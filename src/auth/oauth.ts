import * as crypto from "crypto";
import * as http from "http";
import * as vscode from "vscode";
import { CodexTokens } from "../core/types";
import { isTokenExpired } from "../utils/jwt";
import { fetchWithTimeout, isRetriableHttpStatus, isRetriableNetworkError, retryWithBackoff } from "../utils/network";
import { logNetworkEvent } from "../utils/debug";
import { AuthError, ErrorCode, APIError } from "../core/errors";
import {
  AUTH_ENDPOINT,
  TOKEN_ENDPOINT,
  OAUTH_CLIENT_ID,
  OAUTH_SCOPES,
  OAUTH_ORIGINATOR,
  OAUTH_CALLBACK_PORT
} from "../infrastructure/config/apiEndpoints";

// 使用别名保持向后兼容
const CLIENT_ID = OAUTH_CLIENT_ID;
const SCOPES = OAUTH_SCOPES;
const ORIGINATOR = OAUTH_ORIGINATOR;
const CALLBACK_PORT = OAUTH_CALLBACK_PORT;

/**
 * Token 刷新提前量（秒）。对齐 cockpit-tools 的 TOKEN_REFRESH_SKEW_SECONDS，
 * 在 access_token 剩余有效期不足 5 分钟时即触发刷新，避免边界过期。
 */
export const TOKEN_REFRESH_SKEW_SECONDS = 300;

// Keep refreshes single-flight per refresh token. Multiple quota/scheduler callers
// must not rotate the same refresh token concurrently (which can invalidate one
// of the responses on providers that rotate refresh tokens).
const inFlightTokenRefreshes = new Map<string, Promise<CodexTokens>>();
const TOKEN_REFRESH_RETRY_DELAYS_MS = [500, 1500, 3000] as const;

interface OAuthSession {
  state: string;
  verifier: string;
  server: http.Server;
  redirectUri: string;
}

interface OAuthCodeWaiter {
  promise: Promise<string>;
  dispose: () => void;
}

export interface PreparedOAuthLoginSession {
  state: string;
  verifier: string;
  redirectUri: string;
  authUrl: string;
}

export async function loginWithOAuth(cancellationToken?: vscode.CancellationToken): Promise<CodexTokens> {
  const prepared = prepareOAuthLoginSession();
  return runPreparedOAuthLoginSession(prepared, cancellationToken);
}

export async function refreshTokens(refreshToken: string, currentIdToken?: string): Promise<CodexTokens> {
  const normalizedRefreshToken = refreshToken.trim();
  if (!normalizedRefreshToken) {
    throw new AuthError("Refresh token is missing", { code: ErrorCode.AUTH_TOKEN_MISSING });
  }

  const inFlight = inFlightTokenRefreshes.get(normalizedRefreshToken);
  if (inFlight) {
    return inFlight;
  }

  const refreshTask = refreshTokensWithRetry(normalizedRefreshToken, currentIdToken);
  inFlightTokenRefreshes.set(normalizedRefreshToken, refreshTask);
  try {
    return await refreshTask;
  } finally {
    if (inFlightTokenRefreshes.get(normalizedRefreshToken) === refreshTask) {
      inFlightTokenRefreshes.delete(normalizedRefreshToken);
    }
  }
}

