import { describe, expect, it } from "vitest";
import {
  resolveOverviewRefreshMode,
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

  it("includes the weekly remaining percentage in the reset warning", () => {
    expect(resolveResetQuotaNoticeTitle("en", "18%")).toBe("Weekly quota remaining: 18% · reset available");
    expect(resolveResetQuotaNoticeTitle("zh", "18%")).toContain("18%");
  });
});
