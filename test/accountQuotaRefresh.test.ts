import { describe, expect, it, vi, beforeEach } from "vitest";
import type { CodexAccountRecord, CodexTokens } from "../src/core/types";
import type { AccountsRepository } from "../src/storage";

const { refreshQuotaMock, clearTokenAutomationErrorMock } = vi.hoisted(() => ({
  refreshQuotaMock: vi.fn(),
  clearTokenAutomationErrorMock: vi.fn()
}));

vi.mock("../src/services", () => ({
  refreshQuota: refreshQuotaMock
}));

vi.mock("../src/presentation/workbench/tokenAutomationState", () => ({
  clearTokenAutomationError: clearTokenAutomationErrorMock
}));

import { refreshSingleQuota } from "../src/application/accounts/quota";

type QuotaRefreshRepo = Pick<AccountsRepository, "getAccount" | "getTokens" | "updateQuota">;

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
    clearTokenAutomationErrorMock.mockReset();
  });

  it("clears automation auth error after a successful manual refresh", async () => {
    const repo: QuotaRefreshRepo = {
      getAccount: vi.fn(async () => account),
      getTokens: vi.fn(async () => tokens),
      updateQuota: vi.fn(async () => account)
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

    expect(clearTokenAutomationErrorMock).toHaveBeenCalledWith(account.id);
  });

  it("persists refreshed subscription metadata from quota refresh results", async () => {
    const repo: QuotaRefreshRepo = {
      getAccount: vi.fn(async () => account),
      getTokens: vi.fn(async () => tokens),
      updateQuota: vi.fn(async () => account)
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

    expect(repo.updateQuota).toHaveBeenCalledWith(
      account.id,
      undefined,
      undefined,
      tokens,
      "pro",
      "1800000000"
    );
  });

  it("keeps automation error when refresh still fails", async () => {
    const repo: QuotaRefreshRepo = {
      getAccount: vi.fn(async () => account),
      getTokens: vi.fn(async () => tokens),
      updateQuota: vi.fn(async () => account)
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
});
