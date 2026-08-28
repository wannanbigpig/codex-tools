import { AsyncLocalStorage } from "async_hooks";
import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as path from "path";

const LOCK_DIRECTORY_NAME = "cross-window-operations-v1";
const OWNER_FILE_NAME = "owner.json";
const CLEANUP_LOCK_NAME = ".cleanup.lock";
const DEFAULT_HEARTBEAT_MS = 5_000;
const DEFAULT_STALE_AFTER_MS = 30_000;
const MAX_OPERATION_LIFETIME_MS = 6 * 60 * 60 * 1000;
const STARTUP_COOLDOWN_FILE = "startup-sync-cooldown.json";
export const CENTRAL_ACCOUNT_OPERATION_KEY = "accounts:central-operation";
/**
 * Encrypted Settings Sync has its own single-flight lock.  It must not share
 * the account-operation lock: a sync in another window should never prevent a
 * user from changing a local account setting.
 */
export const ENCRYPTED_SYNC_OPERATION_KEY = "accounts:encrypted-sync";

type LockOwner = {
  instanceId: string;
  pid: number;
  startedAt: number;
  heartbeatAt: number;
};

type OperationLease = { active: boolean };

export class CrossWindowOperationBusyError extends Error {
  constructor(public readonly operationLabel: string) {
    super(`${operationLabel} is already running in another VS Code window. Wait for it to finish, then try again.`);
    this.name = "CrossWindowOperationBusyError";
  }
}

/**
 * A process-safe single-flight guard shared by every VS Code extension host.
 * Atomic directory creation elects exactly one executor for an operation key.
 */
export class CrossWindowOperationCoordinator {
  private readonly lockRoot: string;
  private readonly instanceId = crypto.randomUUID();
  private readonly operationContext = new AsyncLocalStorage<ReadonlyMap<string, OperationLease>>();
  private initializeTask: Promise<void> | undefined;

  constructor(
    globalStoragePath: string,
    private readonly heartbeatMs = DEFAULT_HEARTBEAT_MS,
    private readonly staleAfterMs = DEFAULT_STALE_AFTER_MS
  ) {
    this.lockRoot = path.resolve(globalStoragePath, LOCK_DIRECTORY_NAME);
  }

  initialize(): Promise<void> {
    this.initializeTask ??= fs
      .mkdir(this.lockRoot, { recursive: true })
      .then(() =>
        this.cleanupAbandonedLocks().catch((error: unknown) => {
          console.warn("[codexAccounts] cross-window operation cleanup skipped:", error);
        })
      );
    return this.initializeTask;
  }

