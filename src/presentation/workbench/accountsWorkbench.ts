import * as path from "path";
import * as vscode from "vscode";
import { refreshImportedAccountQuota, registerCommands } from "../../commands";
import { getAuthJsonPath, readAuthFile } from "../../codex";
import { AccountsRepository } from "../../storage";
import { refreshQuotaSummaryPanel } from "../dashboard";
import { AccountsStatusBarProvider, refreshDetailsPanel } from "../../ui";
import { getExternalAuthSyncCopy, getLocalAccountCopy, registerDebugOutput } from "../../utils";
import { getErrorMessage } from "../../core";
import { readCurrentAuthAccountStorageId } from "../../utils/accountIdentity";
import { setCurrentWindowRuntimeAccountId } from "./windowRuntimeAccount";

export class AccountsWorkbench {
  private readonly repo: AccountsRepository;
  private readonly statusBar: AccountsStatusBarProvider;
  private lastObservedAuthIdentity?: string;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.repo = new AccountsRepository(context);
    this.statusBar = new AccountsStatusBarProvider(context, this.repo);
  }

  async activate(): Promise<void> {
    registerDebugOutput(this.context);
    await this.repo.init();
    this.lastObservedAuthIdentity = await this.readObservedAuthIdentity();
    setCurrentWindowRuntimeAccountId(this.lastObservedAuthIdentity);
    this.context.subscriptions.push({ dispose: () => this.repo.dispose() });

    const refreshers = {
      refresh: (): void => {
        void this.statusBar.refresh();
        void refreshDetailsPanel();
        void refreshQuotaSummaryPanel();
      },
      markObservedAuthIdentity: (accountId?: string): void => {
        this.lastObservedAuthIdentity = accountId;
      }
    };

    registerCommands(this.context, this.repo, refreshers);
    this.registerAuthFileWatcher(refreshers);
    this.registerAutoRefreshScheduler();
    await this.promptImportCurrentAccountIfNeeded(refreshers);
    await this.statusBar.refresh();
  }

  dispose(): void {
    this.repo.dispose();
  }

  private async promptImportCurrentAccountIfNeeded(view: { refresh(): void }): Promise<void> {
    const accounts = await this.repo.listAccounts();
    if (accounts.length > 0 && accounts.some((account) => account.isActive)) {
      return;
    }

    await this.promptImportCurrentAccount(view);
  }

  private async promptImportCurrentAccount(view: { refresh(): void }): Promise<void> {
    const auth = await readAuthFile();
    if (!auth?.tokens?.id_token || !auth.tokens.access_token) {
      return;
    }

    const copy = getLocalAccountCopy();
    const choice = await vscode.window.showInformationMessage(copy.message, copy.action);
    if (choice !== copy.action) {
      return;
    }

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: copy.title,
          cancellable: false
        },
        async () => {
          const account = await this.repo.importCurrentAuth();
          this.lastObservedAuthIdentity = account.id;
          const result = await refreshImportedAccountQuota(this.repo, account.id);
          view.refresh();

          if (result.error) {
            void vscode.window.showWarningMessage(copy.partial(account.email, result.error.message));
          } else {
            void vscode.window.showInformationMessage(copy.success(account.email));
          }
        }
      );
    } catch (error) {
      void vscode.window.showErrorMessage(copy.failed(getErrorMessage(error)));
    }
  }

  private registerAuthFileWatcher(view: { refresh(): void }): void {
    const authPath = getAuthJsonPath();
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(path.dirname(authPath), path.basename(authPath))
    );

    let syncTimer: NodeJS.Timeout | undefined;
    let promptVisible = false;

    const scheduleSync = (): void => {
      if (syncTimer) {
        clearTimeout(syncTimer);
      }

      syncTimer = setTimeout(() => {
        void this.syncActiveAccountFromExternalChange(
          view,
          () => {
            promptVisible = true;
          },
          () => {
            promptVisible = false;
          },
          () => promptVisible
        );
      }, 300);
    };

    watcher.onDidChange(scheduleSync, null, this.context.subscriptions);
    watcher.onDidCreate(scheduleSync, null, this.context.subscriptions);
    watcher.onDidDelete(scheduleSync, null, this.context.subscriptions);
    this.context.subscriptions.push(watcher, {
      dispose(): void {
        if (syncTimer) {
          clearTimeout(syncTimer);
        }
      }
    });
  }

  private async syncActiveAccountFromExternalChange(
    view: { refresh(): void },
    markVisible: () => void,
    markHidden: () => void,
    isVisible: () => boolean
  ): Promise<void> {
    const previousObservedIdentity = this.lastObservedAuthIdentity;
    const nextObservedIdentity = await this.readObservedAuthIdentity();
    this.lastObservedAuthIdentity = nextObservedIdentity;

    await this.repo.syncActiveAccountFromAuthFile();
    view.refresh();

    const afterAccounts = await this.repo.listAccounts();
    const nextActive = afterAccounts.find((account) => account.isActive);

    if (isVisible()) {
      return;
    }

    try {
      if (!nextActive && afterAccounts.length > 0) {
        if (previousObservedIdentity === nextObservedIdentity) {
          return;
        }
        markVisible();
        await this.promptImportCurrentAccount(view);
        return;
      }

      if (!nextActive || previousObservedIdentity === nextObservedIdentity) {
        return;
      }

      const copy = getExternalAuthSyncCopy();
      markVisible();

      const choice = await vscode.window.showInformationMessage(
        copy.message(nextActive.accountName ?? nextActive.email),
        copy.reloadNow,
        copy.later
      );

      if (choice === copy.reloadNow) {
        await vscode.commands.executeCommand("workbench.action.reloadWindow");
      }
    } finally {
      markHidden();
    }
  }

  private async readObservedAuthIdentity(): Promise<string | undefined> {
    return readCurrentAuthAccountStorageId();
  }

  private registerAutoRefreshScheduler(): void {
    let timer: NodeJS.Timeout | undefined;

    const applySchedule = (): void => {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }

      const minutes = vscode.workspace.getConfiguration("codexAccounts").get<number>("autoRefreshMinutes", 0);
      if (!minutes || minutes <= 0) {
        return;
      }

      const runAutoRefresh = (): void => {
        void vscode.commands.executeCommand("codexAccounts.refreshAllQuotas", {
          silent: true,
          forceRefresh: true
        });
      };

      timer = setInterval(runAutoRefresh, minutes * 60 * 1000);
      runAutoRefresh();
    };

    applySchedule();

    this.context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("codexAccounts.autoRefreshMinutes")) {
          applySchedule();
        }
      }),
      {
        dispose(): void {
          if (timer) {
            clearInterval(timer);
          }
        }
      }
    );
  }
}
