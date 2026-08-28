import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as http from "http";
import * as path from "path";
import * as vscode from "vscode";
import { buildDashboardState } from "../application/dashboard/buildDashboardState";
import type { DashboardClientMessage, DashboardHostMessage } from "../domain/dashboard/types";
import { ExtensionSettingsStore, getCodexAccountsConfiguration } from "../infrastructure/config/extensionSettings";
import { executeDashboardActionMessage } from "../presentation/dashboard/actionHandlers";
import { withDashboardNotificationSuppression } from "../utils/notificationPolicy";
import { clearDashboardCodexAppPath } from "../presentation/dashboard/messageDispatcher";
import { DashboardOAuthCoordinator } from "../presentation/dashboard/oauthCoordinator";
import { handleDashboardSettingUpdate, pickDashboardCodexAppPath } from "../presentation/dashboard/settings";
import { AccountsRepository } from "../storage";
import { AnnouncementService, type AnnouncementOptions } from "./announcements";
import { appendDashboardUsageSnapshot, saveDashboardUsageHistory } from "./dashboardUsageHistory";
import {
  hashWebDashboardPassword,
  verifyWebDashboardPassword,
  WEB_DASHBOARD_PASSWORD_MIN_LENGTH
} from "./webDashboardPassword";

const WEB_DASHBOARD_PORT = 39875;
const PASSWORD_SECRET_KEY = "codexAccounts.webDashboard.passwordHash.v1";
const SESSION_SECRET_KEY = "codexAccounts.webDashboard.sessions.v1";
const SESSION_COOKIE = "codex_dashboard_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_PERSISTED_SESSIONS = 16;
const MAX_LOGIN_ATTEMPTS = 8;
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const MAX_DASHBOARD_MESSAGE_BYTES = 2 * 1024 * 1024;

type LoginAttempt = { count: number; resetAt: number };

const WEB_DASHBOARD_ASSETS: Record<string, { parts: string[]; contentType: string }> = {
  "/assets/shared.css": { parts: ["media", "webview", "shared.css"], contentType: "text/css; charset=utf-8" },
  "/assets/dashboard.css": { parts: ["media", "webview", "quotaSummary.css"], contentType: "text/css; charset=utf-8" },
  "/assets/browserHost.js": {
    parts: ["media", "webview", "browserHost.js"],
    contentType: "text/javascript; charset=utf-8"
  },
  "/assets/dashboard.js": {
    parts: ["media", "webview", "dashboard", "dashboard.js"],
    contentType: "text/javascript; charset=utf-8"
  },
  "/assets/codex.svg": {
    parts: ["media", "product-icons", "codex-openai.svg"],
    contentType: "image/svg+xml"
  }
};