async function refreshTokensWithRetry(refreshToken: string, currentIdToken?: string): Promise<CodexTokens> {
  return retryWithBackoff(
    async () => {
      const response = await fetchWithTimeout(
        TOKEN_ENDPOINT,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            grant_type: "refresh_token",
            refresh_token: refreshToken,
            client_id: CLIENT_ID
          })
        },
        25000,
        "Token refresh"
      );

      const raw = await response.text();
      logNetworkEvent("oauth.refresh", {
        ok: response.ok,
        status: response.status,
        hasRefreshToken: Boolean(refreshToken),
        bodyPreview: summarizeOAuthResponse(raw)
      });
      if (!response.ok) {
        const errorCode = extractTokenErrorCode(raw);
        throw new APIError(`Token refresh failed${errorCode ? ` (${errorCode})` : ""}.`, {
          statusCode: response.status,
          responseBody: summarizeOAuthResponse(raw),
          context: errorCode ? { errorCode } : undefined
        });
      }

      const payload = JSON.parse(raw) as Record<string, unknown>;
      // OpenAI refresh 端点偶尔不返回新的 id_token，此时复用本地旧值（对齐 cockpit refresh_access_token_with_fallback）。
      const idToken = readOptionalString(payload, "id_token") ?? (currentIdToken?.trim() ? currentIdToken : undefined);
      if (!idToken) {
        throw new AuthError("Missing id_token in OAuth refresh response and no local fallback available", {
          code: ErrorCode.AUTH_TOKEN_MISSING,
          context: { key: "id_token" }
        });
      }

      return {
        idToken,
        accessToken: readString(payload, "access_token"),
        refreshToken: readOptionalString(payload, "refresh_token") ?? refreshToken
      };
    },
    {
      delaysMs: TOKEN_REFRESH_RETRY_DELAYS_MS,
      // Retry only transient transport/server/rate-limit failures. Invalid
      // grants and other auth failures fail immediately and surface reauth.
      shouldRetryError: (error) =>
        error instanceof APIError
          ? typeof error.statusCode === "number" && isRetriableHttpStatus(error.statusCode)
          : isRetriableNetworkError(error)
    }
  );
}

/**
 * 从 token 端点错误响应中提取 error code，便于诊断（对齐 cockpit extract_token_error_code）。
 */
function extractTokenErrorCode(body: string): string | undefined {
  try {
    const value = JSON.parse(body) as Record<string, unknown>;
    const fromError = value["error"];
    if (typeof fromError === "string" && fromError) {
      return fromError;
    }
    if (fromError && typeof fromError === "object") {
      const code = (fromError as Record<string, unknown>)["code"];
      if (typeof code === "string" && code) {
        return code;
      }
    }
    const code = value["code"];
    return typeof code === "string" && code ? code : undefined;
  } catch {
    return undefined;
  }
}

export function needsRefresh(accessToken: string, skewSeconds = TOKEN_REFRESH_SKEW_SECONDS): boolean {
  return isTokenExpired(accessToken, skewSeconds);
}

export function needsTokenRefresh(
  tokens: Pick<CodexTokens, "idToken" | "accessToken">,
  skewSeconds = TOKEN_REFRESH_SKEW_SECONDS
): boolean {
  return isTokenExpired(tokens.accessToken, skewSeconds) || isTokenExpired(tokens.idToken, skewSeconds);
}

export function prepareOAuthLoginSession(port = CALLBACK_PORT): PreparedOAuthLoginSession {
  const verifier = randomBase64Url();
  const challenge = sha256Base64Url(verifier);
  const state = randomBase64Url();
  const redirectUri = `http://localhost:${port}/auth/callback`;
  const authUrl =
    `${AUTH_ENDPOINT}?response_type=code&client_id=${encodeURIComponent(CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&code_challenge=${encodeURIComponent(challenge)}` +
    `&code_challenge_method=S256&id_token_add_organizations=true` +
    `&codex_cli_simplified_flow=true&state=${encodeURIComponent(state)}` +
    `&originator=${encodeURIComponent(ORIGINATOR)}`;

  return {
    state,
    verifier,
    redirectUri,
    authUrl
  };
}

export async function completeOAuthLoginSession(
  session: Pick<PreparedOAuthLoginSession, "state" | "verifier" | "redirectUri">,
  callbackUrl: string
): Promise<CodexTokens> {
  const code = extractCodeFromCallbackUrl(callbackUrl, session.redirectUri, session.state);
  return exchangeCodeForTokens(code, session.verifier, session.redirectUri);
}

