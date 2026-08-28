/**
 * 配额服务模块
 *
 * 优化内容:
 * - 使用统一的错误类型
 * - 添加更详细的 JSDoc 注释
 * - 改进类型安全性
 * - 添加配额刷新缓存，避免短时间内重复 API 调用
 */

import {
  CodexAdditionalQuotaLimit,
  CodexAccountRecord,
  CodexCreditsSummary,
  CodexQuotaErrorInfo,
  CodexQuotaSummary,
  CodexResetCredit,
  CodexResetCreditsSnapshot,
  CodexTokens,
  CodexUsageResponse,
  UsageCreditsInfo,
  UsageRateLimitInfo,
  UsageWindowInfo
} from "../core/types";
import { APIError } from "../core/errors";
import { needsTokenRefresh, refreshTokens } from "../auth/oauth";
import { shouldRetryWithoutWorkspace } from "./workspaceRetry";
import { QUOTA_USAGE_URL, RESET_CREDITS_CONSUME_URL, RESET_CREDITS_URL } from "../infrastructure/config/apiEndpoints";
import { extractClaims } from "../utils/jwt";
import { logNetworkEvent } from "../utils/debug";
import { fetchWithTimeout, isRetriableHttpStatus, isRetriableNetworkError, retryWithBackoff } from "../utils/network";

/** 配额缓存失效时间 (毫秒) - 避免短时间内重复刷新 */
const QUOTA_CACHE_TTL_MS = 30000; // 30 秒

/** 配额缓存接口 */
interface QuotaCacheEntry {
  /** 缓存的配额摘要 */
  summary: CodexQuotaSummary;
  /** 缓存时间戳 */
  timestamp: number;
}

/** 内存缓存 */
const quotaCache = new Map<string, QuotaCacheEntry>();

/** 同账号并发刷新复用 */
const inflightQuotaRefreshes = new Map<string, Promise<QuotaRefreshResult>>();

/** 账号缓存失效代次 */
const quotaCacheGenerations = new Map<string, number>();

export interface QuotaRefreshResult {
  quota?: CodexQuotaSummary;
  error?: CodexQuotaErrorInfo;
  skipped?: "disabled";
  updatedTokens?: CodexTokens;
  updatedPlanType?: string;
  updatedSubscriptionActiveUntil?: string;
}

/**
 * 刷新账号配额
 *
 * @param account - 账号记录
 * @param tokens - 认证令牌
 * @param forceRefresh - 是否强制刷新（忽略缓存），默认 false
 * @returns 刷新结果
 */
export async function refreshQuota(
  account: CodexAccountRecord,
  tokens: CodexTokens,
  forceRefresh = false,
  options: { allowTokenRefresh?: boolean } = {}
): Promise<QuotaRefreshResult> {
  pruneQuotaCache();
  const generation = getQuotaCacheGeneration(account.id);
  if (!forceRefresh) {
    const cached = quotaCache.get(account.id);
    if (cached) {
      if (Date.now() - cached.timestamp < QUOTA_CACHE_TTL_MS) {
        return { quota: cached.summary };
      }
      quotaCache.delete(account.id);
    }
  }

  const inflight = inflightQuotaRefreshes.get(account.id);
  if (inflight) {
    return inflight;
  }

  const refreshTask = (async (): Promise<QuotaRefreshResult> => {
    let effectiveTokens = tokens;
    let tokensUpdated = false;

    if (needsTokenRefresh(tokens) && options.allowTokenRefresh === true) {
      if (!tokens.refreshToken) {
        return { error: buildError("Token expired and no refresh token is available") };
      }
      effectiveTokens = await refreshTokens(tokens.refreshToken, tokens.idToken);
      effectiveTokens.accountId = effectiveTokens.accountId ?? account.accountId;
      tokensUpdated = true;
    }

    const accountId = account.accountId ?? extractClaims(effectiveTokens.idToken, effectiveTokens.accessToken).accountId;
    const primary = await requestQuotaUsage(effectiveTokens.accessToken, accountId);
    const usageResult =
      accountId && !primary.ok && shouldRetryWithoutWorkspace(primary.status, primary.raw)
        ? await (async () => {
            logNetworkEvent("quota.retry-without-workspace", {
              accountId,
              status: primary.status
            });
            return requestQuotaUsage(effectiveTokens.accessToken);
          })()
        : primary;

    if (!usageResult.ok) {
      return {
        error: buildError(extractErrorMessage(usageResult.status, usageResult.raw)),
        updatedTokens: tokensUpdated ? effectiveTokens : undefined
      };
    }

    const usage = usageResult.payload;
    const quotaSummary = parseUsage(usage);

    if (generation === getQuotaCacheGeneration(account.id)) {
      quotaCache.set(account.id, {
        summary: quotaSummary,
        timestamp: Date.now()
      });
    }

    return {
      quota: quotaSummary,
      updatedTokens: tokensUpdated ? effectiveTokens : undefined,
      updatedPlanType: usage.plan_type,
      updatedSubscriptionActiveUntil: readUsageSubscriptionActiveUntil(usage)
    };
  })();

  inflightQuotaRefreshes.set(account.id, refreshTask);
  try {
    return await refreshTask;
  } finally {
    if (inflightQuotaRefreshes.get(account.id) === refreshTask) {
      inflightQuotaRefreshes.delete(account.id);
    }
  }
}

