import { describe, expect, it } from "vitest";
import { getActionTimeoutMs } from "../webview-src/dashboard/host";

describe("dashboard action timeouts", () => {
  it("allows quota refreshes enough time for quota and subscription requests", () => {
    expect(getActionTimeoutMs("refresh")).toBe(120_000);
    expect(getActionTimeoutMs("refreshToken")).toBe(120_000);
  });
});
