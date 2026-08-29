import { describe, expect, it } from "vitest";
import type { DashboardAccountViewModel } from "../src/domain/dashboard/types";
import { resolveOverviewAccount } from "../webview-src/dashboard/helpers";
import { reduceOAuthActionResult, reduceSharedImportActionResult } from "../webview-src/dashboard/sessionModalState";

describe("reduceOAuthActionResult", () => {
  it("stores prepared oauth sessions and resets on completion", () => {
    const prepared = reduceOAuthActionResult(
      {
        oauthFlowStarted: false,
        oauthCallbackUrl: "",
        oauthError: "old"
      },
      {
        type: "dashboard:action-result",
        requestId: "1",
        action: "prepareOAuthSession",
        status: "completed",
        payload: {
          oauthSession: {
            sessionId: "oauth-1",
            authUrl: "https://example.com",
            redirectUri: "vscode://callback"
          }
        }
      }
    );

    expect(prepared.handled).toBe(true);
    expect(prepared.next.oauthSession?.sessionId).toBe("oauth-1");
    expect(prepared.next.oauthError).toBeUndefined();

    const completed = reduceOAuthActionResult(prepared.next, {
      type: "dashboard:action-result",
      requestId: "2",
      action: "completeOAuthSession",
      status: "completed"
    });

    expect(completed.handled).toBe(true);
    expect(completed.shouldCloseModal).toBe(true);
    expect(completed.next.oauthSession).toBeUndefined();
    expect(completed.next.oauthCallbackUrl).toBe("");
  });
});

describe("reduceSharedImportActionResult", () => {
  it("tracks preview, failures and final import results", () => {
    const previewed = reduceSharedImportActionResult(
      {},
      {
        type: "dashboard:action-result",
        requestId: "1",
        action: "previewImportSharedJson",
        status: "completed",
        payload: {
          importPreview: {
            total: 2,
            valid: 1,
            overwriteCount: 0,
            invalidCount: 1,
            invalidEntries: [{ index: 1, message: "bad json" }]
          }
        }
      }
    );

    expect(previewed.handled).toBe(true);
    expect(previewed.next.importPreview?.valid).toBe(1);

    const failed = reduceSharedImportActionResult(previewed.next, {
      type: "dashboard:action-result",
      requestId: "2",
      action: "importSharedJson",
      status: "failed",
      error: "invalid"
    });
    expect(failed.next.importJsonError).toBe("invalid");

    const imported = reduceSharedImportActionResult(failed.next, {
      type: "dashboard:action-result",
      requestId: "3",
      action: "importSharedJson",
      status: "completed",
      payload: {
        importResult: {
          total: 1,
          successCount: 1,
          overwriteCount: 0,
          failedCount: 0,
          importedEmails: ["dev@example.com"],
          failures: []
        }
      }
    });

    expect(imported.next.importJsonError).toBeUndefined();
    expect(imported.next.importResult?.successCount).toBe(1);
  });
});

describe("resolveOverviewAccount", () => {
  const account = (
    id: string,
    flags: Pick<DashboardAccountViewModel, "isActive" | "isCurrentWindowAccount">
  ): DashboardAccountViewModel => ({ id, ...flags }) as DashboardAccountViewModel;

  it("uses the current window account when no active account is marked", () => {
    const current = account("current", { isActive: false, isCurrentWindowAccount: true });
    const other = account("other", { isActive: false, isCurrentWindowAccount: false });

    expect(resolveOverviewAccount([other, current])?.id).toBe("current");
  });

  it("prefers the active account over the current window account", () => {
    const active = account("active", { isActive: true, isCurrentWindowAccount: false });
    const current = account("current", { isActive: false, isCurrentWindowAccount: true });

    expect(resolveOverviewAccount([current, active])?.id).toBe("active");
  });

  it("prefers the queued switch target so the overview can offer reload", () => {
    const active = account("active", { isActive: true, isCurrentWindowAccount: true });
    const queued = {
      ...account("queued", { isActive: false, isCurrentWindowAccount: false }),
      switchQueued: true
    };

    expect(resolveOverviewAccount([active, queued])?.id).toBe("queued");
  });
});
