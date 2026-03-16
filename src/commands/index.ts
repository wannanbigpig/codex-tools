/**
 * 命令处理模块
 *
 * 优化内容:
 * - 使用统一的 i18n 工具处理国际化
 * - 使用统一的错误类型处理异常
 * - 移除重复的 getCommandCopy 函数
 * - 添加更详细的 JSDoc 注释
 */

import * as path from "path";
import * as vscode from "vscode";
import { loginWithOAuth } from "../auth";
import { getCodexHome } from "../codex";
import { QuotaRefreshResult, refreshQuota } from "../services";
import { AccountsRepository } from "../storage";
import { openDetailsPanel } from "../ui";
import { openQuotaSummaryPanel } from "../ui/quotaSummary";
import { CodexAccountRecord } from "../core/types";
import { getCommandCopy, restartCodexAppIfInstalled } from "../utils";
import { createError, getErrorMessage } from "../core";

/**
 * 注册所有命令
 */
export function registerCommands(
  context: vscode.ExtensionContext,
  repo: AccountsRepository,
  view: { refresh(): void }
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("codexAccounts.addAccount", async () => {
      const copy = getCommandCopy();
      try {
        await withProgress(copy.progressAddAccount, async () => {
          const tokens = await loginWithOAuth();
          const account = await repo.upsertFromTokens(tokens, false);
          const result = await refreshQuota(account, tokens);
          await repo.updateQuota(account.id, result.quota, result.error, result.updatedTokens, result.updatedPlanType);
          view.refresh();
          if (result.error) {
            void vscode.window.showWarningMessage(copy.addedButQuotaFailed(account.email, result.error.message));
          } else {
            void vscode.window.showInformationMessage(copy.addedAndRefreshed(account.email));
          }
        });
      } catch (error) {
        void vscode.window.showErrorMessage(copy.addAccountFailed(getErrorMessage(error)));
      }
    }),
    vscode.commands.registerCommand("codexAccounts.importCurrentAuth", async () => {
      const copy = getCommandCopy();
      await withProgress(copy.progressImportCurrent, async () => {
        const account = await repo.importCurrentAuth();
        const result = await refreshImportedAccountQuota(repo, account.id);
        view.refresh();
        if (result.error) {
          void vscode.window.showWarningMessage(copy.importedButQuotaFailed(account.email, result.error.message));
        } else {
          void vscode.window.showInformationMessage(copy.importedAndRefreshed(account.email));
        }
      });
    }),
    vscode.commands.registerCommand("codexAccounts.switchAccount", async (item?: CodexAccountRecord) => {
      const copy = getCommandCopy();
      const account = item ?? (await pickAccount(repo, copy.pickActivateAccount));
      if (!account) {
        return;
      }

      if (account.isActive) {
        void vscode.window.showInformationMessage(copy.alreadyActive(formatAccountToastLabel(account)));
        return;
      }

      await withProgress(copy.progressSwitch(account.email), async () => {
        await repo.switchAccount(account.id);
        await restartCodexAppIfInstalled();
        view.refresh();
        const choice = await vscode.window.showInformationMessage(
          copy.switchedAndAskReload(account.email),
          copy.reloadNow,
          copy.later
        );
        if (choice === copy.reloadNow) {
          await vscode.commands.executeCommand("workbench.action.reloadWindow");
        }
      });
    }),
    vscode.commands.registerCommand("codexAccounts.refreshQuota", async (item?: CodexAccountRecord) => {
      const copy = getCommandCopy();
      const account = item ?? (await pickAccount(repo, copy.pickRefreshAccount));
      if (!account) {
        return;
      }

      await refreshSingleQuota(repo, view, account.id);
    }),
    vscode.commands.registerCommand("codexAccounts.refreshAllQuotas", async () => {
      const copy = getCommandCopy();
      const accounts = await repo.listAccounts();
      await withProgress(copy.progressRefreshAll, async (progress) => {
        for (const [index, account] of accounts.entries()) {
          progress.report({ message: copy.refreshingStep(index + 1, accounts.length, account.email) });
          await refreshSingleQuota(repo, view, account.id, false);
        }
      });
      view.refresh();
      void vscode.window.showInformationMessage(copy.refreshedCount(accounts.length));
    }),
    vscode.commands.registerCommand("codexAccounts.removeAccount", async (item?: CodexAccountRecord) => {
      const copy = getCommandCopy();
      const account = item ?? (await pickAccount(repo, copy.pickRemoveAccount));
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

      await repo.removeAccount(account.id);
      view.refresh();
    }),
    vscode.commands.registerCommand("codexAccounts.toggleStatusBarAccount", async (item?: CodexAccountRecord) => {
      const copy = getCommandCopy();
      const account = item ?? (await pickAccount(repo, copy.pickStatusAccount));
      if (!account) {
        return;
      }

      if (account.isActive) {
        void vscode.window.showInformationMessage(copy.activeAlwaysInStatus);
        return;
      }

      try {
        const updated = await repo.setStatusBarVisibility(account.id, !account.showInStatusBar);
        view.refresh();
        const accountLabel = formatAccountToastLabel(updated);
        void vscode.window.showInformationMessage(
          updated.showInStatusBar ? copy.addedToStatus(accountLabel) : copy.removedFromStatus(accountLabel)
        );
      } catch (error) {
        void vscode.window.showWarningMessage(getErrorMessage(error));
      }
    }),
    vscode.commands.registerCommand("codexAccounts.openDetails", async (item?: CodexAccountRecord) => {
      const copy = getCommandCopy();
      const account = item ?? (await pickAccount(repo, copy.pickInspectAccount));
      if (!account) {
        return;
      }
      openDetailsPanel(context, account);
    }),
    vscode.commands.registerCommand("codexAccounts.openCodexHome", async () => {
      const codexHome = getCodexHome();
      await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(path.join(codexHome, "auth.json")));
    }),
    vscode.commands.registerCommand("codexAccounts.showQuotaSummary", () => {
      openQuotaSummaryPanel(context, repo);
    })
  );
}

