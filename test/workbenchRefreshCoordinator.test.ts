import * as vscode from "vscode";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkbenchRefreshCoordinator } from "../src/presentation/workbench/refreshCoordinator";
import {
  autoReloadWindowForAccount,
  promptWindowReloadForAccount
} from "../src/application/accounts/switchEffects";
import { readCurrentAuthAccountStorageId } from "../src/utils/accountIdentity";
import { setCurrentWindowRuntimeAccountId } from "../src/presentation/workbench/windowRuntimeAccount";

vi.mock("../src/application/accounts/switchEffects", () => ({
  autoReloadWindowForAccount: vi.fn(),
  promptWindowReloadForAccount: vi.fn()
}));

vi.mock("../src/utils/accountIdentity", () => ({
  readCurrentAuthAccountStorageId: vi.fn()
}));

vi.mock("../src/commands", () => ({
  refreshImportedAccountQuota: vi.fn()
}));

vi.mock("../src/presentation/dashboard", () => ({
  refreshQuotaSummaryPanel: vi.fn()
}));

vi.mock("../src/ui", () => ({
  AccountsStatusBarProvider: class {},
  refreshDetailsPanel: vi.fn()
}));

type ExternalChangeSync = {
  syncActiveAccountFromExternalChange: (
    view: { refresh: () => void; markObservedAuthIdentity: (accountId?: string) => void },
    markVisible: () => void,
    markHidden: () => void,
    isVisible: () => boolean
  ) => Promise<void>;
};

describe("workbench external account synchronization", () => {
  beforeEach(() => {
    vi.mocked(autoReloadWindowForAccount).mockReset();
    vi.mocked(promptWindowReloadForAccount).mockReset();
    vi.mocked(readCurrentAuthAccountStorageId).mockReset();
    vi.mocked(vscode.window.showInformationMessage).mockReset();
    setCurrentWindowRuntimeAccountId("old-account");
  });

  it("reloads a window changed by another window without showing a notification", async () => {
    vi.mocked(readCurrentAuthAccountStorageId).mockResolvedValue("new-account");
    vi.mocked(autoReloadWindowForAccount).mockResolvedValue(true);

    const accounts = [
      { id: "old-account", email: "old@example.com", isActive: false, createdAt: 1, updatedAt: 1 },
      { id: "new-account", email: "new@example.com", isActive: true, createdAt: 1, updatedAt: 2 }
    ];
    const repo = {
      syncActiveAccountFromAuthFile: vi.fn(async () => undefined),
      listAccounts: vi.fn(async () => accounts)
    };
    const coordinator = new WorkbenchRefreshCoordinator(
      {} as vscode.ExtensionContext,
      repo as never,
      {} as never
    ) as unknown as ExternalChangeSync & { lastObservedAuthIdentity?: string };
    coordinator.lastObservedAuthIdentity = "old-account";

    const view = { refresh: vi.fn(), markObservedAuthIdentity: vi.fn() };
    const markVisible = vi.fn();
    const markHidden = vi.fn();
    await coordinator.syncActiveAccountFromExternalChange(view, markVisible, markHidden, () => false);

    expect(repo.syncActiveAccountFromAuthFile).toHaveBeenCalledTimes(1);
    expect(view.refresh).toHaveBeenCalledTimes(1);
    expect(autoReloadWindowForAccount).toHaveBeenCalledWith("new-account");
    expect(markVisible).toHaveBeenCalledTimes(1);
    expect(markHidden).toHaveBeenCalledTimes(1);
    expect(promptWindowReloadForAccount).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it("shows a recoverable error when the automatic reload fails", async () => {
    vi.mocked(readCurrentAuthAccountStorageId).mockResolvedValue("new-account");
    vi.mocked(autoReloadWindowForAccount).mockRejectedValue(new Error("restart unavailable"));

    const repo = {
      syncActiveAccountFromAuthFile: vi.fn(async () => undefined),
      listAccounts: vi.fn(async () => [
        { id: "old-account", email: "old@example.com", isActive: false, createdAt: 1, updatedAt: 1 },
        { id: "new-account", email: "new@example.com", isActive: true, createdAt: 1, updatedAt: 2 }
      ])
    };
    const coordinator = new WorkbenchRefreshCoordinator(
      {} as vscode.ExtensionContext,
      repo as never,
      {} as never
    ) as unknown as ExternalChangeSync & { lastObservedAuthIdentity?: string };
    coordinator.lastObservedAuthIdentity = "old-account";

    await coordinator.syncActiveAccountFromExternalChange(
      { refresh: vi.fn(), markObservedAuthIdentity: vi.fn() },
      vi.fn(),
      vi.fn(),
      () => false
    );

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("restart unavailable"));
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });
});
