import * as vscode from "vscode";

let networkOutputChannel: vscode.OutputChannel | undefined;

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

  networkOutputChannel.appendLine(lines.join("\n"));
}

function formatDebugValue(key: string, value: unknown): string {
  if (key === "bodyPreview" && typeof value === "string") {
    return sanitizeBodyPreview(value);
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
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
    normalized === "email" ||
    normalized.endsWith("email") ||
    normalized === "userid" ||
    normalized === "accountuserid"
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

function redactDebugText(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/"(?:access|refresh|id|session|auth)[-_ ]?token"\s*:\s*"[^"]*"/gi, '"token":"[redacted]"')
    .replace(/"authorization"\s*:\s*"[^"]*"/gi, '"authorization":"[redacted]"')
    .replace(/\b(?:org|account|workspace|user)[-_ ]?id\b["':= ]+[\w-]+/gi, "[redacted-id]")
    .trim();
}