export class WebDashboardServer implements vscode.Disposable {
  private server: http.Server | undefined;
  private readonly sessions = new Map<string, number>();
  private readonly loginAttempts = new Map<string, LoginAttempt>();
  private readonly settingsStore = new ExtensionSettingsStore();
  private readonly announcements: AnnouncementService;
  private readonly oauth: DashboardOAuthCoordinator;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly repo: AccountsRepository
  ) {
    this.announcements = new AnnouncementService(context.globalStorageUri.fsPath, context.extensionUri.fsPath);
    this.oauth = new DashboardOAuthCoordinator(repo, () => undefined, async () => {
      if (!getCodexAccountsConfiguration().get<boolean>("encryptedSyncEnabled", false)) {
        return undefined;
      }
      return vscode.commands.executeCommand<boolean>("codexAccounts.syncNow", { announceSuccess: false });
    });
  }

  async start(): Promise<void> {
    if (!this.isEnabled() || this.server) return;
    this.server = http.createServer((request, response) => {
      void this.handle(request, response).catch((error) => {
        console.error("[codexAccounts] Web Dashboard request failed", error);
        if (!response.headersSent) {
          response.statusCode = 500;
          response.setHeader("Content-Type", "text/plain; charset=utf-8");
        }
        if (!response.writableEnded) response.end("Dashboard request failed");
      });
    });
    await new Promise<void>((resolve, reject) => {
      const server = this.server!;
      const onError = (error: Error) => {
        server.off("listening", onListening);
        this.server = undefined;
        if (isAddressInUseError(error)) {
          resolve();
          return;
        }
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(WEB_DASHBOARD_PORT, "127.0.0.1");
    });
  }

  async stop(): Promise<void> {
    this.sessions.clear();
    this.loginAttempts.clear();
    const server = this.server;
    this.server = undefined;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  async applyConfiguration(): Promise<void> {
    if (this.isEnabled()) await this.start();
    else await this.stop();
  }

  async openInBrowser(): Promise<void> {
    if (!this.isEnabled()) {
      void vscode.window.showInformationMessage(
        "Web Dashboard setup pending. Enable it in Settings and set a password."
      );
      return;
    }
    try {
      await this.start();
      if (!(await this.context.secrets.get(PASSWORD_SECRET_KEY))) {
        await this.promptSetPassword();
        if (!(await this.context.secrets.get(PASSWORD_SECRET_KEY))) {
          return;
        }
      }
      await vscode.env.openExternal(vscode.Uri.parse(this.getUrl()));
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Web Dashboard could not start: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async promptSetPassword(): Promise<void> {
    const value = await vscode.window.showInputBox({
      title: "Set Web Dashboard Password",
      prompt: `Use at least ${WEB_DASHBOARD_PASSWORD_MIN_LENGTH} characters. Leave empty to remove the password.`,
      password: true,
      ignoreFocusOut: true
    });
    if (value === undefined) return;
    if (value && value.length < WEB_DASHBOARD_PASSWORD_MIN_LENGTH) {
      void vscode.window.showErrorMessage(
        `Web Dashboard password must be at least ${WEB_DASHBOARD_PASSWORD_MIN_LENGTH} characters.`
      );
      return;
    }
    if (!value) {
      await this.context.secrets.delete(PASSWORD_SECRET_KEY);
      await this.clearSessions();
      void vscode.window.showInformationMessage("Web Dashboard password removed.");
      return;
    }
    try {
      const hash = await hashWebDashboardPassword(value);
      await this.context.secrets.store(PASSWORD_SECRET_KEY, hash);
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Web Dashboard password could not be saved: ${error instanceof Error ? error.message : String(error)}`
      );
      return;
    }
    await this.clearSessions();
    void vscode.window.showInformationMessage("Web Dashboard password updated.");
  }

  dispose(): void {
    this.oauth.dispose();
    void this.stop();
  }

  private isEnabled(): boolean {
    return getCodexAccountsConfiguration().get<boolean>("webDashboardEnabled", false);
  }

  private getUrl(): string {
    return `http://127.0.0.1:${WEB_DASHBOARD_PORT}/`;
  }

  private async handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    const method = request.method ?? "GET";
    const path = new URL(request.url ?? "/", this.getUrl()).pathname;
    if (method === "POST" && path === "/login") {
      await this.handleLogin(request, response);
      return;
    }
    if (!(await this.isAuthorized(request))) {
      if (path.startsWith("/api/")) {
        response.statusCode = 401;
        this.sendJson(response, { error: "Dashboard session expired" });
        return;
      }
      this.sendHtml(response, loginPage(Boolean(await this.context.secrets.get(PASSWORD_SECRET_KEY))));
      return;
    }
    if (method === "GET" && path === "/api/state") {
      await this.sendState(response);
      return;
    }
    if (method === "POST" && path === "/api/message") {
      await this.handleClientMessage(request, response);
      return;
    }
    if (method === "GET" && path.startsWith("/assets/")) {
      await this.sendAsset(path, response);
      return;
    }
    if (method === "GET" && path === "/") {
      this.sendHtml(response, dashboardPage());
      return;
    }
    response.statusCode = 404;
    response.end("Not found");
  }

  private async handleLogin(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const ip = request.socket.remoteAddress ?? "local";
    const now = Date.now();
    const attempt = this.loginAttempts.get(ip);
    if (attempt && attempt.resetAt > now && attempt.count >= MAX_LOGIN_ATTEMPTS) {
      response.statusCode = 429;
      response.end("Too many attempts");
      return;
    }
    let body: string;
    try {
      body = await readDashboardRequestBody(request, 4096);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        response.statusCode = 413;
        response.end("Login request too large");
        return;
      }
      throw error;
    }
    const password = new URLSearchParams(body).get("password") ?? "";
    const stored = await this.context.secrets.get(PASSWORD_SECRET_KEY);
    if (!stored || !(await verifyWebDashboardPassword(password, stored))) {
      this.loginAttempts.set(ip, {
        count: attempt && attempt.resetAt > now ? attempt.count + 1 : 1,
        resetAt: attempt && attempt.resetAt > now ? attempt.resetAt : now + LOGIN_WINDOW_MS
      });
      response.statusCode = 401;
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(loginPage(Boolean(stored), "Incorrect password."));
      return;
    }
    const token = crypto.randomBytes(32).toString("hex");
    await this.rememberSession(token, now + SESSION_TTL_MS);
    response.statusCode = 303;
    const secure = isForwardedHttpsRequest(request) ? "; Secure" : "";
    response.setHeader(
      "Set-Cookie",
      `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${secure}`
    );
    response.setHeader("Location", "/");
    response.end();
  }

  private async isAuthorized(request: http.IncomingMessage): Promise<boolean> {
    const stored = await this.context.secrets.get(PASSWORD_SECRET_KEY);
    if (!stored) return false;
    const cookies = request.headers.cookie ?? "";
    const token = cookies
      .split(";")
      .map((item) => item.trim())
      .find((item) => item.startsWith(`${SESSION_COOKIE}=`))
      ?.split("=")[1];
    if (!token) return false;
    let expiresAt = this.sessions.get(token);
    if (!expiresAt) {
      const persisted = normalizePersistedWebDashboardSessions(
        await this.context.secrets.get(SESSION_SECRET_KEY),
        Date.now()
      );
      const fingerprint = fingerprintWebDashboardSession(token);
      expiresAt = persisted.find((session) => session.fingerprint === fingerprint)?.expiresAt;
      if (expiresAt) {
        this.sessions.set(token, expiresAt);
      }
    }
    if (!expiresAt || expiresAt <= Date.now()) {
      this.sessions.delete(token);
      return false;
    }
    return true;
  }

  private async rememberSession(token: string, expiresAt: number): Promise<void> {
    this.sessions.set(token, expiresAt);
    const sessions = normalizePersistedWebDashboardSessions(
      await this.context.secrets.get(SESSION_SECRET_KEY),
      Date.now()
    ).filter((session) => session.fingerprint !== fingerprintWebDashboardSession(token));
    sessions.push({ fingerprint: fingerprintWebDashboardSession(token), expiresAt });
    await this.context.secrets.store(SESSION_SECRET_KEY, JSON.stringify(sessions.slice(-MAX_PERSISTED_SESSIONS)));
  }

  private async clearSessions(): Promise<void> {
    this.sessions.clear();
    await this.context.secrets.delete(SESSION_SECRET_KEY);
  }

  private async sendState(response: http.ServerResponse): Promise<void> {
    this.sendJson(response, await this.buildState());
  }

  private async handleClientMessage(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    if (request.headers["x-codex-dashboard"] !== "1") {
      response.statusCode = 403;
      response.end("Forbidden");
      return;
    }

    let message: DashboardClientMessage;
    try {
      const parsed = JSON.parse(await readDashboardRequestBody(request, MAX_DASHBOARD_MESSAGE_BYTES)) as unknown;
      if (!isDashboardClientMessage(parsed)) throw new Error("Invalid message");
      message = parsed;
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        response.statusCode = 413;
        response.end("Dashboard message too large");
        return;
      }
      response.statusCode = 400;
      response.end("Invalid dashboard message");
      return;
    }

    const messages: DashboardHostMessage[] = [];
    if (message.type === "dashboard:action") {
      const result = await withDashboardNotificationSuppression(() =>
        executeDashboardActionMessage(
          {
            context: this.context,
            repo: this.repo,
            resolveLanguage: () => this.settingsStore.resolveLanguage(),
            schedulePublishState: () => undefined,
            publishState: () => Promise.resolve(),
            oauth: this.oauth,
            announcements: this.announcements,
            getAnnouncementOptions: () => this.getAnnouncementOptions()
          },
          message
        )
      );
      messages.push({
        type: "dashboard:action-result",
        requestId: message.requestId,
        action: message.action,
        accountId: message.accountId,
        status: result.status,
        payload: result.payload,
        error: result.errorMessage
      });
    } else if (message.type === "dashboard:setting") {
      if (!(await handleDashboardSettingUpdate(message.key, message.value))) {
        throw new Error(`The ${message.key} setting could not be updated.`);
      }
    } else if (message.type === "dashboard:pickCodexAppPath") {
      await pickDashboardCodexAppPath(this.settingsStore);
    } else if (message.type === "dashboard:clearCodexAppPath") {
      await clearDashboardCodexAppPath();
    } else if (message.type === "dashboard:usage-history") {
      await saveDashboardUsageHistory(this.context, message.samples);
    } else if (message.type !== "dashboard:ready") {
      response.statusCode = 400;
      response.end("Unsupported dashboard message");
      return;
    }

    messages.push({ type: "dashboard:snapshot", state: await this.buildState() });
    this.sendJson(response, { messages });
  }

  private async buildState() {
    const state = await buildDashboardState(
      this.repo,
      this.settingsStore,
      "/assets/codex.svg",
      await this.announcements.getState(this.getAnnouncementOptions())
    );
    return { ...state, usageHistory: await appendDashboardUsageSnapshot(this.context, state) };
  }

  private getAnnouncementOptions(): AnnouncementOptions {
    const packageJson = this.context.extension.packageJSON as { version?: string };
    return {
      version: packageJson.version ?? "0.0.0",
      locale: this.settingsStore.resolveLanguage()
    };
  }

  private async sendAsset(requestPath: string, response: http.ServerResponse): Promise<void> {
    const asset = WEB_DASHBOARD_ASSETS[requestPath];
    if (!asset) {
      response.statusCode = 404;
      response.end("Not found");
      return;
    }
    try {
      const content = await fs.readFile(path.join(this.context.extensionUri.fsPath, ...asset.parts));
      response.setHeader("Content-Type", asset.contentType);
      response.end(content);
    } catch {
      response.statusCode = 404;
      response.end("Not found");
    }
  }

  private sendHtml(response: http.ServerResponse, html: string): void {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(html);
  }

  private sendJson(response: http.ServerResponse, value: unknown): void {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify(value));
  }
}

