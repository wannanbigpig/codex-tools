import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
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
        if (!this.restoring) {
          void this.rememberOpenConversations();
        }
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("codexAccounts.autoResumeCodexSessions") && this.isAutoResumeEnabled()) {
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
    return vscode.workspace.getConfiguration("codexAccounts").get<boolean>("autoResumeCodexSessions", false);
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

function resolveCodexHome(): string {
  const configured = process.env["CODEX_HOME"]?.trim().replace(/^['"]|['"]$/g, "");
  return configured || path.join(os.homedir(), ".codex");
}

function createLocalCodexConversationUri(sessionId: string): vscode.Uri {
  return vscode.Uri.file(`/local/${sessionId}`).with({
    scheme: CODEX_CONVERSATION_SCHEME,
    authority: CODEX_CONVERSATION_AUTHORITY
  });
}
