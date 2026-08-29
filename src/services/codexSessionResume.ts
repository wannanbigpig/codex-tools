import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import * as readline from "readline";
import type {
  DashboardCliComposerConfig,
  DashboardCliSessionMessage,
  DashboardCliSessionSummary,
  DashboardCliSandboxMode
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
const MAX_MODELS_CACHE_BYTES = 5 * 1024 * 1024;
const MAX_CONFIG_BYTES = 1024 * 1024;
const MAX_CLI_PROMPT_CHARS = 64_000;
const MAX_CLI_OUTPUT_BYTES = 2 * 1024 * 1024;
const CLI_TURN_TIMEOUT_MS = 15 * 60 * 1000;
const APP_SERVER_REQUEST_TIMEOUT_MS = 30_000;
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const REASONING_EFFORT_PATTERN = /^(minimal|low|medium|high|xhigh|max|ultra)$/;
const activeCliTurns = new Map<string, ChildProcessWithoutNullStreams>();

export class CodexCliTurnCancelledError extends Error {
  constructor() {
    super("Codex stopped this turn before it completed.");
    this.name = "CodexCliTurnCancelledError";
  }
}

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
  const entries = await readCodexCliSessionIndex(codexHome);
  if (!entries.length) return [];
  const archivedIds = await readArchivedSessionIds(codexHome);
  const cappedLimit = Math.max(1, Math.min(MAX_VISIBLE_CLI_SESSIONS, Math.round(limit)));
  const activeEntries = entries.filter((entry) => !archivedIds.has(entry.id)).slice(0, cappedLimit);
  const archivedEntries = entries.filter((entry) => archivedIds.has(entry.id)).slice(0, cappedLimit);
  return Promise.all(
    [...activeEntries, ...archivedEntries].map((entry) => toCliSessionSummary(codexHome, entry, archivedIds.has(entry.id)))
  );
}

export async function readCodexCliSessionSummary(
  sessionId: string,
  codexHome = resolveCodexHome()
): Promise<DashboardCliSessionSummary | undefined> {
  validateSessionId(sessionId);
  const entry = (await readCodexCliSessionIndex(codexHome)).find((candidate) => candidate.id === sessionId);
  if (!entry) return undefined;
  const archivedIds = await readArchivedSessionIds(codexHome);
  return toCliSessionSummary(codexHome, entry, archivedIds.has(entry.id));
}

async function readCodexCliSessionIndex(codexHome: string): Promise<CliSessionIndexEntry[]> {
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

  return [...unique.values()];
}

async function toCliSessionSummary(
  codexHome: string,
  entry: CliSessionIndexEntry,
  archived: boolean
): Promise<DashboardCliSessionSummary> {
  return {
    id: entry.id,
    title: normalizeSessionTitle(entry.thread_name, entry.id),
    updatedAt: normalizeTimestamp(entry.updated_at),
    status: !archived && (await isCliSessionRunning(codexHome, entry.id)) ? "running" : "idle",
    archived
  };
}

export async function readCodexCliComposerConfig(
  codexHome = resolveCodexHome()
): Promise<DashboardCliComposerConfig> {
  const [modelsRaw, configRaw] = await Promise.all([
    readSmallOptionalFile(path.join(codexHome, "models_cache.json"), MAX_MODELS_CACHE_BYTES),
    readSmallOptionalFile(path.join(codexHome, "config.toml"), MAX_CONFIG_BYTES)
  ]);
  const models = parseCliModels(modelsRaw);
  const configuredModel = readTomlString(configRaw, "model");
  const configuredEffort = readTomlString(configRaw, "model_reasoning_effort");
  const configuredSandbox = readTomlString(configRaw, "sandbox_mode");
  return {
    models,
    defaultModel: models.some((model) => model.id === configuredModel) ? configuredModel : models[0]?.id,
    defaultReasoningEffort: REASONING_EFFORT_PATTERN.test(configuredEffort ?? "")
      ? configuredEffort
      : models[0]?.defaultReasoningEffort,
    defaultSandboxMode: isCliSandboxMode(configuredSandbox) ? configuredSandbox : "workspace-write"
  };
}