async function requestQuotaUsage(accessToken: string, accountId?: string): Promise<{
  ok: boolean;
  status: number;
  raw: string;
  payload: CodexUsageResponse;
}> {
  return retryWithBackoff(
    async () => {
      const headers = new Headers({
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json"
      });
      if (accountId) {
        headers.set("ChatGPT-Account-Id", accountId);
      }

      const response = await fetchWithTimeout(
        QUOTA_USAGE_URL,
        {
          method: "GET",
          headers
        },
        15000,
        "Quota request"
      );

      const raw = await response.text();
      logNetworkEvent("quota", {
        accountId,
        status: response.status,
        ok: response.ok,
        url: QUOTA_USAGE_URL,
        bodyPreview: raw
      });

      return {
        ok: response.ok,
        status: response.status,
        raw,
        payload: parseUsagePayload(raw)
      };
    },
    {
      shouldRetryError: isRetriableNetworkError,
      shouldRetryResult: (result) => !result.ok && isRetriableHttpStatus(result.status)
    }
  );
}

function parseUsagePayload(raw: string): CodexUsageResponse {
  try {
    return JSON.parse(raw) as CodexUsageResponse;
  } catch {
    return {};
  }
}

function readUsageSubscriptionActiveUntil(usage: CodexUsageResponse): string | undefined {
  return normalizeOptionalScalar(
    usage.subscription_active_until ?? usage.subscriptionActiveUntil ?? usage.chatgpt_subscription_active_until
  );
}

function normalizeOptionalScalar(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const key of ["value", "timestamp", "ts", "seconds", "sec", "unix", "epoch", "epoch_seconds", "epochSeconds"]) {
      const normalized = normalizeOptionalScalar(record[key]);
      if (normalized) {
        return normalized;
      }
    }
  }
  return undefined;
}

/**
 * 解析配额使用量数据
 */