class RequestBodyTooLargeError extends Error {}

export interface PersistedWebDashboardSession {
  fingerprint: string;
  expiresAt: number;
}

export function fingerprintWebDashboardSession(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

export function normalizePersistedWebDashboardSessions(
  value: string | undefined,
  now = Date.now()
): PersistedWebDashboardSession[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is PersistedWebDashboardSession => {
        if (!item || typeof item !== "object") return false;
        const candidate = item as Partial<PersistedWebDashboardSession>;
        return (
          typeof candidate.fingerprint === "string" &&
          /^[a-f0-9]{64}$/.test(candidate.fingerprint) &&
          typeof candidate.expiresAt === "number" &&
          Number.isFinite(candidate.expiresAt) &&
          candidate.expiresAt > now
        );
      })
      .slice(-MAX_PERSISTED_SESSIONS);
  } catch {
    return [];
  }
}

export function readDashboardRequestBody(request: http.IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      callback();
    };
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      if (settled) {
        return;
      }
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > maxBytes) {
        finish(() => reject(new RequestBodyTooLargeError("Request body too large")));
      }
    });
    request.on("end", () => finish(() => resolve(body)));
    request.on("error", (error) => finish(() => reject(error)));
    request.on("aborted", () => finish(() => reject(new Error("Request aborted"))));
  });
}

