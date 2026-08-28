import { describe, expect, it } from "vitest";
import { buildDashboardStateSignature } from "../src/presentation/dashboard/signature";
import type { DashboardState } from "../src/domain/dashboard/types";

function createState(overrides?: {
  resetCreditsAvailable?: number;
  resetCreditsNextExpiresAt?: number;
  totalUsageMs?: number;
  runningDeviceName?: string;
  encryptedSyncNeedsSettingsSync?: boolean;
}): DashboardState {
  return {
    lang: "zh",
    panelTitle: "title",
    brandSub: "sub",
    logoUri: "logo",
    encryptedSyncNeedsSettingsSync: overrides?.encryptedSyncNeedsSettingsSync,
    settings: {
      dashboardTheme: "dark",
      displayLanguage: "zh",
      autoRefreshMinutes: 0,
      autoRefreshCurrentMinutes: 0,
      backgroundTokenRefreshEnabled: true,
      autoSwitchEnabled: false,
      hourlyQuotaControlEnabled: false,
      autoSwitchReloadWindowEnabled: false,
      autoSwitchHourlyThreshold: 20,
      autoSwitchWeeklyThreshold: 20,
      autoSwitchLockMinutes: 0,
      quotaWarningEnabled: false,
      quotaWarningThreshold: 20,
      quotaGreenThreshold: 60,
      quotaYellowThreshold: 20,
      codexAppRestartEnabled: false,
      codexAppRestartMode: "manual",
      codexAppPath: "",
      resolvedCodexAppPath: ""
    },
    copy: {} as DashboardState["copy"],
    tokenAutomation: {
      enabled: true
    },
    announcements: {
      announcements: [],
      unreadIds: []
    },
    indexHealth: {
      status: "healthy",
      availableBackups: 0
    },
    accounts: [
      {
        id: "account-1",
        email: "dev@example.com",
        displayName: "dev@example.com",
        tags: [],
        planTypeLabel: "Plus",
        isActive: true,
        showInStatusBar: false,
        healthKind: "healthy",
        dismissedHealth: false,
        metrics: [],
        resetCreditsAvailable: overrides?.resetCreditsAvailable,
        resetCreditsNextExpiresAt: overrides?.resetCreditsNextExpiresAt,
        totalUsageMs: overrides?.totalUsageMs,
        runningDeviceName: overrides?.runningDeviceName
      } as DashboardState["accounts"][number]
    ]
  };
}

describe("buildDashboardStateSignature", () => {
  it("changes when reset credits expiry changes", () => {
    const before = buildDashboardStateSignature(createState({ resetCreditsAvailable: 1 }));
    const after = buildDashboardStateSignature(
      createState({ resetCreditsAvailable: 1, resetCreditsNextExpiresAt: 1_800_000_000 })
    );

    expect(after).not.toBe(before);
  });

  it("changes when account usage duration changes", () => {
    const before = buildDashboardStateSignature(createState({ totalUsageMs: 60_000 }));
    const after = buildDashboardStateSignature(createState({ totalUsageMs: 120_000 }));

    expect(after).not.toBe(before);
  });

  it("changes when a synced PC starts running the account", () => {
    const before = buildDashboardStateSignature(createState());
    const after = buildDashboardStateSignature(createState({ runningDeviceName: "Office PC" }));

    expect(after).not.toBe(before);
  });

  it("changes when VS Code Settings Sync becomes inactive", () => {
    const before = buildDashboardStateSignature(createState());
    const after = buildDashboardStateSignature(createState({ encryptedSyncNeedsSettingsSync: true }));

    expect(after).not.toBe(before);
  });
});
