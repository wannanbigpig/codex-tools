import * as path from "path";
import * as vscode from "vscode";
import { refreshImportedAccountQuota } from "../../commands";
import { getAuthJsonPath, readAuthFile } from "../../codex";
import { getErrorMessage } from "../../core";
import type { AccountsRepository } from "../../storage";
import { readCurrentAuthAccountStorageId } from "../../utils/accountIdentity";
import { getExternalAuthSyncCopy, getLocalAccountCopy } from "../../utils";
import { refreshQuotaSummaryPanel } from "../dashboard";
import { AccountsStatusBarProvider, refreshDetailsPanel } from "../../ui";
import { needsWindowReloadForAccount, setCurrentWindowRuntimeAccountId } from "./windowRuntimeAccount";
import { buildWorkbenchRefreshSignature } from "./refreshSignature";
import { getTokenAutomationSnapshot } from "./tokenAutomationState";

type RefreshView = {
  refresh: () => void;
  markObservedAuthIdentity: (accountId?: string) => void;
};

export class WorkbenchRefreshCoordinator {
  private lastObservedAuthIdentity?: string;
  private lastRefreshSignature?: string;
  private refreshTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly repo: AccountsRepository,
    private readonly statusBar: AccountsStatusBarProvider
  ) {}

  async initializeObservedAuthIdentity(): Promise<void> {
    this.lastObservedAuthIdentity = await this.readObservedAuthIdentity();
    setCurrentWindowRuntimeAccountId(this.lastObservedAuthIdentity);
  }

  createRefreshView(): RefreshView {
    return {
      refresh: (): void => {
        if (this.refreshTimer) {
          return;
        }
        this.refreshTimer = setTimeout(() => {
          this.refreshTimer = undefined;
          void this.refreshViewsIfNeeded();
        }, 0);
      },
      markObservedAuthIdentity: (accountId?: string): void => {
        this.lastObservedAuthIdentity = accountId;
      }
    };
  }

  dispose(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  async refreshViewsIfNeeded(): Promise<void> {
    const accounts = await this.repo.listAccounts();
    const indexHealth = await this.repo.getIndexHealthSummary();
    const signature = buildWorkbenchRefreshSignature({
      observedAuthIdentity: this.lastObservedAuthIdentity,
      indexHealth,
      accounts,
      tokenAutomation: getTokenAutomationSnapshot()
    });
    if (signature === this.lastRefreshSignature) {
      return;
    }

    this.lastRefreshSignature = signature;
    await Promise.all([this.statusBar.refresh(), refreshDetailsPanel(), refreshQuotaSummaryPanel()]);
  }

  async promptImportCurrentAccountIfNeeded(view: RefreshView): Promise<void> {
    const accounts = await this.repo.listAccounts();
    if (accounts.length > 0 && accounts.some((account) => account.isActive)) {
      return;
    }

    await this.promptImportCurrentAccount(view);
  }

  registerAuthFileWatcher(view: RefreshView): vscode.Disposable {
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

    return {
      dispose: (): void => {
        watcher.dispose();
        if (syncTimer) {
          clearTimeout(syncTimer);
        }
      }
    };
  }

  private async promptImportCurrentAccount(view: RefreshView): Promise<void> {
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

  private async syncActiveAccountFromExternalChange(
    view: RefreshView,
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

      if (!needsWindowReloadForAccount(nextActive.id)) {
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
}