export async function runPreparedOAuthLoginSession(
  session: PreparedOAuthLoginSession,
  cancellationToken?: vscode.CancellationToken
): Promise<CodexTokens> {
  const runtimeSession: OAuthSession = {
    state: session.state,
    verifier: session.verifier,
    server: http.createServer(),
    redirectUri: session.redirectUri
  };
  const codeWaiter = createCodeWaiter(runtimeSession, cancellationToken);

  const opened = await vscode.env.openExternal(vscode.Uri.parse(session.authUrl));
  if (!opened) {
    codeWaiter.dispose();
    void vscode.env.clipboard.writeText(session.authUrl);
    throw new AuthError(
      "Unable to open the browser automatically. The authorization URL was copied to your clipboard.",
      {
        code: ErrorCode.AUTH_OAUTH_FAILED
      }
    );
  }

  if (cancellationToken?.isCancellationRequested) {
    codeWaiter.dispose();
    throw new AuthError("OAuth login cancelled by user.", {
      code: ErrorCode.AUTH_OAUTH_FAILED
    });
  }

  const code = await codeWaiter.promise;
  return exchangeCodeForTokens(code, session.verifier, session.redirectUri);
}

export function extractCodeFromCallbackUrl(callbackUrl: string, redirectUri: string, expectedState: string): string {
  const validationError = validateManualCallback(callbackUrl, redirectUri, expectedState);
  if (validationError) {
    throw new AuthError(validationError, {
      code: ErrorCode.AUTH_TOKEN_INVALID
    });
  }

  const url = new URL(callbackUrl.trim());
  const code = url.searchParams.get("code");
  if (!code) {
    throw new AuthError("Callback URL does not include code", {
      code: ErrorCode.AUTH_TOKEN_INVALID
    });
  }

  return code;
}

function createCodeWaiter(session: OAuthSession, cancellationToken?: vscode.CancellationToken): OAuthCodeWaiter {
  let settled = false;
  let timeout: NodeJS.Timeout | undefined;
  let cancelDisposable: vscode.Disposable | undefined;

  const finish = (callback?: () => void): void => {
    if (settled) {
      return;
    }
    settled = true;
    if (timeout) {
      clearTimeout(timeout);
    }
    cancelDisposable?.dispose();
    session.server.close();
    callback?.();
  };

  return {
    promise: new Promise<string>((resolve, reject) => {
      timeout = setTimeout(() => {
        finish(() => {
          reject(
            new AuthError("OAuth login was not completed in the browser.", {
              code: ErrorCode.AUTH_OAUTH_FAILED
            })
          );
        });
      }, 300_000);

      cancelDisposable = cancellationToken?.onCancellationRequested(() => {
        finish(() => {
          reject(
            new AuthError("OAuth login cancelled by user.", {
              code: ErrorCode.AUTH_OAUTH_FAILED
            })
          );
        });
      });

      session.server.on("request", (req, res) => {
        if (!req.url) {
          return;
        }

        const url = new URL(req.url, session.redirectUri);
        if (url.pathname !== "/auth/callback") {
          res.writeHead(404);
          res.end("Not found");
          return;
        }

        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (state !== session.state) {
          res.writeHead(400);
          res.end("State mismatch");
          return;
        }

        if (!code) {
          res.writeHead(400);
          res.end("Missing code");
          return;
        }

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(successHtml());
        logNetworkEvent("oauth.callback", {
          ok: true,
          path: url.pathname,
          hasCode: true
        });
        finish(() => {
          resolve(code);
        });
      });

      session.server.once("error", (error) => {
        const isAddrInUse =
          error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EADDRINUSE";
        finish(() => {
          reject(
            new AuthError(
              isAddrInUse
                ? `Automatic OAuth callback listener is unavailable on ${session.redirectUri}. Use the Add Account dialog to complete the callback manually.`
                : `Unable to bind OAuth callback port: ${String(error)}`,
              { code: ErrorCode.AUTH_OAUTH_FAILED }
            )
          );
        });
      });

      session.server.listen(Number(new URL(session.redirectUri).port), "127.0.0.1");
    }),
    dispose: () => {
      finish();
    }
  };
}

