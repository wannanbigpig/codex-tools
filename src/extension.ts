import * as vscode from "vscode";
import { AccountsWorkbench } from "./presentation/workbench/accountsWorkbench";
import {
  disposeCodexProxyEnvironment,
  getCodexProxyConfigurationError,
  initializeCodexProxyEnvironment
} from "./infrastructure/config/proxyEnvironment";
import { configureCrossWindowOperationCoordinator } from "./utils/crossWindowOperations";

let workbench: AccountsWorkbench | undefined;

/**
 * 激活扩展
 *
 * @param context - 扩展上下文
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Build the status entry before any asynchronous setup so every window has
  // immediate visual feedback, even while another window holds a startup lock.
  workbench = new AccountsWorkbench(context);
  try {
    await initializeCodexProxyEnvironment();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[codexAccounts] proxy initialization failed; continuing without proxy integration", error);
    void vscode.window.showWarningMessage(`Codex Manager proxy setup failed. The extension will continue: ${detail}`);
  }
  try {
    await configureCrossWindowOperationCoordinator(context.globalStorageUri.fsPath);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[codexAccounts] cross-window coordination initialization failed", error);
    void vscode.window.showWarningMessage(
      `Codex Manager could not initialize multi-window coordination. Avoid account changes in two windows at once: ${detail}`
    );
  }
  const proxyError = getCodexProxyConfigurationError();
  if (proxyError) {
    void vscode.window.showErrorMessage(`[Codex Accounts Manager] ${proxyError.message}`);
  }
  try {
    await workbench.activate();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    workbench.showActivationFailure(error);
    console.error("[codexAccounts] activation did not complete", error);
    void vscode.window.showErrorMessage(
      `Codex Manager could not finish loading: ${detail}. Run “Developer: Restart Extension Host” to retry.`
    );
  }
}

/**
 * 停用扩展
 */
export function deactivate(): void {
  workbench?.shutdown();
  workbench = undefined;
  disposeCodexProxyEnvironment();
}
