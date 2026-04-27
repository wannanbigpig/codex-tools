import { describe, expect, it, vi } from "vitest";
import { createAccountsRepositoryState } from "../src/storage/accountsRepositoryState";
import {
  assertWriteAllowed,
  markPendingSave,
  readPendingOrCachedIndex
} from "../src/storage/accountsWriteCoordinator";
import { ErrorCode, StorageError } from "../src/core/errors";
import { parseSharedJsonInput, toImportActionPayload } from "../src/presentation/dashboard/actionUtils";
import { buildWorkbenchRefreshSignature, shouldRunAccountScheduler } from "../src/presentation/workbench/refreshSignature";
import { buildDashboardStateSignature } from "../src/presentation/dashboard/signature";

describe("accountsWriteCoordinator helpers", () => {
  it("prefers pending saves over cache and schedules a flush", () => {
    vi.useFakeTimers();
    const state = createAccountsRepositoryState();
    const flush = vi.fn();

    markPendingSave(
      state,
      {
        currentAccountId: "a",
        accounts: [{ id: "a", email: "a@example.com", isActive: true, createdAt: 1, updatedAt: 1 }]
      },
      100,
      flush
    );

    expect(readPendingOrCachedIndex(state, 5000)?.currentAccountId).toBe("a");
    vi.advanceTimersByTime(100);
    expect(flush).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("blocks writes when the index is unrecoverable", () => {
    const state = createAccountsRepositoryState();
    state.indexHealth = {
      status: "corrupted_unrecoverable",
      availableBackups: 0
    };

    expect(() => assertWriteAllowed(state)).toThrowError(StorageError);
    expect(() => assertWriteAllowed(state)).toThrow(/Restore accounts before writing again/);
  });
});

describe("dashboard action utils", () => {
  it("parses shared json and formats import results", () => {
    expect(parseSharedJsonInput('[{"email":"dev@example.com"}]')).toEqual([{ email: "dev@example.com" }]);

    expect(
      toImportActionPayload({
        source: "backup",
        restoredCount: 2,
        restoredEmails: ["a@example.com", "b@example.com"]
      })
    ).toEqual({
      importedCount: 2,
      importedEmails: ["a@example.com", "b@example.com"],
      importResult: {
        total: 2,
        successCount: 2,
        overwriteCount: 0,
        failedCount: 0,
        importedEmails: ["a@example.com", "b@example.com"],
        failures: []
      }
    });
  });

  it("surfaces parser errors through the provided formatter", () => {
    expect(() => parseSharedJsonInput("", (message) => `invalid: ${message}`)).toThrow("invalid: Empty JSON input");
  });
});

describe("workbench refresh signature helpers", () => {
  it("builds a stable signature from account and health state", () => {
    const signature = buildWorkbenchRefreshSignature({
      observedAuthIdentity: "acct-1",
      indexHealth: {
        status: "healthy",
        availableBackups: 1
      },
      accounts: [{ id: "a", email: "a@example.com", isActive: true, createdAt: 1, updatedAt: 2 }]
    });

    expect(signature).toContain("acct-1");
    expect(signature).toContain("a@example.com");
    expect(shouldRunAccountScheduler(0)).toBe(false);
    expect(shouldRunAccountScheduler(2)).toBe(true);
  });

  it("changes signatures when tags change", () => {
    const workbenchBase = buildWorkbenchRefreshSignature({
      observedAuthIdentity: "acct-1",
      indexHealth: {
        status: "healthy",
        availableBackups: 1
      },
      accounts: [{ id: "a", email: "a@example.com", tags: ["team"], isActive: true, createdAt: 1, updatedAt: 2 }]
    });
    const workbenchNext = buildWorkbenchRefreshSignature({
      observedAuthIdentity: "acct-1",
      indexHealth: {
        status: "healthy",
        availableBackups: 1
      },
      accounts: [{ id: "a", email: "a@example.com", tags: ["ops"], isActive: true, createdAt: 1, updatedAt: 2 }]
    });

    expect(workbenchBase).not.toBe(workbenchNext);

    const dashboardBase = buildDashboardStateSignature({
      lang: "en",
      panelTitle: "panel",
      brandSub: "brand",
      logoUri: "logo",
      settings: {
        dashboardTheme: "auto",
        codexAppRestartEnabled: false,
        codexAppRestartMode: "manual",
        backgroundTokenRefreshEnabled: true,
        autoRefreshMinutes: 0,
        autoSwitchEnabled: false,
        autoSwitchHourlyThreshold: 20,
        autoSwitchWeeklyThreshold: 20,
        autoSwitchPreferSameEmail: true,
        autoSwitchPreferSameTag: true,
        autoSwitchLockMinutes: 0,
        codexAppPath: "",
        resolvedCodexAppPath: "",
        quotaWarningEnabled: false,
        quotaWarningThreshold: 20,
        quotaGreenThreshold: 60,
        quotaYellowThreshold: 20,
        debugNetwork: false,
        displayLanguage: "auto"
      },
      copy: {
        panelTitle: "panel",
        brandSub: "brand"
      } as never,
      tokenAutomation: {
        enabled: false
      },
      announcements: {
        announcements: [],
        unreadIds: [],
        popupAnnouncement: null
      },
      indexHealth: {
        status: "healthy",
        availableBackups: 1
      },
      accounts: [
        {
          id: "a",
          email: "a@example.com",
          displayName: "a@example.com",
          accountName: "Account",
          tags: ["team"],
          metrics: [],
          planTypeLabel: "Team",
          authProviderLabel: "google",
          isActive: true,
          isCurrentWindowAccount: false,
          showInStatusBar: false,
          canToggleStatusBar: true,
          statusToggleTitle: "toggle",
          healthKind: "healthy",
          healthLabel: "Healthy",
          dismissedHealth: false
        }
      ]
    });
    const dashboardNext = buildDashboardStateSignature({
      lang: "en",
      panelTitle: "panel",
      brandSub: "brand",
      logoUri: "logo",
      settings: {
        dashboardTheme: "auto",
        codexAppRestartEnabled: false,
        codexAppRestartMode: "manual",
        backgroundTokenRefreshEnabled: true,
        autoRefreshMinutes: 0,
        autoSwitchEnabled: false,
        autoSwitchHourlyThreshold: 20,
        autoSwitchWeeklyThreshold: 20,
        autoSwitchPreferSameEmail: true,
        autoSwitchPreferSameTag: true,
        autoSwitchLockMinutes: 0,
        codexAppPath: "",
        resolvedCodexAppPath: "",
        quotaWarningEnabled: false,
        quotaWarningThreshold: 20,
        quotaGreenThreshold: 60,
        quotaYellowThreshold: 20,
        debugNetwork: false,
        displayLanguage: "auto"
      },
      copy: {
        panelTitle: "panel",
        brandSub: "brand"
      } as never,
      tokenAutomation: {
        enabled: false
      },
      announcements: {
        announcements: [],
        unreadIds: [],
        popupAnnouncement: null
      },
      indexHealth: {
        status: "healthy",
        availableBackups: 1
      },
      accounts: [
        {
          id: "a",
          email: "a@example.com",
          displayName: "a@example.com",
          accountName: "Account",
          tags: ["ops"],
          metrics: [],
          planTypeLabel: "Team",
          authProviderLabel: "google",
          isActive: true,
          isCurrentWindowAccount: false,
          showInStatusBar: false,
          canToggleStatusBar: true,
          statusToggleTitle: "toggle",
          healthKind: "healthy",
          healthLabel: "Healthy",
          dismissedHealth: false
        }
      ]
    });

    expect(dashboardBase).not.toBe(dashboardNext);
  });

  it("changes workbench signatures when token automation state changes", () => {
    const base = buildWorkbenchRefreshSignature({
      observedAuthIdentity: "acct-1",
      indexHealth: {
        status: "healthy",
        availableBackups: 1
      },
      accounts: [{ id: "a", email: "a@example.com", isActive: true, createdAt: 1, updatedAt: 2 }],
      tokenAutomation: {
        enabled: true,
        intervalMs: 300_000,
        skewSeconds: 600,
        lastSweepAt: 100,
        accounts: {
          a: {
            lastCheckAt: 100
          }
        }
      }
    });
    const next = buildWorkbenchRefreshSignature({
      observedAuthIdentity: "acct-1",
      indexHealth: {
        status: "healthy",
        availableBackups: 1
      },
      accounts: [{ id: "a", email: "a@example.com", isActive: true, createdAt: 1, updatedAt: 2 }],
      tokenAutomation: {
        enabled: true,
        intervalMs: 300_000,
        skewSeconds: 600,
        lastSweepAt: 200,
        accounts: {
          a: {
            lastCheckAt: 200,
            lastRefreshAt: 200
          }
        }
      }
    });

    expect(base).not.toBe(next);
  });
});
