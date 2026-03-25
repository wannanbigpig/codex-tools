import * as vscode from "vscode";
import { buildDashboardState } from "../../application/dashboard/buildDashboardState";
import { refreshImportedAccountQuota, refreshSingleQuota } from "../../application/accounts/quota";
import { getDashboardCopy } from "../../application/dashboard/copy";
import {
  DashboardActionName,
  DashboardActionPayload,
  DashboardBatchResultFailure,
  DashboardClientMessage,
  DashboardHostMessage,
  DashboardSettingKey
} from "../../domain/dashboard/types";
import {
  completeOAuthLoginSession,
  prepareOAuthLoginSession,
  PreparedOAuthLoginSession,
  runPreparedOAuthLoginSession
} from "../../auth/oauth";
import type { SharedCodexAccountJson } from "../../core/types";
import { isDashboardLanguageOption } from "../../localization/languages";
import { ExtensionSettingsStore } from "../../infrastructure/config/extensionSettings";
import { AccountsRepository } from "../../storage";
import { getCommandCopy, t } from "../../utils";
import { clearAutoSwitchLock, setAutoSwitchLock } from "../workbench/autoSwitchState";
import { promptForTags } from "../tagEditor";

const DASHBOARD_VIEW_TYPE = "codexQuotaSummary";

let dashboardPanelController: DashboardPanelController | undefined;

