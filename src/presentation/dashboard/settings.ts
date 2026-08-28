import * as vscode from "vscode";
import { getDashboardCopy } from "../../application/dashboard/copy";
import type { DashboardSettingKey } from "../../domain/dashboard/types";
import {
  ExtensionSettingsStore,
  getCodexAccountsConfiguration,
  normalizeAutoRefreshMinutes,
  normalizeAutoSwitchLockMinutes,
  normalizeAutoSwitchThreshold,
  normalizeDashboardTheme,
  normalizeQuotaWarningThreshold,
  normalizeUsageHistoryRetentionDays
} from "../../infrastructure/config/extensionSettings";
import { isDashboardLanguageOption } from "../../localization/languages";
import { normalizeQuotaColorThresholds } from "../../utils";

export type DashboardConfigurationKey = DashboardSettingKey | "codexAppPath";

export async function handleDashboardSettingUpdate(
  key: DashboardConfigurationKey,
  value: string | number | boolean,
  target?: vscode.ConfigurationTarget
): Promise<boolean> {
  const config = getCodexAccountsConfiguration();
  let updated = false;

  switch (key) {
    case "dashboardTheme":
      if (typeof value === "string") {
        await updateDashboardConfiguration(config, key, normalizeDashboardTheme(value), target);
        updated = true;
      }
      break;
    case "codexAppRestartEnabled":
    case "autoSwitchEnabled":
    case "hourlyQuotaControlEnabled":
    case "autoSwitchReloadWindowEnabled":
    case "backgroundTokenRefreshEnabled":
    case "autoResumeCodexSessions":
    case "quotaWarningEnabled":
    case "debugNetwork":
    case "encryptedSyncEnabled":
    case "webDashboardEnabled":
      if (typeof value === "boolean") {
        await updateDashboardConfiguration(config, key, value, target);
        updated = true;
      }
      break;
    case "codexAppRestartMode":
      if (value === "auto" || value === "manual") {
        await updateDashboardConfiguration(config, key, value, target);
        updated = true;
      }
      break;
    case "autoSwitchHourlyThreshold":
    case "autoSwitchWeeklyThreshold":
      if (typeof value === "number") {
        await updateDashboardConfiguration(config, key, normalizeAutoSwitchThreshold(value), target);
        updated = true;
      }
      break;
    case "quotaWarningThreshold":
      if (typeof value === "number") {
        await updateDashboardConfiguration(config, key, normalizeQuotaWarningThreshold(value), target);
        updated = true;
      }
      break;
    case "quotaGreenThreshold":
      if (typeof value === "number") {
        const normalized = normalizeQuotaColorThresholds(
          snapToAllowed(value, [50, 60, 70, 80, 90], 60),
          config.get<number>("quotaYellowThreshold", 20)
        );
        await updateDashboardConfiguration(config, key, normalized.green, target);
        updated = true;
      }
      break;
    case "quotaYellowThreshold":
      if (typeof value === "number") {
        const normalized = normalizeQuotaColorThresholds(
          config.get<number>("quotaGreenThreshold", 60),
          snapToAllowed(value, [10, 20, 30, 40, 50], 20)
        );
        await updateDashboardConfiguration(config, key, normalized.yellow, target);
        updated = true;
      }
      break;
    case "autoSwitchLockMinutes":
      if (typeof value === "number") {
        await updateDashboardConfiguration(config, key, normalizeAutoSwitchLockMinutes(value), target);
        updated = true;
      }
      break;
    case "autoRefreshMinutes":
    case "autoRefreshCurrentMinutes":
      if (typeof value === "number") {
        await updateDashboardConfiguration(config, key, normalizeAutoRefreshMinutes(value), target);
        updated = true;
      }
      break;
    case "usageHistoryRetentionDays":
      if (typeof value === "number") {
        await updateDashboardConfiguration(config, key, normalizeUsageHistoryRetentionDays(value), target);
        updated = true;
      }
      break;
    case "displayLanguage":
      if (typeof value === "string" && isDashboardLanguageOption(value)) {
        await updateDashboardConfiguration(config, key, value, target);
        updated = true;
      }
      break;
    case "codexAppPath":
      if (typeof value === "string") {
        await updateDashboardConfiguration(config, key, value, target);
        updated = true;
      }
      break;
    default:
      return false;
  }

  return updated;
}

function snapToAllowed(value: number, allowed: readonly number[], fallback: number): number {
  if (!Number.isFinite(value)) {return fallback;}
  return allowed.reduce((closest, candidate) =>
    Math.abs(candidate - value) < Math.abs(closest - value) ? candidate : closest
  , fallback);
}

async function updateDashboardConfiguration(
  config: vscode.WorkspaceConfiguration,
  key: DashboardConfigurationKey,
  value: string | number | boolean,
  target?: vscode.ConfigurationTarget
): Promise<void> {
  await config.update(key, value, target ?? resolveConfigurationTarget(config, key));
}

function resolveConfigurationTarget(
  config: vscode.WorkspaceConfiguration,
  key: DashboardConfigurationKey
): vscode.ConfigurationTarget {
  const inspected = config.inspect(key);
  if (inspected?.workspaceFolderValue !== undefined) {
    return vscode.ConfigurationTarget.WorkspaceFolder;
  }
  if (inspected?.workspaceValue !== undefined) {
    return vscode.ConfigurationTarget.Workspace;
  }
  return vscode.ConfigurationTarget.Global;
}

export async function pickDashboardCodexAppPath(
  settingsStore: Pick<ExtensionSettingsStore, "resolveLanguage">
): Promise<void> {
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

  const config = getCodexAccountsConfiguration();
  const target = resolveConfigurationTarget(config, "codexAppPath");
  await config.update("codexAppPath", selected[0].fsPath, target);
}
