import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { AccountsCommandService } from "../src/application/accounts/commandService";
import type { CodexAccountRecord } from "../src/core/types";
import type { AccountsRepository } from "../src/storage";
import { setCurrentWindowRuntimeAccountId } from "../src/presentation/workbench/windowRuntimeAccount";

describe("manual account switch command", () => {
  beforeEach(() => {
    vi.mocked(vscode.window.showQuickPick).mockReset();
    vi.mocked(vscode.window.showInformationMessage).mockReset();
    setCurrentWindowRuntimeAccountId(undefined);
  });

  it("reports picker cancellation as a terminal user-visible outcome", async () => {
    const account = createAccount();
    const service = createService([account]);
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined);

    await expect(service.switchAccount()).resolves.toEqual({ status: "cancelled" });

    expect(vscode.window.showQuickPick).toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith("Switch account cancelled.");
  });

  it("returns the selected account and reports success when no reload is needed", async () => {
    const account = createAccount();
    const { service, repo } = createServiceWithRepo([account]);
    setCurrentWindowRuntimeAccountId(account.id);
    vi.mocked(vscode.window.showQuickPick).mockImplementation(async (items) => (items as never[])[0] as never);

    await expect(service.switchAccount()).resolves.toMatchObject({
      status: "switched",
      account: { id: account.id, email: account.email },
      reloadNeeded: false,
      reloaded: false
    });

    expect(repo.switchAccount).toHaveBeenCalledWith(account.id, { forceTokenRefresh: false });
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(`Switched to ${account.email}.`);
  });
});

function createService(accounts: CodexAccountRecord[]): AccountsCommandService {
  return createServiceWithRepo(accounts).service;
}

function createServiceWithRepo(accounts: CodexAccountRecord[]) {
  const repo = {
    listAccounts: vi.fn().mockResolvedValue(accounts),
    switchAccount: vi.fn().mockResolvedValue(accounts[0])
  } as unknown as AccountsRepository & { switchAccount: ReturnType<typeof vi.fn> };
  const service = new AccountsCommandService(
    {} as vscode.ExtensionContext,
    repo,
    { refresh: vi.fn(), markObservedAuthIdentity: vi.fn() }
  );
  return { service, repo };
}

function createAccount(): CodexAccountRecord {
  return {
    id: "account-next",
    email: "next@example.com",
    isActive: false,
    enabled: true,
    tokenRefreshEnabled: false,
    createdAt: "2026-08-28T00:00:00.000Z",
    updatedAt: "2026-08-28T00:00:00.000Z"
  } as CodexAccountRecord;
}
