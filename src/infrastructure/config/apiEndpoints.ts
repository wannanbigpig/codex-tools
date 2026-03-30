/**
 * API 端点配置
 *
 * 集中管理所有外部 API 端点，便于维护和配置
 */

/** Codex API 基础域名 */
export const CODEX_API_BASE = "https://chatgpt.com";

/** 配额使用量 API */
export const QUOTA_USAGE_URL = `${CODEX_API_BASE}/backend-api/wham/usage`;

/** 每日 token 使用量明细 API */
export const DAILY_USAGE_BREAKDOWN_URL = `${CODEX_API_BASE}/backend-api/wham/usage/daily-token-usage-breakdown`;

/** 账号检查 API */
export const ACCOUNT_CHECK_URL = `${CODEX_API_BASE}/backend-api/wham/accounts/check`;

/** OAuth 认证端点 */
export const AUTH_ENDPOINT = "https://auth.openai.com/oauth/authorize";

/** OAuth Token 端点 */
export const TOKEN_ENDPOINT = "https://auth.openai.com/oauth/token";

/** OAuth 客户端 ID */
export const OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";

/** OAuth 作用域 */
export const OAUTH_SCOPES = "openid profile email offline_access";

/** OAuth 发起源 */
export const OAUTH_ORIGINATOR = "codex_vscode";

/** OAuth 回调端口 */
export const OAUTH_CALLBACK_PORT = 1455;

/** 重定向 URI 路径 */
export const OAUTH_CALLBACK_PATH = "/auth/callback";

/** 获取 OAuth 回调完整 URL */
export function getOAuthRedirectUri(port: number = OAUTH_CALLBACK_PORT): string {
  return `http://localhost:${port}${OAUTH_CALLBACK_PATH}`;
}