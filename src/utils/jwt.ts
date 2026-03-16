/**
 * JWT 工具模块
 *
 * 优化内容:
 * - 添加更详细的 JSDoc 注释
 * - 改进类型安全性
 * - 添加类型守卫
 * - 使用统一的错误类型
 */

import { DecodedAuthClaims } from "../core/types";
import { AuthError, ErrorCode } from "../core/errors";

/**
 * Base64URL 解码
 */
function decodeBase64Url(segment: string): string {
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padding = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(normalized + "=".repeat(padding), "base64").toString("utf8");
}

/**
 * 解码 JWT payload (第二个部分)
 *
 * @param token - JWT 令牌
 * @returns Payload 对象
 * @throws 当令牌格式无效时
 */
export function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length < 2 || !parts[1]) {
    throw new AuthError("Invalid JWT token format", { code: ErrorCode.AUTH_TOKEN_INVALID });
  }

  return JSON.parse(decodeBase64Url(parts[1])) as Record<string, unknown>;
}

/**
 * 辅助函数：安全读取字符串字段
 */
function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

/**
 * 从 JWT 令牌中提取认证声明
 *
 * @param idToken - ID 令牌
 * @param accessToken - 可选的访问令牌
 * @returns 解码后的认证声明
 */
export function extractClaims(idToken: string, accessToken?: string): DecodedAuthClaims {
  const idPayload = decodeJwtPayload(idToken);
  const accessPayload = accessToken ? decodeJwtPayload(accessToken) : undefined;
  const idAuth = (idPayload["https://api.openai.com/auth"] ?? {}) as Record<string, unknown>;
  const accessAuth = (accessPayload?.["https://api.openai.com/auth"] ?? {}) as Record<string, unknown>;

  const organizationsValue = idAuth["organizations"];
  const organizations = Array.isArray(organizationsValue)
    ? (organizationsValue as Array<{ id?: string; title?: string }>)
    : undefined;

  const emailValue = idPayload["email"];
  const authProviderValue = idPayload["auth_provider"];

  return {
    email: typeof emailValue === "string" ? emailValue : undefined,
    userId:
      readString(idAuth, "chatgpt_user_id") ??
      readString(accessAuth, "chatgpt_user_id") ??
      (accessAuth ? readString(accessAuth, "user_id") : undefined),
    authProvider: typeof authProviderValue === "string" && authProviderValue.trim() ? authProviderValue : undefined,
    planType: readString(idAuth, "chatgpt_plan_type") ?? readString(accessAuth, "chatgpt_plan_type"),
    accountId:
      readString(idAuth, "chatgpt_account_id") ??
      readString(idAuth, "account_id") ??
      (accessAuth ? readString(accessAuth, "chatgpt_account_id") : undefined),
    organizationId:
      readString(idAuth, "organization_id") ??
      readString(idAuth, "chatgpt_organization_id") ??
      readString(idAuth, "org_id"),
    organizations
  };
}

/**
 * 获取令牌过期时间 (Unix 秒)
 *
 * @param token - JWT 令牌
 * @returns 过期时间戳，如果不存在则返回 undefined
 */
export function getTokenExpiryEpochSeconds(token: string): number | undefined {
  const payload = decodeJwtPayload(token);
  const expValue = payload["exp"];
  return typeof expValue === "number" ? expValue : undefined;
}

/**
 * 检查令牌是否已过期
 *
 * @param token - JWT 令牌
 * @param skewSeconds - 容差秒数 (默认 60 秒)
 * @returns 是否已过期
 */
export function isTokenExpired(token: string, skewSeconds = 60): boolean {
  const exp = getTokenExpiryEpochSeconds(token);
  if (!exp) {
    return false;
  }
  return exp <= Math.floor(Date.now() / 1000) + skewSeconds;
}