export async function sendCodexCliSessionMessage(options: {
  sessionId: string;
  text: string;
  model?: string;
  reasoningEffort?: string;
  sandboxMode?: DashboardCliSandboxMode;
}): Promise<void> {
  validateSessionId(options.sessionId);
  const text = options.text.trim();
  if (!text) throw new Error("Write a message before sending it to Codex.");
  if (text.length > MAX_CLI_PROMPT_CHARS) {
    throw new Error(`The message is too long. Keep it under ${MAX_CLI_PROMPT_CHARS.toLocaleString()} characters.`);
  }
  if (options.model && !MODEL_ID_PATTERN.test(options.model)) throw new Error("The selected Codex model is invalid.");
  if (options.reasoningEffort && !REASONING_EFFORT_PATTERN.test(options.reasoningEffort)) {
    throw new Error("The selected reasoning effort is invalid.");
  }
  if (options.sandboxMode && !isCliSandboxMode(options.sandboxMode)) {
    throw new Error("The selected access mode is invalid.");
  }
  if (activeCliTurns.has(options.sessionId)) {
    throw new Error("Codex is already working in this session. Wait for it to finish or stop the current turn.");
  }

  const executable = await resolveCodexCliExecutable();
  const args = ["exec", "--json", "--color", "never", "--skip-git-repo-check"];
  if (options.model) args.push("--model", options.model);
  if (options.reasoningEffort) args.push("--config", `model_reasoning_effort=\"${options.reasoningEffort}\"`);
  if (options.sandboxMode) args.push("--sandbox", options.sandboxMode);
  args.push("resume", options.sessionId, "-");

  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable.command, [...executable.prefixArgs, ...args], {
      cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd(),
      env: process.env,
      windowsHide: true
    });
    activeCliTurns.set(options.sessionId, child);
    let stderr = "";
    let cancelled = false;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, CLI_TURN_TIMEOUT_MS);
    // Keep stdout drained so a verbose JSON event stream cannot block the child process.
    child.stdout.on("data", () => undefined);
    child.stderr.on("data", (chunk: Buffer) => {
      if (Buffer.byteLength(stderr, "utf8") < MAX_CLI_OUTPUT_BYTES) stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      activeCliTurns.delete(options.sessionId);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      activeCliTurns.delete(options.sessionId);
      cancelled = signal !== null && !timedOut;
      if (timedOut) {
        reject(new Error("Codex did not finish within 15 minutes. The turn was stopped; try a smaller request."));
      } else if (cancelled) {
        reject(new CodexCliTurnCancelledError());
      } else if (code === 0) {
        resolve();
      } else {
        reject(new Error(normalizeCliError(stderr) || `Codex exited with code ${code ?? "unknown"}.`));
      }
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(text, "utf8");
  });
}

export function cancelCodexCliSessionTurn(sessionId: string): boolean {
  validateSessionId(sessionId);
  const child = activeCliTurns.get(sessionId);
  if (!child) return false;
  return child.kill();
}

export async function openCodexCliSessionInVsCode(sessionId: string): Promise<void> {
  validateSessionId(sessionId);
  if (!vscode.extensions.getExtension(CODEX_EXTENSION_ID)) {
    throw new Error("Install or enable the official Codex extension before opening this session.");
  }
  await vscode.commands.executeCommand(
    "vscode.openWith",
    createLocalCodexConversationUri(sessionId),
    CODEX_CONVERSATION_VIEW_TYPE,
    vscode.ViewColumn.Active
  );
}

export async function renameCodexCliSession(sessionId: string, name: string): Promise<void> {
  validateSessionId(sessionId);
  const normalized = name.trim().replace(/\s+/g, " ");
  if (!normalized) throw new Error("Enter a session name before saving.");
  if (normalized.length > 160) throw new Error("Keep the session name under 160 characters.");
  await runCodexAppServerRequest("thread/name/set", { threadId: sessionId, name: normalized });
}

export async function forkCodexCliSession(sessionId: string): Promise<string> {
  validateSessionId(sessionId);
  const result = await runCodexAppServerRequest<{ thread?: { id?: unknown } }>("thread/fork", {
    threadId: sessionId,
    excludeTurns: true
  });
  const forkedId = result?.thread?.id;
  if (typeof forkedId !== "string" || !SESSION_ID_PATTERN.test(forkedId)) {
    throw new Error("Codex created the fork but did not return its session ID. Refresh the session list.");
  }
  return forkedId;
}

