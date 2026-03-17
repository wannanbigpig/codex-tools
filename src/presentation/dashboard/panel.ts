import * as vscode from "vscode";
import { buildDashboardState } from "../../application/dashboard/buildDashboardState";
import { getDashboardCopy } from "../../application/dashboard/copy";
import { DashboardClientMessage, DashboardHostMessage, DashboardSettingKey } from "../../domain/dashboard/types";
import { ExtensionSettingsStore } from "../../infrastructure/config/extensionSettings";
import { AccountsRepository } from "../../storage";

const DASHBOARD_VIEW_TYPE = "codexQuotaSummary";

let dashboardPanelController: DashboardPanelController | undefined;

class DashboardPanelController {
  private readonly settingsStore = new ExtensionSettingsStore();
  private panel: vscode.WebviewPanel | undefined;
  private configWatcher: vscode.Disposable | undefined;
  private webviewReady = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly repo: AccountsRepository
  ) {}

  open(): void {
    const panelTitle = getDashboardCopy(this.settingsStore.resolveLanguage()).panelTitle;
    const iconUri = vscode.Uri.joinPath(this.context.extensionUri, "media", "CT_logo_transparent_square_hd.png");

    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(DASHBOARD_VIEW_TYPE, panelTitle, vscode.ViewColumn.Beside, {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")]
      });
      this.panel.iconPath = iconUri;
      this.panel.webview.html = this.renderShell(this.panel.webview);

      this.panel.onDidDispose(() => {
        this.configWatcher?.dispose();
        this.configWatcher = undefined;
        this.panel = undefined;
        this.webviewReady = false;
      });

      this.panel.webview.onDidReceiveMessage((message: DashboardClientMessage) => {
        void this.handleMessage(message);
      });

      this.configWatcher = this.settingsStore.onDidChange(() => {
        void this.publishState();
      });
    } else {
      this.panel.title = panelTitle;
      this.panel.iconPath = iconUri;
      this.panel.reveal(vscode.ViewColumn.Beside, false);
    }

    if (this.webviewReady) {
      void this.publishState();
    }
  }

  async refresh(): Promise<void> {
    if (!this.panel || !this.webviewReady) {
      return;
    }

    await this.publishState();
  }

  private async publishState(): Promise<void> {
    if (!this.panel || !this.webviewReady) {
      return;
    }

    const logoUri = this.panel.webview
      .asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "CT_logo_transparent_square_hd.png"))
      .toString();
    const state = await buildDashboardState(this.repo, this.settingsStore, logoUri);
    this.panel.title = state.panelTitle;

    const message: DashboardHostMessage = {
      type: "dashboard:snapshot",
      state
    };
    await this.panel.webview.postMessage(message);
  }

  private async handleMessage(message: DashboardClientMessage): Promise<void> {
    switch (message.type) {
      case "dashboard:ready":
        this.webviewReady = true;
        await this.publishState();
        return;
      case "dashboard:action":
        await this.handleActionMessage(message.action, message.accountId);
        return;
      case "dashboard:setting":
        await this.handleSettingUpdate(message.key, message.value);
        return;
      case "dashboard:pickCodexAppPath":
        await this.pickCodexAppPath();
        return;
      case "dashboard:clearCodexAppPath":
        await vscode.workspace.getConfiguration("codexAccounts").update("codexAppPath", "", vscode.ConfigurationTarget.Global);
        return;
      default:
        return;
    }
  }

  private async handleActionMessage(
    action: Exclude<DashboardClientMessage, { type: "dashboard:ready" | "dashboard:setting" | "dashboard:pickCodexAppPath" | "dashboard:clearCodexAppPath" }>["action"],
    accountId?: string
  ): Promise<void> {
    const account = accountId ? await this.repo.getAccount(accountId) : undefined;

    switch (action) {
      case "addAccount":
        await vscode.commands.executeCommand("codexAccounts.addAccount");
        return;
      case "importCurrent":
        await vscode.commands.executeCommand("codexAccounts.importCurrentAuth");
        return;
      case "refreshAll":
        await vscode.commands.executeCommand("codexAccounts.refreshAllQuotas");
        return;
      case "refreshView":
        await this.publishState();
        return;
      case "details":
        if (account) {
          await vscode.commands.executeCommand("codexAccounts.openDetails", account);
        }
        return;
      case "switch":
        if (account) {
          await vscode.commands.executeCommand("codexAccounts.switchAccount", account);
        }
        return;
      case "refresh":
        if (account) {
          await vscode.commands.executeCommand("codexAccounts.refreshQuota", account);
        }
        return;
      case "remove":
        if (account) {
          await vscode.commands.executeCommand("codexAccounts.removeAccount", account);
        }
        return;
      case "toggleStatusBar":
        if (account) {
          await vscode.commands.executeCommand("codexAccounts.toggleStatusBarAccount", account);
        }
        return;
      default:
        return;
    }
  }

  private async handleSettingUpdate(key: DashboardSettingKey, value: string | number | boolean): Promise<void> {
    const config = vscode.workspace.getConfiguration("codexAccounts");

    switch (key) {
      case "codexAppRestartMode":
        if (value === "auto" || value === "manual") {
          await config.update(key, value, vscode.ConfigurationTarget.Global);
        }
        return;
      case "autoRefreshMinutes":
      case "quotaWarningThreshold":
      case "quotaGreenThreshold":
      case "quotaYellowThreshold":
        if (typeof value === "number") {
          await config.update(key, value, vscode.ConfigurationTarget.Global);
        }
        return;
      case "showCodeReviewQuota":
      case "quotaWarningEnabled":
      case "debugNetwork":
        if (typeof value === "boolean") {
          await config.update(key, value, vscode.ConfigurationTarget.Global);
        }
        return;
      case "displayLanguage":
        if (value === "auto" || value === "zh" || value === "en") {
          await config.update(key, value, vscode.ConfigurationTarget.Global);
        }
        return;
      default:
        return;
    }
  }

  private async pickCodexAppPath(): Promise<void> {
    const pickerCopy = getDashboardCopy(this.settingsStore.resolveLanguage());
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: pickerCopy.pickPath
    });

    if (!selected?.[0]) {
      return;
    }

    await vscode.workspace
      .getConfiguration("codexAccounts")
      .update("codexAppPath", selected[0].fsPath, vscode.ConfigurationTarget.Global);
  }

  private renderShell(webview: vscode.Webview): string {
    const sharedStyles = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "webview", "shared.css")
    );
    const pageStyles = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "webview", "quotaSummary.css")
    );
    const script = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "webview", "dashboard", "dashboard.js")
    );

    return `<!DOCTYPE html>
<html lang="${this.settingsStore.resolveLanguage()}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource};"
  />
  <link rel="stylesheet" href="${sharedStyles.toString()}" />
  <link rel="stylesheet" href="${pageStyles.toString()}" />
</head>
<body>
  <div id="app"></div>
  <script src="${script.toString()}"></script>
</body>
</html>`;
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