function loginPage(configured: boolean, error = ""): string {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Codex Manager</title><link rel="icon" href="/assets/codex.svg" type="image/svg+xml"><style>${BASE_CSS}</style><main class="login"><h1>Codex Manager</h1>${configured ? `<p>Enter your Web Dashboard password.</p><form method="post" action="/login"><input name="password" type="password" minlength="${WEB_DASHBOARD_PASSWORD_MIN_LENGTH}" autofocus required placeholder="Password"><button>Unlock dashboard</button></form>${error ? `<div class="error">${escapeHtml(error)}</div>` : ""}` : `<p>Access is locked until a Web Dashboard password is set from the extension settings.</p>`}</main>`;
}

function dashboardPage(): string {
  return `<!DOCTYPE html><html lang="en" data-theme="auto" data-dashboard-host="browser"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self';"><title>Codex Manager</title><link rel="icon" href="/assets/codex.svg" type="image/svg+xml"><link rel="stylesheet" href="/assets/shared.css"><link rel="stylesheet" href="/assets/dashboard.css"></head><body><div id="app"></div><script src="/assets/browserHost.js"></script><script src="/assets/dashboard.js"></script></body></html>`;
}

const BASE_CSS = `:root{color-scheme:dark;font-family:system-ui,sans-serif;background:#111827;color:#edf2ff}body{margin:0;background:#111827}main{max-width:1100px;margin:0 auto;padding:28px 20px}header{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px}h1{font-size:22px;margin:0}button{border:0;border-radius:8px;padding:9px 14px;background:#4f8cff;color:#fff;font-weight:700;cursor:pointer}input{display:block;width:100%;box-sizing:border-box;padding:11px;border-radius:8px;border:1px solid #43516d;background:#1b2537;color:#fff;margin:12px 0}.login{max-width:380px;margin:12vh auto}.login p{color:#a8b3c9;line-height:1.5}.error{color:#ff8c9b;margin-top:12px}`;

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character
  );
}

