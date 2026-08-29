import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardHostMessage } from "../src/domain/dashboard/types";

const { effectMock, postMessageToHostMock, sharedRef } = vi.hoisted(() => ({
  effectMock: vi.fn(),
  postMessageToHostMock: vi.fn(),
  sharedRef: { current: undefined as unknown }
}));

vi.mock("preact/hooks", () => ({
  useEffect: effectMock,
  useRef: vi.fn((value: unknown) => {
    if (sharedRef.current === undefined) sharedRef.current = value;
    return sharedRef;
  })
}));

vi.mock("../webview-src/dashboard/host", () => ({
  postMessageToHost: postMessageToHostMock
}));

import { useDashboardHostSync } from "../webview-src/dashboard/hostSyncHook";

describe("useDashboardHostSync", () => {
  beforeEach(() => {
    effectMock.mockReset();
    postMessageToHostMock.mockReset();
    sharedRef.current = undefined;
  });

  it("attaches once and routes delayed tunnel responses to the latest render callbacks", () => {
    const listeners = new Map<string, (event: Event & { data?: DashboardHostMessage }) => void>();
    const fakeWindow = {
      addEventListener: vi.fn((type: string, listener: (event: Event & { data?: DashboardHostMessage }) => void) => {
        listeners.set(type, listener);
      }),
      removeEventListener: vi.fn()
    };
    vi.stubGlobal("window", fakeWindow);
    const firstHandler = vi.fn();
    const latestHandler = vi.fn();
    let setup: (() => () => void) | undefined;
    effectMock.mockImplementationOnce((callback: () => () => void, dependencies: unknown[]) => {
      setup = callback;
      expect(dependencies).toEqual([]);
    });

    useDashboardHostSync({ handleHostMessage: firstHandler, handleEscape: () => true });
    const dispose = setup?.();
    useDashboardHostSync({ handleHostMessage: latestHandler, handleEscape: () => true });

    const message = { type: "dashboard:notice", level: "warning", message: "remote result" } as const;
    listeners.get("message")?.({ data: message } as MessageEvent<DashboardHostMessage>);

    expect(firstHandler).not.toHaveBeenCalled();
    expect(latestHandler).toHaveBeenCalledWith(message);
    expect(postMessageToHostMock).toHaveBeenCalledTimes(1);
    expect(postMessageToHostMock).toHaveBeenCalledWith({ type: "dashboard:ready" });
    dispose?.();
    expect(fakeWindow.removeEventListener).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
});
