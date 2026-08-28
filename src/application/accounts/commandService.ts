import * as path from "path";
import * as vscode from "vscode";
import { loginWithOAuth } from "../../auth";
import { getCodexHome } from "../../codex";
import { getErrorMessage } from "../../core";
import { CodexAccountRecord, SharedCodexAccountJson } from "../../core/types";
import { AccountsRepository } from "../../storage";
import { buildAccountStorageId } from "../../utils/accountIdentity";
import { extractClaims } from "../../utils/jwt";
import { runWithConcurrencyLimit } from "../../utils/concurrency";
import { needsWindowReloadForAccount } from "../../presentation/workbench/windowRuntimeAccount";
import { getCommandCopy, getLanguage, logNetworkEvent, resolveLongQuotaLabel, t } from "../../utils";
import { isBackgroundTokenRefreshEnabled } from "../../infrastructure/config/extensionSettings";
import { openDetailsPanel } from "../../ui";
import { openQuotaSummaryPanel } from "../../ui/quotaSummary";
import { consumeResetCredit } from "../../services/quota";
import {
  RefreshView,
  formatAccountToastLabel,
  maybeAutoSwitchForActiveQuota,
  maybeWarnForActiveQuota,
  refreshImportedAccountQuota,
  refreshSingleQuota,
  refreshSingleQuotaSafely
} from "./quota";
import { compareCodexAccountAutoQueueOrder } from "./autoQueueOrder";
import { handleCodexAppRestartPreference, promptWindowReloadForAccount } from "./switchEffects";
import { activateQueuedAccountIfCurrentMissing } from "./queuedAccountActivation";
import {
  CrossWindowOperationBusyError,
  runCrossWindowExclusive
} from "../../utils/crossWindowOperations";
const REFRESH_ALL_SILENT_CONCURRENCY = 1;
const REFRESH_ALL_MANUAL_CONCURRENCY = 2;
const REFRESH_ALL_SILENT_DELAY_MS = 300;
const REFRESH_ALL_MANUAL_DELAY_MS = 150;

export class AccountsCommandService {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly repo: AccountsRepository,
    private readonly view: RefreshView,
    private readonly canRefreshAccount: (accountId: string) => boolean = () => true,
    private readonly syncAccountChange?: () => Promise<boolean | undefined>
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
          const queuedActivation = await activateQueuedAccountIfCurrentMissing(this.repo);
          if (queuedActivation.status === "activated") {
            this.view.markObservedAuthIdentity?.(queuedActivation.account.id);
          }
          this.view.refresh();
          logNetworkEvent("account.add", {
            step: "initial-refresh-finished",
            accountId: account.id,
            quotaOk: !result.error,
            quotaError: result.error?.message
          });

