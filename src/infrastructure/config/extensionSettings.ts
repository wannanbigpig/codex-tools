import * as vscode from "vscode";
import { DashboardSettings } from "../../domain/dashboard/types";
import { DashboardLanguage, DashboardLanguageOption, resolveDashboardLanguage } from "../../localization/languages";
import { normalizeQuotaColorThresholds } from "../../utils";

export class ExtensionSettingsStore {
  getDashboardSettings(): DashboardSettings {
    const config = vscode.workspace.getConfiguration("codexAccounts");
    const thresholds = normalizeQuotaColorThresholds(
      config.get<number>("quotaGreenThreshold", 60),
      config.get<number>("quotaYellowThreshold", 20)
    );

    return {
      codexAppRestartEnabled: config.get<boolean>("codexAppRestartEnabled", false),
      codexAppRestartMode: config.get<"auto" | "manual">("codexAppRestartMode") ?? "manual",
      autoRefreshMinutes: config.get<number>("autoRefreshMinutes", 0),
      autoSwitchEnabled: config.get<boolean>("autoSwitchEnabled", false),
      autoSwitchHourlyThreshold: normalizeAutoSwitchThreshold(config.get<number>("autoSwitchHourlyThreshold", 20)),
      autoSwitchWeeklyThreshold: normalizeAutoSwitchThreshold(config.get<number>("autoSwitchWeeklyThreshold", 20)),
      codexAppPath: config.get<string>("codexAppPath", ""),
      resolvedCodexAppPath: "",
      showCodeReviewQuota: config.get<boolean>("showCodeReviewQuota", true),
      quotaWarningEnabled: config.get<boolean>("quotaWarningEnabled", false),
      quotaWarningThreshold: normalizeQuotaWarningThreshold(config.get<number>("quotaWarningThreshold", 20)),
      quotaGreenThreshold: thresholds.green,
      quotaYellowThreshold: thresholds.yellow,
      debugNetwork: config.get<boolean>("debugNetwork", false),
      displayLanguage: config.get<DashboardLanguageOption>("displayLanguage", "auto")
    };
  }

  resolveLanguage(): DashboardLanguage {
    const configured = vscode.workspace.getConfiguration("codexAccounts").get<string>("displayLanguage", "auto");
    return resolveDashboardLanguage(configured, vscode.env.language);
  }

  onDidChange(listener: () => void): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("codexAccounts")) {
        listener();
      }
    });
  }
}

function normalizeAutoSwitchThreshold(value: number): number {
  if (!Number.isFinite(value)) {
    return 20;
  }

  return Math.max(1, Math.min(20, Math.round(value)));
}

function normalizeQuotaWarningThreshold(value: number): number {
  if (!Number.isFinite(value)) {
    return 20;
  }

  const snapped = Math.round(value / 5) * 5;
  return Math.max(5, Math.min(90, snapped));
}
