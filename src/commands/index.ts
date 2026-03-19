import * as vscode from "vscode";
import { AccountsCommandService } from "../application/accounts/commandService";
export { refreshImportedAccountQuota } from "../application/accounts/quota";
import { CodexAccountRecord } from "../core/types";
import { AccountsRepository } from "../storage";

/**
 * 注册所有命令
 */
export function registerCommands(
  context: vscode.ExtensionContext,
  repo: AccountsRepository,
  view: { refresh(): void; markObservedAuthIdentity?: (accountId?: string) => void }
): void {
  const service = new AccountsCommandService(context, repo, view);

  context.subscriptions.push(
    vscode.commands.registerCommand("codexAccounts.addAccount", () => service.addAccount()),
    vscode.commands.registerCommand("codexAccounts.importCurrentAuth", () => service.importCurrentAuth()),
    vscode.commands.registerCommand("codexAccounts.switchAccount", (item?: CodexAccountRecord) => service.switchAccount(item)),
    vscode.commands.registerCommand("codexAccounts.refreshQuota", (item?: CodexAccountRecord) => service.refreshQuota(item)),
    vscode.commands.registerCommand("codexAccounts.refreshAllQuotas", (options?: { silent?: boolean }) => service.refreshAllQuotas(options)),
    vscode.commands.registerCommand("codexAccounts.removeAccount", (item?: CodexAccountRecord) => service.removeAccount(item)),
    vscode.commands.registerCommand("codexAccounts.toggleStatusBarAccount", (item?: CodexAccountRecord) => service.toggleStatusBarAccount(item)),
    vscode.commands.registerCommand("codexAccounts.openDetails", (item?: CodexAccountRecord) => service.openDetails(item)),
    vscode.commands.registerCommand("codexAccounts.openCodexHome", () => service.openCodexHome()),
    vscode.commands.registerCommand("codexAccounts.showQuotaSummary", () => service.showQuotaSummary())
  );
}
