import * as path from "path";
import * as vscode from "vscode";
import { loginWithOAuth } from "../../auth";
import { getCodexHome } from "../../codex";
import { getErrorMessage } from "../../core";
import { CodexAccountRecord } from "../../core/types";
import { AccountsRepository } from "../../storage";
import {
  getCodexAppRestartCopy,
  getCodexAppState,
  getCommandCopy,
  logNetworkEvent,
  restartCodexAppIfInstalled
} from "../../utils";
import { openDetailsPanel } from "../../ui";
import { openQuotaSummaryPanel } from "../../ui/quotaSummary";
import {
  RefreshView,
  formatAccountToastLabel,
  maybeAutoSwitchForActiveQuota,
  maybeWarnForActiveQuota,
  refreshImportedAccountQuota,
  refreshSingleQuota,
  refreshSingleQuotaSafely
} from "./quota";

const CODEX_APP_RESTART_MODE = "codexAppRestartMode";
const CODEX_APP_RESTART_ENABLED = "codexAppRestartEnabled";

export class AccountsCommandService {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly repo: AccountsRepository,
    private readonly view: RefreshView
  ) {}

  async addAccount(): Promise<void> {
    const copy = getCommandCopy();
    try {
      logNetworkEvent("account.add", { step: "started" });
      await this.withProgress(copy.progressAddAccount, async () => {
        const tokens = await loginWithOAuth();
        logNetworkEvent("account.add", {
          step: "oauth-complete",
          hasRefreshToken: Boolean(tokens.refreshToken),
          accountId: tokens.accountId
        });
        const account = await this.repo.upsertFromTokens(tokens, false);
        logNetworkEvent("account.add", {
          step: "account-upserted",
          storedAccountId: account.accountId,
          organizationId: account.organizationId,
          email: account.email,
          planType: account.planType,
          accountName: account.accountName,
          accountStructure: account.accountStructure
        });
        const result = await refreshImportedAccountQuota(this.repo, account.id);
        this.view.refresh();
        logNetworkEvent("account.add", {
          step: "initial-refresh-finished",
          accountId: account.id,
          quotaOk: !result.error,
          quotaError: result.error?.message
        });

        if (result.error) {
          void vscode.window.showWarningMessage(copy.addedButQuotaFailed(account.email, result.error.message));
        } else {
          void vscode.window.showInformationMessage(copy.addedAndRefreshed(account.email));
        }
      });
    } catch (error) {
      logNetworkEvent("account.add", {
        step: "failed",
        message: getErrorMessage(error)
      });
      void vscode.window.showErrorMessage(copy.addAccountFailed(getErrorMessage(error)));
    }
  }

  async importCurrentAuth(): Promise<void> {
    const copy = getCommandCopy();
    await this.withProgress(copy.progressImportCurrent, async () => {
      const account = await this.repo.importCurrentAuth();
      const result = await refreshImportedAccountQuota(this.repo, account.id);
      this.view.refresh();
      if (result.error) {
        void vscode.window.showWarningMessage(copy.importedButQuotaFailed(account.email, result.error.message));
      } else {
        void vscode.window.showInformationMessage(copy.importedAndRefreshed(account.email));
      }
    });
  }

  async switchAccount(item?: CodexAccountRecord): Promise<void> {
    const copy = getCommandCopy();
    const account = item ?? (await this.pickAccount(copy.pickActivateAccount));
    if (!account) {
      return;
    }

    if (account.isActive) {
      void vscode.window.showInformationMessage(copy.alreadyActive(formatAccountToastLabel(account)));
      return;
    }

    await this.withProgress(copy.progressSwitch(account.email), async () => {
      await this.repo.switchAccount(account.id);
    });

    await this.handleCodexAppRestartPreference();
    this.view.refresh();

    const choice = await vscode.window.showInformationMessage(
      copy.switchedAndAskReload(account.email),
      copy.reloadNow,
      copy.later
    );
    if (choice === copy.reloadNow) {
      await vscode.commands.executeCommand("workbench.action.reloadWindow");
    }
  }

  async refreshQuota(item?: CodexAccountRecord): Promise<void> {
    const copy = getCommandCopy();
    const account = item ?? (await this.pickAccount(copy.pickRefreshAccount));
    if (!account) {
      return;
    }

    await refreshSingleQuota(this.repo, this.view, account.id);
  }

  async refreshAllQuotas(options?: { silent?: boolean }): Promise<void> {
    const copy = getCommandCopy();
    const accounts = await this.repo.listAccounts();
    const refreshAll = async (progress?: vscode.Progress<{ message?: string; increment?: number }>) => {
      for (const [index, account] of accounts.entries()) {
        progress?.report({ message: copy.refreshingStep(index + 1, accounts.length, account.email) });
        if (options?.silent) {
          await refreshSingleQuotaSafely(this.repo, this.view, account.id);
          continue;
        }
        await refreshSingleQuota(this.repo, this.view, account.id, {
          announce: false,
          forceRefresh: true,
          refreshView: false,
          warnQuota: false
        });
      }
    };

    if (options?.silent) {
      await refreshAll();
    } else {
      await this.withProgress(copy.progressRefreshAll, refreshAll);
    }

    this.view.refresh();
    const switched = await maybeAutoSwitchForActiveQuota(this.repo, this.view);
    if (!switched) {
      await maybeWarnForActiveQuota(this.repo);
    }
    if (!options?.silent) {
      void vscode.window.showInformationMessage(copy.refreshedCount(accounts.length));
    }
  }

  async removeAccount(item?: CodexAccountRecord): Promise<void> {
    const copy = getCommandCopy();
    const account = item ?? (await this.pickAccount(copy.pickRemoveAccount));
    if (!account) {
      return;
    }

    const confirmed = await vscode.window.showWarningMessage(
      copy.confirmRemove(account.email),
      { modal: true },
      copy.remove
    );
    if (confirmed !== copy.remove) {
      return;
    }

    await this.repo.removeAccount(account.id);
    this.view.refresh();
  }

  async toggleStatusBarAccount(item?: CodexAccountRecord): Promise<void> {
    const copy = getCommandCopy();
    const account = item ?? (await this.pickAccount(copy.pickStatusAccount));
    if (!account) {
      return;
    }

    if (account.isActive) {
      void vscode.window.showInformationMessage(copy.activeAlwaysInStatus);
      return;
    }

    try {
      const updated = await this.repo.setStatusBarVisibility(account.id, !account.showInStatusBar);
      this.view.refresh();
      const accountLabel = formatAccountToastLabel(updated);
      void vscode.window.showInformationMessage(
        updated.showInStatusBar ? copy.addedToStatus(accountLabel) : copy.removedFromStatus(accountLabel)
      );
    } catch (error) {
      void vscode.window.showWarningMessage(getErrorMessage(error));
    }
  }

  async openDetails(item?: CodexAccountRecord): Promise<void> {
    const copy = getCommandCopy();
    const account = item ?? (await this.pickAccount(copy.pickInspectAccount));
    if (!account) {
      return;
    }

    openDetailsPanel(this.context, this.repo, account);
  }

  async openCodexHome(): Promise<void> {
    const codexHome = getCodexHome();
    await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(path.join(codexHome, "auth.json")));
  }

  showQuotaSummary(): void {
    openQuotaSummaryPanel(this.context, this.repo);
  }

  private async handleCodexAppRestartPreference(): Promise<void> {
    if (!vscode.workspace.getConfiguration("codexAccounts").get<boolean>(CODEX_APP_RESTART_ENABLED, false)) {
      return;
    }

    const state = await getCodexAppState();
    if (!state.installed || !state.running) {
      return;
    }

    const config = vscode.workspace.getConfiguration("codexAccounts");
    const currentMode = config.get<string>(CODEX_APP_RESTART_MODE);
    const copy = getCodexAppRestartCopy();

    let mode = currentMode;
    if (mode !== "auto" && mode !== "manual") {
      const choice = await vscode.window.showInformationMessage(copy.preferenceMessage, copy.auto, copy.manual);
      if (!choice) {
        return;
      }

      mode = choice === copy.auto ? "auto" : "manual";
      await config.update(CODEX_APP_RESTART_MODE, mode, vscode.ConfigurationTarget.Global);
    }

    if (mode === "auto") {
      await restartCodexAppIfInstalled();
      return;
    }

    const manualChoice = await vscode.window.showInformationMessage(copy.manualMessage, copy.restartNow, copy.later);
    if (manualChoice === copy.restartNow) {
      await restartCodexAppIfInstalled();
    }
  }

  private async pickAccount(placeHolder: string): Promise<CodexAccountRecord | undefined> {
    const accounts = await this.repo.listAccounts();
    if (!accounts.length) {
      void vscode.window.showInformationMessage(getCommandCopy().noAccounts);
      return undefined;
    }

    const selected = await vscode.window.showQuickPick(
      accounts.map((account) => ({
        label: account.email,
        description: `${account.planType ?? "unknown"}${account.isActive ? " · active" : ""}`,
        account
      })),
      { placeHolder }
    );

    return selected?.account;
  }

  private async withProgress(
    title: string,
    callback: (progress: vscode.Progress<{ message?: string; increment?: number }>) => Promise<void>
  ): Promise<void> {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title,
        cancellable: false
      },
      callback
    );
  }
}