export async function archiveCodexCliSession(sessionId: string): Promise<void> {
  validateSessionId(sessionId);
  await runCodexCliUtility(["archive", sessionId], "archive the session");
}

export async function unarchiveCodexCliSession(sessionId: string): Promise<void> {
  validateSessionId(sessionId);
  await runCodexCliUtility(["unarchive", sessionId], "restore the session");
}

export async function deleteCodexCliSession(sessionId: string): Promise<void> {
  validateSessionId(sessionId);
  if (activeCliTurns.has(sessionId)) throw new Error("Stop the active Codex turn before deleting this session.");
  await runCodexCliUtility(["delete", "--force", sessionId], "delete the session");
}

export async function readCodexCliSessionMessages(
  sessionId: string,
  codexHome = resolveCodexHome()
): Promise<DashboardCliSessionMessage[]> {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error("The Codex CLI session identifier is invalid.");
  }
  if (path.resolve(codexHome) === path.resolve(resolveCodexHome())) {
    try {
      const response = await runCodexAppServerRequest<AppServerThreadReadResponse>("thread/read", {
        threadId: sessionId,
        includeTurns: true
      });
      const appServerItems = parseCodexAppServerThreadItems(response);
      if (appServerItems.some((item) => item.kind === "message")) {
        return appServerItems.slice(-MAX_VISIBLE_SESSION_MESSAGES);
      }
    } catch {
      // Older CLI builds and threads currently owned by another process can reject thread/read.
      // Fall back to the persisted rollout so the conversation remains available.
    }
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

type AppServerThreadReadResponse = {
  thread?: {
    turns?: Array<{
      id?: unknown;
      status?: unknown;
      error?: { message?: unknown } | null;
      startedAt?: unknown;
      completedAt?: unknown;
      durationMs?: unknown;
      items?: Array<Record<string, unknown>>;
    }>;
  };
};

export function parseCodexAppServerThreadItems(value: unknown): DashboardCliSessionMessage[] {
  const response = value as AppServerThreadReadResponse;
  const output: DashboardCliSessionMessage[] = [];
  for (const [turnIndex, turn] of (response.thread?.turns ?? []).entries()) {
    const status = normalizeCliItemStatus(turn.status);
    const timestamp = unixSecondsToIso(turn.startedAt);
    for (const [itemIndex, item] of (turn.items ?? []).entries()) {
      const parsed = parseAppServerThreadItem(item, `${turnIndex}-${itemIndex}`, status, timestamp);
      if (parsed) output.push(parsed);
    }
    if (turn.error?.message && typeof turn.error.message === "string") {
      const turnId = typeof turn.id === "string" || typeof turn.id === "number" ? String(turn.id) : String(turnIndex);
      output.push({
        id: `${turnId}-error`,
        kind: "error",
        text: turn.error.message.slice(0, MAX_SESSION_MESSAGE_CHARS),
        title: "Turn failed",
        status: "failed",
        timestamp: unixSecondsToIso(turn.completedAt) ?? timestamp
      });
    }
  }
  return output;
}

function parseAppServerThreadItem(
  item: Record<string, unknown>,
  fallbackId: string,
  turnStatus: DashboardCliSessionMessage["status"],
  timestamp: string | undefined
): DashboardCliSessionMessage | undefined {
  const type = typeof item["type"] === "string" ? item["type"] : "";
  const id = typeof item["id"] === "string" ? item["id"] : fallbackId;
  const status = normalizeCliItemStatus(item["status"] ?? turnStatus);
  const durationMs = typeof item["durationMs"] === "number" ? item["durationMs"] : undefined;
  if (type === "userMessage") {
    const text = parseUserInputs(item["content"]);
    return text ? { id, kind: "message", role: "user", text, timestamp } : undefined;
  }
  if (type === "agentMessage") {
    const text = typeof item["text"] === "string" ? item["text"].trim() : "";
    return text ? { id, kind: "message", role: "assistant", text: text.slice(0, MAX_SESSION_MESSAGE_CHARS), timestamp } : undefined;
  }
  if (type === "reasoning") {
    const summary = readStringArray(item["summary"]);
    const content = readStringArray(item["content"]);
    return { id, kind: "reasoning", title: "Reasoning", text: (summary.join("\n\n") || content.join("\n\n") || "Codex reasoned about the next step.").slice(0, MAX_SESSION_MESSAGE_CHARS), status, timestamp };
  }
  if (type === "plan") {
    return { id, kind: "plan", title: "Plan", text: readDisplayText(item["text"], "Codex prepared a plan."), status, timestamp };
  }
  if (type === "commandExecution") {
    const command = readDisplayText(item["command"], "Command");
    const output = typeof item["aggregatedOutput"] === "string" ? item["aggregatedOutput"].slice(0, MAX_SESSION_MESSAGE_CHARS) : undefined;
    return {
      id,
      kind: "command",
      title: status === "inProgress" ? "Running command" : status === "failed" ? "Command failed" : "Ran command",
      text: command,
      command,
      cwd: typeof item["cwd"] === "string" ? item["cwd"] : undefined,
      output,
      exitCode: typeof item["exitCode"] === "number" ? item["exitCode"] : undefined,
      durationMs,
      status,
      timestamp
    };
  }
  if (type === "fileChange") {
    const changes = parseCliFileChanges(item["changes"]);
    return { id, kind: "file-change", title: status === "inProgress" ? "Editing files" : `Edited ${changes.length} ${changes.length === 1 ? "file" : "files"}`, text: changes.map((change) => change.path).join("\n") || "File changes", changes, status, timestamp };
  }
  if (type === "mcpToolCall" || type === "dynamicToolCall") {
    const server = typeof item["server"] === "string" ? item["server"] : typeof item["namespace"] === "string" ? item["namespace"] : "Tool";
    const tool = typeof item["tool"] === "string" ? item["tool"] : "call";
    const error = safeDisplayJson(item["error"]);
    return { id, kind: "tool-call", title: status === "inProgress" ? `Using ${tool}` : `Used ${tool}`, subtitle: server, text: error ?? `${server} · ${tool}`, arguments: safeDisplayJson(item["arguments"]), result: error ?? safeDisplayJson(item["result"] ?? item["contentItems"] ?? item["success"]), durationMs, status: error ? "failed" : status, timestamp };
  }
  if (type === "collabToolCall" || type === "collabAgentToolCall" || type === "subAgentActivity") {
    const tool = typeof item["tool"] === "string" ? item["tool"] : typeof item["kind"] === "string" ? item["kind"] : "Agent activity";
    return { id, kind: "collaboration", title: status === "inProgress" ? "Working with an agent" : "Agent activity", text: typeof item["prompt"] === "string" ? item["prompt"].slice(0, MAX_SESSION_MESSAGE_CHARS) : tool, subtitle: tool, status, timestamp };
  }
  if (type === "webSearch") {
    const query = typeof item["query"] === "string" ? item["query"] : safeDisplayJson(item["action"]);
    return { id, kind: "web-search", title: "Searched the web", text: query || "Web search", status: status === "unknown" ? "completed" : status, timestamp };
  }
  if (type === "imageView" || type === "imageGeneration") {
    return { id, kind: "image", title: type === "imageView" ? "Viewed image" : "Generated image", text: readDisplayText(item["path"], type === "imageView" ? "Image" : "Image generation"), status, timestamp };
  }
  if (type === "enteredReviewMode" || type === "exitedReviewMode") {
    return { id, kind: "review", title: type === "enteredReviewMode" ? "Started review" : "Completed review", text: readDisplayText(item["review"], "Code review"), status, timestamp };
  }
  if (type === "contextCompaction") {
    return { id, kind: "compaction", title: "Compacted conversation", text: "Codex condensed earlier context to continue working.", status: "completed", timestamp };
  }
  if (type === "sleep") {
    return { id, kind: "tool-call", title: "Waited", text: `Waited ${formatDuration(typeof item["durationMs"] === "number" ? item["durationMs"] : 0)}.`, durationMs, status, timestamp };
  }
  return undefined;
}

function parseCliFileChanges(value: unknown): NonNullable<DashboardCliSessionMessage["changes"]> {
  if (Array.isArray(value)) {
    return value.flatMap((change) => {
      if (!change || typeof change !== "object") return [];
      const detail = change as Record<string, unknown>;
      if (typeof detail["path"] !== "string") return [];
      return [{
        path: detail["path"],
        kind: typeof detail["kind"] === "string" ? detail["kind"] : "update",
        diff: typeof detail["diff"] === "string" ? detail["diff"].slice(0, MAX_SESSION_MESSAGE_CHARS) : undefined
      }];
    });
  }
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).map(([filePath, change]) => {
    const detail = change && typeof change === "object" ? change as Record<string, unknown> : {};
    const diff = detail["diff"] ?? detail["unified_diff"];
    return {
      path: filePath,
      kind: typeof detail["kind"] === "string" ? detail["kind"] : typeof detail["type"] === "string" ? detail["type"] : "update",
      diff: typeof diff === "string" ? diff.slice(0, MAX_SESSION_MESSAGE_CHARS) : undefined
    };
  });
}