  async runExclusive<T>(operationKey: string, operationLabel: string, task: () => Promise<T>): Promise<T> {
    const normalizedKey = operationKey.trim();
    if (!normalizedKey) {
      throw new Error("A cross-window operation key is required.");
    }

    const inherited = this.operationContext.getStore();
    if (inherited?.get(normalizedKey)?.active) {
      return task();
    }

    await this.initialize();
    const lockPath = this.resolveLockPath(normalizedKey);
    const acquired = await this.tryAcquire(lockPath);
    if (!acquired) {
      throw new CrossWindowOperationBusyError(operationLabel);
    }

    const owner: LockOwner = {
      instanceId: this.instanceId,
      pid: process.pid,
      startedAt: Date.now(),
      heartbeatAt: Date.now()
    };
    try {
      await this.writeOwner(lockPath, owner);
    } catch (error) {
      await fs.rm(lockPath, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
    let heartbeatInFlight = false;
    let heartbeatTask: Promise<void> | undefined;
    const heartbeat = setInterval(() => {
      if (heartbeatInFlight) {
        return;
      }
      heartbeatInFlight = true;
      owner.heartbeatAt = Date.now();
      heartbeatTask = this.writeOwner(lockPath, owner)
        .catch(() => undefined)
        .finally(() => {
          heartbeatInFlight = false;
        });
    }, this.heartbeatMs);
    heartbeat.unref?.();

    const lease: OperationLease = { active: true };
    const nextContext = new Map(inherited ?? []);
    nextContext.set(normalizedKey, lease);
    try {
      return await this.operationContext.run(nextContext, task);
    } finally {
      lease.active = false;
      clearInterval(heartbeat);
      await heartbeatTask;
      await this.release(lockPath, owner);
    }
  }

  private resolveLockPath(operationKey: string): string {
    const digest = crypto.createHash("sha256").update(operationKey).digest("hex");
    return path.join(this.lockRoot, digest);
  }

  private async tryAcquire(lockPath: string): Promise<boolean> {
    try {
      await fs.mkdir(lockPath);
      return true;
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }
    }

    if (!(await this.isStale(lockPath))) {
      return false;
    }

    const abandonedPath = `${lockPath}.abandoned-${this.instanceId}`;
    try {
      await fs.rename(lockPath, abandonedPath);
    } catch (error) {
      if (isNotFoundError(error) || isAlreadyExistsError(error)) {
        return this.tryAcquire(lockPath);
      }
      return false;
    }
    await fs.rm(abandonedPath, { recursive: true, force: true });
    return this.tryAcquire(lockPath);
  }

  private async isStale(lockPath: string): Promise<boolean> {
    try {
      const owner = JSON.parse(await fs.readFile(path.join(lockPath, OWNER_FILE_NAME), "utf8")) as Partial<LockOwner>;
      if (
        typeof owner.pid !== "number" ||
        typeof owner.heartbeatAt !== "number" ||
        typeof owner.instanceId !== "string" ||
        typeof owner.startedAt !== "number"
      ) {
        throw new Error("Invalid cross-window lock owner metadata");
      }
      if (Date.now() - owner.startedAt > MAX_OPERATION_LIFETIME_MS) {
        return true;
      }
      if (Date.now() - owner.heartbeatAt <= this.staleAfterMs) {
        return false;
      }
      // Multiple extension instances can briefly coexist in one VS Code
      // process during reload. A stale lock from that process is abandoned,
      // even though the PID itself is still alive.
      return owner.pid === process.pid || !isProcessAlive(owner.pid);
    } catch {
      // A freshly-created lock can briefly exist before owner.json is written.
      try {
        const stat = await fs.stat(path.join(lockPath, OWNER_FILE_NAME)).catch(() => fs.stat(lockPath));
        return Date.now() - stat.mtimeMs > this.staleAfterMs;
      } catch {
        return false;
      }
    }
  }

  private async writeOwner(lockPath: string, owner: LockOwner): Promise<void> {
    await fs.writeFile(path.join(lockPath, OWNER_FILE_NAME), JSON.stringify(owner), "utf8");
  }

  private async release(lockPath: string, owner: LockOwner): Promise<void> {
    try {
      const current = JSON.parse(await fs.readFile(path.join(lockPath, OWNER_FILE_NAME), "utf8")) as Partial<LockOwner>;
      if (current.instanceId !== owner.instanceId || current.startedAt !== owner.startedAt) {
        return;
      }
      await fs.rm(lockPath, { recursive: true, force: true });
    } catch (error) {
      if (!isNotFoundError(error)) {
        console.warn("[codexAccounts] failed to release a cross-window operation lock:", error);
      }
    }
  }

  private async cleanupAbandonedLocks(): Promise<void> {
    const cleanupLockPath = path.join(this.lockRoot, CLEANUP_LOCK_NAME);
    let cleanupHandle: fs.FileHandle | undefined;
    try {
      cleanupHandle = await fs.open(cleanupLockPath, "wx");
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }
      try {
        const stat = await fs.stat(cleanupLockPath);
        if (Date.now() - stat.mtimeMs <= this.staleAfterMs) {
          return;
        }
        await fs.unlink(cleanupLockPath);
        cleanupHandle = await fs.open(cleanupLockPath, "wx");
      } catch (recoveryError) {
        // Another window may still own the cleanup claim, or the stale file
        // may be held open by a crashed host while Windows releases it.
        // Cleanup is best-effort and must never prevent extension activation.
        return;
      }
    }

    try {
      const entries = await fs.readdir(this.lockRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }
        const entryPath = path.join(this.lockRoot, entry.name);
        if (entry.name.includes(".abandoned-")) {
          await fs.rm(entryPath, { recursive: true, force: true });
          continue;
        }
        if (/^[a-f0-9]{64}$/.test(entry.name) && (await this.isStale(entryPath))) {
          const abandonedPath = `${entryPath}.abandoned-cleanup-${this.instanceId}`;
          try {
            await fs.rename(entryPath, abandonedPath);
            await fs.rm(abandonedPath, { recursive: true, force: true });
          } catch (error) {
            if (!isNotFoundError(error)) {
              console.warn("[codexAccounts] failed to clean a stale cross-window operation lock:", error);
            }
          }
        }
      }
    } finally {
      await cleanupHandle.close();
      await fs.unlink(cleanupLockPath).catch((error: unknown) => {
        if (!isNotFoundError(error)) {
          console.warn("[codexAccounts] failed to release the cross-window cleanup lock:", error);
        }
      });
    }
  }
}

