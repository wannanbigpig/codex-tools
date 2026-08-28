import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import type {
  DashboardCliSessionMessage,
  DashboardCliSessionSummary
} from "../domain/dashboard/types";
import {
  CrossWindowOperationBusyError,
  runCrossWindowExclusive
} from "../utils/crossWindowOperations";

const CODEX_EXTENSION_ID = "openai.chatgpt";
const CODEX_CONVERSATION_VIEW_TYPE = "chatgpt.conversationEditor";
const CODEX_CONVERSATION_SCHEME = "openai-codex";
const CODEX_CONVERSATION_AUTHORITY = "route";
const SESSION_STATE_KEY = "codexAccounts.openCodexConversations";
const MAX_TRACKED_SESSIONS = 8;
const SESSION_INDEX_FILE = "session_index.jsonl";
const SESSION_DIRECTORY = "sessions";
const SESSION_LOCK_DIRECTORY = "thread-writer-locks";
const MAX_SESSION_INDEX_BYTES = 5 * 1024 * 1024;
const MAX_SESSION_TRANSCRIPT_BYTES = 25 * 1024 * 1024;
const MAX_VISIBLE_CLI_SESSIONS = 30;
const MAX_VISIBLE_SESSION_MESSAGES = 250;
const MAX_SESSION_MESSAGE_CHARS = 12_000;
const MAX_SESSION_SCAN_ENTRIES = 10_000;
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type TrackedCodexConversation = {
  uri: string;
  label: string;
  lastActiveAt: number;
};

/**
 * Remembers official Codex custom-editor tabs and can restore them after a VS Code reload.
 * Only tab URIs and labels are stored; account data and conversation contents are never read.
 */
export class CodexSessionResumeManager implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private lastSnapshot = "";
  private restoring = false;

  constructor(private readonly context: vscode.ExtensionContext) {}

  start(): void {
    this.disposables.push(
      vscode.window.tabGroups.onDidChangeTabs(() => {
        if (!this.restoring && this.isCliIntegrationEnabled()) {
          void this.rememberOpenConversations();
        }
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          (event.affectsConfiguration("codexAccounts.cliIntegrationEnabled") ||
            event.affectsConfiguration("codexAccounts.autoResumeCodexSessions")) &&
          this.isAutoResumeEnabled()
        ) {
          void this.runResumeSavedSessions(true);
        }
      }),
      vscode.commands.registerCommand("codexAccounts.captureCodexSessions", () => this.rememberOpenConversations()),
      vscode.commands.registerCommand("codexAccounts.resumeCodexSessions", () =>
        this.runResumeSavedSessions(false)
      ),
      vscode.commands.registerCommand("codexAccounts.resumeLatestCodexCliSession", () =>
        this.runResumeLatestCliSession()
      )
    );

    if (this.isAutoResumeEnabled()) {
      void this.runResumeSavedSessions(true);
    } else {
      const openConversations = getOpenCodexConversations();
      if (openConversations.length > 0) {
        void this.persistConversations(openConversations);
      }
    }
  }

  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
  }

  private async resumeLatestCliSession(): Promise<boolean> {
    if (!this.isCliIntegrationEnabled()) {
      void vscode.window.showWarningMessage(
        "CLI Integration is disabled. Enable it in Codex Accounts settings before opening CLI sessions."
      );
      return false;
    }
    const session = await readLatestCliSession();
    if (!session) {
      void vscode.window.showInformationMessage("No saved Codex CLI session was found.");
      return false;
    }

    if (!vscode.extensions.getExtension(CODEX_EXTENSION_ID)) {
      void vscode.window.showWarningMessage(
        "Install or enable the official Codex extension before resuming the session."
      );
      return false;
    }

    try {
      await vscode.commands.executeCommand(
        "vscode.openWith",
        createLocalCodexConversationUri(session.id),
        CODEX_CONVERSATION_VIEW_TYPE,
        vscode.ViewColumn.Active
      );
      return true;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      void vscode.window.showWarningMessage(`Could not open the latest Codex CLI session in VS Code: ${detail}`);
      return false;
    }
  }

  private async runResumeLatestCliSession(): Promise<boolean> {
    try {
      return await runCrossWindowExclusive(
        "codex:sessions:latest",
        "Resume latest Codex session",
        () => this.resumeLatestCliSession()
      );
    } catch (error) {
      if (error instanceof CrossWindowOperationBusyError) {
        void vscode.window.showWarningMessage(error.message);
        return false;
      }
      throw error;
    }
  }

  private async runResumeSavedSessions(automatic: boolean): Promise<boolean> {
    try {
      return await runCrossWindowExclusive(
        "codex:sessions:resume",
        "Resume Codex sessions",
        () => this.resumeSavedSessions(automatic)
      );
    } catch (error) {
      if (error instanceof CrossWindowOperationBusyError) {
        if (!automatic) {
          void vscode.window.showWarningMessage(error.message);
        }
        return false;
      }
      throw error;
    }
  }

  private isAutoResumeEnabled(): boolean {
    return (
      this.isCliIntegrationEnabled() &&
      vscode.workspace.getConfiguration("codexAccounts").get<boolean>("autoResumeCodexSessions", false)
    );
  }

  private isCliIntegrationEnabled(): boolean {
    return vscode.workspace.getConfiguration("codexAccounts").get<boolean>("cliIntegrationEnabled", false);
  }

  private async resumeSavedSessions(automatic: boolean): Promise<boolean> {
    const current = getOpenCodexConversations();
    const saved = this.context.workspaceState.get<TrackedCodexConversation[]>(SESSION_STATE_KEY, []);
    if (saved.length === 0) {
      if (current.length > 0) {
        await this.persistConversations(current);
      }
      if (!automatic) {
        void vscode.window.showInformationMessage(
          "No previously open VS Code Codex sessions were found for this workspace."
        );
      }
      return false;
    }

    if (!vscode.extensions.getExtension(CODEX_EXTENSION_ID)) {
      if (!automatic) {
        void vscode.window.showWarningMessage(
          "Install or enable the official Codex extension before resuming sessions."
        );
      }
      return false;
    }

    const openUris = new Set(current.map((conversation) => conversation.uri));
    const missing = saved.filter((conversation) => !openUris.has(conversation.uri));
    if (missing.length === 0) return false;

    this.restoring = true;
    try {
      // Open oldest first so the most recently active conversation receives focus last.
      for (const conversation of [...missing].reverse()) {
        await vscode.commands.executeCommand(
          "vscode.openWith",
          vscode.Uri.parse(conversation.uri),
          CODEX_CONVERSATION_VIEW_TYPE,
          vscode.ViewColumn.Active
        );
      }
      return true;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      void vscode.window.showWarningMessage(`Could not resume the saved VS Code Codex session: ${detail}`);
      return false;
    } finally {
      this.restoring = false;
      await this.rememberOpenConversations();
    }
  }

  private async rememberOpenConversations(): Promise<void> {
    await this.persistConversations(getOpenCodexConversations());
  }

  private async persistConversations(openConversations: TrackedCodexConversation[]): Promise<void> {
    const snapshot = JSON.stringify(openConversations);
    if (snapshot === this.lastSnapshot) return;
    this.lastSnapshot = snapshot;
    await this.context.workspaceState.update(SESSION_STATE_KEY, openConversations);
  }
}

