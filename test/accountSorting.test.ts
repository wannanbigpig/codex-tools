import { describe, expect, it } from "vitest";
import {
  compareDashboardAutoQueueAccounts,
  hasDashboardAutoQueueCapability,
  sortWithQueuedAccount
} from "../webview-src/dashboard/accountSorting";

describe("sortWithQueuedAccount", () => {
  it("keeps a queued switch immediately after the active account", () => {
    const accounts = [
      { id: "healthy", isActive: false, switchQueued: false },
      { id: "queued", isActive: false, switchQueued: true },
      { id: "active", isActive: true, switchQueued: false }
    ] as any;

    const sorted = sortWithQueuedAccount(accounts, (left, right) => left.id.localeCompare(right.id));

    expect(sorted.map((account) => account.id)).toEqual(["active", "queued", "healthy"]);
  });
});

describe("compareDashboardAutoQueueAccounts", () => {
  it("keeps dashboard ordering aligned with quota reset and credit ordering", () => {
    const base = {
      isActive: false,
      switchQueued: false,
      creditsUnlimited: false,
      subscriptionExpiresAt: 1_000,
      lastQuotaAt: 1
    };
    const lowerCredits = {
      ...base,
      id: "lower-credits",
      creditsBalance: 5,
      metrics: [
        { key: "hourly", period: "hourly", percentage: 80, resetAt: 100, visible: true },
        { key: "weekly", period: "weekly", percentage: 90, resetAt: 200, visible: true }
      ]
    } as any;
    const higherCredits = {
      ...base,
      id: "higher-credits",
      creditsBalance: 20,
      metrics: lowerCredits.metrics
    } as any;

    expect([lowerCredits, higherCredits].sort(compareDashboardAutoQueueAccounts).map((item) => item.id)).toEqual([
      "higher-credits",
      "lower-credits"
    ]);
  });

  it("does not treat a zero-quota, zero-credit account as capable", () => {
    const account = {
      creditsBalance: 0,
      creditsUnlimited: false,
      metrics: [{ key: "hourly", period: "hourly", percentage: 0, visible: true }]
    } as any;

    expect(hasDashboardAutoQueueCapability(account)).toBe(false);
  });
});
