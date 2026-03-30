import * as crypto from "crypto";
import * as http from "http";
import * as vscode from "vscode";
import { CodexTokens } from "../core/types";
import { isTokenExpired } from "../utils/jwt";
import { fetchWithTimeout } from "../utils/network";
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

export async function refreshTokens(refreshToken: string): Promise<CodexTokens> {
  const response = await fetchWithTimeout(
    TOKEN_ENDPOINT,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: CLIENT_ID
      }).toString()
    },
    15000,
    "Token refresh"
  );

  const raw = await response.text();
  logNetworkEvent("oauth.refresh", {
    ok: response.ok,
    status: response.status,
    hasRefreshToken: Boolean(refreshToken),
    bodyPreview: raw.slice(0, 400)
  });
  if (!response.ok) {
    throw new APIError(`Token refresh failed: ${raw}`, {
      statusCode: response.status,
      responseBody: raw
    });
  }

  const payload = JSON.parse(raw) as Record<string, unknown>;
  return {
    idToken: readString(payload, "id_token"),
    accessToken: readString(payload, "access_token"),
    refreshToken: readOptionalString(payload, "refresh_token") ?? refreshToken
  };
}

export function needsRefresh(accessToken: string, skewSeconds = 60): boolean {
  return isTokenExpired(accessToken, skewSeconds);
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
  const port = Number(new URL(session.redirectUri).port || CALLBACK_PORT);
  const available = await canBindPort(port);
  logNetworkEvent("oauth.start", {
    callbackPort: port,
    callbackAvailable: available,
    redirectUri: session.redirectUri
  });

  if (!available) {
    throw new AuthError(
      `Automatic OAuth callback listener is unavailable on ${session.redirectUri}. Use the Add Account dialog to complete the callback manually.`,
      {
        code: ErrorCode.AUTH_OAUTH_FAILED
      }
    );
  }

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
    throw new AuthError("Unable to open the browser automatically. The authorization URL was copied to your clipboard.", {
      code: ErrorCode.AUTH_OAUTH_FAILED
    });
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
        finish(() => {
          reject(new Error(`Unable to bind OAuth callback port: ${String(error)}`));
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
    bodyPreview: raw.slice(0, 400)
  });
  if (!response.ok) {
    throw new APIError(`Token exchange failed: ${raw}`, {
      statusCode: response.status,
      responseBody: raw
    });
  }

  const payload = JSON.parse(raw) as Record<string, unknown>;
  return {
    idToken: readString(payload, "id_token"),
    accessToken: readString(payload, "access_token"),
    refreshToken: readOptionalString(payload, "refresh_token")
  };
}

function randomBase64Url(): string {
  return crypto.randomBytes(32).toString("base64url");
}

async function canBindPort(port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const server = http.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
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
    <h1>Authorization complete</h1>
    <p>You can close this tab and return to VS Code.</p>
  </div>
</body>
</html>`;
}