let sharedCoordinator: CrossWindowOperationCoordinator | undefined;
let sharedGlobalStoragePath: string | undefined;

export async function runCentralAccountOperationWithCooldown<T>(
  operationLabel: string,
  cooldownMs: number,
  task: () => Promise<T>
): Promise<{ ran: boolean; value?: T }> {
  return runCentralAccountOperation(operationLabel, async () => {
    const markerPath = sharedGlobalStoragePath
      ? path.join(sharedGlobalStoragePath, STARTUP_COOLDOWN_FILE)
      : undefined;
    if (markerPath) {
      try {
        const marker = JSON.parse(await fs.readFile(markerPath, "utf8")) as { completedAt?: unknown };
        if (typeof marker.completedAt === "number" && Date.now() - marker.completedAt < cooldownMs) {
          return { ran: false };
        }
      } catch {
        // Missing/corrupt cooldown state is safe: the central lock serializes
        // the first repair and the next successful run rewrites it.
      }
    }

    const value = await task();
    if (markerPath) {
      await fs
        .writeFile(markerPath, JSON.stringify({ completedAt: Date.now() }), "utf8")
        .catch((error: unknown) => console.warn("[codexAccounts] startup sync cooldown marker update skipped:", error));
    }
    return { ran: true, value };
  });
}

export async function configureCrossWindowOperationCoordinator(globalStoragePath: string): Promise<void> {
  const coordinator = new CrossWindowOperationCoordinator(globalStoragePath);
  try {
    await coordinator.initialize();
    sharedCoordinator = coordinator;
    sharedGlobalStoragePath = globalStoragePath;
  } catch (error) {
    // Do not retain a rejected singleton. A later activation can retry cleanly
    // while this window continues in read/local mode.
    sharedCoordinator = undefined;
    sharedGlobalStoragePath = undefined;
    throw error;
  }
}

export function runCrossWindowExclusive<T>(
  operationKey: string,
  operationLabel: string,
  task: () => Promise<T>
): Promise<T> {
  return sharedCoordinator ? sharedCoordinator.runExclusive(operationKey, operationLabel, task) : task();
}

export function runCentralAccountOperation<T>(operationLabel: string, task: () => Promise<T>): Promise<T> {
  return runCrossWindowExclusive(CENTRAL_ACCOUNT_OPERATION_KEY, operationLabel, task);
}

export function runEncryptedSyncOperation<T>(operationLabel: string, task: () => Promise<T>): Promise<T> {
  return runCrossWindowExclusive(ENCRYPTED_SYNC_OPERATION_KEY, operationLabel, task);
}

function isAlreadyExistsError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "EEXIST";
}

function isNotFoundError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
