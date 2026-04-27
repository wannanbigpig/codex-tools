import * as vscode from "vscode";
import type { DashboardSettings, DashboardThemeOption } from "../../domain/dashboard/types";
import { DashboardLanguage, DashboardLanguageOption, resolveDashboardLanguage } from "../../localization/languages";
import { normalizeQuotaColorThresholds } from "../../utils";

const CODEX_ACCOUNTS_SECTION = "codexAccounts";

export class ExtensionSettingsStore {
  getDashboardSettings(): DashboardSettings {
    const config = getCodexAccountsConfiguration();
    const thresholds = normalizeQuotaColorThresholds(
      config.get<number>("quotaGreenThreshold", 60),
      config.get<number>("quotaYellowThreshold", 20)
    );

    return {
      dashboardTheme: normalizeDashboardTheme(config.get<string>("dashboardTheme", "auto")),
      codexAppRestartEnabled: config.get<boolean>("codexAppRestartEnabled", false),
      codexAppRestartMode: config.get<"auto" | "manual">("codexAppRestartMode") ?? "manual",
      backgroundTokenRefreshEnabled: config.get<boolean>("backgroundTokenRefreshEnabled", true),
      autoRefreshMinutes: config.get<number>("autoRefreshMinutes", 0),
      autoSwitchEnabled: config.get<boolean>("autoSwitchEnabled", false),
      autoSwitchHourlyThreshold: normalizeAutoSwitchThreshold(config.get<number>("autoSwitchHourlyThreshold", 20)),
      autoSwitchWeeklyThreshold: normalizeAutoSwitchThreshold(config.get<number>("autoSwitchWeeklyThreshold", 20)),
      autoSwitchPreferSameEmail: config.get<boolean>("autoSwitchPreferSameEmail", true),
      autoSwitchPreferSameTag: config.get<boolean>("autoSwitchPreferSameTag", true),
      autoSwitchLockMinutes: normalizeAutoSwitchLockMinutes(config.get<number>("autoSwitchLockMinutes", 0)),
      codexAppPath: config.get<string>("codexAppPath", ""),
      resolvedCodexAppPath: "",
      quotaWarningEnabled: config.get<boolean>("quotaWarningEnabled", false),
      quotaWarningThreshold: normalizeQuotaWarningThreshold(config.get<number>("quotaWarningThreshold", 20)),
      quotaGreenThreshold: thresholds.green,
      quotaYellowThreshold: thresholds.yellow,
      debugNetwork: config.get<boolean>("debugNetwork", false),
      displayLanguage: config.get<DashboardLanguageOption>("displayLanguage", "auto")
    };
  }

  resolveLanguage(): DashboardLanguage {
    const configured = getCodexAccountsConfiguration().get<string>("displayLanguage", "auto");
    return resolveDashboardLanguage(configured, vscode.env.language);
  }

  onDidChange(listener: () => void): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(CODEX_ACCOUNTS_SECTION)) {
        listener();
      }
    });
  }
}

export function normalizeDashboardTheme(value: string | undefined): DashboardThemeOption {
  return value === "dark" || value === "light" || value === "auto" ? value : "auto";
}

export function getCodexAccountsConfiguration(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(CODEX_ACCOUNTS_SECTION);
}

export function getAutoRefreshMinutes(): number {
  return getCodexAccountsConfiguration().get<number>("autoRefreshMinutes", 0);
}

export function isBackgroundTokenRefreshEnabled(): boolean {
  return getCodexAccountsConfiguration().get<boolean>("backgroundTokenRefreshEnabled", true);
}

export function normalizeAutoSwitchThreshold(value: number): number {
  if (!Number.isFinite(value)) {
    return 20;
  }

  return Math.max(1, Math.min(20, Math.round(value)));
}

export function normalizeQuotaWarningThreshold(value: number): number {
  if (!Number.isFinite(value)) {
    return 20;
  }

  const snapped = Math.round(value / 5) * 5;
  return Math.max(5, Math.min(90, snapped));
}

function normalizeAutoSwitchLockMinutes(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(120, Math.round(value)));
}
