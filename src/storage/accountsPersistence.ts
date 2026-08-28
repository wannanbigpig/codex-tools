import * as fs from "fs/promises";
import * as fsSync from "fs";
import { CodexAccountsIndex } from "../core/types";
import {
  countAvailableBackupsSync,
  getBackupPath,
  parseAccountsIndex,
  readCurrentIndexForBackupSync
} from "./accountsIndex";

const REPLACE_RETRY_DELAYS_MS = [20, 50, 100, 200, 400];
const TRANSIENT_REPLACE_CODES = new Set(["EACCES", "EBUSY", "EPERM"]);

export async function readIndexSnapshot(filePath: string): Promise<CodexAccountsIndex> {
  const raw = await fs.readFile(filePath, "utf8");
  return parseAccountsIndex(raw, filePath);
}

export async function countAvailableBackups(indexPath: string, backupCount: number): Promise<number> {
  let count = 0;
  for (let slot = 1; slot <= backupCount; slot += 1) {
    try {
      await fs.access(getBackupPath(indexPath, slot));
      count += 1;
    } catch {
      continue;
    }
  }
  return count;
}

export async function backupCurrentIndex(indexPath: string, backupCount: number): Promise<void> {
  const current = await readCurrentIndexForBackup(indexPath);
  if (!current) {
    return;
  }

  console.info("[codexAccounts] creating accounts index backup");
  for (let slot = backupCount; slot >= 2; slot -= 1) {
    const from = getBackupPath(indexPath, slot - 1);
    const to = getBackupPath(indexPath, slot);
    try {
      await fs.copyFile(from, to);
    } catch (error) {
      if (!isFileNotFoundError(error)) {
        console.error(`[codexAccounts] failed to rotate backup ${slot - 1} -> ${slot}:`, error);
      }
    }
  }

  await fs.writeFile(getBackupPath(indexPath, 1), current, "utf8");
}

export function backupCurrentIndexSync(indexPath: string, backupCount: number): void {
  const current = readCurrentIndexForBackupSync(indexPath);
  if (!current) {
    return;
  }

  for (let slot = backupCount; slot >= 2; slot -= 1) {
    const from = getBackupPath(indexPath, slot - 1);
    const to = getBackupPath(indexPath, slot);
    try {
      fsSync.copyFileSync(from, to);
    } catch (error) {
      if (!isFileNotFoundError(error)) {
        console.error(`[codexAccounts] failed to rotate backup ${slot - 1} -> ${slot}:`, error);
      }
    }
  }

  fsSync.writeFileSync(getBackupPath(indexPath, 1), current, "utf8");
}

export async function writeIndexAtomically(
  indexPath: string,
  index: CodexAccountsIndex,
  tempSuffix: string
): Promise<void> {
  const serialized = JSON.stringify(index, null, 2);
  const tempPath = createUniqueTempPath(indexPath, tempSuffix);
  parseAccountsIndex(serialized, tempPath);
  await fs.writeFile(tempPath, serialized, "utf8");
  await replaceFileWithRetry(tempPath, indexPath);
}

export function writeIndexAtomicallySync(indexPath: string, index: CodexAccountsIndex, tempSuffix: string): void {
  const serialized = JSON.stringify(index, null, 2);
  const tempPath = createUniqueTempPath(indexPath, tempSuffix);
  parseAccountsIndex(serialized, tempPath);
  fsSync.writeFileSync(tempPath, serialized, "utf8");
  replaceFileWithRetrySync(tempPath, indexPath);
}

function createUniqueTempPath(indexPath: string, tempSuffix: string): string {
  const nonce = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${indexPath}${tempSuffix}-${nonce}`;
}

async function replaceFileWithRetry(tempPath: string, indexPath: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= REPLACE_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      await fs.rename(tempPath, indexPath);
      return;
    } catch (error) {
      lastError = error;
      if (!isTransientReplaceError(error) || attempt === REPLACE_RETRY_DELAYS_MS.length) {
        break;
      }
      await delay(REPLACE_RETRY_DELAYS_MS[attempt]!);
    }
  }

  // Windows security tools can hold the destination long enough for rename to
  // keep returning EPERM. copyFile safely replaces the complete destination
  // contents while preserving the validated temporary file as the source.
  if (isTransientReplaceError(lastError)) {
    await fs.copyFile(tempPath, indexPath);
    await fs.unlink(tempPath).catch(() => undefined);
    return;
  }
  throw lastError;
}

function replaceFileWithRetrySync(tempPath: string, indexPath: string): void {
  let lastError: unknown;
  for (let attempt = 0; attempt <= REPLACE_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      fsSync.renameSync(tempPath, indexPath);
      return;
    } catch (error) {
      lastError = error;
      if (!isTransientReplaceError(error) || attempt === REPLACE_RETRY_DELAYS_MS.length) {
        break;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, REPLACE_RETRY_DELAYS_MS[attempt]!);
    }
  }

  if (isTransientReplaceError(lastError)) {
    fsSync.copyFileSync(tempPath, indexPath);
    try {
      fsSync.unlinkSync(tempPath);
    } catch {
      // The completed destination is authoritative; a locked temp file is safe
      // to leave for later operating-system cleanup.
    }
    return;
  }
  throw lastError;
}

function isTransientReplaceError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    TRANSIENT_REPLACE_CODES.has(String((error as { code?: unknown }).code))
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function countAvailableBackupsSyncSafe(indexPath: string, backupCount: number): number {
  return countAvailableBackupsSync(indexPath, backupCount);
}

export function isFileNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT"
  );
}

async function readCurrentIndexForBackup(indexPath: string): Promise<string | undefined> {
  try {
    const raw = await fs.readFile(indexPath, "utf8");
    parseAccountsIndex(raw, indexPath);
    return raw;
  } catch (error) {
    if (!isFileNotFoundError(error)) {
      console.warn("[codexAccounts] skipped index backup because current index is unreadable");
    }
    return undefined;
  }
}
