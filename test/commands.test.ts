import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { runRegisteredCommand } from "../src/commands";
import { CrossWindowOperationBusyError } from "../src/utils/crossWindowOperations";
import { withDashboardNotificationSuppression } from "../src/utils/notificationPolicy";

describe("runRegisteredCommand", () => {
  it("surfaces failures and preserves rejection for dashboard callers", async () => {
    const error = new Error("network unavailable");
    await expect(runRegisteredCommand("Refresh quota", async () => Promise.reject(error))).rejects.toBe(error);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("Refresh quota failed: network unavailable");
  });

  it("surfaces cancellation without converting it into success", async () => {
    await expect(
      runRegisteredCommand("Add account", async () => Promise.reject(new Error("OAuth cancelled")))
    ).rejects.toThrow("OAuth cancelled");
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith("Add account cancelled.");
  });

  it("surfaces a cross-window duplicate as a warning", async () => {
    const error = new CrossWindowOperationBusyError("Refresh quota");
    await expect(runRegisteredCommand("Refresh quota", async () => Promise.reject(error))).rejects.toBe(error);
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      "Refresh quota is already running in another VS Code window. Wait for it to finish, then try again."
    );
  });

  it("does not duplicate a dashboard failure as a VS Code notification", async () => {
    const error = new Error("dashboard request failed");
    await expect(
      withDashboardNotificationSuppression(() =>
        runRegisteredCommand("Refresh quota", async () => Promise.reject(error))
      )
    ).rejects.toBe(error);
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalledWith("Refresh quota failed: dashboard request failed");
  });
});
