import { describe, expect, it } from "vitest";
import { resolveDashboardTheme } from "../webview-src/dashboard/theme";

function classList(...classes: string[]) {
  return {
    contains: (value: string) => classes.includes(value)
  };
}

describe("resolveDashboardTheme", () => {
  it("uses explicit theme preferences first", () => {
    expect(resolveDashboardTheme("light", classList("vscode-dark"), false)).toBe("light");
    expect(resolveDashboardTheme("dark", classList("vscode-light"), true)).toBe("dark");
  });

  it("follows VS Code body classes before the system fallback", () => {
    expect(resolveDashboardTheme("auto", classList("vscode-dark"), true)).toBe("dark");
    expect(resolveDashboardTheme("auto", classList("vscode-light"), false)).toBe("light");
    expect(resolveDashboardTheme("auto", classList("vscode-high-contrast"), true)).toBe("dark");
  });

  it("falls back to system media only when VS Code classes are unavailable", () => {
    expect(resolveDashboardTheme("auto", classList(), true)).toBe("light");
    expect(resolveDashboardTheme("auto", classList(), false)).toBe("dark");
  });
});
