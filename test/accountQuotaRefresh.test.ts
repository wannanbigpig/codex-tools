import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as vscode from "vscode";
import type { CodexAccountRecord, CodexTokens } from "../src/core/types";
import type { AccountsRepository } from "../src/storage";

const { refreshQuotaMock, fetchResetCreditsMock, clearTokenAutomationErrorMock } = vi.hoisted(() => ({
  refreshQuotaMock: vi.fn(),
  fetchResetCreditsMock: vi.fn(),
  clearTokenAutomationErrorMock: vi.fn()
}));

const { handleCodexAppRestartPreferenceMock, autoReloadWindowForAccountMock, promptWindowReloadForAccountMock } =
  vi.hoisted(() => ({
    handleCodexAppRestartPreferenceMock: vi.fn(),
    autoReloadWindowForAccountMock: vi.fn(),
    promptWindowReloadForAccountMock: vi.fn()
  }));

vi.mock("../src/services", () => ({
  refreshQuota: refreshQuotaMock,
  fetchResetCredits: fetchResetCreditsMock
}));

vi.mock("../src/presentation/workbench/tokenAutomationState", () => ({
  clearTokenAutomationError: clearTokenAutomationErrorMock
}));

vi.mock("../src/application/accounts/switchEffects", () => ({
  handleCodexAppRestartPreference: handleCodexAppRestartPreferenceMock,
  autoReloadWindowForAccount: autoReloadWindowForAccountMock,
  promptWindowReloadForAccount: promptWindowReloadForAccountMock
}));

import {
  maybeAutoSwitchForActiveQuota,
  maybeWarnForAccount,
  refreshSingleQuota,
  refreshSingleQuotaSafely
} from "../src/application/accounts/quota";
import { setCurrentWindowRuntimeAccountId } from "../src/presentation/workbench/windowRuntimeAccount";
import { consumeAutoSwitchNotice, getAutoSwitchRuntimeSnapshot } from "../src/presentation/workbench/autoSwitchState";

type QuotaRefreshRepo = Pick<
  AccountsRepository,
  "getAccount" | "getTokens" | "updateQuota" | "refreshSubscriptionState" | "updateResetCreditsSnapshot"
>;