function parseUsage(usage: CodexUsageResponse): CodexQuotaSummary {
  const primary = pickWindow(usage.rate_limit, "primary");
  const secondary = pickWindow(usage.rate_limit, "secondary");
  const additionalRateLimitItems = normalizeAdditionalRateLimitItems(
    usage.additional_rate_limits ?? usage.additionalRateLimits
  );
  const additionalWindows = additionalRateLimitItems.flatMap((item) => [
    pickWindow(item.rateLimit, "primary"),
    pickWindow(item.rateLimit, "secondary")
  ]);

  // code_review_rate_limit 结构与 rate_limit 一致，含 primary_window / secondary_window
  const crPrimary = pickWindow(usage.code_review_rate_limit, "primary");
  const crSecondary = pickWindow(usage.code_review_rate_limit, "secondary");
  const crWindow = crPrimary ?? crSecondary;

  const allWindows = [primary, secondary, crPrimary, crSecondary, ...additionalWindows];
  const percentScale = detectUsagePercentScale(...allWindows);
  const { hourlyWindow, weeklyWindow } = resolveRateLimitWindows(primary, secondary);
  const hourlyPercentage = resolveRemainingPercentage(hourlyWindow, percentScale);
  const weeklyPercentage = resolveRemainingPercentage(weeklyWindow, percentScale);

  const crPercentage = resolveRemainingPercentage(extractCodeReviewWindow(crPrimary, crSecondary), percentScale);

  return {
    hourlyPercentage: hourlyPercentage ?? 0,
    hourlyResetTime: normalizeReset(hourlyWindow),
    hourlyRequestsLeft: pickNumberField(hourlyWindow, "remaining", "requests_left", "requestsLeft"),
    hourlyRequestsLimit: pickNumberField(hourlyWindow, "limit", "requests_limit", "requestsLimit"),
    hourlyWindowMinutes: normalizeWindow(hourlyWindow),
    hourlyWindowPresent: hourlyPercentage !== undefined,
    weeklyPercentage: weeklyPercentage ?? 0,
    weeklyResetTime: normalizeReset(weeklyWindow),
    weeklyRequestsLeft: pickNumberField(weeklyWindow, "remaining", "requests_left", "requestsLeft"),
    weeklyRequestsLimit: pickNumberField(weeklyWindow, "limit", "requests_limit", "requestsLimit"),
    weeklyWindowMinutes: normalizeWindow(weeklyWindow),
    weeklyWindowPresent: weeklyPercentage !== undefined,
    codeReviewPercentage: crPercentage ?? 0,
    codeReviewResetTime: crWindow ? normalizeReset(crWindow) : undefined,
    codeReviewRequestsLeft: crWindow ? pickNumberField(crWindow, "remaining", "requests_left", "requestsLeft") : undefined,
    codeReviewRequestsLimit: crWindow ? pickNumberField(crWindow, "limit", "requests_limit", "requestsLimit") : undefined,
    codeReviewWindowMinutes: crWindow ? normalizeWindow(crWindow) : undefined,
    codeReviewWindowPresent: crPercentage !== undefined,
    additionalRateLimits: parseAdditionalRateLimits(additionalRateLimitItems, percentScale),
    credits: normalizeCredits(usage.credits),
    resetCreditsAvailable: normalizeResetCreditsAvailable(usage),
    rawData: usage
  };
}

function normalizeResetCreditsAvailable(usage: CodexUsageResponse): number | undefined {
  const src = usage.rate_limit_reset_credits ?? usage.rateLimitResetCredits;
  // 调试日志：确认 API 是否返回了 rate_limit_reset_credits 字段
  logNetworkEvent("quota.resetCredits", {
    hasField: Boolean(src),
    availableCount: src?.available_count ?? src?.availableCount,
    topKeys: Object.keys(usage as Record<string, unknown>).filter(
      (k) => k.toLowerCase().includes("reset") || k.toLowerCase().includes("credit")
    )
  });
  if (!src) {
    return undefined;
  }
  const value = src.available_count ?? src.availableCount;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * code_review_rate_limit 只有一个窗口（primary_window），兜底取 secondary_window。
 * 与主 rate_limit 不同，这里直接取存在的窗口作为额度窗口。
 */
function extractCodeReviewWindow(
  primary: UsageWindowInfo | undefined,
  secondary: UsageWindowInfo | undefined
): UsageWindowInfo | undefined {
  return primary ?? secondary;
}

type NormalizedAdditionalRateLimit = {
  limitName: string;
  meteredFeature?: string;
  rateLimit: UsageRateLimitInfo;
};

function normalizeAdditionalRateLimitItems(
  items: CodexUsageResponse["additional_rate_limits"]
): NormalizedAdditionalRateLimit[] {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const rateLimit = item.rate_limit ?? item.rateLimit;
    if (!rateLimit || typeof rateLimit !== "object") {
      return [];
    }

    return [
      {
        limitName: readOptionalString(item.limit_name, item.limitName, item.name) ?? "额外模型",
        meteredFeature: readOptionalString(item.metered_feature, item.meteredFeature),
        rateLimit
      }
    ];
  });
}

