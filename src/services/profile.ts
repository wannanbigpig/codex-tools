/**
 * 账号档案服务模块
 *
 * 优化内容:
 * - 添加更详细的 JSDoc 注释
 * - 改进类型安全性
 * - 使用类型守卫
 * - 复用共享工具函数
 * - 使用统一的错误类型
 */

import { CodexTokens } from "../core/types";
import { extractClaims } from "../utils/jwt";
import { fetchWithTimeout } from "../utils/network";
import { APIError } from "../core/errors";
import { logNetworkEvent } from "../utils/debug";

/**
 * 远程账号档案信息
 */
interface RemoteAccountProfile {
  /** 账号名称 */
  accountName?: string;
  /** 账号结构类型 */
  accountStructure?: string;
  /** 账号 ID */
  accountId?: string;
}

/**
 * 类型守卫：判断是否为有效记录对象
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * 从远程 API 获取账号档案
 *
 * @param tokens - 认证令牌
 * @returns 账号档案信息，获取失败时返回 undefined
 */
export async function fetchRemoteAccountProfile(tokens: CodexTokens): Promise<RemoteAccountProfile | undefined> {
  const ACCOUNT_CHECK_URL = "https://chatgpt.com/backend-api/wham/accounts/check";

  const claims = extractClaims(tokens.idToken, tokens.accessToken);
  const accountId = tokens.accountId ?? claims.accountId;
  const primary = await requestAccountProfile(ACCOUNT_CHECK_URL, tokens.accessToken, accountId);
  const shouldRetry =
    accountId &&
    (!primary.ok ? shouldRetryWithoutWorkspace(primary.status, primary.raw) : !parseAccountProfile(primary.payload, accountId, claims.organizationId));

  if (shouldRetry) {
    logNetworkEvent("profile.retry-without-workspace", {
      accountId,
      reason: primary.ok ? "profile_not_matched" : `status_${primary.status}`
    });
    const fallback = await requestAccountProfile(ACCOUNT_CHECK_URL, tokens.accessToken);
    if (fallback.ok) {
      const fallbackProfile = parseAccountProfile(fallback.payload, accountId, claims.organizationId);
      if (fallbackProfile) {
        return fallbackProfile;
      }
    }
  }

  if (!primary.ok) {
    throw new APIError(`Account profile API returned ${primary.status}: ${primary.raw.slice(0, 200)}`, {
      statusCode: primary.status,
      responseBody: primary.raw.slice(0, 200)
    });
  }

  return parseAccountProfile(primary.payload, accountId, claims.organizationId);
}

async function requestAccountProfile(url: string, accessToken: string, accountId?: string): Promise<{
  ok: boolean;
  status: number;
  raw: string;
  payload: Record<string, unknown>;
}> {
  const headers = new Headers({
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json"
  });

  if (accountId) {
    headers.set("ChatGPT-Account-Id", accountId);
  }

  const response = await fetchWithTimeout(
    url,
    {
      method: "GET",
      headers
    },
    8000,
    "Account profile request"
  );

  const raw = await response.text();
  logNetworkEvent("profile", {
    accountId,
    status: response.status,
    ok: response.ok,
    url,
    bodyPreview: raw.slice(0, 1000)
  });

  return {
    ok: response.ok,
    status: response.status,
    raw,
    payload: parseProfilePayload(raw)
  };
}

function parseProfilePayload(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function shouldRetryWithoutWorkspace(status: number, raw: string): boolean {
  if (![400, 401, 402, 403, 404, 409].includes(status)) {
    return false;
  }

  const normalized = raw.toLowerCase();
  return (
    normalized.includes("workspace") ||
    normalized.includes("account") ||
    normalized.includes("deactivated_workspace") ||
    normalized.includes("no active workspace")
  );
}

/**
 * 解析账号档案数据
 */
function parseAccountProfile(
  payload: Record<string, unknown>,
  expectedAccountId?: string,
  expectedOrgId?: string
): RemoteAccountProfile | undefined {
  const records = collectAccountRecords(payload);
  if (!records.length) {
    return undefined;
  }

  let selected: Record<string, unknown> | undefined;

  if (expectedAccountId) {
    selected = findById(records, expectedAccountId);
    // 当请求已明确指定账号时，只接受精确匹配，避免把其他 workspace 错绑到当前令牌上。
    if (!selected) {
      return undefined;
    }
  } else {
    const orderingValue = payload["account_ordering"];
    const orderedFirstId = Array.isArray(orderingValue)
      ? orderingValue.find((item): item is string => typeof item === "string" && item.trim().length > 0)
      : undefined;

    if (orderedFirstId) {
      selected = findById(records, orderedFirstId);
    }

    if (!selected && expectedOrgId) {
      selected = findByOrg(records, expectedOrgId);
    }

    if (!selected) {
      selected = records[0];
    }
  }

  return {
    accountName: readField(selected, [
      "name",
      "display_name",
      "account_name",
      "organization_name",
      "workspace_name",
      "title"
    ]),
    accountStructure: readField(selected, ["structure", "account_structure", "kind", "type", "account_type"]),
    accountId: readField(selected, ["id", "account_id", "chatgpt_account_id", "workspace_id"])
  };
}

/**
 * 收集账号记录数组
 */
function collectAccountRecords(payload: Record<string, unknown>): Array<Record<string, unknown>> {
  const accountsValue = payload["accounts"];
  if (Array.isArray(accountsValue)) {
    return accountsValue.filter(isRecord);
  }

  if (isRecord(accountsValue)) {
    return Object.values(accountsValue).filter(isRecord);
  }

  return [];
}

/**
 * 按 ID 查找记录
 */
function findById(records: Array<Record<string, unknown>>, expectedId?: string): Record<string, unknown> | undefined {
  if (!expectedId) {
    return undefined;
  }

  return records.find((record) => {
    const candidate = readField(record, ["id", "account_id", "chatgpt_account_id", "workspace_id"]);
    return candidate === expectedId;
  })!;
}

/**
 * 按组织 ID 查找记录
 */
function findByOrg(
  records: Array<Record<string, unknown>>,
  expectedOrgId?: string
): Record<string, unknown> | undefined {
  if (!expectedOrgId) {
    return undefined;
  }

  return records.find((record) => {
    const candidate = readField(record, ["organization_id", "org_id", "workspace_id"]);
    return candidate === expectedOrgId;
  })!;
}

/**
 * 读取字段值
 */
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
