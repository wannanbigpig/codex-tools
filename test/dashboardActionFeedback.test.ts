import { describe, expect, it } from "vitest";
import { noticeFromActionResult, noticeFromActionTimeout } from "../webview-src/dashboard/actionFeedback";

describe("dashboard action feedback", () => {
  it("surfaces the host error from every failed action result", () => {
    expect(
      noticeFromActionResult({
        type: "dashboard:action-result",
        requestId: "request-1",
        action: "syncNow",
        status: "failed",
        error: "VS Code Settings Sync is unavailable."
      })
    ).toEqual({
      level: "error",
      message: "VS Code Settings Sync is unavailable."
    });
  });

  it("provides fallback feedback when a failed result has no message", () => {
    expect(
      noticeFromActionResult({
        type: "dashboard:action-result",
        requestId: "request-2",
        action: "refreshAll",
        status: "failed"
      })?.message
    ).toMatch(/refresh all action failed/i);
  });

  it("turns a client-side action timeout into an actionable warning", () => {
    expect(noticeFromActionTimeout("configureEncryptedSync")).toEqual({
      level: "warning",
      message: "Configure encrypted sync did not finish in time. Check VS Code notifications, then try again."
    });
  });

  it("does not show failure feedback for completed actions", () => {
    expect(
      noticeFromActionResult({
        type: "dashboard:action-result",
        requestId: "request-3",
        action: "refreshView",
        status: "completed"
      })
    ).toBeUndefined();
  });

  it("shows an explicit terminal notice returned by a completed action", () => {
    expect(
      noticeFromActionResult({
        type: "dashboard:action-result",
        requestId: "request-notice",
        action: "refreshView",
        status: "completed",
        payload: {
          notice: { level: "info", message: "Registry refreshed." }
        }
      })
    ).toEqual({ level: "info", message: "Registry refreshed." });
  });

  it("surfaces partial batch failures even when the action completed", () => {
    expect(
      noticeFromActionResult({
        type: "dashboard:action-result",
        requestId: "request-4",
        action: "batchRefresh",
        status: "completed",
        payload: {
          batchResult: {
            kind: "batch_refresh",
            successCount: 2,
            failedCount: 1,
            failures: [{ message: "Session expired." }]
          }
        }
      })
    ).toEqual({
      level: "warning",
      message: "Batch refresh finished with 2 succeeded and 1 failed. First error: Session expired."
    });
  });
});
