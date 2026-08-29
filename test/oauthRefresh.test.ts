import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn()
}));

vi.mock("undici", () => ({
  fetch: fetchMock
}));

import { refreshTokens } from "../src/auth/oauth";
import { APIError } from "../src/core/errors";

function tokenResponse(payload: Record<string, unknown>, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload)
  } as Response;
}

describe("OAuth token refresh reliability", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("shares concurrent refreshes for the same rotating refresh token", async () => {
    fetchMock.mockResolvedValue(
      tokenResponse({
        access_token: "access-2",
        id_token: "id-2",
        refresh_token: "refresh-2"
      })
    );

    const [first, second] = await Promise.all([refreshTokens("refresh-1", "id-1"), refreshTokens("refresh-1", "id-1")]);

    expect(first).toEqual(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry invalid refresh grants", async () => {
    fetchMock.mockResolvedValue(tokenResponse({ error: "invalid_grant" }, 400));

    await expect(refreshTokens("invalid-refresh", "id-1")).rejects.toThrow("Token refresh failed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("redacts credentials from provider error diagnostics", async () => {
    fetchMock.mockResolvedValue(
      tokenResponse({ error: "invalid_grant", access_token: "provider-secret-access", code: "secret-code" }, 400)
    );

    const error = await refreshTokens("invalid-refresh", "id-1").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(APIError);
    expect((error as APIError).message).not.toContain("provider-secret-access");
    expect((error as APIError).responseBody).not.toContain("provider-secret-access");
    expect((error as APIError).responseBody).not.toContain("secret-code");
  });
});
