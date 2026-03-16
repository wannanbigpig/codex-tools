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
import { APIError } from "../core/errors";

/**
 * 远程账号档案信息
 */
export interface RemoteAccountProfile {
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
  const headers = new Headers({
    Authorization: `Bearer ${tokens.accessToken}`,
    Accept: "application/json"
  });

  const accountId = tokens.accountId ?? claims.accountId;
  if (accountId) {
    headers.set("ChatGPT-Account-Id", accountId);
  }

  const response = await fetch(ACCOUNT_CHECK_URL, {
    method: "GET",
    headers
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new APIError(`Account profile API returned ${response.status}: ${raw.slice(0, 200)}`, {
      statusCode: response.status,
      responseBody: raw.slice(0, 200)
    });
  }

  const payload = JSON.parse(raw) as Record<string, unknown>;
  return parseAccountProfile(payload, claims.accountId, claims.organizationId);
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

  const orderingValue = payload["account_ordering"];
  const orderedFirstId = Array.isArray(orderingValue)
    ? orderingValue.find((item): item is string => typeof item === "string" && item.trim().length > 0)
    : undefined;

  // 按优先级查找：期望的账号 ID > 排序后的第一个 ID > 期望的组织 ID > 第一条记录
  let selected: Record<string, unknown> | undefined;

  if (expectedAccountId) {
    selected = findById(records, expectedAccountId);
  }

  if (!selected && orderedFirstId) {
    selected = findById(records, orderedFirstId);
  }

  if (!selected && expectedOrgId) {
    selected = findByOrg(records, expectedOrgId);
  }

  if (!selected) {
    selected = records[0];
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