class DashboardPanelController {
  private readonly settingsStore = new ExtensionSettingsStore();
  private panel: vscode.WebviewPanel | undefined;
  private configWatcher: vscode.Disposable | undefined;
  private webviewReady = false;
  private publishTimer: NodeJS.Timeout | undefined;
  private lastPublishedStateSignature: string | undefined;
  private readonly oauthSessions = new Map<string, PreparedOAuthLoginSession>();
  private readonly oauthCancellationSources = new Map<string, vscode.CancellationTokenSource>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly repo: AccountsRepository
  ) {}

  open(): void {
    const panelTitle = getDashboardCopy(this.settingsStore.resolveLanguage()).panelTitle;
    const iconUri = vscode.Uri.joinPath(this.context.extensionUri, "media", "CT_logo_transparent_square_hd.png");
    const targetColumn = this.getTargetViewColumn();

    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(DASHBOARD_VIEW_TYPE, panelTitle, targetColumn, {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")]
      });
      this.panel.iconPath = iconUri;
      this.panel.webview.html = this.renderShell(this.panel.webview);

      this.panel.onDidDispose(() => {
        if (this.publishTimer) {
          clearTimeout(this.publishTimer);
          this.publishTimer = undefined;
        }
        this.oauthCancellationSources.forEach((source) => {
          source.cancel();
          source.dispose();
        });
        this.oauthCancellationSources.clear();
        this.configWatcher?.dispose();
        this.configWatcher = undefined;
        this.oauthSessions.clear();
        this.lastPublishedStateSignature = undefined;
        this.panel = undefined;
        this.webviewReady = false;
      });

      this.panel.webview.onDidReceiveMessage((message: DashboardClientMessage) => {
        void this.handleMessage(message);
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

  private getTargetViewColumn(): vscode.ViewColumn {
    const activeEditorColumn = vscode.window.activeTextEditor?.viewColumn;
    if (activeEditorColumn !== undefined) {
      return activeEditorColumn;
    }

    return vscode.ViewColumn.Active;
  }

  async refresh(): Promise<void> {
    if (!this.panel || !this.webviewReady) {
      return;
    }

    await this.publishState();
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
    this.panel.webview.html = this.renderShell(this.panel.webview);
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
    const signature = JSON.stringify({
      lang: state.lang,
      panelTitle: state.panelTitle,
      brandSub: state.brandSub,
      settings: state.settings,
      tokenAutomation: state.tokenAutomation,
      indexHealth: state.indexHealth,
      accounts: state.accounts
    });
    if (signature === this.lastPublishedStateSignature) {
      return;
    }

    this.lastPublishedStateSignature = signature;

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
        this.schedulePublishState();
        return;
      case "dashboard:action":
        await this.handleActionMessage(message);
        return;
      case "dashboard:setting":
        await this.handleSettingUpdate(message.key, message.value);
        return;
      case "dashboard:pickCodexAppPath":
        await this.pickCodexAppPath();
        return;
      case "dashboard:clearCodexAppPath":
        await vscode.workspace
          .getConfiguration("codexAccounts")
          .update("codexAppPath", "", vscode.ConfigurationTarget.Global);
        return;
      default:
        return;
    }
  }

  private async handleActionMessage(
    message: Extract<DashboardClientMessage, { type: "dashboard:action" }>
  ): Promise<void> {
    let status: Extract<DashboardHostMessage, { type: "dashboard:action-result" }>["status"] = "completed";
    let payload: Extract<DashboardHostMessage, { type: "dashboard:action-result" }>["payload"];
    let errorMessage: string | undefined;

    try {
      const account = message.accountId ? await this.repo.getAccount(message.accountId) : undefined;
      payload = await this.runAction(message.action, message.payload, account);
    } catch (error) {
      status = "failed";
      errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[codexAccounts] dashboard action failed: ${message.action}`, error);
    } finally {
      await this.postActionResult(message.requestId, message.action, status, message.accountId, payload, errorMessage);
    }
  }

  private async runAction(
    action: DashboardActionName,
    payload: DashboardActionPayload | undefined,
    account?: Awaited<ReturnType<AccountsRepository["getAccount"]>>
  ): Promise<Extract<DashboardHostMessage, { type: "dashboard:action-result" }>["payload"] | undefined> {
    const translate = t(this.settingsStore.resolveLanguage());

    switch (action) {
      case "addAccount":
        await vscode.commands.executeCommand("codexAccounts.addAccount");
        return undefined;
      case "importCurrent":
        await vscode.commands.executeCommand("codexAccounts.importCurrentAuth");
        return undefined;
      case "refreshAll":
        await vscode.commands.executeCommand("codexAccounts.refreshAllQuotas");
        return undefined;
      case "shareTokens": {
        try {
          const accountIds = payload?.accountIds ?? [];
          const shared = await this.repo.exportSharedAccounts(accountIds);
          if (shared.length === 0) {
            const message = translate("message.shareTokensFailed", { message: "No accounts selected" });
            void vscode.window.showErrorMessage(message);
            throw new Error(message);
          }

          void vscode.window.showInformationMessage(
            translate("message.shareTokensReady", {
              count: shared.length
            })
          );
          return {
            sharedJson: JSON.stringify(shared, null, 2)
          };
        } catch (error) {
          const message = translate("message.shareTokensFailed", {
            message: error instanceof Error ? error.message : String(error)
          });
          void vscode.window.showErrorMessage(message);
          throw new Error(message);
        }
      }
      case "restoreFromBackup": {
        try {
          const restored = await this.repo.restoreIndexFromLatestBackup();
          this.schedulePublishState();
          void vscode.window.showInformationMessage(
            translate("message.restoreFromBackupSuccess", {
              count: restored.restoredCount
            })
          );
          return {
            restoredCount: restored.restoredCount
          };
        } catch (error) {
          const message = translate("message.restoreFromBackupFailed", {
            message: error instanceof Error ? error.message : String(error)
          });
          void vscode.window.showErrorMessage(message);
          throw new Error(message);
        }
      }
      case "restoreFromAuthJson": {
        try {
          const restored = await this.repo.restoreAccountsFromAuthFile();
          this.schedulePublishState();
          void vscode.window.showInformationMessage(
            translate("message.restoreFromAuthSuccess", {
              count: restored.restoredCount
            })
          );
          return {
            restoredCount: restored.restoredCount
          };
        } catch (error) {
          const message = translate("message.restoreFromAuthFailed", {
            message: error instanceof Error ? error.message : String(error)
          });
          void vscode.window.showErrorMessage(message);
          throw new Error(message);
        }
      }
      case "copyText": {
        const text = payload?.text ?? "";
        if (!text) {
          return undefined;
        }
        await vscode.env.clipboard.writeText(text);
        return undefined;
      }
      case "openExternalUrl": {
        const url = payload?.url?.trim();
        if (!url) {
          return undefined;
        }
        await vscode.env.openExternal(vscode.Uri.parse(url));
        return undefined;
      }
      case "downloadJsonFile": {
        const text = payload?.text ?? "";
        const defaultName = payload?.filename?.trim() ?? "codex-accounts-manager-share.json";
        if (!text) {
          return undefined;
        }

        const target = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.joinPath(this.context.globalStorageUri, defaultName),
          filters: {
            JSON: ["json"]
          },
          saveLabel: "Save JSON"
        });
        if (!target) {
          return undefined;
        }

        await vscode.workspace.fs.writeFile(target, Buffer.from(text, "utf8"));
        return undefined;
      }
      case "importSharedJson": {
        const jsonText = payload?.jsonText?.trim();
        if (!jsonText) {
          const message = translate("message.sharedJsonParseFailed", {
            message: "Empty JSON input"
          });
          void vscode.window.showErrorMessage(message);
          throw new Error(message);
        }

        let parsed: SharedCodexAccountJson | SharedCodexAccountJson[];
        try {
          parsed = JSON.parse(jsonText) as SharedCodexAccountJson | SharedCodexAccountJson[];
        } catch (error) {
          const message = translate("message.sharedJsonParseFailed", {
            message: error instanceof Error ? error.message : String(error)
          });
          void vscode.window.showErrorMessage(message);
          throw new Error(message);
        }

        try {
          const result = payload?.recoveryMode
            ? await this.repo.restoreAccountsFromSharedJson(parsed)
            : await this.repo.importSharedAccountsWithSummary(parsed);
          const importedCount = "successCount" in result ? result.successCount : result.restoredCount;
          const importedEmails = "importedEmails" in result ? result.importedEmails : result.restoredEmails;
          this.schedulePublishState();
          void vscode.window.showInformationMessage(
            translate(
              payload?.recoveryMode ? "message.restoreFromSharedSuccess" : "message.importSharedJsonSuccess",
              {
                count: importedCount
              }
            )
          );
          return {
            importedCount,
            importedEmails,
            importResult:
              "successCount" in result
                ? result
                : {
                    total: result.restoredCount,
                    successCount: result.restoredCount,
                    overwriteCount: 0,
                    failedCount: 0,
                    importedEmails: result.restoredEmails,
                    failures: []
                  }
          };
        } catch (error) {
          const message = translate(payload?.recoveryMode ? "message.restoreFromSharedFailed" : "message.importSharedJsonFailed", {
            message: error instanceof Error ? error.message : String(error)
          });
          void vscode.window.showErrorMessage(message);
          throw new Error(message);
        }
      }
      case "previewImportSharedJson": {
        const jsonText = payload?.jsonText?.trim();
        if (!jsonText) {
          return {
            importPreview: {
              total: 0,
              valid: 0,
              overwriteCount: 0,
              invalidCount: 0,
              invalidEntries: []
            }
          };
        }

        let parsed: SharedCodexAccountJson | SharedCodexAccountJson[];
        try {
          parsed = JSON.parse(jsonText) as SharedCodexAccountJson | SharedCodexAccountJson[];
        } catch (error) {
          const message = translate("message.sharedJsonParseFailed", {
            message: error instanceof Error ? error.message : String(error)
          });
          throw new Error(message);
        }

        return {
          importPreview: await this.repo.previewSharedAccountsImport(parsed)
        };
      }
      case "prepareOAuthSession": {
        try {
          const prepared = prepareOAuthLoginSession();
          const sessionId = `oauth-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
          this.oauthSessions.set(sessionId, prepared);
          return {
            oauthSession: {
              sessionId,
              authUrl: prepared.authUrl,
              redirectUri: prepared.redirectUri
            }
          };
        } catch (error) {
          const message = translate("message.oauthPrepareFailed", {
            message: error instanceof Error ? error.message : String(error)
          });
          void vscode.window.showErrorMessage(message);
          throw new Error(message);
        }
      }
      case "cancelOAuthSession": {
        const oauthSessionId = payload?.oauthSessionId;
        if (!oauthSessionId) {
          return undefined;
        }

        const source = this.oauthCancellationSources.get(oauthSessionId);
        if (source) {
          source.cancel();
          source.dispose();
          this.oauthCancellationSources.delete(oauthSessionId);
        }
        this.oauthSessions.delete(oauthSessionId);
        return undefined;
      }
      case "startOAuthAutoFlow": {
        const oauthSessionId = payload?.oauthSessionId;
        if (!oauthSessionId) {
          const message = translate("message.oauthPrepareFailed", {
            message: "Missing OAuth session"
          });
          void vscode.window.showErrorMessage(message);
          throw new Error(message);
        }

        const session = this.oauthSessions.get(oauthSessionId);
        if (!session) {
          const message = translate("message.oauthPrepareFailed", {
            message: "OAuth session expired"
          });
          void vscode.window.showErrorMessage(message);
          throw new Error(message);
        }

        try {
          const source = new vscode.CancellationTokenSource();
          this.oauthCancellationSources.set(oauthSessionId, source);
          const tokens = await runPreparedOAuthLoginSession(session, source.token);
          const created = await this.repo.upsertFromTokens(tokens, false);
          await refreshImportedAccountQuota(this.repo, created.id);
          this.oauthCancellationSources.get(oauthSessionId)?.dispose();
          this.oauthCancellationSources.delete(oauthSessionId);
          this.oauthSessions.delete(oauthSessionId);
          this.schedulePublishState();
          void vscode.window.showInformationMessage(
            translate("message.oauthCompleted", {
              email: created.email
            })
          );
          return {
            email: created.email
          };
        } catch (error) {
          this.oauthCancellationSources.get(oauthSessionId)?.dispose();
          this.oauthCancellationSources.delete(oauthSessionId);
          if (error instanceof Error && error.message === "OAuth login cancelled by user.") {
            this.oauthSessions.delete(oauthSessionId);
            return undefined;
          }
          const message = translate("message.oauthCallbackFailed", {
            message: error instanceof Error ? error.message : String(error)
          });
          void vscode.window.showErrorMessage(message);
          throw new Error(message);
        }
      }
      case "completeOAuthSession": {
        const oauthSessionId = payload?.oauthSessionId;
        const callbackUrl = payload?.callbackUrl?.trim();
        if (!oauthSessionId || !callbackUrl) {
          const message = translate("message.oauthCallbackFailed", {
            message: "Missing OAuth session or callback URL"
          });
          void vscode.window.showErrorMessage(message);
          throw new Error(message);
        }

        const session = this.oauthSessions.get(oauthSessionId);
        if (!session) {
          const message = translate("message.oauthPrepareFailed", {
            message: "OAuth session expired"
          });
          void vscode.window.showErrorMessage(message);
          throw new Error(message);
        }

        try {
          const tokens = await completeOAuthLoginSession(session, callbackUrl);
          const created = await this.repo.upsertFromTokens(tokens, false);
          this.oauthCancellationSources.get(oauthSessionId)?.dispose();
          this.oauthCancellationSources.delete(oauthSessionId);
          this.oauthSessions.delete(oauthSessionId);
          this.schedulePublishState();
          void vscode.window.showInformationMessage(
            translate("message.oauthCompleted", {
              email: created.email
            })
          );
          return {
            email: created.email
          };
        } catch (error) {
          const message = translate("message.oauthCallbackFailed", {
            message: error instanceof Error ? error.message : String(error)
          });
          void vscode.window.showErrorMessage(message);
          throw new Error(message);
        }
      }
      case "refreshView":
        this.reloadShell();
        return undefined;
      case "updateTags": {
        const targetIds = payload?.accountIds?.length ? payload.accountIds : account ? [account.id] : [];
        if (!targetIds.length) {
          return undefined;
        }
        const dashboardCopy = getDashboardCopy(this.settingsStore.resolveLanguage());
        const targetAccount =
          targetIds.length === 1 ? account ?? (await this.repo.getAccount(targetIds[0]!)) : undefined;
        const mode = payload?.mode === "add" || payload?.mode === "remove" ? payload.mode : "set";
        const tags = await promptForTags({
          copy: dashboardCopy,
          mode,
          initialTags: targetAccount?.tags ?? [],
          label: targetIds.length === 1 ? targetAccount?.email : undefined
        });
        if (tags === undefined) {
          return undefined;
        }

        if (mode === "add") {
          await this.repo.addAccountTags(targetIds, tags);
        } else if (mode === "remove") {
          await this.repo.removeAccountTags(targetIds, tags);
        } else if (targetIds.length === 1) {
          await this.repo.setAccountTags(targetIds[0]!, tags);
        } else {
          await this.repo.addAccountTags(targetIds, tags);
        }
        this.schedulePublishState();
        {
          const message = translate("message.batchTagsSummary", {
            count: targetIds.length,
            action:
              mode === "add"
                ? dashboardCopy.addTagsBtn
                : mode === "remove"
                  ? dashboardCopy.removeTagsBtn
                  : dashboardCopy.editTagsBtn
          });
          void vscode.window.showInformationMessage(message);
        }
        return undefined;
      }
      case "setAutoSwitchLock": {
        const lockAccountId = account?.id ?? payload?.accountIds?.[0];
        const lockMinutes = typeof payload?.lockMinutes === "number" ? payload.lockMinutes : 0;
        if (!lockAccountId) {
          return undefined;
        }

        if (lockMinutes > 0) {
          setAutoSwitchLock(lockAccountId, lockMinutes);
        } else {
          clearAutoSwitchLock(lockAccountId);
        }
        this.schedulePublishState();
        return undefined;
      }
      case "batchRefresh": {
        const targetIds = payload?.accountIds ?? [];
        const accountsById = new Map(
          await Promise.all(
            targetIds.map(async (id) => [id, await this.repo.getAccount(id)] as const)
          )
        );
        let success = 0;
        let failed = 0;
        const failures: DashboardBatchResultFailure[] = [];
        await runWithConcurrencyLimit(targetIds, 4, async (id) => {
          try {
            await refreshSingleQuota(this.repo, { refresh() {} }, id, {
              announce: false,
              forceRefresh: true,
              refreshView: false,
              warnQuota: false
            });
            success += 1;
          } catch (error) {
            failed += 1;
            failures.push({
              accountId: id,
              email: accountsById.get(id)?.email,
              message: toFailureMessage(error)
            });
            console.warn(`[codexAccounts] batch quota refresh failed for ${id}:`, error);
          }
        });
        this.schedulePublishState();
        const message = translate("message.batchRefreshSummary", {
          success,
          failed
        });
        if (failed > 0) {
          void vscode.window.showWarningMessage(message);
        } else {
          void vscode.window.showInformationMessage(message);
        }
        return undefined;
      }
      case "batchResyncProfile": {
        const targetIds = payload?.accountIds ?? [];
        const accountsById = new Map(
          await Promise.all(
            targetIds.map(async (id) => [id, await this.repo.getAccount(id)] as const)
          )
        );
        let success = 0;
        let failed = 0;
        const failures: DashboardBatchResultFailure[] = [];
        await runWithConcurrencyLimit(targetIds, 4, async (id) => {
          try {
            await this.repo.refreshAccountProfileMetadata(id);
            success += 1;
          } catch (error) {
            failed += 1;
            failures.push({
              accountId: id,
              email: accountsById.get(id)?.email,
              message: toFailureMessage(error)
            });
            console.warn(`[codexAccounts] batch profile resync failed for ${id}:`, error);
          }
        });
        this.schedulePublishState();
        const message = translate("message.batchResyncSummary", {
          success,
          failed
        });
        if (failed > 0) {
          void vscode.window.showWarningMessage(message);
        } else {
          void vscode.window.showInformationMessage(message);
        }
        return undefined;
      }
      case "batchRemove": {
        const targetIds = payload?.accountIds ?? [];
        if (!targetIds.length) {
          return undefined;
        }
        const accountsById = new Map(
          await Promise.all(
            targetIds.map(async (id) => [id, await this.repo.getAccount(id)] as const)
          )
        );
        const choice = await vscode.window.showWarningMessage(
          translate("message.batchRemoveConfirm", { count: targetIds.length }),
          { modal: true },
          translate("confirm.removeButton")
        );
        if (choice !== translate("confirm.removeButton")) {
          return undefined;
        }
        let removed = 0;
        let failed = 0;
        const failures: DashboardBatchResultFailure[] = [];
        for (const id of targetIds) {
          try {
            await this.repo.removeAccount(id);
            removed += 1;
          } catch (error) {
            failed += 1;
            failures.push({
              accountId: id,
              email: accountsById.get(id)?.email,
              message: toFailureMessage(error)
            });
            console.warn(`[codexAccounts] batch remove failed for ${id}:`, error);
          }
        }
        this.schedulePublishState();
        const message = translate("message.batchRemoveSummary", {
          count: removed,
          failed
        });
        if (failed > 0) {
          void vscode.window.showWarningMessage(message);
        } else {
          void vscode.window.showInformationMessage(message);
        }
        return undefined;
      }
      case "reloadPrompt":
        if (account) {
          const copy = getCommandCopy();
          const choice = await vscode.window.showInformationMessage(
            copy.switchedAndAskReload(account.email),
            copy.reloadNow,
            copy.later
          );
          if (choice === copy.reloadNow) {
            await vscode.commands.executeCommand("workbench.action.reloadWindow");
          }
        }
        return undefined;
      case "reauthorize":
        if (account) {
          await vscode.commands.executeCommand("codexAccounts.reauthorizeAccount", account);
        }
        return undefined;
      case "resyncProfile":
        if (account) {
          await this.repo.refreshAccountProfileMetadata(account.id);
          this.schedulePublishState();
        }
        return undefined;
      case "dismissHealthIssue":
        if (account) {
          await this.repo.dismissHealthIssue(account.id, payload?.issueKey);
          this.schedulePublishState();
        }
        return undefined;
      case "details":
        if (account) {
          await vscode.commands.executeCommand("codexAccounts.openDetails", account);
        }
        return undefined;
      case "switch":
        if (account) {
          await vscode.commands.executeCommand("codexAccounts.switchAccount", account);
        }
        return undefined;
      case "refresh":
        if (account) {
          await vscode.commands.executeCommand("codexAccounts.refreshQuota", account);
        }
        return undefined;
      case "remove":
        if (account) {
          await vscode.commands.executeCommand("codexAccounts.removeAccount", account);
        }
        return undefined;
      case "toggleStatusBar":
        if (account) {
          await vscode.commands.executeCommand("codexAccounts.toggleStatusBarAccount", account);
        }
        return undefined;
      default:
        return undefined;
    }
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

    const message: DashboardHostMessage = {
      type: "dashboard:action-result",
      requestId,
      action,
      accountId,
      status,
      payload,
      error
    };
    await this.panel.webview.postMessage(message);
  }

  private async handleSettingUpdate(key: DashboardSettingKey, value: string | number | boolean): Promise<void> {
    const config = vscode.workspace.getConfiguration("codexAccounts");
    let updated = false;

    switch (key) {
      case "codexAppRestartEnabled":
        if (typeof value === "boolean") {
          await config.update(key, value, vscode.ConfigurationTarget.Global);
          updated = true;
        }
        break;
      case "codexAppRestartMode":
        if (value === "auto" || value === "manual") {
          await config.update(key, value, vscode.ConfigurationTarget.Global);
          updated = true;
        }
        break;
      case "autoRefreshMinutes":
      case "autoSwitchHourlyThreshold":
      case "autoSwitchWeeklyThreshold":
      case "quotaWarningThreshold":
      case "quotaGreenThreshold":
      case "quotaYellowThreshold":
        if (typeof value === "number") {
          await config.update(key, value, vscode.ConfigurationTarget.Global);
          updated = true;
        }
        break;
      case "autoSwitchEnabled":
      case "backgroundTokenRefreshEnabled":
      case "showCodeReviewQuota":
      case "quotaWarningEnabled":
      case "debugNetwork":
      case "autoSwitchPreferSameEmail":
      case "autoSwitchPreferSameTag":
        if (typeof value === "boolean") {
          await config.update(key, value, vscode.ConfigurationTarget.Global);
          updated = true;
        }
        break;
      case "autoSwitchLockMinutes":
        if (typeof value === "number") {
          await config.update(key, value, vscode.ConfigurationTarget.Global);
          updated = true;
        }
        break;
      case "displayLanguage":
        if (typeof value === "string" && isDashboardLanguageOption(value)) {
          await config.update(key, value, vscode.ConfigurationTarget.Global);
          updated = true;
        }
        break;
      default:
        return;
    }

    if (!updated) {
      return;
    }

    this.schedulePublishState();
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

async function runWithConcurrencyLimit<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  let cursor = 0;
  const runnerCount = Math.min(limit, items.length);
  await Promise.allSettled(
    Array.from({ length: runnerCount }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        const item = items[index];
        if (typeof index !== "number" || item === undefined) {
          return;
        }
        await worker(item, index);
      }
    })
  );
}

function toFailureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
