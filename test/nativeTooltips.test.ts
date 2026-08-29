import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

const nativeTitleSources = [
  "media/webview/details.css",
  "media/webview/quotaSummary.css",
  "src/ui/details.ts",
  "webview-src/dashboard/main.tsx",
  "webview-src/dashboard/overviewSection.tsx",
  "webview-src/dashboard/primitives.tsx",
  "webview-src/dashboard/savedAccountCard.tsx"
];

describe("native UI tooltips", () => {
  it("does not reintroduce custom tooltip markup or styling", () => {
    const source = nativeTitleSources.map((file) => readFileSync(file, "utf8")).join("\n");

    expect(source).not.toMatch(/button-tip|saved-control-tip|saved-detail-tooltip|data-tip/);
    expect(readFileSync("webview-src/dashboard/overviewSection.tsx", "utf8")).toContain("usage-graph-tooltip");
  });

  it("uses title attributes for shared action buttons and detail usage bars", () => {
    const actionButton = readFileSync("webview-src/dashboard/primitives.tsx", "utf8");
    const details = readFileSync("src/ui/details.ts", "utf8");

    expect(actionButton).toContain("title={accessibleLabel}");
    expect(details).toContain('title="${usageTitle}"');
  });
});
