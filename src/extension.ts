import * as vscode from "vscode";
import { AccountsWorkbench } from "./presentation/workbench/accountsWorkbench";

let workbench: AccountsWorkbench | undefined;

/**
 * 激活扩展
 *
 * @param context - 扩展上下文
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  workbench = new AccountsWorkbench(context);
  await workbench.activate();
}

/**
 * 停用扩展
 */
export function deactivate(): void {
  workbench?.dispose();
  workbench = undefined;
}