function parseUserInputs(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    if (item["type"] === "text" && typeof item["text"] === "string") return [item["text"]];
    if (item["type"] === "image" || item["type"] === "localImage") return ["[Image]"];
    if (item["type"] === "skill" && typeof item["name"] === "string") return [`[Skill: ${item["name"]}]`];
    return [];
  }).join("\n\n").trim().slice(0, MAX_SESSION_MESSAGE_CHARS);
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim())) : [];
}

function readDisplayText(value: unknown, fallback: string): string {
  return (typeof value === "string" && value.trim() ? value.trim() : fallback).slice(0, MAX_SESSION_MESSAGE_CHARS);
}

function safeDisplayJson(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value.slice(0, MAX_SESSION_MESSAGE_CHARS);
  try {
    const serialized = JSON.stringify(value, null, 2);
    return typeof serialized === "string" ? serialized.slice(0, MAX_SESSION_MESSAGE_CHARS) : undefined;
  } catch {
    return "[Unserializable value]";
  }
}

function normalizeCliItemStatus(value: unknown): DashboardCliSessionMessage["status"] {
  if (value === "inProgress" || value === "completed" || value === "failed" || value === "declined" || value === "interrupted") return value;
  return "unknown";
}

function unixSecondsToIso(value: unknown): string | undefined {
  return typeof value === "number" && Number.isFinite(value) ? new Date(value * 1000).toISOString() : undefined;
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${Math.max(0, Math.round(durationMs))} ms`;
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)} s`;
  return `${Math.floor(durationMs / 60_000)}m ${Math.round((durationMs % 60_000) / 1000)}s`;
}

