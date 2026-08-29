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
      backgroundTokenRefreshEnabled: config.get<boolean>("backgroundTokenRefreshEnabled", false),
      cliIntegrationEnabled: config.get<boolean>("cliIntegrationEnabled", false),
      autoResumeCodexSessions: config.get<boolean>("autoResumeCodexSessions", false),
      autoRefreshMinutes: normalizeAutoRefreshMinutes(config.get<number>("autoRefreshMinutes", 15)),
      autoRefreshCurrentMinutes: normalizeAutoRefreshMinutes(config.get<number>("autoRefreshCurrentMinutes", 1)),
      usageHistoryRetentionDays: normalizeUsageHistoryRetentionDays(
        config.get<number>("usageHistoryRetentionDays", 7)
      ),
      autoSwitchEnabled: config.get<boolean>("autoSwitchEnabled", false),
      hourlyQuotaControlEnabled: config.get<boolean>("hourlyQuotaControlEnabled", false),
      autoSwitchReloadWindowEnabled: config.get<boolean>("autoSwitchReloadWindowEnabled", false),
      autoSwitchHourlyThreshold: normalizeAutoSwitchThreshold(config.get<number>("autoSwitchHourlyThreshold", 20)),
      autoSwitchWeeklyThreshold: normalizeAutoSwitchThreshold(config.get<number>("autoSwitchWeeklyThreshold", 20)),
      autoSwitchLockMinutes: normalizeAutoSwitchLockMinutes(config.get<number>("autoSwitchLockMinutes", 0)),
      codexAppPath: config.get<string>("codexAppPath", ""),
      resolvedCodexAppPath: "",
      quotaWarningEnabled: config.get<boolean>("quotaWarningEnabled", false),
      quotaWarningThreshold: normalizeQuotaWarningThreshold(config.get<number>("quotaWarningThreshold", 20)),
      quotaGreenThreshold: thresholds.green,
      quotaYellowThreshold: thresholds.yellow,
      debugNetwork: config.get<boolean>("debugNetwork", false),
      encryptedSyncEnabled: config.get<boolean>("encryptedSyncEnabled", false),
      // Runtime-owned and password-gated; buildDashboardState replaces this placeholder.
      encryptedSyncRegistryOverrideEnabled: false,
      webDashboardEnabled: config.get<boolean>("webDashboardEnabled", false),
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

export function normalizeAutoRefreshMinutes(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.max(1, Math.min(60, Math.round(value)));
}

export function normalizeUsageHistoryRetentionDays(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 7;
  }

  return Math.max(1, Math.min(90, Math.round(value)));
}

export function getCodexAccountsConfiguration(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(CODEX_ACCOUNTS_SECTION);
}

export function getAutoRefreshMinutes(): number {
  return normalizeAutoRefreshMinutes(getCodexAccountsConfiguration().get<number>("autoRefreshMinutes", 15));
}

export function getAutoRefreshCurrentMinutes(): number {
  return normalizeAutoRefreshMinutes(getCodexAccountsConfiguration().get<number>("autoRefreshCurrentMinutes", 1));
}

export function isBackgroundTokenRefreshEnabled(): boolean {
  return getCodexAccountsConfiguration().get<boolean>("backgroundTokenRefreshEnabled", false);
}

export function isHourlyQuotaControlEnabled(): boolean {
  return getCodexAccountsConfiguration().get<boolean>("hourlyQuotaControlEnabled", false);
}

export function normalizeAutoSwitchThreshold(value: number): number {
  if (!Number.isFinite(value)) {
    return 20;
  }

  return Math.max(0, Math.min(20, Math.round(value)));
}

export function normalizeQuotaWarningThreshold(value: number): number {
  if (!Number.isFinite(value)) {
    return 20;
  }

  const snapped = Math.round(value / 5) * 5;
  return Math.max(5, Math.min(90, snapped));
}

export function normalizeAutoSwitchLockMinutes(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(120, Math.round(value)));
}