describe("refreshSingleQuota token automation state", () => {
  const account: CodexAccountRecord = {
    id: "account-1",
    email: "dev@example.com",
    isActive: true,
    createdAt: 1,
    updatedAt: 1
  };

  const tokens: CodexTokens = {
    idToken: "id-token",
    accessToken: "access-token",
    refreshToken: "refresh-token"
  };

  beforeEach(() => {
    refreshQuotaMock.mockReset();
    fetchResetCreditsMock.mockReset();
    clearTokenAutomationErrorMock.mockReset();
    handleCodexAppRestartPreferenceMock.mockReset();
    autoReloadWindowForAccountMock.mockReset();
    promptWindowReloadForAccountMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setCurrentWindowRuntimeAccountId(undefined);
    consumeAutoSwitchNotice();
  });

  it("clears automation auth error after a successful manual refresh", async () => {
    const repo: QuotaRefreshRepo = {
      getAccount: vi.fn(async () => account),
      getTokens: vi.fn(async () => tokens),
      updateQuota: vi.fn(async () => account),
      refreshSubscriptionState: vi.fn(async () => undefined),
      updateResetCreditsSnapshot: vi.fn(async () => undefined)
    };

    refreshQuotaMock.mockResolvedValue({
      quota: undefined,
      error: undefined,
      updatedTokens: tokens
    });

    await refreshSingleQuota(repo as AccountsRepository, { refresh: vi.fn() }, account.id, {
      announce: false,
      refreshView: false,
      warnQuota: false,
      forceRefresh: true
    });

    expect(repo.getTokens).toHaveBeenCalledWith(account.id, { bypassCache: true });
    expect(clearTokenAutomationErrorMock).toHaveBeenCalledWith(account.id);
  });

  it("shows a terminal success notification after a manual quota refresh", async () => {
    const repo: QuotaRefreshRepo = {
      getAccount: vi.fn(async () => account),
      getTokens: vi.fn(async () => tokens),
      updateQuota: vi.fn(async () => account),
      refreshSubscriptionState: vi.fn(async () => undefined),
      updateResetCreditsSnapshot: vi.fn(async () => undefined)
    };
    refreshQuotaMock.mockResolvedValue({ quota: undefined, error: undefined });
    vi.mocked(vscode.window.showInformationMessage).mockClear();

    await refreshSingleQuota(repo as AccountsRepository, { refresh: vi.fn() }, account.id, {
      refreshView: false,
      warnQuota: false,
      forceRefresh: true
    });

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(expect.stringMatching(/refreshed/i));
  });

  it("allows an explicit manual refresh for a disabled account", async () => {
    const disabledAccount = { ...account, enabled: false };
    const repo = {
      getAccount: vi.fn(async () => disabledAccount),
      getTokens: vi.fn(async () => tokens),
      updateQuota: vi.fn(async () => disabledAccount),
      refreshSubscriptionState: vi.fn(async () => undefined),
      updateResetCreditsSnapshot: vi.fn(async () => undefined)
    };
    refreshQuotaMock.mockResolvedValue({ quota: undefined, error: undefined });

    await expect(
      refreshSingleQuota(repo as unknown as AccountsRepository, { refresh: vi.fn() }, account.id, {
        announce: false
      })
    ).resolves.toEqual({ quota: undefined, error: undefined });

    expect(repo.getTokens).toHaveBeenCalled();
    expect(refreshQuotaMock).toHaveBeenCalled();
  });

  it("skips disabled accounts for an automatic refresh before reading tokens", async () => {
    const disabledAccount = { ...account, enabled: false };
    const repo = {
      getAccount: vi.fn(async () => disabledAccount),
      getTokens: vi.fn()
    };

    await expect(
      refreshSingleQuotaSafely(repo as unknown as AccountsRepository, { refresh: vi.fn() }, account.id, {
        skipDisabled: true
      })
    ).resolves.toBe(false);

    expect(repo.getTokens).not.toHaveBeenCalled();
    expect(refreshQuotaMock).not.toHaveBeenCalled();
  });

  it("shows a visible warning when the timed current-account refresh fails", async () => {
    const repo = {
      getAccount: vi.fn(async () => account),
      getTokens: vi.fn(async () => tokens)
    };
    refreshQuotaMock.mockRejectedValue(new Error("network unavailable"));
    vi.mocked(vscode.window.showWarningMessage).mockClear();

    await expect(
      refreshSingleQuotaSafely(repo as unknown as AccountsRepository, { refresh: vi.fn() }, account.id, {
        forceRefresh: true,
        announceFailure: true
      })
    ).resolves.toBe(false);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining("network unavailable"));
  });

  it("persists refreshed subscription metadata from quota refresh results", async () => {
    const repo: QuotaRefreshRepo = {
      getAccount: vi.fn(async () => account),
      getTokens: vi.fn(async () => tokens),
      updateQuota: vi.fn(async () => account),
      refreshSubscriptionState: vi.fn(async () => undefined),
      updateResetCreditsSnapshot: vi.fn(async () => undefined)
    };

    refreshQuotaMock.mockResolvedValue({
      quota: undefined,
      error: undefined,
      updatedTokens: tokens,
      updatedPlanType: "pro",
      updatedSubscriptionActiveUntil: "1800000000"
    });

    await refreshSingleQuota(repo as AccountsRepository, { refresh: vi.fn() }, account.id, {
      announce: false,
      refreshView: false,
      warnQuota: false,
      forceRefresh: true
    });

    expect(repo.updateQuota).toHaveBeenCalledWith(account.id, undefined, undefined, tokens, "pro", "1800000000");
  });

  it("can wait for the subscription refresh before completing account info sync", async () => {
    let finishSubscriptionRefresh: (() => void) | undefined;
    const subscriptionRefresh = new Promise<void>((resolve) => {
      finishSubscriptionRefresh = resolve;
    });
    const repo: QuotaRefreshRepo = {
      getAccount: vi.fn(async () => account),
      getTokens: vi.fn(async () => tokens),
      updateQuota: vi.fn(async () => account),
      refreshSubscriptionState: vi.fn(() => subscriptionRefresh),
      updateResetCreditsSnapshot: vi.fn(async () => undefined)
    };
    refreshQuotaMock.mockResolvedValue({ quota: undefined, error: undefined, updatedTokens: tokens });

    let completed = false;
    const refresh = refreshSingleQuota(repo as AccountsRepository, { refresh: vi.fn() }, account.id, {
      announce: false,
      awaitSubscriptionRefresh: true,
      forceRefresh: true,
      refreshView: false,
      warnQuota: false
    }).then(() => {
      completed = true;
    });

    await vi.waitFor(() => expect(repo.refreshSubscriptionState).toHaveBeenCalledWith(account.id, true));
    expect(completed).toBe(false);
    finishSubscriptionRefresh?.();
    await refresh;
    expect(completed).toBe(true);
  });

  it("keeps automation error when refresh still fails", async () => {
    const repo: QuotaRefreshRepo = {
      getAccount: vi.fn(async () => account),
      getTokens: vi.fn(async () => tokens),
      updateQuota: vi.fn(async () => account),
      refreshSubscriptionState: vi.fn(async () => undefined),
      updateResetCreditsSnapshot: vi.fn(async () => undefined)
    };

    refreshQuotaMock.mockResolvedValue({
      error: {
        message: "Token refresh failed",
        timestamp: Math.floor(Date.now() / 1000)
      }
    });

    await refreshSingleQuota(repo as AccountsRepository, { refresh: vi.fn() }, account.id, {
      announce: false,
      refreshView: false,
      warnQuota: false,
      forceRefresh: true
    });

    expect(clearTokenAutomationErrorMock).not.toHaveBeenCalled();
  });

  it("counts a returned quota error as a failed automatic refresh", async () => {
    const repo: QuotaRefreshRepo = {
      getAccount: vi.fn(async () => ({ ...account, isActive: false })),
      getTokens: vi.fn(async () => tokens),
      updateQuota: vi.fn(async () => ({ ...account, isActive: false })),
      refreshSubscriptionState: vi.fn(async () => undefined),
      updateResetCreditsSnapshot: vi.fn(async () => undefined)
    };
    refreshQuotaMock.mockResolvedValue({
      error: { message: "API returned 503", timestamp: Math.floor(Date.now() / 1000) }
    });

    await expect(
      refreshSingleQuotaSafely(repo as AccountsRepository, { refresh: vi.fn() }, account.id, {
        forceRefresh: true
      })
    ).resolves.toBe(false);
  });

  it("retries an active-account auth failure from Codex-managed auth.json without rotating tokens", async () => {
    const refreshedTokens: CodexTokens = {
      ...tokens,
      idToken: "new-id-token",
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token"
    };
    const syncActiveAccountFromAuthFile = vi.fn(async () => undefined);
    const repo = {
      getAccount: vi.fn(async () => account),
      getTokens: vi.fn().mockResolvedValueOnce(tokens).mockResolvedValueOnce(refreshedTokens),
      syncActiveAccountFromAuthFile,
      updateQuota: vi.fn(async () => account),
      refreshSubscriptionState: vi.fn(async () => undefined),
      updateResetCreditsSnapshot: vi.fn(async () => undefined)
    };
    refreshQuotaMock
      .mockResolvedValueOnce({
        error: { message: "API returned 401 - unauthorized", timestamp: Math.floor(Date.now() / 1000) }
      })
      .mockResolvedValueOnce({ quota: undefined, error: undefined });

    await refreshSingleQuota(repo as unknown as AccountsRepository, { refresh: vi.fn() }, account.id, {
      allowTokenRefresh: false,
      announce: false,
      forceRefresh: true,
      refreshView: false,
      warnQuota: false
    });

    expect(syncActiveAccountFromAuthFile).toHaveBeenCalledTimes(1);
    expect(refreshQuotaMock).toHaveBeenCalledTimes(2);
    expect(refreshQuotaMock).toHaveBeenLastCalledWith(account, refreshedTokens, true, { allowTokenRefresh: false });
  });

  it("fetches reset credits expiry from the updated quota snapshot", async () => {
    const updatedAccount: CodexAccountRecord = {
      ...account,
      accountId: "acct-1",
      quotaSummary: {
        hourlyPercentage: 82,
        hourlyWindowPresent: true,
        weeklyPercentage: 97,
        weeklyWindowPresent: true,
        resetCreditsAvailable: 1
      }
    };
    const repo: QuotaRefreshRepo = {
      getAccount: vi.fn(async () => account),
      getTokens: vi.fn(async () => tokens),
      updateQuota: vi.fn(async () => updatedAccount),
      refreshSubscriptionState: vi.fn(async () => undefined),
      updateResetCreditsSnapshot: vi.fn(async () => undefined)
    };
    const view = { refresh: vi.fn() };

    refreshQuotaMock.mockResolvedValue({
      quota: updatedAccount.quotaSummary,
      error: undefined,
      updatedTokens: tokens
    });
    fetchResetCreditsMock.mockResolvedValue({
      availableCount: 1,
      credits: [],
      nextExpiresAt: 1_800_000_000
    });

    await refreshSingleQuota(repo as AccountsRepository, view, account.id, {
      announce: false,
      refreshView: false,
      warnQuota: false,
      forceRefresh: true
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchResetCreditsMock).toHaveBeenCalledWith(tokens.accessToken, "acct-1");
    expect(repo.updateResetCreditsSnapshot).toHaveBeenCalledWith(account.id, 1, 1_800_000_000);
    expect(view.refresh).toHaveBeenCalled();
  });

  it("still refreshes reset credits when the updated quota count is zero", async () => {
    const updatedAccount: CodexAccountRecord = {
      ...account,
      accountId: "acct-2",
      quotaSummary: {
        hourlyPercentage: 70,
        hourlyWindowPresent: true,
        weeklyPercentage: 95,
        weeklyWindowPresent: true,
        resetCreditsAvailable: 0,
        resetCreditsNextExpiresAt: 1_700_000_000
      }
    };
    const repo: QuotaRefreshRepo = {
      getAccount: vi.fn(async () => account),
      getTokens: vi.fn(async () => tokens),
      updateQuota: vi.fn(async () => updatedAccount),
      refreshSubscriptionState: vi.fn(async () => undefined),
      updateResetCreditsSnapshot: vi.fn(async () => undefined)
    };

    refreshQuotaMock.mockResolvedValue({
      quota: updatedAccount.quotaSummary,
      error: undefined,
      updatedTokens: tokens
    });
    fetchResetCreditsMock.mockResolvedValue({
      availableCount: 0,
      credits: [],
      nextExpiresAt: undefined
    });

    await refreshSingleQuota(repo as AccountsRepository, { refresh: vi.fn() }, account.id, {
      announce: false,
      refreshView: false,
      warnQuota: false,
      forceRefresh: true
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchResetCreditsMock).toHaveBeenCalledWith(tokens.accessToken, "acct-2");
    expect(repo.updateResetCreditsSnapshot).toHaveBeenCalledWith(account.id, 0, undefined);
  });

  it("auto-switches to the candidate with the highest 5-hour quota before weekly quota", async () => {
    vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
      get: vi.fn((key: string, defaultValue?: unknown) => {
        const values: Record<string, unknown> = {
          autoSwitchEnabled: true,
          autoSwitchHourlyThreshold: 20,
          autoSwitchWeeklyThreshold: 20
        };
        return values[key] ?? defaultValue;
      }),
      update: vi.fn()
    } as never);

    const active: CodexAccountRecord = {
      id: "active",
      email: "dev@example.com",
      isActive: true,
      createdAt: 1,
      updatedAt: 1,
      quotaSummary: createQuotaSummary({ hourly: 90, weekly: 5 })
    };
    const sameEmailButLowerQuota: CodexAccountRecord = {
      id: "same-email-lower-quota",
      email: "dev@example.com",
      accountStructure: "organization",
      isActive: false,
      createdAt: 1,
      updatedAt: 1,
      quotaSummary: createQuotaSummary({ hourly: 100, weekly: 30 })
    };
    const bestQuota: CodexAccountRecord = {
      id: "best-quota",
      email: "other@example.com",
      accountStructure: "personal",
      isActive: false,
      createdAt: 1,
      updatedAt: 1,
      quotaSummary: createQuotaSummary({ hourly: 80, weekly: 85 })
    };
    const repo = {
      listAccounts: vi.fn(async () => [active, sameEmailButLowerQuota, bestQuota]),
      switchAccount: vi.fn(async () => undefined)
    };
    const view = {
      refresh: vi.fn(),
      markObservedAuthIdentity: vi.fn()
    };

    setCurrentWindowRuntimeAccountId(bestQuota.id);

    const switched = await maybeAutoSwitchForActiveQuota(repo as unknown as AccountsRepository, view);

    expect(switched).toBe(true);
    expect(repo.switchAccount).toHaveBeenCalledWith(sameEmailButLowerQuota.id);
    expect(repo.switchAccount).not.toHaveBeenCalledWith(bestQuota.id);
  });

  it("uses weekly quota to break a tie in 5-hour quota", async () => {
    vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
      get: vi.fn((key: string, defaultValue?: unknown) => {
        const values: Record<string, unknown> = {
          autoSwitchEnabled: true,
          autoSwitchHourlyThreshold: 20,
          autoSwitchWeeklyThreshold: 20
        };
        return values[key] ?? defaultValue;
      }),
      update: vi.fn()
    } as never);

    const active = createAccount("active", true, 90, 5);
    const lowerWeekly = createAccount("lower-weekly", false, 90, 55);
    const higherWeekly = createAccount("higher-weekly", false, 90, 85);
    const repo = {
      listAccounts: vi.fn(async () => [active, lowerWeekly, higherWeekly]),
      switchAccount: vi.fn(async () => undefined)
    };

    setCurrentWindowRuntimeAccountId(higherWeekly.id);
    const switched = await maybeAutoSwitchForActiveQuota(repo as unknown as AccountsRepository, { refresh: vi.fn() });

    expect(switched).toBe(true);
    expect(repo.switchAccount).toHaveBeenCalledWith(higherWeekly.id);
  });

  it("uses weekly quota before expiry when 5-hour quota is tied", async () => {
    vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
      get: vi.fn((key: string, defaultValue?: unknown) => {
        const values: Record<string, unknown> = {
          autoSwitchEnabled: true,
          autoSwitchHourlyThreshold: 20,
          autoSwitchWeeklyThreshold: 20
        };
        return values[key] ?? defaultValue;
      }),
      update: vi.fn()
    } as never);

    const active = createAccount("active", true, 90, 5);
    const laterHighWeekly = createAccount("later-high-weekly", false, 90, 95);
    laterHighWeekly.subscriptionActiveUntil = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const soonerLowWeekly = createAccount("sooner-low-weekly", false, 90, 30);
    soonerLowWeekly.subscriptionActiveUntil = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const repo = {
      listAccounts: vi.fn(async () => [active, laterHighWeekly, soonerLowWeekly]),
      switchAccount: vi.fn(async () => undefined)
    };

    setCurrentWindowRuntimeAccountId(soonerLowWeekly.id);
    const switched = await maybeAutoSwitchForActiveQuota(repo as unknown as AccountsRepository, { refresh: vi.fn() });

    expect(switched).toBe(true);
    expect(repo.switchAccount).toHaveBeenCalledWith(laterHighWeekly.id);
  });

  it("uses monthly quota before expiry for plans without 5-hour or weekly windows", async () => {
    vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
      get: vi.fn((key: string, defaultValue?: unknown) => {
        const values: Record<string, unknown> = {
          autoSwitchEnabled: true,
          autoSwitchHourlyThreshold: 20,
          autoSwitchWeeklyThreshold: 20
        };
        return values[key] ?? defaultValue;
      }),
      update: vi.fn()
    } as never);

    const active = createAccount("active", true, 90, 5);
    const lowerMonthly = createAccount("lower-monthly", false, 0, 40);
    lowerMonthly.planType = "free";
    lowerMonthly.quotaSummary!.hourlyWindowPresent = false;
    lowerMonthly.quotaSummary!.weeklyWindowMinutes = 43_200;
    lowerMonthly.subscriptionActiveUntil = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const higherMonthly = createAccount("higher-monthly", false, 0, 80);
    higherMonthly.planType = "free";
    higherMonthly.quotaSummary!.hourlyWindowPresent = false;
    higherMonthly.quotaSummary!.weeklyWindowMinutes = 43_200;
    higherMonthly.subscriptionActiveUntil = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const repo = {
      listAccounts: vi.fn(async () => [active, lowerMonthly, higherMonthly]),
      switchAccount: vi.fn(async () => undefined)
    };

    setCurrentWindowRuntimeAccountId(higherMonthly.id);
    const switched = await maybeAutoSwitchForActiveQuota(repo as unknown as AccountsRepository, { refresh: vi.fn() });

    expect(switched).toBe(true);
    expect(repo.switchAccount).toHaveBeenCalledWith(higherMonthly.id);
  });

  it("does not auto-switch for an hourly-only threshold when hourly quota control is disabled", async () => {
    vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
      get: vi.fn((key: string, defaultValue?: unknown) => {
        const values: Record<string, unknown> = {
          autoSwitchEnabled: true,
          hourlyQuotaControlEnabled: false,
          autoSwitchHourlyThreshold: 20,
          autoSwitchWeeklyThreshold: 20
        };
        return values[key] ?? defaultValue;
      }),
      update: vi.fn()
    } as never);

    const active = createAccount("active", true, 0, 80);
    const candidate = createAccount("candidate", false, 100, 100);
    const repo = {
      listAccounts: vi.fn(async () => [active, candidate]),
      switchAccount: vi.fn(async () => undefined)
    };

    const switched = await maybeAutoSwitchForActiveQuota(repo as unknown as AccountsRepository, { refresh: vi.fn() });

    expect(switched).toBe(false);
    expect(repo.switchAccount).not.toHaveBeenCalled();
  });

  it("auto-switches for a valid hourly threshold when hourly quota control is enabled", async () => {
    vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
      get: vi.fn((key: string, defaultValue?: unknown) => {
        const values: Record<string, unknown> = {
          autoSwitchEnabled: true,
          hourlyQuotaControlEnabled: true,
          autoSwitchHourlyThreshold: 20,
          autoSwitchWeeklyThreshold: 20
        };
        return values[key] ?? defaultValue;
      }),
      update: vi.fn()
    } as never);

    const active = createAccount("active", true, 0, 80);
    const candidate = createAccount("candidate", false, 100, 100);
    const repo = {
      listAccounts: vi.fn(async () => [active, candidate]),
      switchAccount: vi.fn(async () => undefined)
    };

    const switched = await maybeAutoSwitchForActiveQuota(repo as unknown as AccountsRepository, { refresh: vi.fn() });

    expect(switched).toBe(true);
    expect(repo.switchAccount).toHaveBeenCalledWith(candidate.id);
  });

  it("prefers a starred candidate before comparing quota balances", async () => {
    vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
      get: vi.fn((key: string, defaultValue?: unknown) => {
        const values: Record<string, unknown> = {
          autoSwitchEnabled: true,
          hourlyQuotaControlEnabled: true,
          autoSwitchHourlyThreshold: 20,
          autoSwitchWeeklyThreshold: 20
        };
        return values[key] ?? defaultValue;
      }),
      update: vi.fn()
    } as never);

    const active = createAccount("active", true, 0, 80);
    const normal = createAccount("normal", false, 100, 100);
    const starred = createAccount("starred", false, 80, 85);
    starred.queuePriority = true;
    const repo = {
      listAccounts: vi.fn(async () => [active, normal, starred]),
      switchAccount: vi.fn(async () => undefined)
    };

    const switched = await maybeAutoSwitchForActiveQuota(repo as unknown as AccountsRepository, { refresh: vi.fn() });

    expect(switched).toBe(true);
    expect(repo.switchAccount).toHaveBeenCalledWith(starred.id);
  });

  it("excludes claim-disabled accounts from automatic switching", async () => {
    vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
      get: vi.fn((key: string, defaultValue?: unknown) => {
        const values: Record<string, unknown> = {
          autoSwitchEnabled: true,
          hourlyQuotaControlEnabled: true,
          autoSwitchHourlyThreshold: 20,
          autoSwitchWeeklyThreshold: 20
        };
        return values[key] ?? defaultValue;
      }),
      update: vi.fn()
    } as never);

    const active = createAccount("active", true, 0, 80);
    const disabledCandidate = createAccount("disabled-candidate", false, 100, 100);
    disabledCandidate.enabled = false;
    const repo = {
      listAccounts: vi.fn(async () => [active, disabledCandidate]),
      switchAccount: vi.fn(async () => disabledCandidate)
    };

    const switched = await maybeAutoSwitchForActiveQuota(repo as unknown as AccountsRepository, { refresh: vi.fn() });

    expect(switched).toBe(false);
    expect(repo.switchAccount).not.toHaveBeenCalled();
  });

  it("auto reloads the window after auto switch when the setting is enabled", async () => {
    vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
      get: vi.fn((key: string, defaultValue?: unknown) => {
        const values: Record<string, unknown> = {
          autoSwitchEnabled: true,
          autoSwitchReloadWindowEnabled: true,
          autoSwitchHourlyThreshold: 20,
          autoSwitchWeeklyThreshold: 20
        };
        return values[key] ?? defaultValue;
      }),
      update: vi.fn()
    } as never);

    const active: CodexAccountRecord = {
      id: "active",
      email: "dev@example.com",
      isActive: true,
      createdAt: 1,
      updatedAt: 1,
      quotaSummary: createQuotaSummary({ hourly: 90, weekly: 5 })
    };
    const next: CodexAccountRecord = {
      id: "next-account",
      email: "next@example.com",
      isActive: false,
      createdAt: 1,
      updatedAt: 1,
      quotaSummary: createQuotaSummary({ hourly: 80, weekly: 85 })
    };
    const repo = {
      listAccounts: vi.fn(async () => [active, next]),
      switchAccount: vi.fn(async () => undefined)
    };
    const view = {
      refresh: vi.fn(),
      markObservedAuthIdentity: vi.fn()
    };

    setCurrentWindowRuntimeAccountId("other-window-account");
    autoReloadWindowForAccountMock.mockResolvedValue(true);

    const switched = await maybeAutoSwitchForActiveQuota(repo as unknown as AccountsRepository, view);

    expect(switched).toBe(true);
    expect(handleCodexAppRestartPreferenceMock).toHaveBeenCalledWith({ allowManualPrompt: false });
    expect(autoReloadWindowForAccountMock).toHaveBeenCalledWith(next.id);
    expect(consumeAutoSwitchNotice()).toBe("Switched to next@example.com and reloaded.");
    expect(getAutoSwitchRuntimeSnapshot().dashboardNotice?.message).toBe("Switched to next@example.com and reloaded.");
  });

  it("shows a notification when auto switch succeeds without requiring a reload", async () => {
    vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
      get: vi.fn((key: string, defaultValue?: unknown) => {
        const values: Record<string, unknown> = {
          autoSwitchEnabled: true,
          autoSwitchHourlyThreshold: 20,
          autoSwitchWeeklyThreshold: 20
        };
        return values[key] ?? defaultValue;
      }),
      update: vi.fn()
    } as never);
    const active = createAccount("active", true, 90, 5);
    const next = createAccount("next", false, 90, 90);
    const repo = {
      listAccounts: vi.fn(async () => [active, next]),
      switchAccount: vi.fn(async () => undefined)
    };
    setCurrentWindowRuntimeAccountId(next.id);

    await expect(
      maybeAutoSwitchForActiveQuota(repo as unknown as AccountsRepository, { refresh: vi.fn() })
    ).resolves.toBe(true);

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith("Switched to next@example.com.");
    expect(getAutoSwitchRuntimeSnapshot().dashboardNotice).toMatchObject({
      level: "info",
      message: "Switched to next@example.com."
    });
  });

  it("shows a warning when the threshold is crossed but no safe candidate exists", async () => {
    vi.mocked(vscode.window.showWarningMessage).mockClear();
    vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
      get: vi.fn((key: string, defaultValue?: unknown) => {
        const values: Record<string, unknown> = {
          autoSwitchEnabled: true,
          autoSwitchHourlyThreshold: 20,
          autoSwitchWeeklyThreshold: 20
        };
        return values[key] ?? defaultValue;
      }),
      update: vi.fn()
    } as never);
    const active = createAccount("active-no-candidate", true, 90, 5);
    const repo = {
      listAccounts: vi.fn(async () => [active]),
      switchAccount: vi.fn(async () => undefined)
    };

    await expect(
      maybeAutoSwitchForActiveQuota(repo as unknown as AccountsRepository, { refresh: vi.fn() })
    ).resolves.toBe(false);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      "No account switched — no enabled account has enough quota."
    );
  });

  it("surfaces automatic switch failures instead of only logging them", async () => {
    vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
      get: vi.fn((key: string, defaultValue?: unknown) => {
        const values: Record<string, unknown> = {
          autoSwitchEnabled: true,
          autoSwitchHourlyThreshold: 20,
          autoSwitchWeeklyThreshold: 20
        };
        return values[key] ?? defaultValue;
      }),
      update: vi.fn()
    } as never);
    const active = createAccount("active-failure", true, 90, 5);
    const next = createAccount("next-failure", false, 90, 90);
    const repo = {
      listAccounts: vi.fn(async () => [active, next]),
      switchAccount: vi.fn(async () => {
        throw new Error("lease conflict");
      })
    };

    await expect(
      maybeAutoSwitchForActiveQuota(repo as unknown as AccountsRepository, { refresh: vi.fn() })
    ).resolves.toBe(false);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "Auto switch failed: lease conflict. Check the account and retry."
    );
    expect(getAutoSwitchRuntimeSnapshot().dashboardNotice).toMatchObject({
      level: "error",
      message: "Auto switch failed: lease conflict. Check the account and retry."
    });
  });

  it("coalesces concurrent auto-switch checks to prevent duplicate switches and reloads", async () => {
    vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
      get: vi.fn((key: string, defaultValue?: unknown) => {
        const values: Record<string, unknown> = {
          autoSwitchEnabled: true,
          autoSwitchReloadWindowEnabled: true,
          autoSwitchHourlyThreshold: 20,
          autoSwitchWeeklyThreshold: 20
        };
        return values[key] ?? defaultValue;
      }),
      update: vi.fn()
    } as never);
    const active = createAccount("active", true, 90, 5);
    const next = createAccount("next", false, 90, 90);
    let releaseSwitch!: () => void;
    const switchGate = new Promise<void>((resolve) => {
      releaseSwitch = resolve;
    });
    const repo = {
      listAccounts: vi.fn(async () => [active, next]),
      switchAccount: vi.fn(async () => switchGate)
    };
    setCurrentWindowRuntimeAccountId("different-runtime-account");
    autoReloadWindowForAccountMock.mockResolvedValue(true);

    const first = maybeAutoSwitchForActiveQuota(repo as unknown as AccountsRepository, { refresh: vi.fn() });
    const second = maybeAutoSwitchForActiveQuota(repo as unknown as AccountsRepository, { refresh: vi.fn() });
    await vi.waitFor(() => expect(repo.switchAccount).toHaveBeenCalledTimes(1));
    releaseSwitch();

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(repo.switchAccount).toHaveBeenCalledTimes(1);
    expect(autoReloadWindowForAccountMock).toHaveBeenCalledTimes(1);
  });
});