function validateSessionId(sessionId: string): void {
  if (!SESSION_ID_PATTERN.test(sessionId)) throw new Error("The Codex CLI session identifier is invalid.");
}

function isCliSandboxMode(value: string | undefined): value is DashboardCliSandboxMode {
  return value === "read-only" || value === "workspace-write" || value === "danger-full-access";
}

async function readSmallOptionalFile(filePath: string, maxBytes: number): Promise<string | undefined> {
  const stat = await fs.stat(filePath).catch(() => undefined);
  if (!stat || stat.size > maxBytes) return undefined;
  return fs.readFile(filePath, "utf8").catch(() => undefined);
}

function parseCliModels(raw: string | undefined): DashboardCliComposerConfig["models"] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as {
      models?: Array<{
        slug?: unknown;
        display_name?: unknown;
        description?: unknown;
        visibility?: unknown;
        default_reasoning_level?: unknown;
        supported_reasoning_levels?: Array<{ effort?: unknown }>;
      }>;
    };
    return (parsed.models ?? [])
      .filter((model) => model.visibility === "list" && typeof model.slug === "string" && MODEL_ID_PATTERN.test(model.slug))
      .map((model) => ({
        id: model.slug as string,
        label: typeof model.display_name === "string" ? model.display_name : model.slug as string,
        description: typeof model.description === "string" ? model.description : undefined,
        defaultReasoningEffort:
          typeof model.default_reasoning_level === "string" && REASONING_EFFORT_PATTERN.test(model.default_reasoning_level)
            ? model.default_reasoning_level
            : undefined,
        reasoningEfforts: (model.supported_reasoning_levels ?? [])
          .map((level) => level.effort)
          .filter((effort): effort is string => typeof effort === "string" && REASONING_EFFORT_PATTERN.test(effort))
      }));
  } catch {
    return [];
  }
}

