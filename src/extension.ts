/**
 * VS Code 扩展主入口
 *
 * 优化内容:
 * - 使用统一的 i18n 工具处理国际化
 * - 使用统一的错误类型处理异常
 * - 添加更详细的 JSDoc 注释
 */

import * as path from "path";
import * as vscode from "vscode";
import { refreshImportedAccountQuota, registerCommands } from "./commands";
import { getAuthJsonPath, readAuthFile } from "./codex";
import { AccountsRepository } from "./storage";
import { AccountsStatusBarProvider } from "./ui";
import { getExternalAuthSyncCopy, getLocalAccountCopy } from "./utils";
import { getErrorMessage } from "./core";

/**
 * 激活扩展
 *
 * @param context - 扩展上下文
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const repo = new AccountsRepository(context);
  await repo.init();

  const statusBar = new AccountsStatusBarProvider(context, repo);

  const refreshers = {
    refresh(): void {
      void statusBar.refresh();
    }
  };

  registerCommands(context, repo, refreshers);
  registerAuthFileWatcher(context, repo, refreshers);
  await promptImportLocalAccountIfNeeded(repo, refreshers);
  await statusBar.refresh();
}

/**
 * 停用扩展
 */
export function deactivate(): void {
  // 清理资源（如果需要）
}

/**
 * 提示导入本地账号（如果有）
 */
async function promptImportLocalAccountIfNeeded(repo: AccountsRepository, view: { refresh(): void }): Promise<void> {
  const accounts = await repo.listAccounts();
  if (accounts.length > 0) {
    return;
  }

  const auth = await readAuthFile();
  if (!auth?.tokens?.id_token || !auth.tokens.access_token) {
    return;
  }

  // 使用统一的 i18n 工具
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
        const account = await repo.importCurrentAuth();
        const result = await refreshImportedAccountQuota(repo, account.id);
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

function registerAuthFileWatcher(
  context: vscode.ExtensionContext,
  repo: AccountsRepository,
  view: { refresh(): void }
): void {
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
      void syncActiveAccountFromExternalChange(repo, view, () => {
        promptVisible = true;
      }, () => {
        promptVisible = false;
      }, () => promptVisible);
    }, 300);
  };

  watcher.onDidChange(scheduleSync, null, context.subscriptions);
  watcher.onDidCreate(scheduleSync, null, context.subscriptions);
  context.subscriptions.push(watcher, {
    dispose(): void {
      if (syncTimer) {
        clearTimeout(syncTimer);
      }
    }
  });
}

async function syncActiveAccountFromExternalChange(
  repo: AccountsRepository,
  view: { refresh(): void },
  markVisible: () => void,
  markHidden: () => void,
  isVisible: () => boolean
): Promise<void> {
  const beforeAccounts = await repo.listAccounts();
  const previousActive = beforeAccounts.find((account) => account.isActive);

  await repo.syncActiveAccountFromAuthFile();
  view.refresh();

  const afterAccounts = await repo.listAccounts();
  const nextActive = afterAccounts.find((account) => account.isActive);

  if (!nextActive || nextActive.id === previousActive?.id || isVisible()) {
    return;
  }

  const copy = getExternalAuthSyncCopy();
  markVisible();
  try {
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
