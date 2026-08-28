import * as vscode from "vscode";
import type { CodexAccountRecord } from "../../core/types";
import { getCodexAccountsConfiguration } from "../../infrastructure/config/extensionSettings";
import {
  getCurrentWindowRuntimeAccountId,
  clearQueuedAccountSwitch,
  needsWindowReloadForAccount,
  queueAccountSwitch
} from "../../presentation/workbench/windowRuntimeAccount";
import { getCodexAppRestartCopy, getCodexAppState, getCommandCopy, restartCodexAppIfInstalled } from "../../utils";

const CODEX_APP_RESTART_MODE = "codexAppRestartMode";
const CODEX_APP_RESTART_ENABLED = "codexAppRestartEnabled";
let reloadPromptInFlight: Promise<boolean> | undefined;

export async function handleCodexAppRestartPreference(options?: { allowManualPrompt?: boolean }): Promise<void> {
  if (!getCodexAccountsConfiguration().get<boolean>(CODEX_APP_RESTART_ENABLED, false)) {
    return;
  }

  const state = await getCodexAppState();
  if (!state.installed || !state.running) {
    return;
  }

  const config = getCodexAccountsConfiguration();
  const mode = config.get<string>(CODEX_APP_RESTART_MODE);
  if (mode === "auto") {
    await restartCodexAppIfInstalled();
    return;
  }

  if (mode !== "manual" || options?.allowManualPrompt === false) {
    return;
  }

  const copy = getCodexAppRestartCopy();
  const manualChoice = await vscode.window.showInformationMessage(copy.manualMessage, copy.restartNow, copy.later);
  if (manualChoice === copy.restartNow) {
    await restartCodexAppIfInstalled();
  }
}

export async function promptWindowReloadForAccount(
  account: Pick<CodexAccountRecord, "id" | "email">,
  options?: { message?: string }
): Promise<boolean> {
  if (!needsWindowReloadForAccount(account.id)) {
    clearQueuedAccountSwitch();
    return false;
  }

  if (reloadPromptInFlight) {
    return reloadPromptInFlight;
  }

  reloadPromptInFlight = (async () => {
    const copy = getCommandCopy();
    const choice = await vscode.window.showInformationMessage(
      options?.message ?? copy.switchedAndAskReload(account.email),
      copy.reloadNow,
      copy.later
    );
    if (choice === copy.reloadNow) {
      clearQueuedAccountSwitch();
      await reloadExtensionHostWithWindowFallback();
      return true;
    }
    const currentWindowAccountId = getCurrentWindowRuntimeAccountId();
    if (currentWindowAccountId && currentWindowAccountId !== account.id) {
      queueAccountSwitch(account.id, currentWindowAccountId);
    } else {
      clearQueuedAccountSwitch();
    }
    return false;
  })().finally(() => {
    reloadPromptInFlight = undefined;
  });

  return reloadPromptInFlight;
}

export async function autoReloadWindowForAccount(accountId?: string): Promise<boolean> {
  if (!needsWindowReloadForAccount(accountId)) {
    return false;
  }

  await reloadExtensionHostWithWindowFallback();
  return true;
}

async function reloadExtensionHostWithWindowFallback(): Promise<void> {
  await vscode.commands.executeCommand("codexAccounts.prepareDashboardForExtensionHostRestart");
  await vscode.commands.executeCommand("codexAccounts.captureCodexSessions");
  try {
    await vscode.commands.executeCommand("workbench.action.restartExtensionHost");
  } catch (error) {
    console.warn("[codexAccounts] extension host restart failed; reloading the VS Code window", error);
    await vscode.commands.executeCommand("workbench.action.reloadWindow");
  }
}
