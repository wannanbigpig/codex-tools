import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { resolveCreateOAuthLinkLabel } from "../webview-src/dashboard/accountModals";

describe("add account OAuth actions", () => {
  it("shows Create Link before the authorization actions are available", () => {
    expect(resolveCreateOAuthLinkLabel("en")).toBe("Create Link");

    const source = readFileSync("webview-src/dashboard/accountModals.tsx", "utf8");
    expect(source).not.toContain("Generate on click");
    expect(source).not.toContain("oauth-link-status");
    expect(source).toMatch(/oauthLinkReady \? \([\s\S]*oauth-copy-btn[\s\S]*oauth-open-btn[\s\S]*\) : \([\s\S]*oauth-create-link-btn/);
  });

  it("uses an in-dashboard account info modal for the browser host", () => {
    const source = readFileSync("webview-src/dashboard/main.tsx", "utf8");
    const modal = readFileSync("webview-src/dashboard/accountModals.tsx", "utf8");
    expect(source).toContain('action === "details" && isBrowserDashboard && accountId');
    expect(source).toContain("<AccountInfoModal");
    expect(modal).toContain('className="dashboard-modal-compact account-info-modal"');
  });
});
