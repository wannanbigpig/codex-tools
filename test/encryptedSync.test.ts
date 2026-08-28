import * as crypto from "crypto";
import * as zlib from "zlib";
import * as vscode from "vscode";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSyncEntry,
  decryptSyncPayload,
  EncryptedSyncManager,
  encryptSyncPayload,
  mergeSyncAccountDeletions,
  mergeSyncAccounts,
  syncAccountsFingerprint,
  isEncryptedSyncRegistryOverrideEnabled,
  getSyncedAccountLeases,
  type SyncAccountEntry,
  type SyncAccountDeletion,
  type SyncPayload
} from "../src/services/encryptedSync";
import { createSyncAccountLease } from "../src/services/syncLeases";
import { createSyncAccountEnablement } from "../src/services/syncEnablementRegistry";
import {
  getTokenAutomationSnapshot,
  markTokenAutomationRefreshFailure
} from "../src/presentation/workbench/tokenAutomationState";

const PASSPHRASE = "correct horse battery staple";

describe("encrypted account sync", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("encrypts and decrypts an authenticated compressed vault without exposing credentials", async () => {
    const payload = createPayload([createEntry("one", 100, "refresh-secret")]);
    payload.leases = [
      createSyncAccountLease({ accountId: "one", deviceId: "device-one", deviceName: "Office PC", now: 123 })
    ];
    payload.enablementRegistry = [
      createSyncAccountEnablement({
        accountId: "one",
        deviceId: "device-one",
        deviceName: "Office PC",
        enabled: true,
        now: 123
      })
    ];
    const encrypted = await encryptSyncPayload(payload, PASSPHRASE);

    expect(encrypted).not.toContain("refresh-secret");
    expect(encrypted).not.toContain(PASSPHRASE);
    expect(encrypted).not.toContain("Office PC");
    const decrypted = await decryptSyncPayload(encrypted, PASSPHRASE);
    expect(decrypted.accounts).toEqual(payload.accounts.map(createSyncEntry));
    expect(decrypted.leases).toEqual(payload.leases);
    expect(decrypted.enablementRegistry).toEqual(payload.enablementRegistry);
  });

  it("decrypts early v1 vaults that implicitly used gzip", async () => {
    const payload = createPayload([createEntry("legacy", 100, "legacy-refresh")]);
    const encrypted = await encryptLegacySyncPayload(payload, PASSPHRASE);

    const decrypted = await decryptSyncPayload(encrypted, PASSPHRASE);
    expect(decrypted.accounts).toEqual(payload.accounts.map(createSyncEntry));
    expect(decrypted.format).toBe(payload.format);
    expect(decrypted.version).toBe(payload.version);
  });

  it("rejects a wrong passphrase and authenticated-header tampering", async () => {
    const encrypted = await encryptSyncPayload(createPayload([createEntry("one", 100)]), PASSPHRASE);
    await expect(decryptSyncPayload(encrypted, "this is the wrong passphrase")).rejects.toThrow(/incorrect|modified/i);

    const envelope = JSON.parse(encrypted) as { updatedAt: number };
    envelope.updatedAt += 1;
    await expect(decryptSyncPayload(JSON.stringify(envelope), PASSPHRASE)).rejects.toThrow(/incorrect|modified/i);
  });

  it("merges concurrent additions and deterministically keeps the freshest token", () => {
    const older = createEntry("shared", 100, "older");
    const newer = createEntry("shared", 200, "newer");
    const merged = mergeSyncAccounts([older, createEntry("local", 100)], [newer, createEntry("remote", 100)]);

    expect(merged.map((entry) => entry.id)).toEqual(["local", "remote", "shared"]);
    expect(merged.find((entry) => entry.id === "shared")?.tokens?.refresh_token).toBe("newer");
  });

  it("keeps a deleted account removed when a stale PC still uploads it", () => {
    const deletion: SyncAccountDeletion = { accountId: "removed", deletedAt: 500_000, deviceId: "device-one" };
    const mergedDeletions = mergeSyncAccountDeletions([deletion], []);
    const merged = mergeSyncAccounts([], [createEntry("removed", 900)], mergedDeletions);

    expect(merged).toEqual([]);
    expect(mergedDeletions).toEqual([deletion]);
  });

  it("allows an explicitly recreated account to supersede an older deletion", () => {
    const recreated = { ...createEntry("removed", 900), created_at: 600 };
    const deletion: SyncAccountDeletion = { accountId: "removed", deletedAt: 500_000, deviceId: "device-one" };

    expect(mergeSyncAccounts([recreated], [], [deletion])).toEqual([recreated]);
  });

  it("round-trips authenticated deletion tombstones", async () => {
    const payload = createPayload([]);
    payload.deletions = [{ accountId: "removed", deletedAt: 500_000, deviceId: "device-one" }];

    const encrypted = await encryptSyncPayload(payload, PASSPHRASE);

    await expect(decryptSyncPayload(encrypted, PASSPHRASE)).resolves.toEqual(payload);
  });

  it("does not upload quota, logs, usage, active-account state, or other volatile dashboard data", () => {
    const entry = createSyncEntry({
      ...createEntry("one", 100),
      quota: { hourly_percentage: 50, raw_data: { private: "diagnostic" } },
      quota_error: { message: "private diagnostic" },
      tags: ["local-only"],
      queue_priority: true,
      enabled: false
    } as SyncAccountEntry & { enabled: boolean });

    expect(entry.quota).toBeUndefined();
    expect(entry.quota_error).toBeUndefined();
    expect(entry.tags).toBeUndefined();
    expect(entry.queue_priority).toBeUndefined();
    expect(entry.last_used).toBeUndefined();
    expect(entry).not.toHaveProperty("enabled");
  });

  it("runs one Settings Sync refresh on startup and stays idle during account use", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: (key: string, fallback?: unknown) => (key === "encryptedSyncEnabled" ? true : fallback),
      update: vi.fn(),
      inspect: vi.fn()
    } as unknown as vscode.WorkspaceConfiguration);
    vi.mocked(vscode.workspace.onDidChangeConfiguration).mockReturnValue({ dispose: vi.fn() });

    const secretGet = vi.fn(async () => undefined);
    const setKeysForSync = vi.fn();
    const context = {
      subscriptions: [] as vscode.Disposable[],
      globalState: {
        get: vi.fn(() => undefined),
        update: vi.fn(async () => undefined),
        setKeysForSync
      },
      secrets: {
        get: secretGet,
        store: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined)
      }
    } as unknown as vscode.ExtensionContext;
    const manager = new EncryptedSyncManager(context, {} as never);

    await manager.start();
    expect(setKeysForSync).toHaveBeenCalledWith(["codexAccounts.encryptedSync.v1"]);
    expect(secretGet).toHaveBeenCalledTimes(2);
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith("workbench.userDataSync.actions.syncNow");

    await manager.prepareAccountSwitch("account-one");
    await manager.completeAccountSwitch();
    await manager.cancelAccountSwitch();
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

    expect(secretGet).toHaveBeenCalledTimes(2);
    manager.dispose();
  });

  it("does not create scheduled sync traffic after the startup refresh", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: (key: string, fallback?: unknown) => (key === "encryptedSyncEnabled" ? true : fallback),
      update: vi.fn(),
      inspect: vi.fn()
    } as unknown as vscode.WorkspaceConfiguration);
    vi.mocked(vscode.workspace.onDidChangeConfiguration).mockReturnValue({ dispose: vi.fn() });
    const secretGet = vi.fn(async () => undefined);
    const context = {
      subscriptions: [] as vscode.Disposable[],
      globalState: { get: vi.fn(() => undefined), update: vi.fn(async () => undefined), setKeysForSync: vi.fn() },
      secrets: {
        get: secretGet,
        store: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined)
      }
    } as unknown as vscode.ExtensionContext;
    const manager = new EncryptedSyncManager(context, {} as never);

    await manager.start();
    expect(secretGet).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(59 * 60 * 1000);
    expect(secretGet).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(secretGet).toHaveBeenCalledTimes(2);
    manager.dispose();
  });

  it("requires the encrypted sync passphrase before enabling local rescue override", async () => {
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: (key: string, fallback?: unknown) => (key === "encryptedSyncEnabled" ? true : fallback),
      update: vi.fn(),
      inspect: vi.fn()
    } as unknown as vscode.WorkspaceConfiguration);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue("wrong passphrase value");
    const state = new Map<string, unknown>();
    const context = {
      subscriptions: [] as vscode.Disposable[],
      globalState: {
        get: <T>(key: string, fallback?: T) => (state.has(key) ? (state.get(key) as T) : fallback),
        update: vi.fn(async (key: string, value: unknown) => {
          if (value === undefined) state.delete(key);
          else state.set(key, value);
        }),
        setKeysForSync: vi.fn()
      },
      secrets: {
        get: vi.fn(async (key: string) =>
          key === "codexAccounts.encryptedSync.passphrase" ? PASSPHRASE : "local-device"
        ),
        store: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined)
      }
    } as unknown as vscode.ExtensionContext;
    const manager = new EncryptedSyncManager(context, {} as never);

    await manager.start();
    await expect(manager.setRegistryOverrideEnabled(true)).resolves.toBe(false);
    expect(isEncryptedSyncRegistryOverrideEnabled()).toBe(false);
    expect(state.get("codexAccounts.encryptedSync.enablementOverride.v1")).toBeUndefined();

    vi.mocked(vscode.window.showInputBox).mockResolvedValue(PASSPHRASE);
    await expect(manager.setRegistryOverrideEnabled(true)).resolves.toBe(true);
    expect(isEncryptedSyncRegistryOverrideEnabled()).toBe(true);
    expect(state.get("codexAccounts.encryptedSync.enablementOverride.v1")).toBe(true);

    await expect(manager.setRegistryOverrideEnabled(false)).resolves.toBe(true);
    expect(isEncryptedSyncRegistryOverrideEnabled()).toBe(false);
    manager.dispose();
  });

  it("imports a foreign PC claim as disabled and blocks local switching", async () => {
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: (key: string, fallback?: unknown) => (key === "encryptedSyncEnabled" ? true : fallback),
      update: vi.fn(),
      inspect: vi.fn()
    } as unknown as vscode.WorkspaceConfiguration);
    const account = createEntry("one", 100);
    const remotePayload = createPayload([account]);
    remotePayload.enablementRegistry = [
      createSyncAccountEnablement({
        accountId: "one",
        deviceId: "office-device",
        deviceName: "Office PC",
        enabled: true,
        now: 500
      })
    ];
    const state = new Map<string, unknown>([
      ["codexAccounts.encryptedSync.v1", await encryptSyncPayload(remotePayload, PASSPHRASE)]
    ]);
    const context = {
      subscriptions: [] as vscode.Disposable[],
      globalState: {
        get: <T>(key: string, fallback?: T) => (state.has(key) ? (state.get(key) as T) : fallback),
        update: vi.fn(async (key: string, value: unknown) => {
          if (value === undefined) state.delete(key);
          else state.set(key, value);
        }),
        setKeysForSync: vi.fn()
      },
      secrets: {
        get: vi.fn(async (key: string) =>
          key === "codexAccounts.encryptedSync.passphrase" ? PASSPHRASE : "laptop-device"
        ),
        store: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined)
      }
    } as unknown as vscode.ExtensionContext;
    const repo = {
      listAccounts: vi.fn(async () => [{ id: "one", enabled: true }]),
      setAccountEnabledFromSync: vi.fn(async () => undefined)
    };
    const manager = new EncryptedSyncManager(context, repo as never);

    await manager.start();

    expect(repo.setAccountEnabledFromSync).toHaveBeenCalledWith("one", false);
    expect(getSyncedAccountLeases()).toEqual([
      expect.objectContaining({ accountId: "one", deviceName: "Office PC", isCurrentDevice: false })
    ]);
    await expect(manager.prepareAccountSwitch("one")).rejects.toThrow(/Office PC/i);
    manager.dispose();
  });

  it("removes legacy account-use leases from the next meaningful vault write", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: (key: string, fallback?: unknown) => (key === "encryptedSyncEnabled" ? true : fallback),
      update: vi.fn(),
      inspect: vi.fn()
    } as unknown as vscode.WorkspaceConfiguration);
    vi.mocked(vscode.workspace.onDidChangeConfiguration).mockReturnValue({ dispose: vi.fn() });

    const account = createEntry("one", 100);
    const remotePayload = createPayload([account]);
    remotePayload.leases = [
      createSyncAccountLease({ accountId: "one", deviceId: "old-device", deviceName: "Old PC", now: 123 })
    ];
    const state = new Map<string, unknown>([
      ["codexAccounts.encryptedSync.v1", await encryptSyncPayload(remotePayload, PASSPHRASE)]
    ]);
    const update = vi.fn(async (key: string, value: unknown) => {
      if (value === undefined) state.delete(key);
      else state.set(key, value);
    });
    const context = {
      subscriptions: [] as vscode.Disposable[],
      globalState: {
        get: <T>(key: string) => state.get(key) as T | undefined,
        update,
        setKeysForSync: vi.fn()
      },
      secrets: {
        get: vi.fn(async (key: string) =>
          key === "codexAccounts.encryptedSync.passphrase" ? PASSPHRASE : "local-device"
        ),
        store: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined)
      }
    } as unknown as vscode.ExtensionContext;
    const repo = {
      listAccounts: vi.fn(async () => [{ id: "one" }]),
      exportSharedAccounts: vi.fn(async () => [account]),
      importSharedAccountsWithSummary: vi.fn(async () => ({ failedCount: 0 })),
      removeAccount: vi.fn(async () => undefined)
    };
    const manager = new EncryptedSyncManager(context, repo as never);

    await manager.start();
    await manager.syncNow(false, false);

    const rewritten = state.get("codexAccounts.encryptedSync.v1");
    expect(typeof rewritten).toBe("string");
    const decrypted = await decryptSyncPayload(rewritten as string, PASSPHRASE);
    expect(decrypted.leases).toBeUndefined();
    expect(update).toHaveBeenCalledWith("codexAccounts.encryptedSync.v1", expect.any(String));
    manager.dispose();
  });

  it("ignores volatile timestamps but detects credential changes", () => {
    const first = createEntry("one", 100, "first");
    const touched = { ...first, last_used: 999 };
    const refreshed = createEntry("one", 200, "second");

    expect(syncAccountsFingerprint([first])).toBe(syncAccountsFingerprint([touched]));
    expect(syncAccountsFingerprint([first])).not.toBe(syncAccountsFingerprint([refreshed]));
  });

  it("clears the receiving PC's stale automation auth error when newer credentials are synchronized", async () => {
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: (key: string, fallback?: unknown) => (key === "encryptedSyncEnabled" ? true : fallback),
      update: vi.fn(),
      inspect: vi.fn()
    } as unknown as vscode.WorkspaceConfiguration);
    const local = createEntry("one", 100, "expired-refresh");
    const remote = createEntry("one", 200, "reauthorized-refresh");
    const state = new Map<string, unknown>([
      ["codexAccounts.encryptedSync.v1", await encryptSyncPayload(createPayload([remote]), PASSPHRASE)]
    ]);
    const context = {
      subscriptions: [] as vscode.Disposable[],
      globalState: {
        get: <T>(key: string) => state.get(key) as T | undefined,
        update: vi.fn(async (key: string, value: unknown) => {
          if (value === undefined) state.delete(key);
          else state.set(key, value);
        }),
        setKeysForSync: vi.fn()
      },
      secrets: {
        get: vi.fn(async (key: string) =>
          key === "codexAccounts.encryptedSync.passphrase" ? PASSPHRASE : "laptop-device"
        ),
        store: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined)
      }
    } as unknown as vscode.ExtensionContext;
    const repo = {
      listAccounts: vi.fn(async () => [{ id: "one", enabled: true }]),
      exportSharedAccounts: vi.fn(async () => [local]),
      importSharedAccountsWithSummary: vi.fn(async () => ({ failedCount: 0 })),
      removeAccount: vi.fn(async () => undefined),
      setAccountEnabledFromSync: vi.fn(async () => undefined)
    };
    markTokenAutomationRefreshFailure("one", "API returned 401: token expired");
    const manager = new EncryptedSyncManager(context, repo as never);

    await expect(manager.syncNow(false, false, false)).resolves.toBe(true);

    expect(repo.importSharedAccountsWithSummary).toHaveBeenCalledWith([
      expect.objectContaining({
        id: remote.id,
        email: remote.email,
        tokens: remote.tokens
      })
    ]);
    expect(getTokenAutomationSnapshot().accounts.one?.lastError).toBeUndefined();
    manager.dispose();
  });

  it("rejects malformed session metadata and oversized credentials", async () => {
    const malformed = {
      ...createEntry("one", 100),
      email: 42
    } as unknown as SyncAccountEntry;
    await expect(encryptSyncPayload(createPayload([malformed]), PASSPHRASE)).rejects.toThrow(/invalid account/i);

    const oversized = createEntry("one", 100);
    oversized.tokens!.access_token = "x".repeat(512 * 1024 + 1);
    await expect(encryptSyncPayload(createPayload([oversized]), PASSPHRASE)).rejects.toThrow(/invalid account/i);
  });

  it("drops unsupported remote account fields after authenticated decryption", async () => {
    const account = {
      ...createEntry("one", 100),
      quota: { hourly_percentage: 50 },
      tags: ["device-local"]
    };
    const encrypted = await encryptSyncPayload(createPayload([account]), PASSPHRASE);
    const decrypted = await decryptSyncPayload(encrypted, PASSPHRASE);

    expect(decrypted.accounts[0]?.quota).toBeUndefined();
    expect(decrypted.accounts[0]?.tags).toBeUndefined();
  });
});

