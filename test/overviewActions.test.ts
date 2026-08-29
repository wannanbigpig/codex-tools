import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import {
  resolveOverviewContextAction,
  resolveOverviewRefreshMode,
  resolveOverviewPopoverPosition,
  resolveOverviewToolbarActionCount,
  resolveOverviewToolbarLabel,
  resolveResetCreditBadgeLabel
} from "../webview-src/dashboard/overviewSection";

describe("overview actions", () => {
  it("opens a picker from Switch and exposes Reload for a queued target", () => {
    const overview = readFileSync("webview-src/dashboard/overviewSection.tsx", "utf8");
    const main = readFileSync("webview-src/dashboard/main.tsx", "utf8");

    expect(overview).toContain("props.onSwitchAccount();");
    expect(overview).not.toContain("props.onSwitchAccount(switchTarget.id)");
    expect(main).toContain('sendAction("switch");');
    expect(main).toContain("openBrowserSwitchPicker()");
    expect(
      resolveOverviewContextAction(
        {
          isActive: false,
          isCurrentWindowAccount: false,
          switchQueued: true,
          runningDeviceName: undefined,
          runningOnThisDevice: undefined
        },
        false
      )
    ).toBe("reload");
  });

  it("uses quota refresh before encrypted sync is enabled", () => {
    expect(resolveOverviewRefreshMode(false)).toBe("quota");
  });

  it("uses sync after passphrase setup enables encrypted sync", () => {
    expect(resolveOverviewRefreshMode(true)).toBe("sync");
  });

  it("keeps toolbar labels compact", () => {
    expect(["add", "import", "sync", "setup", "refresh", "lock", "disableRescue"].map((action) =>
      resolveOverviewToolbarLabel(
        action as "add" | "import" | "sync" | "setup" | "refresh" | "lock" | "disableRescue",
        "en"
      )
    )).toEqual(["Add", "Import", "Sync", "Set Up", "Refresh", "Lock", "Rescue"]);
  });

  it("distributes the full toolbar across every visible action", () => {
    expect(resolveOverviewToolbarActionCount(true, true, false)).toBe(4);
    expect(resolveOverviewToolbarActionCount(true, true, true)).toBe(4);
    expect(resolveOverviewToolbarActionCount(true, false, true)).toBe(4);
    expect(resolveOverviewToolbarActionCount(false, false, true)).toBe(2);
  });

  it("positions the More menu in the viewport-level layer below its trigger", () => {
    expect(resolveOverviewPopoverPosition({ bottom: 80, right: 334 }, 357)).toEqual({ top: 85, right: 23 });
    expect(resolveOverviewPopoverPosition({ bottom: 80, right: 355 }, 357)).toEqual({ top: 85, right: 8 });

    const source = readFileSync("webview-src/dashboard/overviewSection.tsx", "utf8");
    expect(source).toContain('class="claim-popover claim-popover-portal overview-more-menu"');
    expect(source).toContain("morePopoverContentRef.current?.contains(target)");
    expect(source).toMatch(/overview-more-menu[\s\S]*document\.body/);
  });

  it("keeps Lock and Unlock available in the More menu alongside CLI Sessions", () => {
    const source = readFileSync("webview-src/dashboard/overviewSection.tsx", "utf8");

    expect(source).toContain('resolveOverviewMenuLabel(account.autoSwitchLockedUntil ? "unlock" : "lock"');
    expect(source).toContain("openLockDialog(event.currentTarget)");
    expect(source).toContain("props.onSetAutoSwitchLock(0)");
    expect(source).toContain("props.onOpenCliSessions!");
  });

  it("keeps all four account actions in one icon-only row on mobile", () => {
    const css = readFileSync("media/webview/quotaSummary.css", "utf8");

    expect(css).toMatch(
      /\.overview-bottom-row \.overview-actions:not\(\.overview-empty-actions\) \.toolbar \{\r?\n\s+grid-template-columns: repeat\(4, minmax\(0, 1fr\)\) !important;/
    );
    expect(css).toMatch(
      /\.overview-bottom-row \.overview-actions:not\(\.overview-empty-actions\) \.toolbar-btn \.button-label \{\r?\n\s+display: none;/
    );
  });

  it("keeps account badges on one horizontal row and lets search fill the toolbar", () => {
    const css = readFileSync("media/webview/quotaSummary.css", "utf8");

    expect(css).toMatch(/\.account-count-badges \{[\s\S]*?flex-wrap: nowrap;/);
    expect(css).toMatch(/\.dashboard-account-toolbar \.account-search-control \{[\s\S]*?flex: 1 1 140px;/);
    expect(css).toMatch(/\.dashboard-account-toolbar \.dashboard-view-controls \{[\s\S]*?margin-left: 0;/);
  });

  it("keeps reset availability in the compact badge instead of a second quota block", () => {
    const source = readFileSync("webview-src/dashboard/overviewSection.tsx", "utf8");
    const css = readFileSync("media/webview/quotaSummary.css", "utf8");

    expect(source).toContain('class="overview-reset-credit"');
    expect(resolveResetCreditBadgeLabel("en")).toBe("Reset");
    expect(source).toContain("resolveResetCreditBadgeLabel(props.lang)");
    expect(source).not.toContain("overview-quota-notice");
    expect(source).not.toContain("Weekly quota remaining");
    expect(source).not.toContain("Auto-switch is enabled");
    expect(css).not.toContain(".overview-quota-notice");
  });

  it("renders every visible metric and uses an in-app graph tooltip", () => {
    const overview = readFileSync("webview-src/dashboard/overviewSection.tsx", "utf8");
    const state = readFileSync("webview-src/dashboard/main.tsx", "utf8");
    expect(overview).toContain('typeof metric.percentage === "number"');
    expect(overview).toContain("usage-graph-tooltip");
    expect(overview).toContain("onMouseEnter");
    expect(overview).toContain("usage-graph-settings-popover");
    expect(overview).toContain('onLoadDailyUsage');
    expect(overview).toContain('graphMode === "tokens"');
    expect(state).toContain("availableMetrics");
    expect(state).toContain('"login-date"');
    expect(state).toContain('"account-type"');
  });
});