          const activationSuffix = formatQueuedActivationSuffix(queuedActivation);
          if (result.error || queuedActivation.status === "failed") {
            const message = result.error
              ? copy.addedButQuotaFailed(account.email, result.error.message)
              : copy.addedAndRefreshed(account.email);
            void vscode.window.showWarningMessage(`${message}${activationSuffix}`);
          } else {
            void vscode.window.showInformationMessage(`${copy.addedAndRefreshed(account.email)}${activationSuffix}`);
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
        throw error;
      }
      logNetworkEvent("account.add", {
        step: "failed",
        message: getErrorMessage(error)
      });
      throw error;
    }
  }

  async importCurrentAuth(): Promise<void> {
    const copy = getCommandCopy();
    await this.withProgress(copy.progressImportCurrent, async () => {
      const account = await this.repo.importCurrentAuth();
      this.view.markObservedAuthIdentity?.(account.id);
      const result = await refreshImportedAccountQuota(this.repo, account.id);
      this.view.refresh();
      await promptWindowReloadForAccount(account);
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

        const updated = await this.repo.updateTokens(account.id, {
          ...tokens,
          accountId: tokens.accountId ?? account.accountId
        });
        if (account.isActive) {
          this.view.markObservedAuthIdentity?.(updated.id);
        }

        const result = await refreshImportedAccountQuota(this.repo, updated.id);
        const queuedActivation = await activateQueuedAccountIfCurrentMissing(this.repo);
        if (queuedActivation.status === "activated") {
          this.view.markObservedAuthIdentity?.(queuedActivation.account.id);
        }
        this.view.refresh();

        // Reauthorization changes the credentials that are shared with other
        // PCs. Publish the replacement after the local validation/profile
        // refresh so the next PC receives the complete, current session.
        let synced: boolean | undefined;
        if (this.syncAccountChange) {
          synced = await this.syncAccountChange();
        }

        if (result.error) {
          const syncSuffix = synced === false
            ? " Encrypted sync could not be completed; run Sync Now to share the new credentials."
            : "";
          void vscode.window.showWarningMessage(
            `${copy.importedButQuotaFailed(updated.email, result.error.message)}${syncSuffix}${formatQueuedActivationSuffix(queuedActivation)}`
          );
          return;
        }

        if (synced === false) {
          void vscode.window.showWarningMessage(
            `${copy.importedAndRefreshed(updated.email)} Encrypted sync could not be completed; run Sync Now to share the new credentials.${formatQueuedActivationSuffix(queuedActivation)}`
          );
          return;
        }

        if (queuedActivation.status === "failed") {
          void vscode.window.showWarningMessage(
            `${copy.importedAndRefreshed(updated.email)}${formatQueuedActivationSuffix(queuedActivation)}`
          );
          return;
        }

        if (account.isActive && needsWindowReloadForAccount(updated.id)) {
          await promptWindowReloadForAccount(updated);
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
      await this.repo.switchAccount(account.id, {
        forceTokenRefresh: isBackgroundTokenRefreshEnabled() && account.tokenRefreshEnabled === true
      });
    });
    this.view.markObservedAuthIdentity?.(account.id);

    await handleCodexAppRestartPreference({ allowManualPrompt: true });
    this.view.refresh();
    await promptWindowReloadForAccount(account);
  }

  async autoSelectAccount(): Promise<void> {
    await maybeAutoSwitchForActiveQuota(this.repo, this.view, {
      ignoreEnabled: true,
      userInitiated: true
    });
  }

  async consumeResetCredit(item?: CodexAccountRecord): Promise<void> {
    const account = item ?? (await this.pickAccount("Select an account to reset"));
    if (!account) return;
    const available = account.quotaSummary?.resetCreditsAvailable ?? 0;
    if (available <= 0) {
      throw new Error(`No reset credits available for ${account.email}`);
    }

    const confirm = await vscode.window.showWarningMessage(
      `Reset the rate limit for ${account.email}? You have ${available} reset${available === 1 ? "" : "s"} available.`,
      { modal: true },
      "Reset Rate Limit"
    );
    if (confirm !== "Reset Rate Limit") return;

    const tokens = await this.repo.getTokens(account.id);
    if (!tokens?.accessToken) throw new Error("No access token available");
    await consumeResetCredit(tokens.accessToken, account.accountId ?? undefined);
    await refreshSingleQuota(this.repo, this.view, account.id, {
      announce: false,
      warnQuota: false,
      refreshView: true
    });
  }

  async refreshQuota(item?: CodexAccountRecord): Promise<void> {
    const copy = getCommandCopy();
    const account = item ?? (await this.pickAccount(copy.pickRefreshAccount));
    if (!account) {
      return;
    }
    await refreshSingleQuota(this.repo, this.view, account.id);
  }

  async refreshAllQuotas(options?: {
    silent?: boolean;
    forceRefresh?: boolean;
    excludeCurrent?: boolean;
  }): Promise<void> {
    const copy = getCommandCopy();
    const allAccounts = await this.repo.listAccounts();
    const currentId = options?.excludeCurrent ? allAccounts.find((account) => account.isActive)?.id : undefined;
    const accounts = (options?.silent ? allAccounts.filter((account) => account.enabled !== false) : allAccounts)
      .filter((account) => account.id !== currentId)
      .filter((account) => !options?.silent || this.canRefreshAccount(account.id));
    let success = 0;
    let failed = 0;
    const refreshAll = async (progress?: vscode.Progress<{ message?: string; increment?: number }>) => {
      let started = 0;
      await runWithConcurrencyLimit(
        accounts,
        options?.silent ? REFRESH_ALL_SILENT_CONCURRENCY : REFRESH_ALL_MANUAL_CONCURRENCY,
        async (account) => {
          started += 1;
          progress?.report({ message: copy.refreshingStep(started, accounts.length, account.email) });
          if (options?.silent) {
            try {
              await runCrossWindowExclusive(`quota:refresh:${account.id}`, "Quota refresh", () =>
                refreshSingleQuotaSafely(this.repo, this.view, account.id, {
                  allowTokenRefresh: isBackgroundTokenRefreshEnabled(),
                  forceRefresh: options.forceRefresh,
                  skipDisabled: true
                })
              );
            } catch (error) {
              if (!(error instanceof CrossWindowOperationBusyError)) {
                throw error;
              }
            }
            return;
          }
          try {
            await runCrossWindowExclusive(`quota:refresh:${account.id}`, "Quota refresh", () =>
              refreshSingleQuota(this.repo, this.view, account.id, {
                announce: false,
                forceRefresh: options?.forceRefresh ?? true,
                refreshView: false,
                warnQuota: false
              })
            );
            success += 1;
          } catch (error) {
            failed += 1;
            console.warn(`[codexAccounts] refresh all failed for ${account.email}:`, error);
          }
        },
        { delayMs: options?.silent ? REFRESH_ALL_SILENT_DELAY_MS : REFRESH_ALL_MANUAL_DELAY_MS }
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
      const message = failed > 0 ? copy.refreshAllSummary(success, failed) : copy.refreshedCount(success);
      if (failed > 0) {
        void vscode.window.showWarningMessage(message);
      } else {
        void vscode.window.showInformationMessage(message);
      }
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
    void vscode.window.showInformationMessage(`Removed account ${formatAccountToastLabel(account)}.`);
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

  async toggleAccountEnabled(item?: CodexAccountRecord): Promise<void> {
    const account = item ?? (await this.pickAccount("Pick an account to enable or disable"));
    if (!account) {
      return;
    }

    try {
      await this.repo.setAccountEnabled(account.id, account.enabled === false);
      this.view.refresh();
      if (this.syncAccountChange) {
        const synced = await this.syncAccountChange();
        // The sync manager owns failure feedback; avoid stacking a second
        // toast when a retry is needed.
        if (synced === false) {
          return;
        }
        void vscode.window.showInformationMessage(
          synced === true ? "Account updated and encrypted sync completed." : "Account updated."
        );
      } else {
        void vscode.window.showInformationMessage("Account updated.");
      }
    } catch (error) {
      void vscode.window.showWarningMessage(getErrorMessage(error));
    }
  }

  async openDetails(item?: CodexAccountRecord, options?: { privacyMode?: boolean }): Promise<void> {
    const copy = getCommandCopy();
    const account = item ?? (await this.pickAccount(copy.pickInspectAccount));
    if (!account) {
      return;
    }

    openDetailsPanel(this.context, this.repo, account, options);
  }

  async openCodexHome(): Promise<void> {
    const codexHome = getCodexHome();
    await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(path.join(codexHome, "auth.json")));
    void vscode.window.showInformationMessage("Opened Codex auth file location.");
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

  private async pickAccount(placeHolder: string): Promise<CodexAccountRecord | undefined> {
    const accounts = (await this.repo.listAccounts()).slice().sort(compareCodexAccountAutoQueueOrder);
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
    const accounts = (await this.repo.listAccounts()).slice().sort(compareSwitchPickerOrder);
    if (!accounts.length) {
      void vscode.window.showInformationMessage(getCommandCopy().noAccounts);
      return undefined;
    }

    const _t = t();
    const selected = await vscode.window.showQuickPick(
      accounts.map((account) => ({
        label: account.email,
        description: buildSwitchPickerDescription(account, _t("account.current")),
        detail: buildSwitchPickerDetail(
          account,
          _t("quota.hourly"),
          resolveLongQuotaLabel(
            account.planType,
            account.quotaSummary?.weeklyWindowMinutes,
            getLanguage(),
            _t("quota.weekly")
          )
        ),
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

function formatQueuedActivationSuffix(
  result: Awaited<ReturnType<typeof activateQueuedAccountIfCurrentMissing>>
): string {
  if (result.status === "activated") {
    return `. Activated queued account ${formatAccountToastLabel(result.account)} because no current account was available.`;
  }
  if (result.status === "failed") {
    return `. The account was added, but queued-account activation failed: ${result.message}`;
  }
  return "";
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

/** Keep the manual switch picker in the same queue order as Auto Select. */
export function compareSwitchPickerOrder(left: CodexAccountRecord, right: CodexAccountRecord): number {
  if (left.isActive !== right.isActive) return left.isActive ? -1 : 1;
  if ((left.enabled !== false) !== (right.enabled !== false)) return left.enabled !== false ? -1 : 1;
  return compareCodexAccountAutoQueueOrder(left, right) || left.email.localeCompare(right.email);
}