async function exchangeCodeForTokens(code: string, verifier: string, redirectUri: string): Promise<CodexTokens> {
  const response = await fetchWithTimeout(
    TOKEN_ENDPOINT,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: CLIENT_ID,
        code_verifier: verifier
      }).toString()
    },
    15000,
    "OAuth token exchange"
  );

  const raw = await response.text();
  logNetworkEvent("oauth.exchange", {
    ok: response.ok,
    status: response.status,
    redirectUri,
    bodyPreview: summarizeOAuthResponse(raw)
  });
  if (!response.ok) {
    const errorCode = extractTokenErrorCode(raw);
    throw new APIError(`Token exchange failed${errorCode ? ` (${errorCode})` : ""}.`, {
      statusCode: response.status,
      responseBody: summarizeOAuthResponse(raw),
      context: errorCode ? { errorCode } : undefined
    });
  }

  const payload = JSON.parse(raw) as Record<string, unknown>;
  return {
    idToken: readString(payload, "id_token"),
    accessToken: readString(payload, "access_token"),
    refreshToken: readOptionalString(payload, "refresh_token")
  };
}

/** Keep provider diagnostics bounded and free of token-sized payloads. */
function summarizeOAuthResponse(raw: string): string {
  let diagnostic = raw;
  try {
    diagnostic = JSON.stringify(redactOAuthDiagnostic(JSON.parse(raw) as unknown));
  } catch {
    diagnostic = raw
      .replace(/\b(?:eyJ|[A-Za-z0-9_-]{20,}\.)[A-Za-z0-9._-]{20,}\b/g, "[redacted-token]")
      .replace(/((?:access|refresh|id)_token|authorization|code)\s*[=:]\s*[^\s&,]+/gi, "$1=[redacted]");
  }
  const compact = diagnostic.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "(empty response)";
  }
  return compact.length > 240 ? `${compact.slice(0, 240)}…` : compact;
}

function redactOAuthDiagnostic(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactOAuthDiagnostic);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      /(?:^|_)(?:access_token|refresh_token|id_token|authorization|code|secret|credential)(?:$|_)/i.test(key)
        ? "[redacted]"
        : redactOAuthDiagnostic(entry)
    ])
  );
}

function randomBase64Url(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function validateManualCallback(value: string, redirectUri: string, expectedState: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const url = new URL(trimmed);
    const expected = new URL(redirectUri);
    if (url.origin !== expected.origin || url.pathname !== expected.pathname) {
      return `Expected callback URL starting with ${redirectUri}`;
    }
    if (url.searchParams.get("state") !== expectedState) {
      return "State mismatch in callback URL";
    }
    if (!url.searchParams.get("code")) {
      return "Callback URL does not include code";
    }
    return undefined;
  } catch {
    return "Paste the full callback URL from the browser address bar";
  }
}

function sha256Base64Url(value: string): string {
  return crypto.createHash("sha256").update(value).digest("base64url");
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value) {
    throw new AuthError(`Missing ${key} in OAuth response`, {
      code: ErrorCode.AUTH_TOKEN_MISSING,
      context: { key }
    });
  }
  return value;
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value ? value : undefined;
}

function successHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>Codex Authorized</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: radial-gradient(circle at top, #f4d35e, #ee964b 40%, #0d3b66 100%); font-family: Georgia, serif; color: #fff7e6; }
    .card { padding: 32px 40px; border: 1px solid rgba(255,255,255,.2); border-radius: 20px; background: rgba(9,25,40,.45); backdrop-filter: blur(10px); text-align: center; }
    h1 { margin: 0 0 10px; font-size: 28px; }
    p { margin: 0; font-size: 16px; opacity: .92; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Authorization response received</h1>
    <p>Return to VS Code while your account is being verified.</p>
  </div>
</body>
</html>`;
}
