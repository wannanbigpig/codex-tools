import { describe, expect, it } from "vitest";
import { resolveBrandSubtitle } from "../webview-src/dashboard/helpers";

describe("dashboard brand subtitle", () => {
  it("keeps the marked dashboard description when sync data is unavailable", () => {
    expect(resolveBrandSubtitle("marked", true, undefined, 1, 1, 1, () => "date")).toBe("marked");
    expect(resolveBrandSubtitle("marked", false, 123, 1, 1, 1, () => "date")).toBe("marked");
  });

  it("always shows the synced summary when completed sync data exists", () => {
    expect(resolveBrandSubtitle("marked", true, 123, 2, 3, 4, () => "date")).toBe(
      "Synced date · 2 enabled / 3 sessions"
    );
  });

  it("falls back to account count when the sync session count is omitted", () => {
    expect(resolveBrandSubtitle("marked", true, 123, undefined, undefined, 4, () => "date")).toBe(
      "Synced date · 0 enabled / 4 sessions"
    );
  });
});