function getOpenCodexConversations(): TrackedCodexConversation[] {
  const now = Date.now();
  const conversations: Array<TrackedCodexConversation & { active: boolean }> = [];

  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (
        !(input instanceof vscode.TabInputCustom) ||
        input.viewType !== CODEX_CONVERSATION_VIEW_TYPE ||
        input.uri.scheme !== CODEX_CONVERSATION_SCHEME
      ) {
        continue;
      }
      conversations.push({
        uri: input.uri.toString(),
        label: tab.label,
        lastActiveAt: tab.isActive ? now : 0,
        active: tab.isActive
      });
    }
  }

  return conversations
    .sort((left, right) => Number(right.active) - Number(left.active))
    .slice(0, MAX_TRACKED_SESSIONS)
    .map(({ active: _active, ...conversation }) => conversation);
}

type CliSessionIndexEntry = { id: string; thread_name?: string; updated_at?: string };

async function readLatestCliSession(): Promise<CliSessionIndexEntry | undefined> {
  try {
    const raw = await fs.readFile(path.join(resolveCodexHome(), SESSION_INDEX_FILE), "utf8");
    const entries = raw
      .split(/\r?\n/)
      .map(parseCliSessionEntry)
      .filter((entry): entry is CliSessionIndexEntry => Boolean(entry));
    return entries
      .sort((left, right) => String(right.updated_at ?? "").localeCompare(String(left.updated_at ?? "")))
      .at(0);
  } catch {
    return undefined;
  }
}

export async function readCodexCliSessions(
  codexHome = resolveCodexHome(),
  limit = MAX_VISIBLE_CLI_SESSIONS
): Promise<DashboardCliSessionSummary[]> {
  const indexPath = path.join(codexHome, SESSION_INDEX_FILE);
  const stat = await fs.stat(indexPath).catch(() => undefined);
  if (!stat) return [];
  if (stat.size > MAX_SESSION_INDEX_BYTES) {
    throw new Error("The Codex CLI session index is too large to read safely.");
  }

  const raw = await fs.readFile(indexPath, "utf8");
  const entries = raw
    .split(/\r?\n/)
    .map(parseCliSessionEntry)
    .filter((entry): entry is CliSessionIndexEntry => Boolean(entry))
    .sort((left, right) => String(right.updated_at ?? "").localeCompare(String(left.updated_at ?? "")));
  const unique = new Map<string, CliSessionIndexEntry>();
  for (const entry of entries) {
    if (!unique.has(entry.id)) unique.set(entry.id, entry);
  }

  const cappedLimit = Math.max(1, Math.min(MAX_VISIBLE_CLI_SESSIONS, Math.round(limit)));
  return Promise.all(
    [...unique.values()].slice(0, cappedLimit).map(async (entry) => ({
      id: entry.id,
      title: normalizeSessionTitle(entry.thread_name, entry.id),
      updatedAt: normalizeTimestamp(entry.updated_at),
      status: (await isCliSessionRunning(codexHome, entry.id)) ? "running" as const : "idle" as const
    }))
  );
}