function parseAdditionalRateLimits(
  items: NormalizedAdditionalRateLimit[],
  percentScale: "percent" | "ratio"
): CodexAdditionalQuotaLimit[] {
  return items.map((item) => {
    const { hourlyWindow, weeklyWindow } = resolveRateLimitWindows(
      pickWindow(item.rateLimit, "primary"),
      pickWindow(item.rateLimit, "secondary")
    );
    const hourlyPercentage = resolveRemainingPercentage(hourlyWindow, percentScale);
    const weeklyPercentage = resolveRemainingPercentage(weeklyWindow, percentScale);

    return {
      limitName: item.limitName,
      meteredFeature: item.meteredFeature,
      hourlyPercentage,
      hourlyResetTime: normalizeReset(hourlyWindow),
      hourlyRequestsLeft: pickNumberField(hourlyWindow, "remaining", "requests_left", "requestsLeft"),
      hourlyRequestsLimit: pickNumberField(hourlyWindow, "limit", "requests_limit", "requestsLimit"),
      hourlyWindowMinutes: normalizeWindow(hourlyWindow),
      hourlyWindowPresent: hourlyPercentage !== undefined,
      weeklyPercentage,
      weeklyResetTime: normalizeReset(weeklyWindow),
      weeklyRequestsLeft: pickNumberField(weeklyWindow, "remaining", "requests_left", "requestsLeft"),
      weeklyRequestsLimit: pickNumberField(weeklyWindow, "limit", "requests_limit", "requestsLimit"),
      weeklyWindowMinutes: normalizeWindow(weeklyWindow),
      weeklyWindowPresent: weeklyPercentage !== undefined
    };
  });
}

function normalizeCredits(credits: UsageCreditsInfo | null | undefined): CodexCreditsSummary | undefined {
  if (!credits || typeof credits !== "object") {
    return undefined;
  }

  return {
    hasCredits: credits.has_credits === true || credits.hasCredits === true,
    unlimited: credits.unlimited === true,
    overageLimitReached: credits.overage_limit_reached === true || credits.overageLimitReached === true,
    balance: String(credits.balance ?? "").trim(),
    approxLocalMessages: Array.isArray(credits.approx_local_messages)
      ? credits.approx_local_messages
      : Array.isArray(credits.approxLocalMessages)
        ? credits.approxLocalMessages
        : [],
    approxCloudMessages: Array.isArray(credits.approx_cloud_messages)
      ? credits.approx_cloud_messages
      : Array.isArray(credits.approxCloudMessages)
        ? credits.approxCloudMessages
        : []
  };
}

function resolveRateLimitWindows(
  primary?: CodexUsageResponse["rate_limit"] extends infer R
    ? R extends { primary_window?: infer W }
      ? W
      : never
    : never,
  secondary?: CodexUsageResponse["rate_limit"] extends infer R
    ? R extends { secondary_window?: infer W }
      ? W
      : never
    : never
): {
  hourlyWindow?: typeof primary;
  weeklyWindow?: typeof primary;
} {
  const windows = [primary, secondary].filter((window): window is NonNullable<typeof primary> => Boolean(window));
  if (windows.length === 0) {
    return {};
  }

  if (windows.length === 1) {
    const [onlyWindow] = windows;
    return isWeeklyQuotaWindow(onlyWindow) ? { weeklyWindow: onlyWindow } : { hourlyWindow: onlyWindow };
  }

  const sorted = sortWindowsByDuration(windows);
  return {
    hourlyWindow: sorted[0],
    weeklyWindow: sorted[sorted.length - 1]
  };
}

function isWeeklyQuotaWindow(window: NonNullable<CodexUsageResponse["rate_limit"]>["primary_window"]): boolean {
  const minutes = normalizeWindow(window);
  return typeof minutes === "number" && minutes >= 1440;
}

function getWindowSeconds(window?: UsageWindowInfo): number {
  const seconds = pickNumberField(window, "limit_window_seconds", "limitWindowSeconds");
  return typeof seconds === "number" && seconds > 0 ? seconds : Number.MAX_SAFE_INTEGER;
}

function sortWindowsByDuration(windows: UsageWindowInfo[]): UsageWindowInfo[] {
  return [...windows].sort((left, right) => getWindowSeconds(left) - getWindowSeconds(right));
}

/**
 * 规范化剩余百分比 (转换为 0-100 的范围)
 */
