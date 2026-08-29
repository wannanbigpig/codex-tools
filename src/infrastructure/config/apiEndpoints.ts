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

/** 主动重置次数查询 API */
export const RESET_CREDITS_URL = `${CODEX_API_BASE}/backend-api/wham/rate-limit-reset-credits`;

/** 主动重置次数消耗 API */
export const RESET_CREDITS_CONSUME_URL = `${CODEX_API_BASE}/backend-api/wham/rate-limit-reset-credits/consume`;

/** 订阅账号查询 API（对齐 cockpit accounts/check） */
export const SUBSCRIPTION_ACCOUNTS_CHECK_URL = `${CODEX_API_BASE}/backend-api/accounts/check/v4-2023-04-27`;

/** 订阅信息查询 API（对齐 cockpit subscriptions） */
export const SUBSCRIPTIONS_URL = `${CODEX_API_BASE}/backend-api/subscriptions`;

/** 订阅重试间隔 (秒) — 对齐 cockpit SUBSCRIPTION_RETRY_INTERVAL_SECONDS */
export const SUBSCRIPTION_RETRY_INTERVAL_SECONDS = 30 * 60;

/** OAuth 认证端点 */
export const AUTH_ENDPOINT = "https://auth.openai.com/oauth/authorize";

/** OAuth Token 端点 */
export const TOKEN_ENDPOINT = "https://auth.openai.com/oauth/token";

/** OAuth 客户端 ID */
export const OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";

/** OAuth scope set used by the Codex VS Code sign-in flow. */
export const OAUTH_SCOPES = "openid profile email offline_access api.connectors.read api.connectors.invoke";

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