function createPayload(accounts: SyncAccountEntry[]): SyncPayload {
  return {
    format: "codex-accounts-encrypted-sync",
    version: 1,
    updatedAt: 123,
    deviceId: "device-one",
    accounts
  };
}

function createEntry(id: string, expiresAt: number, refreshToken = "refresh"): SyncAccountEntry {
  return {
    id,
    email: `${id}@example.com`,
    account_id: `account-${id}`,
    tokens: {
      id_token: jwt(expiresAt),
      access_token: jwt(expiresAt),
      refresh_token: refreshToken,
      account_id: `account-${id}`
    },
    created_at: 1,
    last_used: expiresAt
  };
}

function jwt(expiresAt: number): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode({ exp: expiresAt })}.signature`;
}

async function encryptLegacySyncPayload(payload: SyncPayload, passphrase: string): Promise<string> {
  const salt = Buffer.alloc(16, 1);
  const iv = Buffer.alloc(12, 2);
  const key = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(passphrase, salt, 32, { N: 131_072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (error, value) => {
      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    });
  });
  const header = {
    format: payload.format,
    version: payload.version,
    updatedAt: payload.updatedAt,
    deviceId: payload.deviceId
  };
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(JSON.stringify(header), "utf8"));
  const compressed = zlib.gzipSync(Buffer.from(JSON.stringify(payload), "utf8"), { level: 9 });
  const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
  return JSON.stringify({
    ...header,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64")
  });
}
