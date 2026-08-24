/**
 * 订阅查询服务
 *
 * 对齐 cockpit codex_quota.rs 的 subscription 查询链：
 * 1. GET accounts/check/v4-2023-04-27 → plan_type + expires_at
 * 2. 若 expires_at 缺失/过期 → GET subscriptions?account_id= → 补全
 * 3. 失败后 30 分钟回退重试
 */

import type { CodexAccountRecord } from "../core/types";
import { fetchWithTimeout } from "../utils/network";
import { logNetworkEvent } from "../utils/debug";
import { APIError } from "../core/errors";
import { isFreePlanType } from "../utils/quotaLabels";
import {
  SUBSCRIPTION_ACCOUNTS_CHECK_URL,
  SUBSCRIPTION_RETRY_INTERVAL_SECONDS,
  SUBSCRIPTIONS_URL
} from "../infrastructure/config/apiEndpoints";

/** 订阅状态快照 */
export interface SubscriptionStatusSnapshot {
  accountId?: string;
  planType?: string;
  subscriptionActiveUntil?: string;
}

/**
 * 判断订阅信息是否缺失或已过期
 */
export function subscriptionMissingOrExpired(raw?: string): boolean {
  if (!raw) {
    return true;
  }
  const ts = parseSubscriptionTimestamp(raw);
  return ts == null || ts <= Math.floor(Date.now() / 1000);
}

/**
 * 判断是否应该尝试刷新订阅（对齐 cockpit should_attempt_subscription_refresh）
 */
export function shouldAttemptSubscriptionRefresh(account: CodexAccountRecord, force: boolean): boolean {
  if (!subscriptionMissingOrExpired(account.subscriptionActiveUntil) && !force) {
    return false;
  }
  if (force) {
    return true;
  }
  const now = Date.now();
  return account.subscriptionQueryNextRetryAt == null || account.subscriptionQueryNextRetryAt <= now;
}

/**
 * 标记订阅查询失败，记录回退时间（对齐 cockpit mark_subscription_retry_pending）
 */
export function markSubscriptionRetryPending(
  account: CodexAccountRecord,
  error?: string
): void {
  const now = Date.now();
  account.subscriptionQueryLastAttemptAt = now;
  account.subscriptionQueryNextRetryAt = now + SUBSCRIPTION_RETRY_INTERVAL_SECONDS * 1000;
  account.subscriptionQueryLastError = error?.trim() || undefined;
}

/**
 * 清除订阅重试状态（对齐 cockpit clear_subscription_retry_pending）
 */
export function clearSubscriptionRetryPending(account: CodexAccountRecord): void {
  account.subscriptionQueryNextRetryAt = undefined;
  account.subscriptionQueryLastError = undefined;
}

/**
 * 查询订阅状态：先调 accounts/check，不够再降级到 subscriptions
 */