function resolveRemainingPercentage(window: UsageWindowInfo | undefined, scale: "percent" | "ratio"): number | undefined {
  if (!window) {
    return undefined;
  }

  const usedPercent = normalizePercentValue(pickNumberField(window, "used_percent", "usedPercent"), scale);
  if (usedPercent !== undefined) {
    return 100 - usedPercent;
  }

  const remainingPercent = normalizePercentValue(pickNumberField(window, "remaining_percent", "remainingPercent"), scale);
  if (remainingPercent !== undefined) {
    return remainingPercent;
  }

  const remaining = pickNumberField(window, "remaining", "requests_left", "requestsLeft");
  const limit = pickNumberField(window, "limit", "requests_limit", "requestsLimit");
  if (remaining !== undefined && limit !== undefined && limit > 0) {
    return clampPercent((remaining / limit) * 100);
  }

  return undefined;
}

function normalizePercentValue(value: number | undefined, scale: "percent" | "ratio"): number | undefined {
  const raw = pickNumber(value);
  if (raw === undefined) {
    return undefined;
  }

  const normalized = scale === "ratio" ? raw * 100 : raw;
  return clampPercent(normalized);
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function pickNumber(...values: Array<number | undefined>): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function readOptionalString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function pickNumberField<T extends string>(source: Partial<Record<T, number>> | undefined, ...keys: T[]): number | undefined {
  if (!source) {
    return undefined;
  }

  return pickNumber(...keys.map((key) => source[key]));
}

function pickWindow(source: UsageRateLimitInfo | CodexUsageResponse["rate_limit"] | undefined, kind: "primary" | "secondary"): UsageWindowInfo | undefined {
  if (!source) {
    return undefined;
  }

  return kind === "primary"
    ? source.primary_window ?? source.primaryWindow
    : source.secondary_window ?? source.secondaryWindow;
}

function detectUsagePercentScale(...windows: Array<UsageWindowInfo | undefined>): "percent" | "ratio" {
  const values = windows
    .map((window) => pickNumberField(window, "used_percent", "usedPercent"))
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  if (!values.length) {
    return "percent";
  }

  const nonZeroValues = values.filter((value) => value !== 0);
  if (!nonZeroValues.length) {
    return "percent";
  }

  return nonZeroValues.every((value) => value > 0 && value < 1) ? "ratio" : "percent";
}

/**
 * 规范化重置时间
 */
function normalizeReset(window?: UsageWindowInfo): number | undefined {
  const resetAt = pickNumberField(window, "reset_at", "resetAt", "reset_time", "resetTime");
  if (typeof resetAt === "number") {
    return resetAt > 1_000_000_000_000 ? Math.floor(resetAt / 1000) : Math.floor(resetAt);
  }
  const resetAfterSeconds = pickNumberField(window, "reset_after_seconds", "resetAfterSeconds", "reset_after", "resetAfter");
  if (typeof resetAfterSeconds === "number" && resetAfterSeconds >= 0) {
    return Math.floor(Date.now() / 1000) + resetAfterSeconds;
  }
  return undefined;
}

/**
 * 规范化窗口大小 (转换为分钟)
 */
function normalizeWindow(window?: UsageWindowInfo): number | undefined {
  const limitWindowSeconds = pickNumberField(window, "limit_window_seconds", "limitWindowSeconds");
  if (typeof limitWindowSeconds !== "number" || limitWindowSeconds <= 0) {
    return undefined;
  }
  return Math.ceil(limitWindowSeconds / 60);
}

/**
 * 提取错误消息
 */
function extractErrorMessage(status: number, raw: string): string {
  try {
    const payload = JSON.parse(raw) as Record<string, unknown>;
    const detailValue = payload["detail"];
    const detail = detailValue as Record<string, unknown> | undefined;
    const codeValue = detail?.["code"];
    const code = typeof codeValue === "string" ? codeValue : undefined;
    const shortRaw = raw.slice(0, 200);
    return code ? `API returned ${status} [error_code:${code}] - ${shortRaw}` : `API returned ${status} - ${shortRaw}`;
  } catch {
    return `API returned ${status} - ${raw.slice(0, 200)}`;
  }
}

/**
 * 构建错误信息对象
 */
function buildError(message: string): CodexQuotaErrorInfo {
  const codeMatch = message.match(/\[error_code:([^\]]+)\]/);
  return {
    code: codeMatch?.[1],
    message,
    timestamp: Math.floor(Date.now() / 1000)
  };
}

