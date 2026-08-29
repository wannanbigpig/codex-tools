import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { parseSubmittedTags } from "../webview-src/dashboard/browserActionModal";

describe("port dashboard action modals", () => {
  it("normalizes tag input collected in the browser", () => {
    expect(parseSubmittedTags("team, paid, team,  review ")).toEqual(["team", "paid", "review"]);
  });

  it("guards browser-only interception without replacing VS Code webview actions", () => {
    const source = readFileSync("webview-src/dashboard/main.tsx", "utf8");
    expect(source).toContain('isBrowserDashboard && action === "remove"');
    expect(source).toMatch(/if \(isBrowserDashboard\) \{\s+openBrowserSwitchPicker\(\);/);
    expect(source).toMatch(/else \{\s+sendAction\("switch"\);/);
    expect(source).toContain("handleConfigureEncryptedSync");
    expect(source).toContain('kind: "passphrase"');
    expect(source).toContain("<BrowserActionModal");
  });
});
