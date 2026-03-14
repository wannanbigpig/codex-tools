import * as path from "path";
import * as vscode from "vscode";
import { loginWithOAuth } from "../auth/oauth";
import { getCodexHome } from "../codex/authFile";
import { QuotaRefreshResult, refreshQuota } from "../services/quota";
import { AccountsRepository } from "../storage/accounts";
import { openDetailsPanel } from "../ui/details";
import { openQuotaSummaryPanel } from "../ui/quotaSummary";
import { CodexAccountRecord } from "../types";

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
            vscode.window.showWarningMessage(copy.addedButQuotaFailed(account.email, result.error.message));
          } else {
            vscode.window.showInformationMessage(copy.addedAndRefreshed(account.email));
          }
        });
      } catch (error) {
        vscode.window.showErrorMessage(copy.addAccountFailed(error instanceof Error ? error.message : String(error)));
      }
    }),
    vscode.commands.registerCommand("codexAccounts.importCurrentAuth", async () => {
      const copy = getCommandCopy();
      await withProgress(copy.progressImportCurrent, async () => {
        const account = await repo.importCurrentAuth();
        const result = await refreshImportedAccountQuota(repo, account.id);
        view.refresh();
        if (result.error) {
          vscode.window.showWarningMessage(copy.importedButQuotaFailed(account.email, result.error.message));
        } else {
          vscode.window.showInformationMessage(copy.importedAndRefreshed(account.email));
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
        vscode.window.showInformationMessage(copy.alreadyActive(formatAccountToastLabel(account)));
        return;
      }

      await withProgress(copy.progressSwitch(account.email), async () => {
        await repo.switchAccount(account.id);
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
      vscode.window.showInformationMessage(copy.refreshedCount(accounts.length));
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
        vscode.window.showInformationMessage(copy.activeAlwaysInStatus);
        return;
      }

      try {
        const updated = await repo.setStatusBarVisibility(account.id, !account.showInStatusBar);
        view.refresh();
        const accountLabel = formatAccountToastLabel(updated);
        vscode.window.showInformationMessage(
          updated.showInStatusBar
            ? copy.addedToStatus(accountLabel)
            : copy.removedFromStatus(accountLabel)
        );
      } catch (error) {
        vscode.window.showWarningMessage(error instanceof Error ? error.message : String(error));
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
    vscode.commands.registerCommand("codexAccounts.showQuotaSummary", async () => {
      openQuotaSummaryPanel(context, repo);
    })
  );
}

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
    throw new Error(`Tokens missing for ${account.email}`);
  }

  const result = await refreshQuota(account, tokens);
  await repo.updateQuota(accountId, result.quota, result.error, result.updatedTokens, result.updatedPlanType);
  view.refresh();

  if (announce) {
    const copy = getCommandCopy();
    if (result.error) {
      vscode.window.showWarningMessage(copy.failedToRefresh(account.email, result.error.message));
    } else {
      vscode.window.showInformationMessage(copy.quotaRefreshed(account.email));
    }
  }
}

export async function refreshImportedAccountQuota(
  repo: AccountsRepository,
  accountId: string
): Promise<QuotaRefreshResult> {
  const account = await repo.getAccount(accountId);
  if (!account) {
    throw new Error(`Account not found: ${accountId}`);
  }

  const tokens = await repo.getTokens(accountId);
  if (!tokens) {
    throw new Error(`Tokens missing for ${account.email}`);
  }

  const result = await refreshQuota(account, tokens);
  await repo.updateQuota(accountId, result.quota, result.error, result.updatedTokens, result.updatedPlanType);
  return result;
}

async function pickAccount(
  repo: AccountsRepository,
  placeHolder: string
) {
  const accounts = await repo.listAccounts();
  if (!accounts.length) {
    vscode.window.showInformationMessage(getCommandCopy().noAccounts);
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

function getCommandCopy() {
  const zh = vscode.env.language.toLowerCase().startsWith("zh");
  return {
    progressAddAccount: zh ? "添加 Codex 账号" : "Adding Codex account",
    progressImportCurrent: zh ? "导入当前 auth.json" : "Importing current auth.json",
    progressSwitch: (email: string) => (zh ? `正在切换到 ${email}` : `Switching to ${email}`),
    progressRefreshAll: zh ? "刷新全部配额" : "Refreshing all quotas",
    refreshingStep: (index: number, total: number, email: string) =>
      zh ? `${index}/${total} ${email}` : `${index}/${total} ${email}`,
    pickActivateAccount: zh ? "选择要切换到的账号" : "Select account to activate",
    pickRefreshAccount: zh ? "选择要刷新的账号" : "Select account to refresh",
    pickRemoveAccount: zh ? "选择要移除的账号" : "Select account to remove",
    pickInspectAccount: zh ? "选择要查看详情的账号" : "Select account to inspect",
    pickStatusAccount: zh ? "选择要显示在状态栏弹窗中的账号" : "Select account to show in the status popup",
    reloadNow: zh ? "立即重载" : "Reload Now",
    later: zh ? "稍后" : "Later",
    remove: zh ? "删除" : "Remove",
    activeAlwaysInStatus: zh
      ? "当前激活账号会始终显示在状态栏弹窗顶部。"
      : "The active account is always shown at the top of the status popup.",
    alreadyActive: (label: string) =>
      zh ? `当前已是 ${label}` : `${label} is already the active account`,
    switchedAndAskReload: (email: string) =>
      zh
        ? `已切换当前 Codex 账号到 ${email}。是否立即重载 VS Code 以同步内置 Codex 面板？`
        : `Active Codex account switched to ${email}. Reload VS Code now to sync the built-in Codex panel?`,
    addedAndRefreshed: (email: string) =>
      zh ? `已添加 Codex 账号 ${email}，并已刷新配额` : `Added Codex account ${email} and refreshed quota`,
    addedButQuotaFailed: (email: string, message: string) =>
      zh ? `已添加 Codex 账号 ${email}，但刷新配额失败：${message}` : `Added Codex account ${email}, but quota refresh failed: ${message}`,
    addAccountFailed: (message: string) =>
      zh ? `添加账号失败：${message}` : `Add account failed: ${message}`,
    importedAndRefreshed: (email: string) =>
      zh ? `已导入当前 auth.json 为 ${email}，并已刷新配额` : `Imported current auth.json as ${email} and refreshed quota`,
    importedButQuotaFailed: (email: string, message: string) =>
      zh ? `已导入当前 auth.json 为 ${email}，但刷新配额失败：${message}` : `Imported current auth.json as ${email}, but quota refresh failed: ${message}`,
    refreshedCount: (count: number) =>
      zh ? `已刷新 ${count} 个账号的配额` : `Refreshed quota for ${count} account(s)`,
    confirmRemove: (email: string) =>
      zh ? `确认移除已保存账号 ${email}？这不会删除全局 auth.json。` : `Remove saved account ${email}? This does not delete the global auth.json.`,
    addedToStatus: (email: string) =>
      zh ? `已将 ${email} 加入状态栏弹窗` : `Added ${email} to the status popup`,
    removedFromStatus: (email: string) =>
      zh ? `已将 ${email} 从状态栏弹窗移除` : `Removed ${email} from the status popup`,
    failedToRefresh: (email: string, message: string) =>
      zh ? `刷新 ${email} 的配额失败：${message}` : `Failed to refresh ${email}: ${message}`,
    quotaRefreshed: (email: string) =>
      zh ? `已刷新 ${email} 的配额` : `Quota refreshed for ${email}`,
    noAccounts: zh ? "还没有保存 Codex 账号。" : "No Codex accounts saved yet."
  };
}

function formatAccountToastLabel(account: CodexAccountRecord): string {
  const team = account.accountName?.trim();
  if (team) {
    return `${team} · ${account.email}`;
  }
  return account.email;
}
