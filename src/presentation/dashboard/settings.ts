import * as vscode from "vscode";
import { getDashboardCopy } from "../../application/dashboard/copy";
import type { DashboardSettingKey } from "../../domain/dashboard/types";
import {
  ExtensionSettingsStore,
  getCodexAccountsConfiguration,
  normalizeDashboardTheme
} from "../../infrastructure/config/extensionSettings";
import { isDashboardLanguageOption } from "../../localization/languages";

export async function handleDashboardSettingUpdate(
  key: DashboardSettingKey,
  value: string | number | boolean
): Promise<boolean> {
  const config = getCodexAccountsConfiguration();
  let updated = false;

  switch (key) {
    case "dashboardTheme":
      if (typeof value === "string") {
        await config.update(key, normalizeDashboardTheme(value), vscode.ConfigurationTarget.Global);
        updated = true;
      }
      break;
    case "codexAppRestartEnabled":
    case "autoSwitchEnabled":
    case "backgroundTokenRefreshEnabled":
    case "quotaWarningEnabled":
    case "debugNetwork":
    case "autoSwitchPreferSameEmail":
    case "autoSwitchPreferSameTag":
      if (typeof value === "boolean") {
        await config.update(key, value, vscode.ConfigurationTarget.Global);
        updated = true;
      }
      break;
    case "codexAppRestartMode":
      if (value === "auto" || value === "manual") {
        await config.update(key, value, vscode.ConfigurationTarget.Global);
        updated = true;
      }
      break;
    case "autoRefreshMinutes":
    case "autoSwitchHourlyThreshold":
    case "autoSwitchWeeklyThreshold":
    case "quotaWarningThreshold":
    case "quotaGreenThreshold":
    case "quotaYellowThreshold":
    case "autoSwitchLockMinutes":
      if (typeof value === "number") {
        await config.update(key, value, vscode.ConfigurationTarget.Global);
        updated = true;
      }
      break;
    case "displayLanguage":
      if (typeof value === "string" && isDashboardLanguageOption(value)) {
        await config.update(key, value, vscode.ConfigurationTarget.Global);
        updated = true;
      }
      break;
    default:
      return false;
  }

  return updated;
}

export async function pickDashboardCodexAppPath(settingsStore: Pick<ExtensionSettingsStore, "resolveLanguage">): Promise<void> {
  const pickerCopy = getDashboardCopy(settingsStore.resolveLanguage());
  const selected = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: pickerCopy.pickPath
  });

  if (!selected?.[0]) {
    return;
  }

  await getCodexAccountsConfiguration().update("codexAppPath", selected[0].fsPath, vscode.ConfigurationTarget.Global);
}
