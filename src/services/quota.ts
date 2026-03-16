/**
 * 配额服务模块
 *
 * 优化内容:
 * - 使用统一的错误类型
 * - 添加更详细的 JSDoc 注释
 * - 改进类型安全性
 * - 添加配额刷新缓存，避免短时间内重复 API 调用
 */

import { CodexAccountRecord, CodexQuotaErrorInfo, CodexQuotaSummary, CodexTokens, CodexUsageResponse } from "../core/types";
import { refreshTokens } from "../auth/oauth";
import { extractClaims } from "../utils/jwt";

/** 配额缓存失效时间 (毫秒) - 避免短时间内重复刷新 */
const QUOTA_CACHE_TTL_MS = 30000; // 30 秒

/** 配额缓存接口 */
interface QuotaCacheEntry {
  /** 缓存的配额摘要 */
  summary: CodexQuotaSummary;
  /** 缓存时间戳 */
  timestamp: number;
  /** 账号 ID */
  accountId: string;
}

/** 内存缓存 */
let quotaCache: QuotaCacheEntry | null = null;

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
  // 检查缓存（如果非强制刷新）
  if (!forceRefresh && quotaCache) {
    const age = Date.now() - quotaCache.timestamp;
    if (age < QUOTA_CACHE_TTL_MS && quotaCache.accountId === account.id) {
      return { quota: quotaCache.summary };
    }
  }

  let effectiveTokens = tokens;

  // 检查是否需要刷新令牌
  if (await shouldRefresh(tokens)) {
    if (!tokens.refreshToken) {
      return { error: buildError("Token expired and no refresh token is available") };
    }
    effectiveTokens = await refreshTokens(tokens.refreshToken);
    effectiveTokens.accountId = effectiveTokens.accountId ?? account.accountId;
  }

  const accountId = account.accountId ?? extractClaims(effectiveTokens.idToken, effectiveTokens.accessToken).accountId;

  const headers = new Headers({
    Authorization: `Bearer ${effectiveTokens.accessToken}`,
    Accept: "application/json"
  });
  if (accountId) {
    headers.set("ChatGPT-Account-Id", accountId);
  }

  const response = await fetch("https://chatgpt.com/backend-api/wham/usage", {
    method: "GET",
    headers
  });

  const raw = await response.text();
  if (!response.ok) {
    return { error: buildError(extractErrorMessage(response.status, raw)), updatedTokens: effectiveTokens };
  }

  const usage = JSON.parse(raw) as CodexUsageResponse;
  const quotaSummary = parseUsage(usage, raw);

  // 更新缓存
  quotaCache = {
    summary: quotaSummary,
    timestamp: Date.now(),
    accountId: account.id
  };

  return {
    quota: quotaSummary,
    updatedTokens: effectiveTokens,
    updatedPlanType: usage.plan_type
  };
}

/**
 * 判断是否需要刷新令牌
 */
async function shouldRefresh(tokens: CodexTokens): Promise<boolean> {
  const { needsRefresh } = await import("../auth/oauth");
  return needsRefresh(tokens.accessToken);
}

/**
 * 解析配额使用量数据
 */
function parseUsage(usage: CodexUsageResponse, raw: string): CodexQuotaSummary {
  const primary = usage.rate_limit?.primary_window;
  const secondary = usage.rate_limit?.secondary_window;
  const codeReviewPrimary = usage.code_review_rate_limit?.primary_window;

  return {
    hourlyPercentage: normalizeRemaining(primary?.used_percent),
    hourlyResetTime: normalizeReset(primary?.reset_at, primary?.reset_after_seconds),
    hourlyWindowMinutes: normalizeWindow(primary?.limit_window_seconds),
    hourlyWindowPresent: Boolean(primary),
    weeklyPercentage: normalizeRemaining(secondary?.used_percent),
    weeklyResetTime: normalizeReset(secondary?.reset_at, secondary?.reset_after_seconds),
    weeklyWindowMinutes: normalizeWindow(secondary?.limit_window_seconds),
    weeklyWindowPresent: Boolean(secondary),
    codeReviewPercentage: normalizeRemaining(codeReviewPrimary?.used_percent),
    codeReviewResetTime: normalizeReset(codeReviewPrimary?.reset_at, codeReviewPrimary?.reset_after_seconds),
    codeReviewWindowMinutes: normalizeWindow(codeReviewPrimary?.limit_window_seconds),
    codeReviewWindowPresent: Boolean(codeReviewPrimary),
    rawData: JSON.parse(raw) as unknown
  };
}

/**
 * 规范化剩余百分比 (转换为 0-100 的范围)
 */
function normalizeRemaining(usedPercent?: number): number {
  const used = Math.max(0, Math.min(100, usedPercent ?? 0));
  return 100 - used;
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
