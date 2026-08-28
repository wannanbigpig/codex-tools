import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import type { DashboardActionContext } from "../src/presentation/dashboard/actionHandlers";

const { consumeResetCreditMock } = vi.hoisted(() => ({
  consumeResetCreditMock: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../src/services/quota", async () => {
  const actual = await vi.importActual<typeof import("../src/services/quota")>("../src/services/quota");
  return {
    ...actual,
    consumeResetCredit: consumeResetCreditMock
  };
});

import { executeDashboardActionMessage, isSafeExternalUrl } from "../src/presentation/dashboard/actionHandlers";
import {
  CrossWindowOperationBusyError,
  CrossWindowOperationCoordinator,
  configureCrossWindowOperationCoordinator
} from "../src/utils/crossWindowOperations";
import { removeTestDirectory } from "./testFilesystem";
import { setCurrentWindowRuntimeAccountId } from "../src/presentation/workbench/windowRuntimeAccount";

let operationDirectory: string;

beforeAll(async () => {
  operationDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "dashboard-actions-"));
  await configureCrossWindowOperationCoordinator(operationDirectory);
});

afterAll(async () => {
  await removeTestDirectory(operationDirectory);
});

describe("isSafeExternalUrl", () => {
  it("allows ordinary HTTP(S) URLs and rejects executable or credential-bearing schemes", () => {
    expect(isSafeExternalUrl("https://openai.com/research")).toBe(true);
    expect(isSafeExternalUrl("http://localhost:3000/help")).toBe(true);
    expect(isSafeExternalUrl("http://example.com/help")).toBe(false);
    expect(isSafeExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeExternalUrl("file:///tmp/auth.json")).toBe(false);
    expect(isSafeExternalUrl("https://user:password@example.com/private")).toBe(false);
  });
});

