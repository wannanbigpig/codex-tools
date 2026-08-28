import * as vscode from "vscode";
import { AccountsCommandService } from "../application/accounts/commandService";
export { refreshImportedAccountQuota } from "../application/accounts/quota";
import { CodexAccountRecord } from "../core/types";
import { AccountsRepository } from "../storage";
import type { EncryptedSyncManager } from "../services/encryptedSync";
import { getCodexAccountsConfiguration } from "../infrastructure/config/extensionSettings";
import {
  CrossWindowOperationBusyError,
  CENTRAL_ACCOUNT_OPERATION_KEY,
  ENCRYPTED_SYNC_OPERATION_KEY,
  runCrossWindowExclusive
} from "../utils/crossWindowOperations";
import { shouldSuppressDashboardNotifications } from "../utils/notificationPolicy";

export function runRegisteredCommand<T>(
  label: string,
  action: () => T | Thenable<T>,
  operationKey?: string,
  options: { announceBusy?: boolean; retryBusy?: boolean } = {}
): Thenable<T> {
  const run = async (): Promise<T> => {
    const maxBusyRetries = options.retryBusy ? 20 : 0;
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await (operationKey
          ? runCrossWindowExclusive(operationKey, label, async () => action())
          : action());
      } catch (error) {
        if (!(error instanceof CrossWindowOperationBusyError) || attempt >= maxBusyRetries) {
          throw error;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
      }
    }
  };
  return Promise.resolve()
    .then(run)
    .catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      if (shouldSuppressDashboardNotifications()) {
        throw error;
      }
      void (error instanceof CrossWindowOperationBusyError
        ? options.announceBusy === false
          ? Promise.resolve(undefined)
          : vscode.window.showWarningMessage(detail)
        : /cancel(?:led|lation)/i.test(detail)
        ? vscode.window.showInformationMessage(`${label} cancelled.`)
        : vscode.window.showErrorMessage(`${label} failed: ${detail}`));
      throw error;
    });
}

/**
 * 注册所有命令
 */
