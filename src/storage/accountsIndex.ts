import * as fsSync from "fs";
import { createError } from "../core/errors";
import type { CodexAccountRecord, CodexAccountsIndex } from "../core/types";
import { normalizeQuotaSummary } from "../utils/quotaWindows";
import { normalizeAccountTags } from "./sharedAccounts";

export function markActive(index: CodexAccountsIndex, accountId: string, now = Date.now()): void {
  const startsNewSession = index.currentAccountId !== accountId;
  const previousAccountId = index.currentAccountId;
  index.currentAccountId = accountId;
  for (const account of index.accounts) {
    const nextActive = account.id === accountId;
    if (startsNewSession && account.id === previousAccountId) {
      completeAccountUsageSession(account, now);
    }
    account.isActive = nextActive;
    if (nextActive && (startsNewSession || account.sessionStartedAt == null)) {
      account.sessionStartedAt = now;
    }
  }
}

export function syncActiveAccountState(index: CodexAccountsIndex, accountId: string | undefined, now = Date.now()): boolean {
  const normalizedAccountId = accountId && index.accounts.some((account) => account.id === accountId) ? accountId : undefined;
  const startsNewSession = index.currentAccountId !== normalizedAccountId;
  const previousAccountId = index.currentAccountId;
  let changed = startsNewSession;
  index.currentAccountId = normalizedAccountId;

  for (const account of index.accounts) {
    const nextActive = account.id === normalizedAccountId;
    if (startsNewSession && account.id === previousAccountId) {
      completeAccountUsageSession(account, now);
      changed = true;
    }
    if (account.isActive !== nextActive) {
      account.isActive = nextActive;
      changed = true;
    }
    if (nextActive && (startsNewSession || account.sessionStartedAt == null)) {
      account.sessionStartedAt = now;
      changed = true;
    }
  }

  return changed;
}

function completeAccountUsageSession(account: CodexAccountRecord, now: number): void {
  if (typeof account.sessionStartedAt === "number" && Number.isFinite(account.sessionStartedAt)) {
    const elapsed = Math.max(0, now - account.sessionStartedAt);
    const previous =
      typeof account.totalUsageMs === "number" && Number.isFinite(account.totalUsageMs)
        ? Math.max(0, account.totalUsageMs)
        : 0;
    account.totalUsageMs = previous + elapsed;
  }
  account.sessionStartedAt = undefined;
}

export function createEmptyIndex(): CodexAccountsIndex {
  return { accounts: [] };
}

export function cloneIndex(index: CodexAccountsIndex): CodexAccountsIndex {
  const normalized: CodexAccountsIndex = {
    currentAccountId: index?.currentAccountId,
    accounts: Array.isArray(index?.accounts)
      ? index.accounts.map((account) => ({
          ...account,
          tags: normalizeAccountTags(account.tags),
          quotaSummary: normalizeQuotaSummary(account.quotaSummary)
        }))
      : []
  };

  return structuredClone(normalized);
}

export function parseAccountsIndex(raw: string, filePath: string): CodexAccountsIndex {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isValidAccountsIndex(parsed)) {
      throw new Error("Invalid accounts index structure");
    }

    return cloneIndex(parsed);
  } catch (cause) {
    throw createError.storageIndexCorrupted(filePath, cause);
  }
}

export function getBackupPath(indexPath: string, slot: number): string {
  return indexPath.replace(/\.json$/i, `.backup-${slot}.json`);
}

export function countAvailableBackupsSync(indexPath: string, backupCount: number): number {
  let count = 0;
  for (let slot = 1; slot <= backupCount; slot += 1) {
    if (fsSync.existsSync(getBackupPath(indexPath, slot))) {
      count += 1;
    }
  }

  return count;
}

export function readCurrentIndexForBackupSync(indexPath: string): string | undefined {
  try {
    const raw = fsSync.readFileSync(indexPath, "utf8");
    parseAccountsIndex(raw, indexPath);
    return raw;
  } catch (error) {
    return undefined;
  }
}

function isValidAccountsIndex(value: unknown): value is CodexAccountsIndex {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<CodexAccountsIndex>;
  if (!Array.isArray(candidate.accounts)) {
    return false;
  }

  return candidate.accounts.every((account) => {
    if (!account || typeof account !== "object") {
      return false;
    }

    const record = account as Partial<CodexAccountRecord>;
    return (
      typeof record.id === "string" &&
      typeof record.email === "string" &&
      typeof record.createdAt === "number" &&
      typeof record.updatedAt === "number" &&
      (record.sessionStartedAt === undefined ||
        (typeof record.sessionStartedAt === "number" && Number.isFinite(record.sessionStartedAt))) &&
      (record.totalUsageMs === undefined ||
        (typeof record.totalUsageMs === "number" && Number.isFinite(record.totalUsageMs) && record.totalUsageMs >= 0)) &&
      (record.tags === undefined || (Array.isArray(record.tags) && record.tags.every((tag) => typeof tag === "string")))
    );
  });
}