describe("executeDashboardActionMessage", () => {
  it("does not block a reload prompt when another window already has the same action in flight", async () => {
    const blocker = new CrossWindowOperationCoordinator(operationDirectory);
    let releaseBlocker!: () => void;
    let blockerStarted!: () => void;
    const blocked = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });
    const started = new Promise<void>((resolve) => {
      blockerStarted = resolve;
    });
    const heldAction = blocker.runExclusive("dashboard:reloadPrompt:account-1", "Reload prompt", async () => {
      blockerStarted();
      await blocked;
    });
    await started;

    setCurrentWindowRuntimeAccountId("account-before-reload");
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue("Later" as never);
    const account = { id: "account-1", email: "dev@example.com" };
    const context = {
      ...createContext(),
      repo: {
        getAccount: vi.fn().mockResolvedValue(account)
      } as unknown as DashboardActionContext["repo"]
    };

    const result = await executeDashboardActionMessage(context, {
      type: "dashboard:action",
      action: "reloadPrompt",
      requestId: "req-reload-unblocked",
      accountId: account.id
    });

    expect(result.status).toBe("completed");
    expect(vscode.window.showInformationMessage).toHaveBeenCalled();
    releaseBlocker();
    await heldAction;
  });

  it("forces a panel state publish for refreshView", async () => {
    const publishState = vi.fn().mockResolvedValue(undefined);
    const result = await executeDashboardActionMessage(
      {
        context: {} as DashboardActionContext["context"],
        repo: {} as DashboardActionContext["repo"],
        resolveLanguage: () => "en",
        schedulePublishState: vi.fn(),
        publishState,
        oauth: {} as DashboardActionContext["oauth"],
        announcements: {} as DashboardActionContext["announcements"],
        getAnnouncementOptions: () => ({
          version: "0.1.15",
          locale: "en"
        })
      },
      {
        type: "dashboard:action",
        action: "refreshView",
        requestId: "req-1"
      }
    );

    expect(publishState).toHaveBeenCalledWith(true);
    expect(result.status).toBe("completed");
  });

  it("waits for quota refresh after consuming a reset credit", async () => {
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue("Reset Rate Limit" as never);
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);
    const executeCommandMock = vi.mocked(vscode.commands.executeCommand).mockResolvedValue(undefined);
    const repo = {
      getAccount: vi.fn(async () => ({
        id: "account-1",
        email: "dev@example.com",
        accountId: "acct-1",
        quotaSummary: {
          resetCreditsAvailable: 1
        }
      })),
      getTokens: vi.fn(async () => ({
        accessToken: "access-token"
      }))
    } as unknown as DashboardActionContext["repo"];

    const result = await executeDashboardActionMessage(
      {
        context: {} as DashboardActionContext["context"],
        repo,
        resolveLanguage: () => "en",
        schedulePublishState: vi.fn(),
        publishState: vi.fn(),
        oauth: {} as DashboardActionContext["oauth"],
        announcements: {} as DashboardActionContext["announcements"],
        getAnnouncementOptions: () => ({
          version: "0.1.15",
          locale: "en"
        })
      },
      {
        type: "dashboard:action",
        action: "consumeResetCredit",
        requestId: "req-2",
        accountId: "account-1"
      }
    );

    expect(executeCommandMock).toHaveBeenCalledWith(
      "codexAccounts.refreshQuota",
      expect.objectContaining({ id: "account-1" })
    );
    expect(result.status).toBe("completed");
  });

  it("keeps dashboard refresh separate from encrypted sync when enabled", async () => {
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValueOnce({
      get: (key: string, fallback?: unknown) => (key === "encryptedSyncEnabled" ? true : fallback)
    } as unknown as vscode.WorkspaceConfiguration);
    const context = createContext();

    const result = await executeDashboardActionMessage(context, {
      type: "dashboard:action",
      action: "refreshView",
      requestId: "req-global-refresh"
    });

    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith("codexAccounts.syncNow");
    expect(context.publishState).toHaveBeenCalledWith(true);
    expect(result.status).toBe("completed");
    expect(result.payload?.notice).toBeUndefined();
  });

  it("uses the refreshed dashboard state as quota refresh feedback", async () => {
    const context = createContext();
    const result = await executeDashboardActionMessage(context, {
      type: "dashboard:action",
      action: "refreshAll",
      requestId: "req-quota-refresh"
    });

    expect(result.status).toBe("completed");
    expect(result.payload?.notice).toBeUndefined();
  });

  it("reports an inconclusive manual encrypted sync as a failed action", async () => {
    vi.mocked(vscode.commands.executeCommand).mockResolvedValue(false);
    const context = createContext();

    const result = await executeDashboardActionMessage(context, {
      type: "dashboard:action",
      action: "syncNow",
      requestId: "req-sync"
    });

    expect(result.status).toBe("failed");
    expect(result.errorMessage).toMatch(/did not complete/i);
    expect(context.schedulePublishState).toHaveBeenCalled();
  });

  it("reports cancelled passphrase setup instead of completing silently", async () => {
    vi.mocked(vscode.commands.executeCommand).mockResolvedValue(false);
    const context = createContext();

    const result = await executeDashboardActionMessage(context, {
      type: "dashboard:action",
      action: "configureEncryptedSync",
      requestId: "req-configure-sync"
    });

    expect(result.status).toBe("failed");
    expect(result.errorMessage).toMatch(/passphrase was not set/i);
    expect(context.schedulePublishState).toHaveBeenCalled();
  });

  it("reports stale and missing account targets instead of completing silently", async () => {
    const repo = {
      getAccount: vi.fn().mockResolvedValue(undefined)
    } as unknown as DashboardActionContext["repo"];

    const missingTarget = await executeDashboardActionMessage(
      { ...createContext(), repo },
      {
        type: "dashboard:action",
        action: "refresh",
        requestId: "req-missing-target"
      }
    );
    const staleTarget = await executeDashboardActionMessage(
      { ...createContext(), repo },
      {
        type: "dashboard:action",
        action: "refresh",
        requestId: "req-stale-target",
        accountId: "deleted-account"
      }
    );

    expect(missingTarget.status).toBe("failed");
    expect(missingTarget.errorMessage).toMatch(/requires an account/i);
    expect(staleTarget.status).toBe("failed");
    expect(staleTarget.errorMessage).toMatch(/no longer exists/i);
  });

  it("reports invalid action input instead of completing silently", async () => {
    const result = await executeDashboardActionMessage(createContext(), {
      type: "dashboard:action",
      action: "copyText",
      requestId: "req-copy"
    });

    expect(result.status).toBe("failed");
    expect(result.errorMessage).toMatch(/no text/i);
  });

  it("updates account claim enablement and republishes dashboard state", async () => {
    vi.mocked(vscode.workspace.getConfiguration)
      .mockReset()
      .mockReturnValue({
        get: (_key: string, fallback?: unknown) => fallback
      } as unknown as vscode.WorkspaceConfiguration);
    vi.mocked(vscode.commands.executeCommand).mockReset().mockResolvedValue(undefined);
    const account = { id: "account-1", email: "dev@example.com", enabled: false };
    const repo = {
      getAccount: vi.fn().mockResolvedValue(account),
      setAccountEnabled: vi.fn().mockResolvedValue({ ...account, enabled: true })
    } as unknown as DashboardActionContext["repo"];
    const context = { ...createContext(), repo };

    const result = await executeDashboardActionMessage(context, {
      type: "dashboard:action",
      action: "toggleAccountEnabled",
      requestId: "req-enable",
      accountId: account.id
    });

    expect(repo.setAccountEnabled).toHaveBeenCalledWith(account.id, true);
    expect(context.schedulePublishState).toHaveBeenCalled();
    expect(result.status).toBe("completed");
    expect(result.payload?.notice).toBeUndefined();
  });

  it("completes an account toggle without waiting for encrypted sync", async () => {
    vi.mocked(vscode.workspace.getConfiguration)
      .mockReset()
      .mockReturnValue({
        get: (key: string, fallback?: unknown) => (key === "encryptedSyncEnabled" ? true : fallback)
      } as unknown as vscode.WorkspaceConfiguration);
    vi.mocked(vscode.commands.executeCommand).mockReset().mockResolvedValue(true);
    const account = { id: "account-1", email: "dev@example.com", enabled: true };
    const repo = {
      getAccount: vi.fn().mockResolvedValue(account),
      setAccountEnabled: vi.fn().mockResolvedValue({ ...account, enabled: false })
    } as unknown as DashboardActionContext["repo"];
    const context = { ...createContext(), repo };

    const result = await executeDashboardActionMessage(context, {
      type: "dashboard:action",
      action: "toggleAccountEnabled",
      requestId: "req-disable-sync",
      accountId: account.id
    });

    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith("codexAccounts.syncNow", expect.anything());
    expect(result.status).toBe("completed");
    expect(result.payload?.notice).toBeUndefined();
  });

  it("does not block an account toggle while a background account task is running", async () => {
    const blocker = new CrossWindowOperationCoordinator(operationDirectory);
    const account = { id: "account-toggle", email: "toggle@example.com", enabled: true };
    let release!: () => void;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const held = blocker.runExclusive(`background:quota-refresh:${account.id}`, "Quota refresh", async () => {
      started();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    await startedPromise;
    const repo = {
      getAccount: vi.fn().mockResolvedValue(account),
      setAccountEnabled: vi.fn().mockResolvedValue({ ...account, enabled: false })
    } as unknown as DashboardActionContext["repo"];

    const result = await executeDashboardActionMessage({ ...createContext(), repo }, {
      type: "dashboard:action",
      action: "toggleAccountEnabled",
      requestId: "req-toggle-background-busy",
      accountId: account.id
    });

    expect(result.status).toBe("completed");
    expect(repo.setAccountEnabled).toHaveBeenCalledWith(account.id, false);
    release();
    await held;
  });

  it("completes an account toggle locally when another window already owns sync", async () => {
    vi.mocked(vscode.workspace.getConfiguration)
      .mockReset()
      .mockReturnValue({
        get: (key: string, fallback?: unknown) => (key === "encryptedSyncEnabled" ? true : fallback)
      } as unknown as vscode.WorkspaceConfiguration);
    vi.mocked(vscode.commands.executeCommand)
      .mockReset()
      .mockRejectedValue(new CrossWindowOperationBusyError("Encrypted account sync"));
    const account = { id: "account-1", email: "dev@example.com", enabled: true };
    const repo = {
      getAccount: vi.fn().mockResolvedValue(account),
      setAccountEnabled: vi.fn().mockResolvedValue({ ...account, enabled: false })
    } as unknown as DashboardActionContext["repo"];
    const context = { ...createContext(), repo };

    const result = await executeDashboardActionMessage(context, {
      type: "dashboard:action",
      action: "toggleAccountEnabled",
      requestId: "req-disable-sync-busy",
      accountId: account.id
    });

    expect(repo.setAccountEnabled).toHaveBeenCalledWith(account.id, false);
    expect(context.schedulePublishState).toHaveBeenCalled();
    expect(result.status).toBe("completed");
    expect(result.payload?.notice).toBeUndefined();
  });

  it("returns account claim enablement failures to the dashboard", async () => {
    const account = { id: "account-1", email: "dev@example.com", enabled: true };
    const repo = {
      getAccount: vi.fn().mockResolvedValue(account),
      setAccountEnabled: vi.fn().mockRejectedValue(new Error("local index is read-only"))
    } as unknown as DashboardActionContext["repo"];
    const context = { ...createContext(), repo };

    const result = await executeDashboardActionMessage(context, {
      type: "dashboard:action",
      action: "toggleAccountEnabled",
      requestId: "req-disable",
      accountId: account.id
    });

    expect(result.status).toBe("failed");
    expect(result.errorMessage).toMatch(/read-only/i);
    expect(context.schedulePublishState).toHaveBeenCalled();
  });

  it("returns password-gated claim bypass outcomes to the dashboard", async () => {
    const context = createContext();
    vi.mocked(vscode.commands.executeCommand).mockResolvedValueOnce(true);

    const enabled = await executeDashboardActionMessage(context, {
      type: "dashboard:action",
      action: "setEncryptedSyncRegistryOverride",
      requestId: "req-bypass-on",
      payload: { enabled: true }
    });

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith("codexAccounts.setEncryptedSyncRegistryOverride", true);
    expect(enabled.status).toBe("completed");
    expect(enabled.payload?.notice).toBeUndefined();
    expect(context.schedulePublishState).toHaveBeenCalled();

    vi.mocked(vscode.commands.executeCommand).mockResolvedValueOnce(true);
    const disabled = await executeDashboardActionMessage(context, {
      type: "dashboard:action",
      action: "setEncryptedSyncRegistryOverride",
      requestId: "req-bypass-off",
      payload: { enabled: false }
    });

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith("codexAccounts.setEncryptedSyncRegistryOverride", false);
    expect(disabled.status).toBe("completed");
    expect(disabled.payload?.notice).toBeUndefined();

    vi.mocked(vscode.commands.executeCommand).mockResolvedValueOnce(false);
    const rejected = await executeDashboardActionMessage(context, {
      type: "dashboard:action",
      action: "setEncryptedSyncRegistryOverride",
      requestId: "req-bypass-rejected",
      payload: { enabled: true }
    });

    expect(rejected.status).toBe("failed");
    expect(rejected.errorMessage).toMatch(/not enabled/i);
  });

  it("allows duplicate refresh-view requests while another window is refreshing", async () => {
    const context = createContext();
    context.publishState = vi.fn().mockResolvedValue(undefined);

    const first = await executeDashboardActionMessage(context, {
      type: "dashboard:action",
      action: "refreshView",
      requestId: "req-refresh-first"
    });
    const duplicate = await executeDashboardActionMessage(context, {
      type: "dashboard:action",
      action: "refreshView",
      requestId: "req-refresh-duplicate"
    });

    expect(first.status).toBe("completed");
    expect(duplicate.status).toBe("completed");
    expect(context.publishState).toHaveBeenCalledTimes(2);
  });
});

function createContext(): DashboardActionContext {
  return {
    context: {} as DashboardActionContext["context"],
    repo: {} as DashboardActionContext["repo"],
    resolveLanguage: () => "en",
    schedulePublishState: vi.fn(),
    publishState: vi.fn(),
    oauth: {} as DashboardActionContext["oauth"],
    announcements: {} as DashboardActionContext["announcements"],
    getAnnouncementOptions: () => ({
      version: "0.1.19",
      locale: "en"
    })
  };
}
