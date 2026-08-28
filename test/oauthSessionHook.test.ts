import { afterEach, describe, expect, it, vi } from "vitest";
import { openOAuthAuthorizationWindow } from "../webview-src/dashboard/oauthSessionHook";

describe("browser dashboard OAuth authorization", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("opens the authorization URL in the remote client browser", () => {
    const open = vi.fn(() => ({}));
    vi.stubGlobal("window", { open });

    expect(openOAuthAuthorizationWindow("https://auth.example.test/authorize")).toBe(true);
    expect(open).toHaveBeenCalledWith(
      "https://auth.example.test/authorize",
      "_blank",
      "noopener,noreferrer"
    );
  });

  it("reports a blocked authorization window", () => {
    vi.stubGlobal("window", { open: vi.fn(() => null) });
    expect(openOAuthAuthorizationWindow("https://auth.example.test/authorize")).toBe(false);
  });
});
