import * as vscode from "vscode";
import { beforeEach, describe, expect, it, vi } from "vitest";

const oauthMocks = vi.hoisted(() => ({
  complete: vi.fn(),
  prepare: vi.fn()
}));
const quotaMocks = vi.hoisted(() => ({ refresh: vi.fn() }));
const activationMocks = vi.hoisted(() => ({ activate: vi.fn() }));

vi.mock("../src/auth/oauth", () => ({
  completeOAuthLoginSession: oauthMocks.complete,
  prepareOAuthLoginSession: oauthMocks.prepare,
  runPreparedOAuthLoginSession: vi.fn()
}));
vi.mock("../src/application/accounts/quota", () => ({
  refreshImportedAccountQuota: quotaMocks.refresh
}));
vi.mock("../src/application/accounts/queuedAccountActivation", () => ({
  activateQueuedAccountIfCurrentMissing: activationMocks.activate
}));

import { DashboardOAuthCoordinator } from "../src/presentation/dashboard/oauthCoordinator";

describe("dashboard OAuth encrypted sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    oauthMocks.prepare.mockReturnValue({
      authUrl: "https://auth.example.test",
      redirectUri: "http://localhost/callback",
      state: "state",
      verifier: "verifier"
    });
    oauthMocks.complete.mockResolvedValue({
      idToken: "id-token",
      accessToken: "access-token",
      refreshToken: "refresh-token"
    });
    quotaMocks.refresh.mockResolvedValue({});
    activationMocks.activate.mockResolvedValue({ status: "not-needed" });
  });

  it("uses the newly visible account as OAuth success feedback", async () => {
    const repo = {
      upsertFromTokens: vi.fn().mockResolvedValue({ id: "one", email: "one@example.com" })
    };
    const syncAccountChange = vi.fn().mockResolvedValue(true);
    const coordinator = new DashboardOAuthCoordinator(repo as never, vi.fn(), syncAccountChange);
    const prepared = coordinator.prepareSession((key) => key);

    const result = await coordinator.completeSession(
      prepared?.oauthSession?.sessionId,
      "http://localhost/callback?code=ok",
      (key) => key
    );

    expect(syncAccountChange).toHaveBeenCalledOnce();
    expect(syncAccountChange.mock.invocationCallOrder[0]).toBeGreaterThan(
      quotaMocks.refresh.mock.invocationCallOrder[0] ?? 0
    );
    expect(result?.email).toBe("one@example.com");
    expect(result?.notice).toBeUndefined();
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it("returns a warning to the browser dashboard when credential sync needs retry", async () => {
    const repo = {
      upsertFromTokens: vi.fn().mockResolvedValue({ id: "one", email: "one@example.com" })
    };
    const coordinator = new DashboardOAuthCoordinator(repo as never, vi.fn(), vi.fn().mockResolvedValue(false));
    const prepared = coordinator.prepareSession((key) => key);

    const result = await coordinator.completeSession(
      prepared?.oauthSession?.sessionId,
      "http://localhost/callback?code=ok",
      (key) => key
    );

    expect(result?.notice?.level).toBe("warning");
    expect(result?.notice?.message).toMatch(/run Sync Now/i);
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(expect.stringMatching(/run Sync Now/i));
  });
});
