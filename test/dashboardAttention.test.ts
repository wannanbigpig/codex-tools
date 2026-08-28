import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { countAccountEnablement, isAccountAttention } from "../webview-src/dashboard/helpers";
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

  it("counts enabled and disabled accounts for the Saved Accounts header", () => {
    expect(
      countAccountEnablement([
        { enabled: true } as DashboardAccountViewModel,
        { enabled: true } as DashboardAccountViewModel,
        { enabled: false } as DashboardAccountViewModel
      ])
    ).toEqual({ enabled: 2, disabled: 1 });

    const source = readFileSync("webview-src/dashboard/main.tsx", "utf8");
    expect(source).toContain('filter: "enabled"');
    expect(source).toContain('filter: "disabled"');
    expect(source).toContain('resolveUiText("enabled", snapshot.lang)');
    expect(source).toContain('resolveUiText("disabled", snapshot.lang)');
  });
});

function account(
  healthKind: DashboardAccountViewModel["healthKind"],
  dismissedHealth = false
): DashboardAccountViewModel {
  return { healthKind, dismissedHealth } as DashboardAccountViewModel;
}
