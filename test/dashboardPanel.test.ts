import { describe, expect, it, vi } from "vitest";
import type { DashboardState } from "../src/domain/dashboard/types";

const { buildDashboardStateMock, backfillMissingResetCreditExpiriesMock } = vi.hoisted(() => ({
  buildDashboardStateMock: vi.fn(),
  backfillMissingResetCreditExpiriesMock: vi.fn()
}));

vi.mock("../src/application/dashboard/buildDashboardState", () => ({
  buildDashboardState: buildDashboardStateMock
}));

vi.mock("../src/presentation/dashboard/resetCreditsBackfill", () => ({
  backfillMissingResetCreditExpiries: backfillMissingResetCreditExpiriesMock
}));

import { publishDashboardSnapshot } from "../src/presentation/dashboard/panel";

function createState(): DashboardState {
  return {
    lang: "en",
    panelTitle: "Quota Summary",
    brandSub: "sub",
    logoUri: "logo",
    settings: {
      dashboardTheme: "dark",
      displayLanguage: "en",
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
        resetCreditsAvailable: 1
      } as DashboardState["accounts"][number]
    ]
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | "timeout"> {
  return Promise.race([
    promise,
    new Promise<"timeout">((resolve) => {
      setTimeout(() => resolve("timeout"), timeoutMs);
    })
  ]);
}

describe("publishDashboardSnapshot", () => {
  it("publishes the current snapshot without waiting for reset credits backfill", async () => {
    const state = createState();
    let resolveBackfill: (value: boolean) => void = () => undefined;

    buildDashboardStateMock.mockResolvedValue(state);
    backfillMissingResetCreditExpiriesMock.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveBackfill = resolve;
        })
    );

    const setPanelTitle = vi.fn();
    const postMessage = vi.fn(async () => true);
    const schedulePublishState = vi.fn();

    const result = await withTimeout(
      publishDashboardSnapshot({
        repo: {} as never,
        settingsStore: {} as never,
        logoUri: "logo",
        announcementsState: state.announcements,
        setPanelTitle,
        postMessage,
        schedulePublishState
      }),
      50
    );

    expect(result).not.toBe("timeout");
    expect(setPanelTitle).toHaveBeenCalledWith("Quota Summary");
    expect(postMessage).toHaveBeenCalledWith({
      type: "dashboard:snapshot",
      state
    });
    expect(schedulePublishState).not.toHaveBeenCalled();

    resolveBackfill(true);
  });

  it("schedules a follow-up publish after backfill updates the repository", async () => {
    const state = createState();
    buildDashboardStateMock.mockResolvedValue(state);
    backfillMissingResetCreditExpiriesMock.mockImplementation(async (_repo, _accounts, onUpdated) => {
      onUpdated();
      return true;
    });

    const schedulePublishState = vi.fn();

    await publishDashboardSnapshot({
      repo: {} as never,
      settingsStore: {} as never,
      logoUri: "logo",
      announcementsState: state.announcements,
      setPanelTitle: vi.fn(),
      postMessage: vi.fn(async () => true),
      schedulePublishState
    });

    await Promise.resolve();

    expect(schedulePublishState).toHaveBeenCalledTimes(1);
  });
});
