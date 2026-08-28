import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import {
  resolveOverviewRefreshMode,
  resolveOverviewPopoverPosition,
  resolveOverviewToolbarActionCount,
  resolveOverviewToolbarLabel,
  resolveResetQuotaNoticeTitle
} from "../webview-src/dashboard/overviewSection";

describe("overview actions", () => {
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

  it("keeps all four account actions in one icon-only row on mobile", () => {
    const css = readFileSync("media/webview/quotaSummary.css", "utf8");

    expect(css).toMatch(
      /\.overview-bottom-row \.overview-actions:not\(\.overview-empty-actions\) \.toolbar \{\r?\n\s+grid-template-columns: repeat\(4, minmax\(0, 1fr\)\) !important;/
    );
    expect(css).toMatch(
      /\.overview-bottom-row \.overview-actions:not\(\.overview-empty-actions\) \.toolbar-btn \.button-label \{\r?\n\s+display: none;/
    );
  });

  it("includes the weekly remaining percentage in the reset warning", () => {
    expect(resolveResetQuotaNoticeTitle("en", "18%")).toBe("Weekly quota remaining: 18% · reset available");
    expect(resolveResetQuotaNoticeTitle("zh", "18%")).toContain("18%");
  });
});
