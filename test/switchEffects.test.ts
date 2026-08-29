import * as vscode from "vscode";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  autoReloadWindowForAccount,
  promptWindowReloadForAccount
} from "../src/application/accounts/switchEffects";
import { setCurrentWindowRuntimeAccountId } from "../src/presentation/workbench/windowRuntimeAccount";

describe("account switch reload effects", () => {
  beforeEach(() => {
    vi.mocked(vscode.commands.executeCommand).mockReset();
    vi.mocked(vscode.window.showInformationMessage).mockReset();
    setCurrentWindowRuntimeAccountId("current-account");
  });

  it("restarts the extension host without reloading the full window when possible", async () => {
    vi.mocked(vscode.commands.executeCommand).mockResolvedValue(undefined);

    await expect(autoReloadWindowForAccount("next-account")).resolves.toBe(true);

    expect(vscode.commands.executeCommand).toHaveBeenNthCalledWith(1, "codexAccounts.prepareDashboardForExtensionHostRestart");
    expect(vscode.commands.executeCommand).toHaveBeenNthCalledWith(2, "codexAccounts.captureCodexSessions");
    expect(vscode.commands.executeCommand).toHaveBeenNthCalledWith(3, "workbench.action.restartExtensionHost");
    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith("workbench.action.reloadWindow");
  });

  it("falls back to a full window reload when the extension host restart fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue("Reload Now" as never);
    vi.mocked(vscode.commands.executeCommand).mockImplementation(async (command: string) => {
      if (command === "workbench.action.restartExtensionHost") {
        throw new Error("Command unavailable");
      }
      return undefined;
    });

    await expect(
      promptWindowReloadForAccount({ id: "next-account", email: "next@example.com" })
    ).resolves.toBe(true);

    expect(vscode.commands.executeCommand).toHaveBeenNthCalledWith(1, "codexAccounts.prepareDashboardForExtensionHostRestart");
    expect(vscode.commands.executeCommand).toHaveBeenNthCalledWith(2, "codexAccounts.captureCodexSessions");
    expect(vscode.commands.executeCommand).toHaveBeenNthCalledWith(3, "workbench.action.restartExtensionHost");
    expect(vscode.commands.executeCommand).toHaveBeenNthCalledWith(4, "workbench.action.reloadWindow");
  });
});
