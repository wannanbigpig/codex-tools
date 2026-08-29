import { describe, expect, it } from "vitest";
import { buildUsageEvents, resolveUsageGraphBucketCount } from "../webview-src/dashboard/overviewSection";

describe("quota usage graph", () => {
  it("distributes a quota change observed after five minutes across those minutes", () => {
    const start = 1_800_000_000_000;
    const events = buildUsageEvents([
      { at: start, accountId: "account-1", hourly: 60, weekly: 80 },
      { at: start + 5 * 60_000, accountId: "account-1", hourly: 55, weekly: 80 }
    ]);

    expect(events).toHaveLength(5);
    expect(events.map((event) => event.at)).toEqual([
      start + 60_000,
      start + 2 * 60_000,
      start + 3 * 60_000,
      start + 4 * 60_000,
      start + 5 * 60_000
    ]);
    expect(events.map((event) => event.used)).toEqual([1, 1, 1, 1, 1]);
  });

  it("keeps unusually stale observations at their detection time", () => {
    const start = 1_800_000_000_000;
    const events = buildUsageEvents([
      { at: start, accountId: "account-1", hourly: 60 },
      { at: start + 61 * 60_000, accountId: "account-1", hourly: 50 }
    ]);

    expect(events).toEqual([{ at: start + 61 * 60_000, accountId: "account-1", used: 10 }]);
  });

  it("uses one bucket per minute in the one-hour view", () => {
    expect(resolveUsageGraphBucketCount("1h")).toBe(60);
  });
});
