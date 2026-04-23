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
  CodexAccountRecord,
  CodexQuotaErrorInfo,
  CodexQuotaSummary,
  CodexTokens,
  CodexUsageResponse,
  UsageWindowInfo
} from "../core/types";
import { needsRefresh, refreshTokens } from "../auth/oauth";
import { shouldRetryWithoutWorkspace } from "./workspaceRetry";
import { QUOTA_USAGE_URL } from "../infrastructure/config/apiEndpoints";
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
  updatedTokens?: CodexTokens;
  updatedPlanType?: string;
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
  forceRefresh = false
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

    if (needsRefresh(tokens.accessToken)) {
      if (!tokens.refreshToken) {
        return { error: buildError("Token expired and no refresh token is available") };
      }
      effectiveTokens = await refreshTokens(tokens.refreshToken);
      effectiveTokens.accountId = effectiveTokens.accountId ?? account.accountId;
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
      return { error: buildError(extractErrorMessage(usageResult.status, usageResult.raw)), updatedTokens: effectiveTokens };
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
      updatedTokens: effectiveTokens,
      updatedPlanType: usage.plan_type
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
        bodyPreview: raw.slice(0, 1000)
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

/**
 * 解析配额使用量数据
 */
function parseUsage(usage: CodexUsageResponse): CodexQuotaSummary {
  const primary = usage.rate_limit?.primary_window;
  const secondary = usage.rate_limit?.secondary_window;
  const codeReviewRateLimit = resolveCodeReviewRateLimit(usage);
  const codeReviewWindow = resolveCodeReviewWindow(codeReviewRateLimit);
  const percentScale = detectUsagePercentScale(primary, secondary, codeReviewWindow);
  const { hourlyWindow, weeklyWindow } = resolveRateLimitWindows(primary, secondary);
  const hourlyPercentage = resolveRemainingPercentage(hourlyWindow, percentScale);
  const weeklyPercentage = resolveRemainingPercentage(weeklyWindow, percentScale);
  const codeReviewPercentage = resolveRemainingPercentage(codeReviewWindow, percentScale);
  const resolvedCodeReviewPercentage = codeReviewPercentage ?? weeklyPercentage;

  return {
    hourlyPercentage: hourlyPercentage ?? 0,
    hourlyResetTime: normalizeReset(hourlyWindow?.reset_at, hourlyWindow?.reset_after_seconds),
    hourlyWindowMinutes: normalizeWindow(hourlyWindow?.limit_window_seconds),
    hourlyWindowPresent: hourlyPercentage !== undefined,
    weeklyPercentage: weeklyPercentage ?? 0,
    weeklyResetTime: normalizeReset(weeklyWindow?.reset_at, weeklyWindow?.reset_after_seconds),
    weeklyWindowMinutes: normalizeWindow(weeklyWindow?.limit_window_seconds),
    weeklyWindowPresent: weeklyPercentage !== undefined,
    codeReviewPercentage: resolvedCodeReviewPercentage ?? 0,
    codeReviewResetTime:
      normalizeReset(codeReviewWindow?.reset_at, codeReviewWindow?.reset_after_seconds) ??
      normalizeReset(weeklyWindow?.reset_at, weeklyWindow?.reset_after_seconds),
    codeReviewWindowMinutes:
      normalizeWindow(codeReviewWindow?.limit_window_seconds) ??
      normalizeWindow(weeklyWindow?.limit_window_seconds),
    codeReviewWindowPresent: resolvedCodeReviewPercentage !== undefined,
    rawData: usage
  };
}

function resolveCodeReviewRateLimit(
  usage: CodexUsageResponse
): NonNullable<CodexUsageResponse["code_review_rate_limit"]> | undefined {
  return (
    usage.code_review_rate_limit ??
    usage.codeReviewRateLimit ??
    usage.code_review ??
    usage.rate_limit?.code_review_rate_limit ??
    usage.rate_limit?.codeReviewRateLimit ??
    usage.rate_limit?.code_review
  );
}

function resolveCodeReviewWindow(
  rateLimit?: NonNullable<CodexUsageResponse["code_review_rate_limit"]>
): UsageWindowInfo | undefined {
  if (!rateLimit) {
    return undefined;
  }

  const windows = [
    rateLimit.primary_window,
    rateLimit.secondary_window,
    ...(Array.isArray(rateLimit.windows) ? rateLimit.windows : [])
  ].filter((window): window is UsageWindowInfo => Boolean(window));

  if (windows.length === 0) {
    return undefined;
  }

  const withQuotaData = windows.find((window) => hasQuotaData(window));
  if (withQuotaData) {
    return withQuotaData;
  }

  if (windows.length === 1) {
    return windows[0];
  }

  const sorted = [...windows].sort((left, right) => getWindowSeconds(left) - getWindowSeconds(right));
  return sorted[0];
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

  const sorted = [...windows].sort((left, right) => getWindowSeconds(left) - getWindowSeconds(right));
  return {
    hourlyWindow: sorted[0],
    weeklyWindow: sorted[sorted.length - 1]
  };
}

function isWeeklyQuotaWindow(window: NonNullable<CodexUsageResponse["rate_limit"]>["primary_window"]): boolean {
  const minutes = normalizeWindow(window?.limit_window_seconds);
  return typeof minutes === "number" && minutes >= 1440;
}

function getWindowSeconds(window?: UsageWindowInfo): number {
  const seconds = window?.limit_window_seconds;
  return typeof seconds === "number" && seconds > 0 ? seconds : Number.MAX_SAFE_INTEGER;
}

/**
 * 规范化剩余百分比 (转换为 0-100 的范围)
 */
function resolveRemainingPercentage(window: UsageWindowInfo | undefined, scale: "percent" | "ratio"): number | undefined {
  if (!window) {
    return undefined;
  }

  const usedPercent = normalizePercentValue(window.used_percent, scale);
  if (usedPercent !== undefined) {
    return 100 - usedPercent;
  }

  const remainingPercent = normalizePercentValue(window.remaining_percent, scale);
  if (remainingPercent !== undefined) {
    return remainingPercent;
  }

  const remaining = pickNumber(window.remaining, window.requests_left);
  const limit = pickNumber(window.limit, window.requests_limit);
  if (remaining !== undefined && limit !== undefined && limit > 0) {
    return clampPercent((remaining / limit) * 100);
  }

  return undefined;
}

function hasQuotaData(window: UsageWindowInfo): boolean {
  return (
    pickNumber(window.used_percent) !== undefined ||
    pickNumber(window.remaining_percent) !== undefined ||
    (pickNumber(window.remaining, window.requests_left) !== undefined &&
      pickNumber(window.limit, window.requests_limit) !== undefined)
  );
}

function normalizePercentValue(value: number | undefined, scale: "percent" | "ratio"): number | undefined {
  const raw = pickNumber(value);
  if (raw === undefined) {
    return undefined;
  }

  const normalized = scale === "ratio" || (raw >= 0 && raw <= 1) ? raw * 100 : raw;
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

function detectUsagePercentScale(...windows: Array<UsageWindowInfo | undefined>): "percent" | "ratio" {
  const values = windows
    .map((window) => window?.used_percent)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  if (!values.length) {
    return "percent";
  }

  return values.every((value) => value >= 0 && value <= 1) ? "ratio" : "percent";
}

/**
 * 规范化重置时间
 */
function normalizeReset(resetAt?: number, resetAfterSeconds?: number): number | undefined {
  if (typeof resetAt === "number") {
    return resetAt;
  }
  if (typeof resetAfterSeconds === "number" && resetAfterSeconds >= 0) {
    return Math.floor(Date.now() / 1000) + resetAfterSeconds;
  }
  return undefined;
}

/**
 * 规范化窗口大小 (转换为分钟)
 */
function normalizeWindow(limitWindowSeconds?: number): number | undefined {
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
