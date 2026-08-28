import * as vscode from "vscode";
import { getDashboardCopy } from "../../application/dashboard/copy";
import { buildDashboardState } from "../../application/dashboard/buildDashboardState";
import type {
  DashboardActionName,
  DashboardClientMessage,
  DashboardHostMessage,
  DashboardSettingKey
} from "../../domain/dashboard/types";
import { ExtensionSettingsStore, getCodexAccountsConfiguration } from "../../infrastructure/config/extensionSettings";
import { AccountsRepository } from "../../storage";
import { AnnouncementService, type AnnouncementOptions } from "../../services/announcements";
import { renderDashboardShell } from "./shell";
import { buildDashboardStateSignature } from "./signature";
import { executeDashboardActionMessage } from "./actionHandlers";
import { clearDashboardCodexAppPath, dispatchDashboardClientMessage } from "./messageDispatcher";
import { DashboardOAuthCoordinator } from "./oauthCoordinator";
import { backfillMissingResetCreditExpiries } from "./resetCreditsBackfill";
import { withDashboardNotificationSuppression } from "../../utils/notificationPolicy";
import { saveDashboardUsageHistory } from "../../services/dashboardUsageHistory";
import { handleDashboardSettingUpdate, pickDashboardCodexAppPath } from "./settings";

const DASHBOARD_VIEW_TYPE = "codexQuotaSummary";
const REOPEN_AFTER_HOST_RESTART_KEY = "codexAccounts.reopenDashboardAfterHostRestart";

let dashboardPanelController: DashboardPanelController | undefined;

type PublishDashboardSnapshotParams = {
  repo: AccountsRepository;
  settingsStore: ExtensionSettingsStore;
  logoUri: string;
  announcementsState: Awaited<ReturnType<AnnouncementService["getState"]>>;
  setPanelTitle: (title: string) => void;
  postMessage: (message: DashboardHostMessage) => Thenable<boolean>;
  schedulePublishState: () => void;
  lastPublishedStateSignature?: string;
  force?: boolean;
};

export async function publishDashboardSnapshot(params: PublishDashboardSnapshotParams): Promise<string | undefined> {
  const state = await buildDashboardState(params.repo, params.settingsStore, params.logoUri, params.announcementsState);
  void backfillMissingResetCreditExpiries(params.repo, state.accounts, params.schedulePublishState).catch(
    () => undefined
  );

  params.setPanelTitle(state.panelTitle);
  const signature = buildDashboardStateSignature(state);
  if (!params.force && signature === params.lastPublishedStateSignature) {
    return undefined;
  }

  await params.postMessage({
    type: "dashboard:snapshot",
    state
  } satisfies DashboardHostMessage);
  return signature;
}