/**
 * 刷新单个账号的配额
 */
async function refreshSingleQuota(
  repo: AccountsRepository,
  view: { refresh(): void },
  accountId: string,
  announce = true
): Promise<void> {
  const account = await repo.getAccount(accountId);
  if (!account) {
    return;
  }

  const tokens = await repo.getTokens(accountId);
  if (!tokens) {
    throw createError.accountNotFound(account.email);
  }

  const result = await refreshQuota(account, tokens);
  await repo.updateQuota(accountId, result.quota, result.error, result.updatedTokens, result.updatedPlanType);
  view.refresh();

  if (announce) {
    const copy = getCommandCopy();
    if (result.error) {
      void vscode.window.showWarningMessage(copy.failedToRefresh(account.email, result.error.message));
    } else {
      void vscode.window.showInformationMessage(copy.quotaRefreshed(account.email));
    }
  }
}

/**
 * 刷新导入账号的配额
 */
export async function refreshImportedAccountQuota(
  repo: AccountsRepository,
  accountId: string
): Promise<QuotaRefreshResult> {
  const account = await repo.getAccount(accountId);
  if (!account) {
    throw createError.accountNotFound(accountId);
  }

  const tokens = await repo.getTokens(accountId);
  if (!tokens) {
    throw createError.accountNotFound(account.email);
  }

  const result = await refreshQuota(account, tokens);
  await repo.updateQuota(accountId, result.quota, result.error, result.updatedTokens, result.updatedPlanType);
  return result;
}

/**
 * 选择账号
 */
async function pickAccount(repo: AccountsRepository, placeHolder: string): Promise<CodexAccountRecord | undefined> {
  const accounts = await repo.listAccounts();
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

/**
 * 带进度显示地执行回调
 */
async function withProgress(
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

/**
 * 格式化账号显示标签
 */
function formatAccountToastLabel(account: CodexAccountRecord): string {
  const team = account.accountName?.trim();
  if (team) {
    return `${team} · ${account.email}`;
  }
  return account.email;
}
