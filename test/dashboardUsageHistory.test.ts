import { describe, expect, it, vi } from "vitest";
import {
  normalizeDashboardDailyUsageCache,
  readDashboardDailyUsageCache,
  upsertDashboardDailyUsageCache
} from "../src/services/dashboardUsageHistory";

describe("dashboard daily usage cache", () => {
  it("rejects malformed or oversized cached usage entries", () => {
    expect(
      normalizeDashboardDailyUsageCache([
        { accountId: "ok", fetchedAt: 100, usage: { days: 1, points: [{ date: "2026-08-28", totalTokens: 4 }] } },
        { accountId: "bad", fetchedAt: 100, usage: { days: 90, points: [] } },
        { accountId: "bad", fetchedAt: 100, usage: { days: 1, points: [{ date: "x", totalTokens: -1 }] } }
      ])
    ).toHaveLength(1);
  });

  it("upserts usage in the reconciled global persistent store", async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const context = {
      globalState: {
        get: vi.fn().mockReturnValue([]),
        update
      }
    } as never;
    const entries = await upsertDashboardDailyUsageCache(
      context,
      "account-1",
      { days: 7, points: [{ date: "2026-08-28", totalTokens: 42 }] },
      123
    );

    expect(entries[0]?.accountId).toBe("account-1");
    expect(update).toHaveBeenCalledWith("codexAccounts.dashboardDailyUsageCache.v1", entries);
    expect(readDashboardDailyUsageCache(context)).toEqual([]);
  });
});