describe("quota warning window validation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("ignores the hourly quota while control is disabled and still warns for weekly quota", async () => {
    vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
      get: vi.fn((key: string, defaultValue?: unknown) => {
        const values: Record<string, unknown> = {
          quotaWarningEnabled: true,
          hourlyQuotaControlEnabled: false,
          quotaWarningThreshold: 10
        };
        return values[key] ?? defaultValue;
      })
    } as never);
    const showWarning = vi.spyOn(vscode.window, "showWarningMessage").mockResolvedValue(undefined);
    showWarning.mockClear();
    const account = createAccount("active", true, 0, 5);
    const target = createAccount("recommended", false, 90, 85);
    const repo = {
      getAccount: vi.fn(async () => account),
      listAccounts: vi.fn(async () => [account, target])
    };

    await maybeWarnForAccount(repo as unknown as AccountsRepository, account.id);

    expect(showWarning).toHaveBeenCalledTimes(1);
    expect(showWarning.mock.calls[0]?.[0]).toContain(
      "active@example.com Weekly quota is at 5%, below your configured threshold of 10%."
    );
    expect(showWarning.mock.calls[0]?.[0]).not.toContain("Balance");
    expect(showWarning.mock.calls[0]?.slice(1)).toEqual([
      "Switch recommended@example.com",
      "Select Account",
      "Later"
    ]);
  });

  it("opens the account picker when Select Account is chosen", async () => {
    vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
      get: vi.fn((key: string, defaultValue?: unknown) => {
        const values: Record<string, unknown> = {
          quotaWarningEnabled: true,
          hourlyQuotaControlEnabled: false,
          quotaWarningThreshold: 10
        };
        return values[key] ?? defaultValue;
      })
    } as never);
    vi.spyOn(vscode.window, "showWarningMessage").mockResolvedValue("Select Account" as never);
    const executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined);
    const account = createAccount("select-account-action", true, 80, 5);
    const repo = {
      getAccount: vi.fn(async () => account),
      listAccounts: vi.fn(async () => [account])
    };

    await maybeWarnForAccount(repo as unknown as AccountsRepository, account.id);
    await vi.waitFor(() => expect(executeCommand).toHaveBeenCalledWith("codexAccounts.switchAccount"));
  });

  it("switches directly to the recommended account named by the Switch action", async () => {
    vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
      get: vi.fn((key: string, defaultValue?: unknown) => {
        const values: Record<string, unknown> = {
          quotaWarningEnabled: true,
          hourlyQuotaControlEnabled: false,
          quotaWarningThreshold: 10
        };
        return values[key] ?? defaultValue;
      })
    } as never);
    vi.spyOn(vscode.window, "showWarningMessage").mockResolvedValue("Switch recommended-action@example.com" as never);
    const executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined);
    const account = createAccount("auto-select-action", true, 80, 5);
    const target = createAccount("recommended-action", false, 95, 85);
    const repo = {
      getAccount: vi.fn(async () => account),
      listAccounts: vi.fn(async () => [account, target])
    };

    await maybeWarnForAccount(repo as unknown as AccountsRepository, account.id);
    await vi.waitFor(() => expect(executeCommand).toHaveBeenCalledWith("codexAccounts.switchAccount", target));
  });

  it("appends the weekly balance to a 5h warning without requiring reset credits", async () => {
    vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
      get: vi.fn((key: string, defaultValue?: unknown) => {
        const values: Record<string, unknown> = {
          quotaWarningEnabled: true,
          hourlyQuotaControlEnabled: true,
          quotaWarningThreshold: 10
        };
        return values[key] ?? defaultValue;
      })
    } as never);
    const showWarning = vi.spyOn(vscode.window, "showWarningMessage").mockResolvedValue(undefined);
    const account = createAccount("balance-warning", true, 7, 64);
    const repo = {
      getAccount: vi.fn(async () => account),
      listAccounts: vi.fn(async () => [account])
    };

    await maybeWarnForAccount(repo as unknown as AccountsRepository, account.id);

    expect(showWarning).toHaveBeenCalledWith(
      "balance-warning@example.com 5h quota is at 7%, below your configured threshold of 10%. Weekly 64% Balance.",
      "Select Account",
      "Later"
    );
  });

  it("shows weekly quota in a 5h warning with Reset and the recommended switch target", async () => {
    vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
      get: vi.fn((key: string, defaultValue?: unknown) => {
        const values: Record<string, unknown> = {
          quotaWarningEnabled: true,
          hourlyQuotaControlEnabled: true,
          quotaWarningThreshold: 10
        };
        return values[key] ?? defaultValue;
      })
    } as never);
    const showWarning = vi.spyOn(vscode.window, "showWarningMessage").mockResolvedValue(
      "Reset reset-action@example.com" as never
    );
    showWarning.mockClear();
    const executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined);
    const account = createAccount("reset-action", true, 6, 95);
    account.quotaSummary!.resetCreditsAvailable = 1;
    const target = createAccount("reset-target", false, 80, 90);
    const repo = {
      getAccount: vi.fn(async () => account),
      listAccounts: vi.fn(async () => [account, target])
    };

    await maybeWarnForAccount(repo as unknown as AccountsRepository, account.id);

    expect(showWarning.mock.calls[0]?.[0]).toBe(
      "reset-action@example.com 5h quota is at 6%, below your configured threshold of 10%. Weekly 95% Balance."
    );
    expect(showWarning.mock.calls[0]?.slice(1)).toEqual([
      "Switch reset-target@example.com",
      "Reset reset-action@example.com",
      "Select Account",
      "Later"
    ]);
    await vi.waitFor(() =>
      expect(executeCommand).toHaveBeenCalledWith("codexAccounts.consumeResetCredit", account)
    );
  });

  it("does not warn for missing hourly and weekly windows", async () => {
    vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
      get: vi.fn((key: string, defaultValue?: unknown) => {
        const values: Record<string, unknown> = {
          quotaWarningEnabled: true,
          hourlyQuotaControlEnabled: true,
          quotaWarningThreshold: 10
        };
        return values[key] ?? defaultValue;
      })
    } as never);
    const showWarning = vi.spyOn(vscode.window, "showWarningMessage").mockResolvedValue(undefined);
    showWarning.mockClear();
    const account = createAccount("missing-windows", true, 0, 0);
    if (account.quotaSummary) {
      account.quotaSummary.hourlyWindowPresent = false;
      account.quotaSummary.weeklyWindowPresent = false;
    }
    const repo = {
      getAccount: vi.fn(async () => account),
      listAccounts: vi.fn(async () => [account])
    };

    await maybeWarnForAccount(repo as unknown as AccountsRepository, account.id);

    expect(showWarning).not.toHaveBeenCalled();
  });
});

function createAccount(id: string, isActive: boolean, hourly: number, weekly: number): CodexAccountRecord {
  return {
    id,
    email: `${id}@example.com`,
    isActive,
    createdAt: 1,
    updatedAt: 1,
    quotaSummary: createQuotaSummary({ hourly, weekly })
  };
}

function createQuotaSummary(values: { hourly: number; weekly: number }) {
  return {
    hourlyPercentage: values.hourly,
    hourlyWindowMinutes: 300,
    hourlyWindowPresent: true,
    weeklyPercentage: values.weekly,
    weeklyWindowMinutes: 10_080,
    weeklyWindowPresent: true,
    codeReviewPercentage: 0
  };
}
