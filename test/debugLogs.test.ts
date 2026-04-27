import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { logNetworkEvent } from "../src/utils/debug";

describe("network debug logs", () => {
  it("prints the full sanitized response body instead of truncating it", () => {
    const appendLine = vi.fn();
    vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
      get: vi.fn((key: string, defaultValue?: unknown) => (key === "debugNetwork" ? true : defaultValue)),
      update: vi.fn()
    } as never);
    (vscode.window as unknown as { createOutputChannel: unknown }).createOutputChannel = vi.fn(() => ({
      appendLine,
      dispose: vi.fn()
    }));

    logNetworkEvent("quota", {
      status: 200,
      bodyPreview: JSON.stringify({
        email: "dev@example.com",
        longField: "x".repeat(1500),
        tail: "visible-after-long-body"
      })
    });

    const output = appendLine.mock.calls[0]?.[0] as string;
    expect(output).toContain("visible-after-long-body");
    expect(output).toContain("[redacted-email]");
    expect(output).not.toContain("dev@example.com");
  });
});
