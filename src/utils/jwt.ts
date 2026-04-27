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

type JwtPayloadCacheEntry = {
  payload: Record<string, unknown>;
  expiresAt?: number;
};

type ClaimsCacheEntry = {
  claims: DecodedAuthClaims;
  expiresAt?: number;
};

const jwtPayloadCache = new Map<string, JwtPayloadCacheEntry>();
const claimsCache = new Map<string, ClaimsCacheEntry>();

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
  pruneExpiredCacheEntries();
  const cached = jwtPayloadCache.get(token);
  if (cached) {
    return cached.payload;
  }

  const parts = token.split(".");
  if (parts.length < 2 || !parts[1]) {
    throw new AuthError("Invalid JWT token format", { code: ErrorCode.AUTH_TOKEN_INVALID });
  }

  const payload = JSON.parse(decodeBase64Url(parts[1])) as Record<string, unknown>;
  const expiresAt = readExpiryEpochMs(payload);
  if (expiresAt) {
    jwtPayloadCache.set(token, { payload, expiresAt });
  }
  return payload;
}

/**
 * 辅助函数：安全读取字符串字段
 */
function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readOptionalScalar(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value === "string") {
    return value.trim() || undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

/**
 * 从 JWT 令牌中提取认证声明
 *
 * @param idToken - ID 令牌
 * @param accessToken - 可选的访问令牌
 * @returns 解码后的认证声明
 */
export function extractClaims(idToken: string, accessToken?: string): DecodedAuthClaims {
  pruneExpiredCacheEntries();
  const cacheKey = buildClaimsCacheKey(idToken, accessToken);
  const cached = claimsCache.get(cacheKey);
  if (cached) {
    return cached.claims;
  }

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

  const claims = {
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
      (accessAuth ? readString(accessAuth, "chatgpt_account_id") : undefined) ??
      (accessAuth ? readString(accessAuth, "account_id") : undefined),
    organizationId:
      readString(idAuth, "organization_id") ??
      readString(idAuth, "chatgpt_organization_id") ??
      readString(idAuth, "org_id") ??
      (accessAuth ? readString(accessAuth, "organization_id") : undefined) ??
      (accessAuth ? readString(accessAuth, "chatgpt_organization_id") : undefined) ??
      (accessAuth ? readString(accessAuth, "org_id") : undefined),
    organizations,
    loginAt: readLoginEpochMs(idPayload, accessPayload),
    subscriptionActiveUntil:
      readOptionalScalar(idAuth, "chatgpt_subscription_active_until") ??
      readOptionalScalar(accessAuth, "chatgpt_subscription_active_until")
  };

  const expiryCandidates = [readExpiryEpochMs(idPayload), readExpiryEpochMs(accessPayload)].filter(
    (value): value is number => typeof value === "number"
  );
  const expiresAt = expiryCandidates.length ? Math.min(...expiryCandidates) : undefined;
  if (typeof expiresAt === "number") {
    claimsCache.set(cacheKey, { claims, expiresAt });
  }

  return claims;
}

/**
 * 获取令牌过期时间 (Unix 秒)
 *
 * @param token - JWT 令牌
 * @returns 过期时间戳，如果不存在则返回 undefined
 */
function getTokenExpiryEpochSeconds(token: string): number | undefined {
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

function readLoginEpochMs(
  idPayload: Record<string, unknown>,
  accessPayload?: Record<string, unknown>
): number | undefined {
  const candidates = [
    idPayload["pwd_auth_time"],
    accessPayload?.["pwd_auth_time"],
    idPayload["auth_time"],
    accessPayload?.["auth_time"],
    idPayload["iat"],
    accessPayload?.["iat"]
  ];

  for (const candidate of candidates) {
    const normalized = normalizeEpochMs(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return undefined;
}

function normalizeEpochMs(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return value > 1_000_000_000_000 ? Math.floor(value) : Math.floor(value * 1000);
}

function buildClaimsCacheKey(idToken: string, accessToken?: string): string {
  return `${idToken}::${accessToken ?? ""}`;
}

function readExpiryEpochMs(payload?: Record<string, unknown>): number | undefined {
  if (!payload) {
    return undefined;
  }
  const expValue = payload["exp"];
  return typeof expValue === "number" && Number.isFinite(expValue) && expValue > 0
    ? Math.floor(expValue * 1000)
    : undefined;
}

function pruneExpiredCacheEntries(): void {
  const now = Date.now();
  pruneMap(jwtPayloadCache, now);
  pruneMap(claimsCache, now);
}

function pruneMap<T extends { expiresAt?: number }>(map: Map<string, T>, now: number): void {
  for (const [key, entry] of map.entries()) {
    if (entry.expiresAt && entry.expiresAt <= now) {
      map.delete(key);
    }
  }
}
