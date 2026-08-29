import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import {
  resolveCardHealthReason,
  resolveCompactIdentityBadge,
  resolvePrimaryAccountControl,
  shouldOpenClaimPopover
} from "../webview-src/dashboard/savedAccountCard";

describe("saved account card presentation", () => {
  it("replaces the enablement toggle with reauthorization in both account layouts", () => {
    expect(resolvePrimaryAccountControl({ healthKind: "reauthorize", dismissedHealth: false })).toBe("reauthorize");
    expect(resolvePrimaryAccountControl({ healthKind: "reauthorize", dismissedHealth: true })).toBe("reauthorize");
    expect(resolvePrimaryAccountControl({ healthKind: "healthy", dismissedHealth: false })).toBe("enablement");
  });

  it("uses the remote-PC badge first in table rows and omits the redundant plan badge", () => {
    expect(resolveCompactIdentityBadge("Plus", "With Office PC")).toEqual({
      kind: "running-device",
      label: "With Office PC"
    });
    expect(resolveCompactIdentityBadge("Plus")).toEqual({ kind: "plan", label: "Plus" });
  });

  it("keeps raw provider errors out of the card health reason", () => {
    expect(
      resolveCardHealthReason({
        healthKind: "reauthorize",
        healthLabel: "Needs Reauth",
        healthMessage: 'API returned 401 - {"error":"Your authentication token has expired"}'
      })
    ).toBe("Needs Reauth");
  });

  it("only opens the foreign-claim dialog while rescue is locked", () => {
    expect(shouldOpenClaimPopover(true, false)).toBe(true);
    expect(shouldOpenClaimPopover(true, true)).toBe(false);
    expect(shouldOpenClaimPopover(false, false)).toBe(false);

    const source = readFileSync("webview-src/dashboard/savedAccountCard.tsx", "utf8");
    expect(source).not.toContain("Rescue override is active");
  });

  it("opens account details in the details pane instead of flipping the card", () => {
    const source = readFileSync("webview-src/dashboard/savedAccountCard.tsx", "utf8");
    expect(source).toContain('onAction("details", account.id, { privacyMode: props.privacyMode })');
  });
});
