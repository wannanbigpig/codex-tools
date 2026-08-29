import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { removeTestDirectory } from "./testFilesystem";
import {
  CrossWindowOperationBusyError,
  CrossWindowOperationCoordinator,
  CENTRAL_ACCOUNT_OPERATION_KEY,
  ENCRYPTED_SYNC_OPERATION_KEY,
  configureCrossWindowOperationCoordinator,
  runCentralAccountOperationWithCooldown
} from "../src/utils/crossWindowOperations";

describe("CrossWindowOperationCoordinator", () => {
  it("runs deferred startup sync once per five-minute cooldown across windows", async () => {
    const directory = await createTestDirectory("cross-window-startup-cooldown");
    await configureCrossWindowOperationCoordinator(directory);
    let executions = 0;

    const first = await runCentralAccountOperationWithCooldown("Deferred startup sync", 5 * 60 * 1000, async () => {
      executions += 1;
    });
    const second = await runCentralAccountOperationWithCooldown("Deferred startup sync", 5 * 60 * 1000, async () => {
      executions += 1;
    });

    expect(first.ran).toBe(true);
    expect(second.ran).toBe(false);
    expect(executions).toBe(1);
    await removeTestDirectory(directory);
  });

  it("allows only one coordinator to execute the same operation", async () => {
    const directory = await createTestDirectory("cross-window-operation");
    const first = new CrossWindowOperationCoordinator(directory);
    const second = new CrossWindowOperationCoordinator(directory);
    let release!: () => void;
    let markStarted!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let executions = 0;

    const firstRun = first.runExclusive("quota:refresh:account-1", "Quota refresh", async () => {
      executions += 1;
      markStarted();
      await pending;
    });
    await started;

    await expect(
      second.runExclusive("quota:refresh:account-1", "Quota refresh", async () => {
        executions += 1;
      })
    ).rejects.toEqual(expect.any(CrossWindowOperationBusyError));

    release();
    await firstRun;
    expect(executions).toBe(1);
    expect(await fs.readdir(path.join(directory, "cross-window-operations-v1"))).toEqual([]);
    await removeTestDirectory(directory);
  });

  it("lets unrelated operations run concurrently", async () => {
    const directory = await createTestDirectory("cross-window-operation-keys");
    const first = new CrossWindowOperationCoordinator(directory);
    const second = new CrossWindowOperationCoordinator(directory);

    const values = await Promise.all([
      first.runExclusive("quota:refresh:a", "Refresh A", async () => "a"),
      second.runExclusive("quota:refresh:b", "Refresh B", async () => "b")
    ]);

    expect(values).toEqual(["a", "b"]);
    await removeTestDirectory(directory);
  });

  it("does not block a manual account operation while another window is syncing", async () => {
    const directory = await createTestDirectory("cross-window-sync-and-manual");
    const syncingWindow = new CrossWindowOperationCoordinator(directory);
    const manualWindow = new CrossWindowOperationCoordinator(directory);
    let releaseSync!: () => void;
    let markSyncStarted!: () => void;
    const syncPending = new Promise<void>((resolve) => {
      releaseSync = resolve;
    });
    const syncStarted = new Promise<void>((resolve) => {
      markSyncStarted = resolve;
    });

    const sync = syncingWindow.runExclusive(ENCRYPTED_SYNC_OPERATION_KEY, "Encrypted account sync", async () => {
      markSyncStarted();
      await syncPending;
    });
    await syncStarted;

    await expect(
      manualWindow.runExclusive(CENTRAL_ACCOUNT_OPERATION_KEY, "Toggle account", async () => "updated")
    ).resolves.toBe("updated");

    releaseSync();
    await sync;
    await removeTestDirectory(directory);
  });

  it("supports a nested call for the same operation in one action", async () => {
    const directory = await createTestDirectory("cross-window-operation-nested");
    const coordinator = new CrossWindowOperationCoordinator(directory);
    let executions = 0;

    await coordinator.runExclusive("sync:now", "Sync", async () => {
      await coordinator.runExclusive("sync:now", "Sync", async () => {
        executions += 1;
      });
    });

    expect(executions).toBe(1);
    await removeTestDirectory(directory);
  });

  it("releases the lock when the operation fails", async () => {
    const directory = await createTestDirectory("cross-window-operation-failure");
    const first = new CrossWindowOperationCoordinator(directory);
    const second = new CrossWindowOperationCoordinator(directory);

    await expect(
      first.runExclusive("quota:refresh:failed", "Quota refresh", async () => {
        throw new Error("network unavailable");
      })
    ).rejects.toThrow("network unavailable");

    await expect(
      second.runExclusive("quota:refresh:failed", "Quota refresh", async () => "retried")
    ).resolves.toBe("retried");
    expect(await fs.readdir(path.join(directory, "cross-window-operations-v1"))).toEqual([]);
    await removeTestDirectory(directory);
  });

  it("reclaims a stale lock left by another coordinator in this process", async () => {
    const directory = await createTestDirectory("cross-window-operation-live-owner");
    const lockRoot = path.join(directory, "cross-window-operations-v1");
    const key = "quota:refresh:live";
    const digest = (await import("crypto")).createHash("sha256").update(key).digest("hex");
    const lockPath = path.join(lockRoot, digest);
    await fs.mkdir(lockPath, { recursive: true });
    await fs.writeFile(
      path.join(lockPath, "owner.json"),
      JSON.stringify({ instanceId: "live", pid: process.pid, startedAt: Date.now(), heartbeatAt: 1 }),
      "utf8"
    );

    const coordinator = new CrossWindowOperationCoordinator(directory, 5, 10);
    await expect(coordinator.runExclusive(key, "Quota refresh", async () => "recovered")).resolves.toBe("recovered");
    await removeTestDirectory(directory);
  });

  it("runs one startup cleanup and removes abandoned lock directories", async () => {
    const directory = await createTestDirectory("cross-window-operation-cleanup");
    const lockRoot = path.join(directory, "cross-window-operations-v1");
    await fs.mkdir(path.join(lockRoot, `${"a".repeat(64)}.abandoned-crashed-window`), { recursive: true });

    const first = new CrossWindowOperationCoordinator(directory);
    const second = new CrossWindowOperationCoordinator(directory);
    await Promise.all([first.initialize(), second.initialize()]);

    expect(await fs.readdir(lockRoot)).toEqual([]);
    await removeTestDirectory(directory);
  });
});

function createTestDirectory(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
}
