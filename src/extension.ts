import * as vscode from "vscode";
import { refreshImportedAccountQuota, registerCommands } from "./commands";
import { readAuthFile } from "./codex/authFile";
import { AccountsRepository } from "./storage/accounts";
import { AccountsStatusBarProvider } from "./ui/statusBar";

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
  await promptImportLocalAccountIfNeeded(repo, refreshers);
  await statusBar.refresh();
}

export function deactivate(): void {}

async function promptImportLocalAccountIfNeeded(
  repo: AccountsRepository,
  view: { refresh(): void }
): Promise<void> {
  const accounts = await repo.listAccounts();
  if (accounts.length > 0) {
    return;
  }

  const auth = await readAuthFile();
  if (!auth?.tokens?.id_token || !auth.tokens.access_token) {
    return;
  }

  const zh = vscode.env.language.toLowerCase().startsWith("zh");
  const copy = {
    title: zh ? "检测到本地 Codex 账号" : "Local Codex account detected",
    message: zh
      ? "检测到当前机器已有本地 auth.json，是否立即绑定到扩展并刷新最新配额？"
      : "A local Codex auth.json was found. Bind it to the extension and refresh the latest quota now?",
    action: zh ? "立即绑定" : "Bind Now",
    success: (email: string) =>
      zh ? `已绑定本地账号 ${email}，并已刷新配额` : `Bound local account ${email} and refreshed quota`,
    partial: (email: string, message: string) =>
      zh ? `已绑定本地账号 ${email}，但刷新配额失败：${message}` : `Bound local account ${email}, but quota refresh failed: ${message}`,
    failed: (message: string) =>
      zh ? `绑定本地账号失败：${message}` : `Failed to bind local account: ${message}`
  };

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
          vscode.window.showWarningMessage(copy.partial(account.email, result.error.message));
        } else {
          vscode.window.showInformationMessage(copy.success(account.email));
        }
      }
    );
  } catch (error) {
    vscode.window.showErrorMessage(copy.failed(error instanceof Error ? error.message : String(error)));
  }
}