export async function readCodexCliSessionMessages(
  sessionId: string,
  codexHome = resolveCodexHome()
): Promise<DashboardCliSessionMessage[]> {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error("The Codex CLI session identifier is invalid.");
  }
  const transcriptPath = await findCliSessionTranscript(codexHome, sessionId);
  if (!transcriptPath) {
    throw new Error("The Codex CLI session transcript was not found on this PC.");
  }
  const stat = await fs.stat(transcriptPath);
  if (stat.size > MAX_SESSION_TRANSCRIPT_BYTES) {
    throw new Error("This Codex CLI session is too large to display safely.");
  }

  const raw = await fs.readFile(transcriptPath, "utf8");
  const messages: DashboardCliSessionMessage[] = [];
  let sequence = 0;
  for (const line of raw.split(/\r?\n/)) {
    const message = parseCliSessionMessage(line, sequence);
    if (!message) continue;
    messages.push(message);
    sequence += 1;
  }
  return messages.slice(-MAX_VISIBLE_SESSION_MESSAGES);
}

function parseCliSessionEntry(line: string): CliSessionIndexEntry | undefined {
  try {
    const value = JSON.parse(line) as Partial<CliSessionIndexEntry>;
    return typeof value.id === "string" && value.id.length > 0
      ? { id: value.id, thread_name: value.thread_name, updated_at: value.updated_at }
      : undefined;
  } catch {
    return undefined;
  }
}

export function resolveCodexHome(): string {
  const configured = process.env["CODEX_HOME"]?.trim().replace(/^['"]|['"]$/g, "");
  return configured || path.join(os.homedir(), ".codex");
}

function normalizeSessionTitle(value: string | undefined, id: string): string {
  const title = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return (title || `Codex session ${id.slice(0, 8)}`).slice(0, 160);
}

function normalizeTimestamp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

async function isCliSessionRunning(codexHome: string, sessionId: string): Promise<boolean> {
  const lockPath = path.join(codexHome, SESSION_LOCK_DIRECTORY, `${sessionId}.lock`);
  const stat = await fs.stat(lockPath).catch(() => undefined);
  if (!stat) return false;
  // Codex refreshes writer locks for active threads. Treat old orphaned files as idle.
  return Date.now() - stat.mtimeMs < 15 * 60 * 1000;
}

async function findCliSessionTranscript(codexHome: string, sessionId: string): Promise<string | undefined> {
  const root = path.join(codexHome, SESSION_DIRECTORY);
  const pending = [root];
  let scanned = 0;
  while (pending.length > 0 && scanned < MAX_SESSION_SCAN_ENTRIES) {
    const directory = pending.pop()!;
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      scanned += 1;
      if (scanned > MAX_SESSION_SCAN_ENTRIES) break;
      if (entry.isSymbolicLink()) continue;
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(candidate);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl") && entry.name.includes(sessionId)) {
        return candidate;
      }
    }
  }
  return undefined;
}

function parseCliSessionMessage(line: string, sequence: number): DashboardCliSessionMessage | undefined {
  try {
    const value = JSON.parse(line) as {
      timestamp?: unknown;
      type?: unknown;
      payload?: {
        type?: unknown;
        role?: unknown;
        phase?: unknown;
        content?: unknown;
      };
    };
    const payload = value.type === "response_item" ? value.payload : undefined;
    const role = payload?.role;
    if (payload?.type !== "message" || (role !== "user" && role !== "assistant")) return undefined;
    if (role === "assistant" && payload.phase && payload.phase !== "commentary" && payload.phase !== "final_answer") {
      return undefined;
    }
    if (!Array.isArray(payload.content)) return undefined;
    const parts: string[] = [];
    for (const item of payload.content) {
      if (!item || typeof item !== "object") continue;
      const content = item as { type?: unknown; text?: unknown };
      if ((content.type === "input_text" || content.type === "output_text") && typeof content.text === "string") {
        const text = content.text.trim();
        if (text) parts.push(text);
      } else if (content.type === "input_image") {
        parts.push("[Image]");
      }
    }
    const text = parts.join("\n\n").trim();
    if (!text) return undefined;
    return {
      id: `${sequence}-${typeof value.timestamp === "string" ? value.timestamp : "message"}`,
      role,
      text: text.slice(0, MAX_SESSION_MESSAGE_CHARS),
      timestamp: typeof value.timestamp === "string" ? normalizeTimestamp(value.timestamp) : undefined
    };
  } catch {
    return undefined;
  }
}

function createLocalCodexConversationUri(sessionId: string): vscode.Uri {
  return vscode.Uri.file(`/local/${sessionId}`).with({
    scheme: CODEX_CONVERSATION_SCHEME,
    authority: CODEX_CONVERSATION_AUTHORITY
  });
}