function readTomlString(raw: string | undefined, key: string): string | undefined {
  if (!raw) return undefined;
  const match = raw.match(new RegExp(`^\\s*${key}\\s*=\\s*[\"']([^\"']+)[\"']\\s*(?:#.*)?$`, "m"));
  return match?.[1]?.trim();
}

async function resolveCodexCliExecutable(): Promise<{ command: string; prefixArgs: string[] }> {
  const candidates = [
    process.env["CODEX_CLI_PATH"],
    vscode.extensions.getExtension(CODEX_EXTENSION_ID)?.extensionPath
      ? path.join(
          vscode.extensions.getExtension(CODEX_EXTENSION_ID)!.extensionPath,
          "bin",
          process.platform === "win32"
            ? process.arch === "arm64" ? "windows-arm64" : "windows-x86_64"
            : process.platform === "darwin"
              ? process.arch === "arm64" ? "macos-aarch64" : "macos-x86_64"
              : process.arch === "arm64" ? "linux-aarch64" : "linux-x86_64",
          process.platform === "win32" ? "codex.exe" : "codex"
        )
      : undefined
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of candidates) {
    if (await fs.stat(candidate).then((stat) => stat.isFile()).catch(() => false)) {
      return { command: candidate, prefixArgs: [] };
    }
  }
  if (process.platform === "win32") {
    const npmScript = process.env["APPDATA"]
      ? path.join(process.env["APPDATA"], "npm", "node_modules", "@openai", "codex", "bin", "codex.js")
      : undefined;
    if (npmScript && await fs.stat(npmScript).then((stat) => stat.isFile()).catch(() => false)) {
      return { command: process.execPath, prefixArgs: [npmScript] };
    }
  }
  return { command: "codex", prefixArgs: [] };
}

async function runCodexCliUtility(args: string[], label: string): Promise<void> {
  const executable = await resolveCodexCliExecutable();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable.command, [...executable.prefixArgs, ...args], {
      cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd(),
      env: process.env,
      windowsHide: true
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (code) => code === 0
      ? resolve()
      : reject(new Error(normalizeCliError(stderr) || `Codex could not ${label}.`)));
  });
}

async function runCodexAppServerRequest<T = unknown>(method: string, params: unknown): Promise<T> {
  const executable = await resolveCodexCliExecutable();
  return new Promise<T>((resolve, reject) => {
    const child = spawn(executable.command, [...executable.prefixArgs, "app-server", "--stdio"], {
      cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd(),
      env: process.env,
      windowsHide: true
    });
    const lines = readline.createInterface({ input: child.stdout });
    let stderr = "";
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      lines.close();
      child.kill();
      callback();
    };
    const write = (value: unknown): void => {
      child.stdin.write(`${JSON.stringify(value)}\n`, "utf8");
    };
    const timeout = setTimeout(() => finish(() => reject(new Error("Codex did not respond to the session action in time."))), APP_SERVER_REQUEST_TIMEOUT_MS);
    child.stderr.on("data", (chunk: Buffer) => {
      if (Buffer.byteLength(stderr, "utf8") < MAX_CLI_OUTPUT_BYTES) stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => finish(() => reject(error)));
    child.on("close", (code) => {
      if (!settled) finish(() => reject(new Error(normalizeCliError(stderr) || `Codex app server exited with code ${code ?? "unknown"}.`)));
    });
    lines.on("line", (line) => {
      try {
        const message = JSON.parse(line) as { id?: unknown; result?: unknown; error?: { message?: unknown } };
        if (message.id === 1 && message.result) {
          write({ method: "initialized" });
          write({ method, id: 2, params });
        } else if (message.id === 2) {
          if (message.error) {
            const detail = typeof message.error.message === "string" ? message.error.message : "Codex rejected the session action.";
            finish(() => reject(new Error(detail)));
          } else {
            finish(() => resolve(message.result as T));
          }
        }
      } catch {
        // Ignore non-protocol diagnostic lines and wait for the requested response.
      }
    });
    write({
      method: "initialize",
      id: 1,
      params: {
        clientInfo: { name: "codex-accounts-manager", title: "Codex Manager", version: "0.1.19" },
        capabilities: null
      }
    });
  });
}

