import * as vscode from "vscode";

let networkOutputChannel: vscode.OutputChannel | undefined;
const debugLogBuffer: string[] = [];
const MAX_DEBUG_LOG_LINES = 2000;
const MAX_DEBUG_VALUE_LENGTH = 8000;

export function registerDebugOutput(context: vscode.ExtensionContext): void {
  if (!networkOutputChannel) {
    networkOutputChannel = vscode.window.createOutputChannel("Codex Accounts Network");
  }

  context.subscriptions.push(networkOutputChannel);
}

export function logNetworkEvent(scope: string, detail: Record<string, unknown>): void {
  if (!vscode.workspace.getConfiguration("codexAccounts").get<boolean>("debugNetwork", false)) {
    return;
  }

  if (!networkOutputChannel) {
    networkOutputChannel = vscode.window.createOutputChannel("Codex Accounts Network");
  }

  const lines = [
    `[${new Date().toISOString()}] ${scope}`,
    ...Object.entries(detail).map(([key, value]) => `${key}: ${formatDebugValue(key, value)}`),
    ""
  ];
  const text = lines.join("\n");
  networkOutputChannel.appendLine(text);
  debugLogBuffer.push(...text.split("\n"));
  if (debugLogBuffer.length > MAX_DEBUG_LOG_LINES) {
    debugLogBuffer.splice(0, debugLogBuffer.length - MAX_DEBUG_LOG_LINES);
  }
}

/** Returns the in-memory diagnostics captured during this extension run. */
export function getDebugLogSnapshot(): string[] {
  return debugLogBuffer.map((line) => redactDebugText(line).slice(0, MAX_DEBUG_VALUE_LENGTH));
}

/** Opens the redacted network diagnostics in VS Code's Output panel. */
export function showNetworkDebugLogs(): void {
  if (!networkOutputChannel) {
    networkOutputChannel = vscode.window.createOutputChannel("Codex Accounts Network");
  }
  networkOutputChannel.show();
}

/** Adds diagnostics imported from a manual backup to the current output channel. */
export function appendImportedDebugLogs(logs: readonly string[]): void {
  const sanitized = logs
    .filter((line): line is string => typeof line === "string")
    .slice(-MAX_DEBUG_LOG_LINES)
    .map((line) => redactDebugText(line).slice(0, MAX_DEBUG_VALUE_LENGTH));
  if (sanitized.length === 0) {
    return;
  }
  if (!networkOutputChannel) {
    networkOutputChannel = vscode.window.createOutputChannel("Codex Accounts Network");
  }
  networkOutputChannel.appendLine("[Imported Codex Accounts backup logs]");
  networkOutputChannel.appendLine(sanitized.join("\n"));
  debugLogBuffer.push(...sanitized);
  if (debugLogBuffer.length > MAX_DEBUG_LOG_LINES) {
    debugLogBuffer.splice(0, debugLogBuffer.length - MAX_DEBUG_LOG_LINES);
  }
}

function formatDebugValue(key: string, value: unknown): string {
  if (shouldRedactDebugField(key)) {
    return String(redactDebugScalar(value));
  }
  if (key === "bodyPreview" && typeof value === "string") {
    return sanitizeBodyPreview(value).slice(0, MAX_DEBUG_VALUE_LENGTH);
  }

  if (typeof value === "string") {
    return redactDebugText(value).slice(0, MAX_DEBUG_VALUE_LENGTH);
  }

  try {
    return JSON.stringify(redactDebugValue(value), null, 2).slice(0, MAX_DEBUG_VALUE_LENGTH);
  } catch {
    return redactDebugText(String(value)).slice(0, MAX_DEBUG_VALUE_LENGTH);
  }
}

function sanitizeBodyPreview(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  try {
    return JSON.stringify(redactDebugValue(JSON.parse(trimmed) as unknown), null, 2);
  } catch {
    return redactDebugText(trimmed);
  }
}

function redactDebugValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactDebugValue);
  }

  if (!value || typeof value !== "object") {
    return typeof value === "string" ? redactDebugText(value) : value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      shouldRedactDebugField(key) ? redactDebugScalar(entry) : redactDebugValue(entry)
    ])
  );
}

function shouldRedactDebugField(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_\s]/g, "");
  return (
    normalized.includes("token") ||
    normalized.includes("authorization") ||
    normalized.includes("apikey") ||
    normalized.includes("secret") ||
    normalized.includes("password") ||
    normalized.includes("cookie") ||
    normalized === "email" ||
    normalized.endsWith("email") ||
    normalized === "userid" ||
    normalized === "accountuserid" ||
    normalized === "accountid" ||
    normalized === "organizationid" ||
    normalized === "workspaceid"
  );
}

function redactDebugScalar(value: unknown): unknown {
  if (typeof value === "string") {
    if (value.includes("@")) {
      return "[redacted-email]";
    }
    return value.trim() ? "[redacted]" : value;
  }
  if (value == null) {
    return value;
  }
  return "[redacted]";
}

export function redactDebugText(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/"(?:access|refresh|id|session|auth)[-_ ]?token"\s*:\s*"[^"]*"/gi, '"token":"[redacted]"')
    .replace(/"authorization"\s*:\s*"[^"]*"/gi, '"authorization":"[redacted]"')
    .replace(/"(?:api[-_ ]?key|password|secret|cookie)"\s*:\s*"[^"]*"/gi, '"secret":"[redacted]"')
    .replace(
      /\b(?:authorization|proxy-authorization)\s*[:=]\s*(?:Basic|Bearer)?\s*[^\s,;]+/gi,
      "authorization: [redacted]"
    )
    .replace(/\b(?:access|refresh|id|session|auth)[-_ ]?token\s*[:=]\s*[^\s&,;]+/gi, "token=[redacted]")
    .replace(/\b(?:openai[-_ ]?)?api[-_ ]?key\s*[:=]\s*[^\s&,;]+/gi, "api_key=[redacted]")
    .replace(/\b(?:client[-_ ]?secret|password)\s*[:=]\s*[^\s&,;]+/gi, "secret=[redacted]")
    .replace(/\b(?:set-)?cookie\s*[:=][^\r\n]*/gi, "cookie: [redacted]")
    .replace(/\b(Basic|Bearer)\s+[A-Za-z0-9._~+/-]+=*/gi, "$1 [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[redacted-api-key]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted-jwt]")
    .replace(/\b(?:org|account|workspace|user)[-_ ]?id\b["':= ]+[\w-]+/gi, "[redacted-id]")
    .trim();
}
