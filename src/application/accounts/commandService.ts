import * as path from "path";
import * as vscode from "vscode";
import { loginWithOAuth } from "../../auth";
import { getCodexHome } from "../../codex";
import { getErrorMessage } from "../../core";
import { CodexAccountRecord, SharedCodexAccountJson } from "../../core/types";
import { getCodexAccountsConfiguration } from "../../infrastructure/config/extensionSettings";
import { AccountsRepository } from "../../storage";
import { buildAccountStorageId } from "../../utils/accountIdentity";
import { extractClaims } from "../../utils/jwt";
import { runWithConcurrencyLimit } from "../../utils/concurrency";
import { needsWindowReloadForAccount } from "../../presentation/workbench/windowRuntimeAccount";
import {
  getCodexAppRestartCopy,
  getCodexAppState,
  getCommandCopy,
  logNetworkEvent,
  restartCodexAppIfInstalled,
  t
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
const REFRESH_ALL_CONCURRENCY = 1;
const REFRESH_ALL_DELAY_MS = 300;

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
      await this.withProgress(
        copy.progressAddAccount,
        async (_progress, cancellationToken) => {
          const tokens = await loginWithOAuth(cancellationToken);
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
        },
        { cancellable: true }
      );
    } catch (error) {
      if (isOauthCancelled(error)) {
        logNetworkEvent("account.add", {
          step: "cancelled",
          message: getErrorMessage(error)
        });
        return;
      }
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

  async reauthorizeAccount(item?: CodexAccountRecord): Promise<void> {
    const copy = getCommandCopy();
    const account = item ?? (await this.pickAccount(copy.pickRefreshAccount));
    if (!account) {
      return;
    }

    await this.withProgress(
      copy.progressAddAccount,
      async (_progress, cancellationToken) => {
        const tokens = await loginWithOAuth(cancellationToken);
        const claims = extractClaims(tokens.idToken, tokens.accessToken);
        const authorizedId = claims.email
          ? buildAccountStorageId(claims.email, claims.accountId, claims.organizationId)
          : undefined;

        if (!authorizedId || authorizedId !== account.id) {
          void vscode.window.showWarningMessage(
            `Authorized account does not match ${account.email}. No changes were applied.`
          );
          return;
        }

        const updated = await this.repo.upsertFromTokens(tokens, account.isActive);
        if (account.isActive) {
          await this.repo.switchAccount(updated.id);
          this.view.markObservedAuthIdentity?.(updated.id);
        }

        const result = await refreshImportedAccountQuota(this.repo, updated.id);
        this.view.refresh();

        if (result.error) {
          void vscode.window.showWarningMessage(copy.importedButQuotaFailed(updated.email, result.error.message));
          return;
        }

        if (account.isActive && needsWindowReloadForAccount(updated.id)) {
          const choice = await vscode.window.showInformationMessage(
            copy.switchedAndAskReload(updated.email),
            copy.reloadNow,
            copy.later
          );
          if (choice === copy.reloadNow) {
            await vscode.commands.executeCommand("workbench.action.reloadWindow");
          }
          return;
        }

        void vscode.window.showInformationMessage(copy.importedAndRefreshed(updated.email));
      },
      { cancellable: true }
    );
  }

  async switchAccount(item?: CodexAccountRecord): Promise<void> {
    const copy = getCommandCopy();
    const account = item ?? (await this.pickSwitchAccount(copy.pickActivateAccount));
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
    this.view.markObservedAuthIdentity?.(account.id);

    await this.handleCodexAppRestartPreference();
    this.view.refresh();

    if (!needsWindowReloadForAccount(account.id)) {
      return;
    }

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

  async refreshAllQuotas(options?: { silent?: boolean; forceRefresh?: boolean }): Promise<void> {
    const copy = getCommandCopy();
    const accounts = await this.repo.listAccounts();
    const refreshAll = async (progress?: vscode.Progress<{ message?: string; increment?: number }>) => {
      let started = 0;
      await runWithConcurrencyLimit(
        accounts,
        REFRESH_ALL_CONCURRENCY,
        async (account) => {
          started += 1;
          progress?.report({ message: copy.refreshingStep(started, accounts.length, account.email) });
          if (options?.silent) {
            await refreshSingleQuotaSafely(this.repo, this.view, account.id, {
              forceRefresh: options.forceRefresh
            });
            return;
          }
          await refreshSingleQuota(this.repo, this.view, account.id, {
            announce: false,
            forceRefresh: options?.forceRefresh ?? true,
            refreshView: false,
            warnQuota: false
          });
        },
        { delayMs: REFRESH_ALL_DELAY_MS }
      );
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

  async restoreAccountsFromBackup(): Promise<void> {
    const translate = t();
    try {
      const restored = await this.repo.restoreIndexFromLatestBackup();
      this.view.refresh();
      void vscode.window.showInformationMessage(
        translate("message.restoreFromBackupSuccess", {
          count: restored.restoredCount
        })
      );
    } catch (error) {
      void vscode.window.showErrorMessage(
        translate("message.restoreFromBackupFailed", {
          message: getErrorMessage(error)
        })
      );
    }
  }

  async restoreAccountsFromAuthJson(): Promise<void> {
    const translate = t();
    try {
      const restored = await this.repo.restoreAccountsFromAuthFile();
      this.view.refresh();
      void vscode.window.showInformationMessage(
        translate("message.restoreFromAuthSuccess", {
          count: restored.restoredCount
        })
      );
    } catch (error) {
      void vscode.window.showErrorMessage(
        translate("message.restoreFromAuthFailed", {
          message: getErrorMessage(error)
        })
      );
    }
  }

  async restoreAccountsFromSharedJson(): Promise<void> {
    const translate = t();
    try {
      const picked = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: {
          JSON: ["json"]
        },
        openLabel: "Select JSON File"
      });
      if (!picked?.[0]) {
        return;
      }

      const raw = await vscode.workspace.fs.readFile(picked[0]);
      const parsed = JSON.parse(Buffer.from(raw).toString("utf8")) as SharedCodexAccountJson | SharedCodexAccountJson[];
      const restored = await this.repo.restoreAccountsFromSharedJson(parsed);
      this.view.refresh();
      void vscode.window.showInformationMessage(
        translate("message.restoreFromSharedSuccess", {
          count: restored.restoredCount
        })
      );
    } catch (error) {
      void vscode.window.showErrorMessage(
        translate("message.restoreFromSharedFailed", {
          message: getErrorMessage(error)
        })
      );
    }
  }

  private async handleCodexAppRestartPreference(): Promise<void> {
    if (!getCodexAccountsConfiguration().get<boolean>(CODEX_APP_RESTART_ENABLED, false)) {
      return;
    }

    const state = await getCodexAppState();
    if (!state.installed || !state.running) {
      return;
    }

    const config = getCodexAccountsConfiguration();
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

  private async pickSwitchAccount(placeHolder: string): Promise<CodexAccountRecord | undefined> {
    const accounts = await this.repo.listAccounts();
    if (!accounts.length) {
      void vscode.window.showInformationMessage(getCommandCopy().noAccounts);
      return undefined;
    }

    const _t = t();
    const selected = await vscode.window.showQuickPick(
      accounts.map((account) => ({
        label: account.email,
        description: buildSwitchPickerDescription(account, _t("account.current")),
        detail: buildSwitchPickerDetail(account, _t("quota.hourly"), _t("quota.weekly")),
        account
      })),
      {
        placeHolder,
        matchOnDescription: true,
        matchOnDetail: true
      }
    );

    return selected?.account;
  }

  private async withProgress(
    title: string,
    callback: (
      progress: vscode.Progress<{ message?: string; increment?: number }>,
      token: vscode.CancellationToken
    ) => Promise<void>,
    options?: { cancellable?: boolean }
  ): Promise<void> {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title,
        cancellable: options?.cancellable ?? false
      },
      callback
    );
  }
}

function isOauthCancelled(error: unknown): boolean {
  return getErrorMessage(error).toLowerCase().includes("cancelled");
}

function buildSwitchPickerDescription(account: CodexAccountRecord, currentLabel: string): string {
  const parts = [account.accountName?.trim(), account.planType?.trim()];
  if (account.isActive) {
    parts.push(currentLabel);
  }

  return parts.filter(Boolean).join(" · ");
}

function buildSwitchPickerDetail(account: CodexAccountRecord, hourlyLabel: string, weeklyLabel: string): string {
  const quota = account.quotaSummary;
  const parts = [
    ...(quota?.hourlyWindowPresent ? [`${hourlyLabel} ${formatQuickPickQuota(quota.hourlyPercentage)}`] : []),
    ...(quota?.weeklyWindowPresent ? [`${weeklyLabel} ${formatQuickPickQuota(quota.weeklyPercentage)}`] : [])
  ];
  return parts.join(" · ");
}

function formatQuickPickQuota(value: number | undefined): string {
  return typeof value === "number" ? `${value}%` : "--";
}
