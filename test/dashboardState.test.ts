import { describe, expect, it } from "vitest";
import {
  buildMetrics,
  resolveDashboardQueuedSwitch,
  sortDashboardAccounts
} from "../src/application/dashboard/buildDashboardState";
import { formatPlanType, getDashboardCopy } from "../src/application/dashboard/copy";

describe("sortDashboardAccounts", () => {
  it("puts the current window account before active accounts", () => {
    const accounts = [
      { id: "active", isActive: true, createdAt: 3, email: "active@example.com" },
      { id: "current", isActive: false, createdAt: 2, email: "current@example.com" },
      { id: "other", isActive: false, createdAt: 1, email: "other@example.com" }
    ];

    const sorted = sortDashboardAccounts(accounts, "current");

    expect(sorted.map((account) => account.id)).toEqual(["current", "active", "other"]);
  });
});

describe("resolveDashboardQueuedSwitch", () => {
  it("ignores a queue without a known previous window account", () => {
    expect(
      resolveDashboardQueuedSwitch(
        [{ id: "selected" }],
        { toAccountId: "selected", queuedAt: 1 }
      )
    ).toBeUndefined();
  });

  it("keeps a queue only when both the previous and selected accounts exist", () => {
    const queuedSwitch = { fromAccountId: "previous", toAccountId: "selected", queuedAt: 1 };

    expect(resolveDashboardQueuedSwitch([{ id: "previous" }, { id: "selected" }], queuedSwitch)).toBe(
      queuedSwitch
    );
    expect(resolveDashboardQueuedSwitch([{ id: "selected" }], queuedSwitch)).toBeUndefined();
  });
});

describe("formatPlanType", () => {
  it("normalizes raw ChatGPT plan identifiers", () => {
    expect(formatPlanType("chatgptteamplan", "zh")).toBe("Team");
    expect(formatPlanType("chatgptplusplan", "zh")).toBe("Plus");
  });
});

describe("buildMetrics", () => {
  it("labels a Free 30-day quota as monthly", () => {
    const metrics = buildMetrics(
      {
        id: "free-account",
        email: "free@example.com",
        isActive: true,
        planType: "chatgptfreeplan",
        createdAt: 1,
        updatedAt: 1,
        quotaSummary: {
          hourlyPercentage: 0,
          weeklyPercentage: 1,
          weeklyWindowMinutes: 43_200,
          weeklyWindowPresent: true
        }
      },
      getDashboardCopy("zh"),
      "zh"
    );

    expect(metrics).toHaveLength(1);
    expect(metrics[0]?.label).toBe("每月");
  });
});
