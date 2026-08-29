import { describe, expect, it } from "vitest";
import {
  formatAccountUsageDuration,
  getCurrentSessionUsageMs,
  getTotalAccountUsageMs
} from "../src/utils/accountUsage";

describe("account usage duration", () => {
  it("shows the active session followed by account-specific total usage", () => {
    const account = {
      isActive: true,
      sessionStartedAt: 1_000,
      totalUsageMs: 103 * 60_000
    };
    const now = 20 * 60_000 + 1_000;

    expect(getCurrentSessionUsageMs(account, now)).toBe(20 * 60_000);
    expect(getTotalAccountUsageMs(account, now)).toBe(123 * 60_000);
    expect(formatAccountUsageDuration(account, now)).toBe("20m / 2h 3m");
  });

  it("does not count a stored session start while the account is inactive", () => {
    const account = {
      isActive: false,
      sessionStartedAt: 1_000,
      totalUsageMs: 90 * 60_000
    };

    expect(formatAccountUsageDuration(account, 20 * 60_000)).toBe("0m / 1h 30m");
  });
});
