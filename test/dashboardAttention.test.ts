import { describe, expect, it } from "vitest";
import { isAccountAttention } from "../webview-src/dashboard/helpers";
import type { DashboardAccountViewModel } from "../src/domain/dashboard/types";

describe("dashboard attention state", () => {
  it.each(["reauthorize", "refresh_failed", "disabled", "quota"] as const)(
    "treats %s as invalid attention",
    (healthKind) => {
      expect(isAccountAttention(account(healthKind))).toBe(true);
    }
  );

  it("does not put a merely expiring account in the invalid attention list", () => {
    expect(isAccountAttention(account("expiring"))).toBe(false);
  });

  it("does not put a dismissed issue in the invalid attention list", () => {
    expect(isAccountAttention(account("quota", true))).toBe(false);
  });
});

function account(
  healthKind: DashboardAccountViewModel["healthKind"],
  dismissedHealth = false
): DashboardAccountViewModel {
  return { healthKind, dismissedHealth } as DashboardAccountViewModel;
}