export function registerCommands(
  context: vscode.ExtensionContext,
  repo: AccountsRepository,
  view: { refresh(): void; markObservedAuthIdentity?: (accountId?: string) => void },
  sync?: EncryptedSyncManager
): void {
  const service = new AccountsCommandService(
    context,
    repo,
    view,
    (accountId) => sync?.canRefreshAccount(accountId) ?? true,
    sync
      ? async () => {
          const enabled = getCodexAccountsConfiguration().get<boolean>("encryptedSyncEnabled", false);
          if (!enabled) return undefined;
          try {
            return await sync.syncNow(true, false);
          } catch (error) {
            if (error instanceof CrossWindowOperationBusyError) {
              sync.queueBackgroundSync();
              return undefined;
            }
            throw error;
          }
        }
      : undefined
  );

  const runCommand = runRegisteredCommand;
  const runAccountCommand = <T>(
    label: string,
    action: () => T | Thenable<T>,
    announceBusy = true,
    retryBusy = true,
    operationKey = CENTRAL_ACCOUNT_OPERATION_KEY
  ): Thenable<T> =>
    runCommand(
      label,
      async () => {
        try {
          return await action();
        } finally {
          await repo.flush();
        }
      },
      operationKey,
      { announceBusy, retryBusy }
    );
  const runSyncCommand = <T>(
    label: string,
    action: () => T | Thenable<T>,
    announceBusy = true
  ): Thenable<T> =>
    runCommand(
      label,
      async () => {
        try {
          return await action();
        } finally {
          await repo.flush();
        }
      },
      ENCRYPTED_SYNC_OPERATION_KEY,
      { announceBusy }
    );

  context.subscriptions.push(
    vscode.commands.registerCommand("codexAccounts.addAccount", () =>
      runAccountCommand("Add account", () => service.addAccount())
    ),
    vscode.commands.registerCommand("codexAccounts.importCurrentAuth", () =>
      runAccountCommand("Import current account", () => service.importCurrentAuth())
    ),
    vscode.commands.registerCommand("codexAccounts.reauthorizeAccount", (item?: CodexAccountRecord) =>
      runAccountCommand("Reauthorize account", () => service.reauthorizeAccount(item))
    ),
    vscode.commands.registerCommand("codexAccounts.switchAccount", (item?: CodexAccountRecord) =>
      runAccountCommand("Switch account", () => service.switchAccount(item), true, true, `account:switch:${item?.id ?? "pick"}`)
    ),
    vscode.commands.registerCommand("codexAccounts.autoSelectAccount", () =>
      runAccountCommand("Auto-select account", () => service.autoSelectAccount())
    ),
    vscode.commands.registerCommand("codexAccounts.consumeResetCredit", (item?: CodexAccountRecord) =>
      runAccountCommand("Reset rate limit", () => service.consumeResetCredit(item))
    ),
    vscode.commands.registerCommand("codexAccounts.refreshQuota", (item?: CodexAccountRecord) =>
      runAccountCommand("Refresh quota", () => service.refreshQuota(item))
    ),
    vscode.commands.registerCommand(
      "codexAccounts.refreshAllQuotas",
      (options?: { silent?: boolean; forceRefresh?: boolean; excludeCurrent?: boolean }) =>
        runAccountCommand("Refresh all quotas", () => service.refreshAllQuotas(options), options?.silent !== true)
    ),
    vscode.commands.registerCommand("codexAccounts.restoreAccountsFromBackup", () =>
      runAccountCommand("Restore accounts from backup", () => service.restoreAccountsFromBackup())
    ),
    vscode.commands.registerCommand("codexAccounts.restoreAccountsFromAuthJson", () =>
      runAccountCommand("Restore accounts from auth.json", () => service.restoreAccountsFromAuthJson())
    ),
    vscode.commands.registerCommand("codexAccounts.restoreAccountsFromSharedJson", () =>
      runAccountCommand("Restore accounts from shared JSON", () => service.restoreAccountsFromSharedJson())
    ),
    vscode.commands.registerCommand("codexAccounts.removeAccount", (item?: CodexAccountRecord) =>
      runAccountCommand("Remove account", () => service.removeAccount(item))
    ),
    vscode.commands.registerCommand("codexAccounts.toggleStatusBarAccount", (item?: CodexAccountRecord) =>
      runAccountCommand("Toggle status bar account", () => service.toggleStatusBarAccount(item))
    ),
    vscode.commands.registerCommand("codexAccounts.toggleAccountEnabled", (item?: CodexAccountRecord) =>
      runAccountCommand(
        "Toggle account",
        () => service.toggleAccountEnabled(item),
        true,
        false,
        `account:toggle:${item?.id ?? "pick"}`
      )
    ),
    vscode.commands.registerCommand(
      "codexAccounts.openDetails",
      (item?: CodexAccountRecord, options?: { privacyMode?: boolean }) =>
        runCommand("Open account details", () => service.openDetails(item, options))
    ),
    vscode.commands.registerCommand("codexAccounts.openCodexHome", () =>
      runCommand("Open Codex home", () => service.openCodexHome())
    ),
    vscode.commands.registerCommand("codexAccounts.showQuotaSummary", () =>
      runCommand("Open quota summary", () => service.showQuotaSummary())
    ),
    vscode.commands.registerCommand("codexAccounts.showShortcuts", () =>
      runCommand("Show keyboard shortcuts", async () => {
        const choice = await vscode.window.showInformationMessage(
          "Codex Accounts keyboard shortcuts and quick access",
          {
            modal: true,
            detail:
              "Click the Codex Manager status item — open quota dashboard\n\n" +
              "Ctrl+Shift+P — open Command Palette, then type ‘Codex Accounts’\n\n" +
              "Ctrl+K Ctrl+S — open Keyboard Shortcuts and assign your preferred keys\n\n" +
              "No custom key combinations are forced by default, so the extension does not conflict with your existing shortcuts."
          },
          "Open Keyboard Shortcuts"
        );
        if (choice === "Open Keyboard Shortcuts") {
          await vscode.commands.executeCommand(
            "workbench.action.openGlobalKeybindings",
            "@ext:wannanbigpig.codex-accounts-manager"
          );
        }
      })
    ),
    vscode.commands.registerCommand("codexAccounts.configureEncryptedSync", () =>
      runSyncCommand("Configure encrypted sync", () => sync?.configure())
    ),
    vscode.commands.registerCommand(
      "codexAccounts.syncNow",
      (options?: { announceSuccess?: boolean; backgroundIfBusy?: boolean }) => {
        const backgroundIfBusy = options?.backgroundIfBusy !== false;
        const task = runSyncCommand(
          "Encrypted account sync",
          () => sync?.syncNow(true, options?.announceSuccess ?? true),
          !backgroundIfBusy
        );
        if (!backgroundIfBusy) return task;
        return Promise.resolve(task).catch((error: unknown) => {
          if (!(error instanceof CrossWindowOperationBusyError)) throw error;
          sync?.queueBackgroundSync();
          return true;
        });
      }
    ),
    vscode.commands.registerCommand("codexAccounts.setEncryptedSyncRegistryOverride", (enabled: boolean) =>
      runSyncCommand("Set encrypted sync rescue override", () => sync?.setRegistryOverrideEnabled(enabled))
    )
  );
}