function isDashboardClientMessage(value: unknown): value is DashboardClientMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  switch (candidate["type"]) {
    case "dashboard:ready":
    case "dashboard:pickCodexAppPath":
    case "dashboard:clearCodexAppPath":
      return true;
    case "dashboard:usage-history":
      return Array.isArray(candidate["samples"]) && candidate["samples"].length <= 10_000;
    case "dashboard:action":
      return (
        typeof candidate["requestId"] === "string" &&
        candidate["requestId"].length <= 256 &&
        typeof candidate["action"] === "string" &&
        candidate["action"].length <= 128
      );
    case "dashboard:setting":
      return (
        typeof candidate["key"] === "string" &&
        candidate["key"].length <= 128 &&
        ["string", "number", "boolean"].includes(typeof candidate["value"])
      );
    default:
      return false;
  }
}

export function isAddressInUseError(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "EADDRINUSE";
}

export function isForwardedHttpsRequest(request: Pick<http.IncomingMessage, "headers">): boolean {
  const forwardedProto = request.headers["x-forwarded-proto"];
  const value = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  if (value?.split(",")[0]?.trim().toLowerCase() === "https") {
    return true;
  }

  const cfVisitor = request.headers["cf-visitor"];
  const visitorValue = Array.isArray(cfVisitor) ? cfVisitor[0] : cfVisitor;
  if (!visitorValue) {
    return false;
  }
  try {
    return (JSON.parse(visitorValue) as { scheme?: unknown }).scheme === "https";
  } catch {
    return false;
  }
}

export { WEB_DASHBOARD_PORT };
