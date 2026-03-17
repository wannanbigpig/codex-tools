import * as vscode from "vscode";
import { DashboardLanguage, DashboardSettings } from "../../domain/dashboard/types";
import { normalizeQuotaColorThresholds } from "../../utils";

export class ExtensionSettingsStore {
  getDashboardSettings(): DashboardSettings {
    const config = vscode.workspace.getConfiguration("codexAccounts");
    const thresholds = normalizeQuotaColorThresholds(
      config.get<number>("quotaGreenThreshold", 60),
      config.get<number>("quotaYellowThreshold", 20)
    );

    return {
      codexAppRestartMode: config.get<"auto" | "manual">("codexAppRestartMode") ?? "manual",
      autoRefreshMinutes: config.get<number>("autoRefreshMinutes", 0),
      codexAppPath: config.get<string>("codexAppPath", ""),
      showCodeReviewQuota: config.get<boolean>("showCodeReviewQuota", true),
      quotaWarningEnabled: config.get<boolean>("quotaWarningEnabled", true),
      quotaWarningThreshold: config.get<number>("quotaWarningThreshold", 20),
      quotaGreenThreshold: thresholds.green,
      quotaYellowThreshold: thresholds.yellow,
      debugNetwork: config.get<boolean>("debugNetwork", false),
      displayLanguage: config.get<"auto" | "zh" | "en">("displayLanguage", "auto")
    };
  }

  resolveLanguage(): DashboardLanguage {
    const configured = vscode.workspace.getConfiguration("codexAccounts").get<string>("displayLanguage", "auto");
    if (configured === "zh" || configured === "en") {
      return configured;
    }

    const currentLanguage = vscode.env.language.toLowerCase();
    return currentLanguage.startsWith("zh") ? "zh" : "en";
  }

  onDidChange(listener: () => void): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("codexAccounts")) {
        listener();
      }
    });
  }
}