function pruneQuotaCache(): void {
  const now = Date.now();
  for (const [key, entry] of quotaCache.entries()) {
    if (now - entry.timestamp >= QUOTA_CACHE_TTL_MS) {
      quotaCache.delete(key);
    }
  }
}

/**
 * 清理指定账号的配额缓存
 *
 * @param accountId - 账号 ID
 */
export function clearQuotaCacheForAccount(accountId: string): void {
  quotaCacheGenerations.set(accountId, getQuotaCacheGeneration(accountId) + 1);
  quotaCache.delete(accountId);
  inflightQuotaRefreshes.delete(accountId);
}

function getQuotaCacheGeneration(accountId: string): number {
  return quotaCacheGenerations.get(accountId) ?? 0;
}

// ── 主动重置次数（rate-limit reset credits）──

/**
 * 查询账号的主动重置次数（可用于手动重置 5 小时配额窗口）。
 *
 * @param accessToken - access token
 * @param accountId - ChatGPT account ID
 * @returns 重置次数快照
 */
export async function fetchResetCredits(
  accessToken: string,
  accountId?: string
): Promise<CodexResetCreditsSnapshot> {
  const headers = new Headers({
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json"
  });
  if (accountId) {
    headers.set("ChatGPT-Account-Id", accountId);
  }

  const response = await fetchWithTimeout(
    RESET_CREDITS_URL,
    { method: "GET", headers },
    15000,
    "Reset credits request"
  );

  const raw = await response.text();
  logNetworkEvent("resetCredits", {
    accountId,
    status: response.status,
    ok: response.ok,
    url: RESET_CREDITS_URL,
    bodyPreview: raw
  });

  if (!response.ok) {
    const detailCode = extractErrorDetailCode(raw);
    throw new APIError(`Reset credits API returned ${response.status}: ${raw.slice(0, 200)}`, {
      statusCode: response.status,
      responseBody: raw.slice(0, 200),
      context: detailCode ? { errorCode: detailCode } : undefined
    });
  }

  return parseResetCreditsSnapshot(JSON.parse(raw) as Record<string, unknown>);
}

/**
 * 消耗一次主动重置次数。
 *
 * @param accessToken - access token
 * @param accountId - ChatGPT account ID
 */
export async function consumeResetCredit(
  accessToken: string,
  accountId?: string
): Promise<void> {
  const headers = new Headers({
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    Accept: "application/json"
  });
  if (accountId) {
    headers.set("ChatGPT-Account-Id", accountId);
  }

  // redeem_request_id 使用随机 UUID v4 风格标识
  const redeemRequestId = `cr-${crypto.randomUUID()}`;

  const response = await fetchWithTimeout(
    RESET_CREDITS_CONSUME_URL,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ redeem_request_id: redeemRequestId })
    },
    15000,
    "Consume reset credit"
  );

  const raw = await response.text();
  logNetworkEvent("consumeResetCredit", {
    accountId,
    redeemRequestId,
    status: response.status,
    ok: response.ok,
    url: RESET_CREDITS_CONSUME_URL,
    bodyPreview: raw
  });

  if (!response.ok) {
    const detailCode = extractErrorDetailCode(raw);
    throw new APIError(`Consume reset credit returned ${response.status}: ${raw.slice(0, 200)}`, {
      statusCode: response.status,
      responseBody: raw.slice(0, 200),
      context: detailCode ? { errorCode: detailCode } : undefined
    });
  }
}

