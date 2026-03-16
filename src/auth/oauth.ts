import * as crypto from "crypto";
import * as http from "http";
import * as vscode from "vscode";
import { CodexTokens } from "../core/types";
import { isTokenExpired } from "../utils/jwt";
import { AuthError, ErrorCode, APIError } from "../core/errors";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTH_ENDPOINT = "https://auth.openai.com/oauth/authorize";
const TOKEN_ENDPOINT = "https://auth.openai.com/oauth/token";
const SCOPES = "openid profile email offline_access";
const ORIGINATOR = "codex_vscode";
const CALLBACK_PORT = 1455;

interface OAuthSession {
  state: string;
  verifier: string;
  server: http.Server;
  redirectUri: string;
}

export async function loginWithOAuth(): Promise<CodexTokens> {
  const port = CALLBACK_PORT;
  const available = await canBindPort(port);
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

  const opened = await vscode.env.openExternal(vscode.Uri.parse(authUrl));
  if (!opened) {
    void vscode.env.clipboard.writeText(authUrl);
    throw new AuthError("Unable to open the browser automatically. The authorization URL was copied to your clipboard.", {
      code: ErrorCode.AUTH_OAUTH_FAILED
    });
  }

  if (!available) {
    const code = await promptForManualCallback(authUrl, redirectUri, state);
    return exchangeCodeForTokens(code, verifier, redirectUri);
  }

  const codePromise = waitForCode({
    state,
    verifier,
    server: http.createServer(),
    redirectUri
  });

  let code: string;
  try {
    code = await codePromise;
  } catch (error) {
    if (error instanceof Error && error.message.includes("timed out")) {
      code = await promptForManualCallback(authUrl, redirectUri, state);
    } else {
      throw error;
    }
  }

  return exchangeCodeForTokens(code, verifier, redirectUri);
}

export async function refreshTokens(refreshToken: string): Promise<CodexTokens> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID
    }).toString()
  });

  const raw = await response.text();
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

export function needsRefresh(accessToken: string): boolean {
  return isTokenExpired(accessToken);
}

async function waitForCode(session: OAuthSession): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      session.server.close();
      reject(new Error("OAuth authorization timed out after 5 minutes"));
    }, 300_000);

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
      clearTimeout(timeout);
      session.server.close();
      resolve(code);
    });

    session.server.once("error", (error) => {
      clearTimeout(timeout);
      reject(new Error(`Unable to bind OAuth callback port: ${String(error)}`));
    });

    session.server.listen(Number(new URL(session.redirectUri).port), "127.0.0.1");
  });
}

async function exchangeCodeForTokens(code: string, verifier: string, redirectUri: string): Promise<CodexTokens> {
  const response = await fetch(TOKEN_ENDPOINT, {
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
  });

  const raw = await response.text();
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

async function promptForManualCallback(authUrl: string, redirectUri: string, expectedState: string): Promise<string> {
  await vscode.env.clipboard.writeText(authUrl);

  await vscode.window.showInformationMessage(
    [
      "Automatic OAuth callback was not completed.",
      `Finish authorization in the browser, then copy the full address bar URL like ${redirectUri}?code=...&state=...`,
      "Return to VS Code and paste that URL in the next input box."
    ].join(" "),
    { modal: true }
  );

  const pasted = await vscode.window.showInputBox({
    title: "Paste OAuth callback URL",
    prompt:
      "Paste the full callback URL from the browser address bar. The authorization URL is already in your clipboard.",
    placeHolder: redirectUri,
    ignoreFocusOut: true,
    validateInput: (value) => validateManualCallback(value, redirectUri, expectedState)
  });

  if (!pasted) {
    throw new AuthError("OAuth login cancelled before callback URL was provided.", {
      code: ErrorCode.AUTH_OAUTH_FAILED
    });
  }

  const url = new URL(pasted.trim());
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (state !== expectedState || !code) {
    throw new AuthError("Invalid callback URL pasted.", {
      code: ErrorCode.AUTH_TOKEN_INVALID
    });
  }

  return code;
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