function normalizeCliError(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "").trim().split(/\r?\n/).filter(Boolean).slice(-4).join(" ").slice(0, 1200);
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
  const archived = await fs.readdir(path.join(codexHome, "archived_sessions"), { withFileTypes: true }).catch(() => []);
  const archivedEntry = archived.find(
    (entry) => !entry.isSymbolicLink() && entry.isFile() && entry.name.endsWith(".jsonl") && entry.name.includes(sessionId)
  );
  return archivedEntry ? path.join(codexHome, "archived_sessions", archivedEntry.name) : undefined;
}

async function readArchivedSessionIds(codexHome: string): Promise<Set<string>> {
  const entries = await fs.readdir(path.join(codexHome, "archived_sessions"), { withFileTypes: true }).catch(() => []);
  const ids = new Set<string>();
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink()) continue;
    const match = entry.name.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (match) ids.add(match[0]);
  }
  return ids;
}

function parseCliSessionMessage(line: string, sequence: number): DashboardCliSessionMessage | undefined {
  try {
    const value = JSON.parse(line) as {
      timestamp?: unknown;
      type?: unknown;
      payload?: Record<string, unknown>;
    };
    const timestamp = typeof value.timestamp === "string" ? normalizeTimestamp(value.timestamp) : undefined;
    if (value.type === "event_msg" && value.payload?.["type"] === "item_completed") {
      const item = normalizePersistedActivity(value.payload["item"]);
      const activityTimestamp = typeof value.timestamp === "string" ? value.timestamp : "activity";
      return item ? parseAppServerThreadItem(item, `${sequence}-${activityTimestamp}`, "completed", timestamp) : undefined;
    }
    const payload = value.type === "response_item" ? value.payload : undefined;
    const role = payload?.["role"];
    if (payload?.["type"] !== "message" || (role !== "user" && role !== "assistant")) return undefined;
    if (role === "assistant" && payload["phase"] && payload["phase"] !== "commentary" && payload["phase"] !== "final_answer") {
      return undefined;
    }
    if (!Array.isArray(payload["content"])) return undefined;
    const parts: string[] = [];
    for (const item of payload["content"]) {
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
      timestamp
    };
  } catch {
    return undefined;
  }
}

function normalizePersistedActivity(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  const persistedType = typeof item["type"] === "string" ? item["type"] : "";
  const type = ({
    Reasoning: "reasoning",
    CommandExecution: "commandExecution",
    FileChange: "fileChange",
    McpToolCall: "mcpToolCall",
    CollabAgentToolCall: "collabAgentToolCall",
    SubAgentActivity: "subAgentActivity",
    ImageView: "imageView",
    ContextCompaction: "contextCompaction",
    Extension: item["kind"] === "web.search" ? "webSearch" : ""
  } as Record<string, string>)[persistedType];
  if (!type) return undefined;
  const changes = item["changes"] && typeof item["changes"] === "object" && !Array.isArray(item["changes"])
    ? Object.entries(item["changes"] as Record<string, unknown>).map(([filePath, change]) => {
        const detail = change && typeof change === "object" ? change as Record<string, unknown> : {};
        return { path: filePath, kind: detail["type"] ?? "update", diff: detail["unified_diff"] };
      })
    : item["changes"];
  return {
    ...item,
    type,
    summary: item["summary"] ?? item["summary_text"],
    content: item["content"] ?? item["raw_content"],
    aggregatedOutput: item["aggregatedOutput"] ?? item["aggregated_output"] ?? item["formatted_output"],
    exitCode: item["exitCode"] ?? item["exit_code"],
    durationMs: item["durationMs"] ?? item["duration"],
    changes,
    query: item["query"] ?? item["action"]
  };
}

function createLocalCodexConversationUri(sessionId: string): vscode.Uri {
  return vscode.Uri.file(`/local/${sessionId}`).with({
    scheme: CODEX_CONVERSATION_SCHEME,
    authority: CODEX_CONVERSATION_AUTHORITY
  });
}