export async function fetchSubscriptionStatus(
  accessToken: string,
  accountId?: string,
  organizationId?: string,
  accountName?: string,
  accountStructure?: string
): Promise<SubscriptionStatusSnapshot> {
  // 第一步：accounts/check
  const snapshot = await fetchAccountCheck(
    accessToken,
    accountId,
    organizationId,
    accountName,
    accountStructure
  );

  // 第二步：如果 expires_at 缺失/过期，降级到 subscriptions
  if (!subscriptionMissingOrExpired(snapshot.subscriptionActiveUntil)) {
    return snapshot;
  }

  const effectiveAccountId = snapshot.accountId ?? accountId;
  if (!effectiveAccountId) {
    return sanitizeInactiveSubscription(snapshot);
  }

  let subscriptions: SubscriptionStatusSnapshot | undefined;
  try {
    subscriptions = await fetchSubscriptions(accessToken, effectiveAccountId);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (_error) {
    // subscriptions 失败不抛错，继续使用 accounts/check 结果。
  }

  const merged = {
    accountId: subscriptions?.accountId ?? snapshot.accountId ?? effectiveAccountId,
    planType: subscriptions?.planType ?? snapshot.planType,
    subscriptionActiveUntil: subscriptions?.subscriptionActiveUntil ?? snapshot.subscriptionActiveUntil
  };
  return subscriptionMissingOrExpired(merged.subscriptionActiveUntil)
    ? sanitizeInactiveSubscription(merged)
    : merged;
}

function sanitizeInactiveSubscription(snapshot: SubscriptionStatusSnapshot): SubscriptionStatusSnapshot {
  return {
    accountId: snapshot.accountId,
    planType: isFreePlanType(snapshot.planType) ? snapshot.planType : undefined
  };
}

// ── 内部实现 ──

function currentTimezoneOffsetMin(): number {
  return -new Date().getTimezoneOffset();
}

function buildSubscriptionHeaders(
  accessToken: string,
  targetPath: string,
  accountId?: string
): Headers {
  const headers = new Headers({
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    Referer: "https://chatgpt.com/",
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
    "x-openai-target-path": targetPath,
    "x-openai-target-route": targetPath
  });
  if (accountId) {
    headers.set("ChatGPT-Account-Id", accountId);
  }
  return headers;
}

async function fetchAccountCheck(
  accessToken: string,
  accountId?: string,
  organizationId?: string,
  accountName?: string,
  accountStructure?: string
): Promise<SubscriptionStatusSnapshot> {
  const url = `${SUBSCRIPTION_ACCOUNTS_CHECK_URL}?timezone_offset_min=${currentTimezoneOffsetMin()}`;
  // accounts/check 需要返回该登录用户的完整 workspace 列表，再在响应中按 accountId 选择。
  // 与 cockpit-tools 保持一致，不在此请求上附加 ChatGPT-Account-Id，避免服务端先错误收窄上下文。
  const headers = buildSubscriptionHeaders(accessToken, "/backend-api/accounts/check/v4-2023-04-27");

  const response = await fetchWithTimeout(url, { method: "GET", headers }, 15000, "Subscription account check");

  const raw = await response.text();
  logNetworkEvent("subscription.check", {
    url: SUBSCRIPTION_ACCOUNTS_CHECK_URL,
    status: response.status,
    ok: response.ok,
    bodyPreview: raw
  });

  if (!response.ok) {
    throw new APIError(`Account check API returned ${response.status}: ${raw.slice(0, 200)}`, {
      statusCode: response.status,
      responseBody: raw.slice(0, 200)
    });
  }

  const payload = JSON.parse(raw) as Record<string, unknown>;
  return parseAccountCheckSnapshot(payload, accountId, organizationId, accountName, accountStructure);
}

async function fetchSubscriptions(
  accessToken: string,
  accountId: string
): Promise<SubscriptionStatusSnapshot> {
  const url = `${SUBSCRIPTIONS_URL}?account_id=${encodeURIComponent(accountId)}`;
  const headers = buildSubscriptionHeaders(accessToken, "/backend-api/subscriptions");

  const response = await fetchWithTimeout(url, { method: "GET", headers }, 15000, "Subscription query");

  const raw = await response.text();
  logNetworkEvent("subscription.detail", {
    url: SUBSCRIPTIONS_URL,
    accountId,
    status: response.status,
    ok: response.ok,
    bodyPreview: raw
  });

  if (!response.ok) {
    throw new APIError(`Subscriptions API returned ${response.status}: ${raw.slice(0, 200)}`, {
      statusCode: response.status,
      responseBody: raw.slice(0, 200)
    });
  }

  const payload = JSON.parse(raw) as Record<string, unknown>;
  return {
    accountId,
    planType: readOptionalScalar(payload, ["subscription_plan", "plan_type"]),
    subscriptionActiveUntil: readOptionalScalar(payload, ["active_until", "expires_at"])
  };
}

// ── accounts/check 响应解析 ──

function parseAccountCheckSnapshot(
  payload: Record<string, unknown>,
  preferredAccountId?: string,
  preferredOrganizationId?: string,
  preferredAccountName?: string,
  preferredAccountStructure?: string
): SubscriptionStatusSnapshot {
  const records = collectAccountRecords(payload);
  if (!records.length) {
    return {};
  }

  // 选匹配的 account：优先 preferredAccountId，其次 account_ordering 首个
  const orderingFirstKey =
    (Array.isArray(payload["account_ordering"]) &&
      (payload["account_ordering"] as string[]).find((v) => typeof v === "string" && v.trim())) ||
    undefined;

  const selected =
    records.find((r) => matchesWorkspaceRecord(r, preferredAccountId, preferredOrganizationId, true)) ??
    records.find((r) => matchesWorkspaceRecord(r, undefined, preferredOrganizationId, false)) ??
    records.find((r) => matchesWorkspaceName(r, preferredAccountName)) ??
    records.find((r) => matchesWorkspaceStructure(r, preferredAccountStructure)) ??
    records.find((r) => {
      const accountRecord = isRecord(r["account"]) ? r["account"] : r;
      const id = readField(accountRecord, ["account_id", "id", "chatgpt_account_id", "workspace_id"]);
      return preferredAccountId && id === preferredAccountId;
    }) ??
    records.find((r) => {
      const key = readField(r, ["key"]);
      return orderingFirstKey && key === orderingFirstKey;
    }) ??
    records[0];

  if (!selected) {
    return {};
  }

  const accountRecord = (selected["account"] as Record<string, unknown> | undefined) ?? selected;
  const entitlement = selected["entitlement"] as Record<string, unknown> | undefined;

  return {
    accountId: readField(accountRecord, ["account_id", "id", "chatgpt_account_id", "workspace_id"]),
    planType:
      (entitlement != null ? readField(entitlement, ["subscription_plan"]) : undefined) ??
      readField(accountRecord, ["plan_type", "planType"]),
    subscriptionActiveUntil:
      (entitlement != null ? readField(entitlement, ["expires_at"]) : undefined) ??
      readField(accountRecord, ["expires_at"])
  };
}

function matchesWorkspaceName(
  record: Record<string, unknown>,
  accountName: string | undefined
): boolean {
  const normalizedName = accountName?.trim().toLowerCase();
  if (!normalizedName) {
    return false;
  }
  const accountRecord = isRecord(record["account"]) ? record["account"] : record;
  const candidateName = readField(accountRecord, [
    "name",
    "display_name",
    "account_name",
    "organization_name",
    "workspace_name",
    "title"
  ]);
  return candidateName?.toLowerCase() === normalizedName;
}

function matchesWorkspaceStructure(
  record: Record<string, unknown>,
  accountStructure: string | undefined
): boolean {
  const normalizedStructure = accountStructure?.trim().toLowerCase();
  if (!normalizedStructure) {
    return false;
  }
  const accountRecord = isRecord(record["account"]) ? record["account"] : record;
  const entitlement = isRecord(record["entitlement"]) ? record["entitlement"] : undefined;
  const candidateStructure = readField(accountRecord, ["structure", "account_structure", "kind", "type"])
    ?.trim()
    .toLowerCase();
  const candidatePlan =
    readField(entitlement, ["subscription_plan"])?.toLowerCase() ??
    readField(accountRecord, ["plan_type", "planType"])?.toLowerCase() ??
    "";
  const candidateIsTeam =
    Boolean(candidateStructure && candidateStructure !== "personal") ||
    ["team", "business", "enterprise"].some((plan) => candidatePlan.includes(plan));
  return normalizedStructure === "personal" ? !candidateIsTeam : candidateIsTeam;
}

function matchesWorkspaceRecord(
  record: Record<string, unknown>,
  accountId: string | undefined,
  organizationId: string | undefined,
  requireBoth: boolean
): boolean {
  if (!organizationId || (requireBoth && !accountId)) {
    return false;
  }
  const accountRecord = isRecord(record["account"]) ? record["account"] : record;
  const candidateAccountId = readField(accountRecord, ["account_id", "id", "chatgpt_account_id"]);
  const candidateOrganizationId = readField(accountRecord, ["organization_id", "org_id", "workspace_id"]);
  return candidateOrganizationId === organizationId && (!requireBoth || candidateAccountId === accountId);
}

function collectAccountRecords(payload: Record<string, unknown>): Array<Record<string, unknown>> {
  const accountsValue = payload["accounts"];
  if (Array.isArray(accountsValue)) {
    return accountsValue.filter(isRecord);
  }
  if (isRecord(accountsValue)) {
    return Object.entries(accountsValue).flatMap(([key, value]) =>
      isRecord(value) ? [{ ...value, key: readField(value, ["key"]) ?? key }] : []
    );
  }
  // 兜底：整个 payload 本身是数组
  if (Array.isArray(payload)) {
    return (payload as unknown[]).filter(isRecord);
  }
  return [];
}

// ── 工具函数 ──

function readField(record: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!record) {
    return undefined;
  }
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function readOptionalScalar(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseSubscriptionTimestamp(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  // 纯数字时间戳
  if (/^\d+$/.test(trimmed)) {
    let ts = Number(trimmed);
    if (ts > 1_000_000_000_000) {
      ts = Math.floor(ts / 1000);
    }
    return ts;
  }
  // ISO 8601
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : undefined;
}
