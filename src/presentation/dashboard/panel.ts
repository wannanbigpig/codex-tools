import * as vscode from "vscode";
import { getDashboardCopy } from "../../application/dashboard/copy";
import { buildDashboardState } from "../../application/dashboard/buildDashboardState";
import type {
  DashboardActionName,
  DashboardClientMessage,
  DashboardHostMessage,
  DashboardSettingKey
} from "../../domain/dashboard/types";
import { ExtensionSettingsStore } from "../../infrastructure/config/extensionSettings";
import { AccountsRepository } from "../../storage";
import { AnnouncementService, type AnnouncementOptions } from "../../services/announcements";
import { renderDashboardShell } from "./shell";
import { buildDashboardStateSignature } from "./signature";
import { executeDashboardActionMessage } from "./actionHandlers";
import { clearDashboardCodexAppPath, dispatchDashboardClientMessage } from "./messageDispatcher";
import { DashboardOAuthCoordinator } from "./oauthCoordinator";
import { handleDashboardSettingUpdate, pickDashboardCodexAppPath } from "./settings";

const DASHBOARD_VIEW_TYPE = "codexQuotaSummary";

let dashboardPanelController: DashboardPanelController | undefined;

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
    this.oauth = new DashboardOAuthCoordinator(repo, () => {
      this.schedulePublishState();
    });
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
          }
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

    await this.publishState();
  }

  private getPanelTitle(): string {
    return getDashboardCopy(this.settingsStore.resolveLanguage()).panelTitle;
  }

  private getPanelIconUri(): vscode.Uri {
    return vscode.Uri.joinPath(this.context.extensionUri, "media", "CT_logo_transparent_square_hd.png");
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
      void this.publishState();
    }, delayMs);
  }

  private reloadShell(): void {
    if (!this.panel) {
      return;
    }

    this.webviewReady = false;
    this.lastPublishedStateSignature = undefined;
    this.panel.webview.html = renderDashboardShell(this.context, this.panel.webview, this.settingsStore);
  }

  private async publishState(): Promise<void> {
    if (!this.panel || !this.webviewReady) {
      return;
    }

    const logoUri = this.panel.webview
      .asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "CT_logo_transparent_square_hd.png"))
      .toString();
    const state = await buildDashboardState(
      this.repo,
      this.settingsStore,
      logoUri,
      await this.announcements.getState(this.getAnnouncementOptions())
    );
    this.panel.title = state.panelTitle;
    const signature = buildDashboardStateSignature(state);
    if (signature === this.lastPublishedStateSignature) {
      return;
    }

    this.lastPublishedStateSignature = signature;
    await this.panel.webview.postMessage({
      type: "dashboard:snapshot",
      state
    } satisfies DashboardHostMessage);
  }

  private async handleActionMessage(
    message: Extract<DashboardClientMessage, { type: "dashboard:action" }>
  ): Promise<void> {
    const result = await executeDashboardActionMessage(
      {
        context: this.context,
        repo: this.repo,
        resolveLanguage: () => this.settingsStore.resolveLanguage(),
        schedulePublishState: () => this.schedulePublishState(),
        reloadShell: () => this.reloadShell(),
        oauth: this.oauth,
        announcements: this.announcements,
        getAnnouncementOptions: () => this.getAnnouncementOptions()
      },
      message
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

  private async handleSettingUpdate(key: DashboardSettingKey, value: string | number | boolean): Promise<void> {
    const updated = await handleDashboardSettingUpdate(key, value);
    if (updated) {
      this.schedulePublishState();
    }
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

export async function refreshQuotaSummaryPanel(): Promise<void> {
  if (!dashboardPanelController) {
    return;
  }

  await dashboardPanelController.refresh();
}