class DashboardPanelController {
  private readonly settingsStore = new ExtensionSettingsStore();
  private readonly announcements: AnnouncementService;
  private readonly oauth: DashboardOAuthCoordinator;
  private panel: vscode.WebviewPanel | undefined;
  private configWatcher: vscode.Disposable | undefined;
  private webviewReady = false;
  private publishTimer: NodeJS.Timeout | undefined;
  private lastPublishedStateSignature: string | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly repo: AccountsRepository
  ) {
    this.announcements = new AnnouncementService(context.globalStorageUri.fsPath, context.extensionUri.fsPath);
    this.oauth = new DashboardOAuthCoordinator(
      repo,
      () => {
        this.schedulePublishState();
      },
      async () => {
        if (!getCodexAccountsConfiguration().get<boolean>("encryptedSyncEnabled", false)) {
          return undefined;
        }
        return vscode.commands.executeCommand<boolean>("codexAccounts.syncNow", { announceSuccess: false });
      }
    );
  }

  open(): void {
    const panelTitle = this.getPanelTitle();
    const iconUri = this.getPanelIconUri();
    const targetColumn = this.getTargetViewColumn();

    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(DASHBOARD_VIEW_TYPE, panelTitle, targetColumn, {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")]
      });
      this.panel.iconPath = iconUri;
      this.panel.webview.html = renderDashboardShell(this.context, this.panel.webview, this.settingsStore);

      this.panel.onDidDispose(() => {
        if (this.publishTimer) {
          clearTimeout(this.publishTimer);
          this.publishTimer = undefined;
        }
        this.oauth.dispose();
        this.configWatcher?.dispose();
        this.configWatcher = undefined;
        this.lastPublishedStateSignature = undefined;
        this.panel = undefined;
        this.webviewReady = false;
      });

      this.panel.webview.onDidReceiveMessage((message: DashboardClientMessage) => {
        void dispatchDashboardClientMessage(message, {
          onReady: () => {
            this.webviewReady = true;
            this.schedulePublishState();
          },
          onAction: async (actionMessage) => {
            await this.handleActionMessage(actionMessage);
          },
          onSetting: async (key, value) => {
            await this.handleSettingUpdate(key, value);
          },
          onPickCodexAppPath: async () => {
            await this.pickCodexAppPath();
          },
          onClearCodexAppPath: async () => {
            await clearDashboardCodexAppPath();
          },
          onUsageHistory: async (samples) => {
            await saveDashboardUsageHistory(this.context, samples);
          }
        }).catch((error) => {
          const detail = error instanceof Error ? error.message : String(error);
          console.error(`[codexAccounts] dashboard request failed: ${message.type}`, error);
          void this.postNotice("error", `The dashboard request failed: ${detail}`).catch(() => undefined);
          void this.publishState(true).catch(() => undefined);
        });
      });

      this.configWatcher = this.settingsStore.onDidChange(() => {
        this.schedulePublishState();
      });
    } else {
      this.panel.title = panelTitle;
      this.panel.iconPath = iconUri;
      this.panel.reveal(targetColumn, false);
    }

    if (this.webviewReady) {
      this.schedulePublishState();
    }
  }

  async refresh(): Promise<void> {
    if (!this.panel || !this.webviewReady) {
      return;
    }

    await this.publishState(true);
  }

  private getPanelTitle(): string {
    return getDashboardCopy(this.settingsStore.resolveLanguage()).panelTitle;
  }

  private getPanelIconUri(): vscode.Uri {
    return vscode.Uri.joinPath(this.context.extensionUri, "media", "product-icons", "codex-openai.svg");
  }

  private getTargetViewColumn(): vscode.ViewColumn {
    const activeEditorColumn = vscode.window.activeTextEditor?.viewColumn;
    return activeEditorColumn ?? vscode.ViewColumn.Active;
  }

  private schedulePublishState(delayMs = 0): void {
    if (!this.panel) {
      return;
    }

    if (this.publishTimer) {
      clearTimeout(this.publishTimer);
    }

    this.publishTimer = setTimeout(() => {
      this.publishTimer = undefined;
      void this.publishState().catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error);
        console.error("[codexAccounts] scheduled dashboard publish failed", error);
        void this.postNotice("error", `Dashboard refresh failed: ${detail}`).catch(() => undefined);
      });
    }, delayMs);
  }

  private async publishState(force = false): Promise<void> {
    if (!this.panel || !this.webviewReady) {
      return;
    }

    const logoUri = this.panel.webview
      .asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "product-icons", "codex-openai.svg"))
      .toString();
    const signature = await publishDashboardSnapshot({
      repo: this.repo,
      settingsStore: this.settingsStore,
      logoUri,
      announcementsState: await this.announcements.getState(this.getAnnouncementOptions()),
      setPanelTitle: (title) => {
        if (this.panel) {
          this.panel.title = title;
        }
      },
      postMessage: (message) => this.panel!.webview.postMessage(message),
      schedulePublishState: () => this.schedulePublishState(),
      lastPublishedStateSignature: this.lastPublishedStateSignature,
      force
    });
    if (!signature) {
      return;
    }

    this.lastPublishedStateSignature = signature;
  }

  private async handleActionMessage(
    message: Extract<DashboardClientMessage, { type: "dashboard:action" }>
  ): Promise<void> {
    const result = await withDashboardNotificationSuppression(() =>
      executeDashboardActionMessage(
        {
          context: this.context,
          repo: this.repo,
          resolveLanguage: () => this.settingsStore.resolveLanguage(),
          schedulePublishState: () => this.schedulePublishState(),
          publishState: async (force = false) => this.publishState(force),
          oauth: this.oauth,
          announcements: this.announcements,
          getAnnouncementOptions: () => this.getAnnouncementOptions()
        },
        message
      )
    );

    await this.postActionResult(
      message.requestId,
      message.action,
      result.status,
      message.accountId,
      result.payload,
      result.errorMessage
    );
  }

  private async postActionResult(
    requestId: string,
    action: DashboardActionName,
    status: Extract<DashboardHostMessage, { type: "dashboard:action-result" }>["status"],
    accountId?: string,
    payload?: Extract<DashboardHostMessage, { type: "dashboard:action-result" }>["payload"],
    error?: string
  ): Promise<void> {
    if (!this.panel) {
      return;
    }

    await this.panel.webview.postMessage({
      type: "dashboard:action-result",
      requestId,
      action,
      accountId,
      status,
      payload,
      error
    } satisfies DashboardHostMessage);
  }

  async prepareForExtensionHostRestart(): Promise<boolean> {
    if (!this.panel) {
      return false;
    }
    await this.context.workspaceState.update(REOPEN_AFTER_HOST_RESTART_KEY, true);
    this.panel.dispose();
    return true;
  }

  private async postNotice(level: "info" | "warning" | "error", message: string): Promise<void> {
    if (!this.panel) {
      return;
    }
    await this.panel.webview.postMessage({
      type: "dashboard:notice",
      level,
      message
    } satisfies DashboardHostMessage);
  }

  private async handleSettingUpdate(key: DashboardSettingKey, value: string | number | boolean): Promise<void> {
    const updated = await handleDashboardSettingUpdate(key, value);
    if (!updated) {
      throw new Error(`The ${key} setting could not be updated.`);
    }
    this.schedulePublishState();
  }

  private async pickCodexAppPath(): Promise<void> {
    await pickDashboardCodexAppPath(this.settingsStore);
  }

  private getAnnouncementOptions(): AnnouncementOptions {
    const packageJson = this.context.extension.packageJSON as { version?: string };
    return {
      version: packageJson.version ?? "0.0.0",
      locale: this.settingsStore.resolveLanguage()
    };
  }
}

export function openQuotaSummaryPanel(context: vscode.ExtensionContext, repo: AccountsRepository): void {
  dashboardPanelController ??= new DashboardPanelController(context, repo);
  dashboardPanelController.open();
}

export async function prepareQuotaSummaryPanelForExtensionHostRestart(): Promise<boolean> {
  return dashboardPanelController?.prepareForExtensionHostRestart() ?? false;
}

export async function restoreQuotaSummaryPanelAfterExtensionHostRestart(
  context: vscode.ExtensionContext,
  repo: AccountsRepository
): Promise<void> {
  if (!context.workspaceState.get<boolean>(REOPEN_AFTER_HOST_RESTART_KEY, false)) {
    return;
  }
  await context.workspaceState.update(REOPEN_AFTER_HOST_RESTART_KEY, false);
  openQuotaSummaryPanel(context, repo);
}

export async function refreshQuotaSummaryPanel(): Promise<void> {
  if (!dashboardPanelController) {
    return;
  }

  await dashboardPanelController.refresh();
}
