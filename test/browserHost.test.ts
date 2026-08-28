import { readFileSync } from "fs";
import { runInNewContext } from "vm";
import { describe, expect, it, vi } from "vitest";

describe("browser dashboard bridge", () => {
  it("resolves a failed remote action immediately instead of leaving the modal waiting", async () => {
    const events: unknown[] = [];
    const windowMock = {
      dispatchEvent: vi.fn((event: { data: unknown }) => events.push(event.data)),
      setInterval: vi.fn(),
      location: { reload: vi.fn() },
      acquireVsCodeApi: undefined as
        | undefined
        | (() => { postMessage(message: unknown): Promise<void> })
    };
    class TestMessageEvent {
      constructor(
        _type: string,
        public readonly init: { data: unknown }
      ) {}

      get data(): unknown {
        return this.init.data;
      }
    }
    const code = readFileSync("media/webview/browserHost.js", "utf8");
    runInNewContext(code, {
      window: windowMock,
      MessageEvent: TestMessageEvent,
      fetch: vi.fn(async () => ({ status: 502, ok: false })),
      console: { error: vi.fn() },
      Error,
      Array,
      JSON
    });

    await windowMock.acquireVsCodeApi?.().postMessage({
      type: "dashboard:action",
      requestId: "remote-oauth-1",
      action: "prepareOAuthSession"
    });

    expect(events).toContainEqual({
      type: "dashboard:action-result",
      requestId: "remote-oauth-1",
      action: "prepareOAuthSession",
      accountId: undefined,
      status: "failed",
      error: "Dashboard action failed (502)"
    });
    expect(events).toContainEqual({
      type: "dashboard:notice",
      level: "error",
      message: "Dashboard action failed (502)"
    });
  });
});