function parseResetCreditsSnapshot(payload: Record<string, unknown>): CodexResetCreditsSnapshot {
  const dataRecord = isResetCreditRecord(payload["data"]) ? payload["data"] : undefined;
  const creditsValue = payload["credits"] ?? dataRecord?.["credits"];
  const credits: CodexResetCredit[] = Array.isArray(creditsValue)
    ? creditsValue.filter(isResetCreditRecord).map(parseResetCreditRecord)
    : [];

  const availableCount =
    normalizeOptionalInt(payload["available_count"]) ??
    normalizeOptionalInt(payload["availableCount"]) ??
    normalizeOptionalInt(dataRecord?.["available_count"]) ??
    normalizeOptionalInt(dataRecord?.["availableCount"]) ??
    credits.filter(isAvailableResetCredit).length;

  const explicitNextExpiresAt =
    readResetCreditTimestamp(payload, [
      "next_expires_at",
      "nextExpiresAt",
      "reset_credits_next_expires_at",
      "resetCreditsNextExpiresAt"
    ]) ??
    (dataRecord
      ? readResetCreditTimestamp(dataRecord, [
          "next_expires_at",
          "nextExpiresAt",
          "reset_credits_next_expires_at",
          "resetCreditsNextExpiresAt"
        ])
      : undefined);

  const derivedNextExpiresAt = credits
    .filter(isAvailableResetCredit)
    .map((c) => c.expires_at)
    .filter((v): v is number => typeof v === "number" && v > 0)
    .sort((a, b) => a - b)[0];

  const nextExpiresAt = explicitNextExpiresAt ?? derivedNextExpiresAt;

  return { availableCount, credits, nextExpiresAt };
}

function parseResetCreditRecord(record: Record<string, unknown>): CodexResetCredit {
  const rawStatus = readResetCreditString(record, ["status", "state"]);
  const expiresAt = readResetCreditTimestamp(record, ["expires_at", "expire_at", "expiresAt"]);
  return {
    id: readResetCreditString(record, ["id", "credit_id", "creditId"]),
    status: normalizeResetCreditStatus(rawStatus, expiresAt),
    reset_type: readResetCreditString(record, ["type", "reset_type", "resetType"]),
    granted_at: readResetCreditTimestamp(record, ["granted_at", "created_at", "grantedAt"]),
    expires_at: expiresAt,
    redeemed_at: readResetCreditTimestamp(record, ["redeemed_at", "used_at", "consumed_at", "redeemedAt"]),
    raw_status: rawStatus
  };
}

function normalizeResetCreditStatus(rawStatus: string | undefined, expiresAt: number | undefined): string | undefined {
  const status = (rawStatus ?? "available").trim().toLowerCase();
  if (["redeemed", "used", "consumed", "expired"].includes(status)) {
    return status;
  }
  if (typeof expiresAt === "number" && expiresAt <= Math.floor(Date.now() / 1000)) {
    return "expired";
  }
  return status;
}

function isAvailableResetCredit(credit: CodexResetCredit): boolean {
  const status = credit.status?.trim().toLowerCase() ?? "available";
  if (["redeemed", "used", "consumed", "expired"].includes(status)) {
    return false;
  }
  return credit.expires_at === undefined || credit.expires_at > Math.floor(Date.now() / 1000);
}

function readResetCreditString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function readResetCreditTimestamp(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value > 1_000_000_000_000 ? Math.floor(value / 1000) : value;
    }
    if (typeof value === "string" && value.trim()) {
      const trimmed = value.trim();
      const numericTimestamp = Number(trimmed);
      if (Number.isFinite(numericTimestamp) && numericTimestamp > 0) {
        return numericTimestamp > 1_000_000_000_000 ? Math.floor(numericTimestamp / 1000) : numericTimestamp;
      }

      const dateTimestamp = Date.parse(trimmed);
      if (Number.isFinite(dateTimestamp) && dateTimestamp > 0) {
        return Math.floor(dateTimestamp / 1000);
      }
    }
  }
  return undefined;
}

function isResetCreditRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeOptionalInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  return undefined;
}

function extractErrorDetailCode(body: string): string | undefined {
  try {
    const value = JSON.parse(body) as Record<string, unknown>;
    const detail = value["detail"];
    if (detail && typeof detail === "object") {
      const code = (detail as Record<string, unknown>)["code"];
      if (typeof code === "string" && code) {
        return code;
      }
    }
    const err = value["error"];
    if (err && typeof err === "object") {
      const code = (err as Record<string, unknown>)["code"];
      if (typeof code === "string" && code) {
        return code;
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}
