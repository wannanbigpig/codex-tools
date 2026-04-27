import { getErrorMessage } from "../core/errors";
import type {
  CodexAccountRecord,
  CodexImportPreviewIssue,
  CodexImportPreviewSummary,
  CodexImportResultIssue,
  SharedCodexAccountJson
} from "../core/types";
import { normalizeQuotaSummary } from "../utils/quotaWindows";
import {
  fromSharedQuota,
  fromSharedQuotaError,
  normalizeAccountTags,
  normalizeEpochMs,
  previewSharedEntry,
  sanitizeOptionalValue
} from "./sharedAccounts";

export function toSharedEntries(input: SharedCodexAccountJson | SharedCodexAccountJson[]): SharedCodexAccountJson[] {
  return Array.isArray(input) ? input : [input];
}

export function previewSharedAccountsImportEntries(
  entries: SharedCodexAccountJson[],
  existingIds: Set<string>
): CodexImportPreviewSummary {
  const invalidEntries: CodexImportPreviewIssue[] = [];
  let valid = 0;
  let overwriteCount = 0;

  entries.forEach((entry, index) => {
    try {
      const preview = previewSharedEntry(entry);
      valid += 1;
      if (preview.storageId && existingIds.has(preview.storageId)) {
        overwriteCount += 1;
      }
    } catch (error) {
      invalidEntries.push(createSharedImportIssue(entry, index, error));
    }
  });

  return {
    total: entries.length,
    valid,
    overwriteCount,
    invalidCount: invalidEntries.length,
    invalidEntries
  };
}

export function createSharedImportIssue(
  entry: SharedCodexAccountJson,
  index: number,
  error: unknown
): CodexImportResultIssue {
  return {
    index,
    accountId: sanitizeOptionalValue(entry.account_id) ?? sanitizeOptionalValue(entry.id),
    email: sanitizeOptionalValue(entry.email),
    message: typeof error === "string" ? error : getErrorMessage(error)
  };
}

export function applySharedAccountEntry(account: CodexAccountRecord, entry: SharedCodexAccountJson): void {
  account.userId = sanitizeOptionalValue(entry.user_id) ?? account.userId;
  account.planType = sanitizeOptionalValue(entry.plan_type) ?? account.planType;
  account.subscriptionActiveUntil = sanitizeOptionalValue(entry.subscription_active_until) ?? account.subscriptionActiveUntil;
  account.accountId = sanitizeOptionalValue(entry.account_id) ?? account.accountId;
  account.organizationId = sanitizeOptionalValue(entry.organization_id) ?? account.organizationId;
  account.accountName = sanitizeOptionalValue(entry.account_name) ?? account.accountName;
  account.tags = normalizeAccountTags(entry.tags, account.tags);
  account.addedVia = sanitizeOptionalValue(entry.added_via) ?? account.addedVia ?? "json";
  account.accountStructure = sanitizeOptionalValue(entry.account_structure) ?? account.accountStructure;
  account.createdAt = normalizeEpochMs(entry.created_at) ?? account.createdAt;
  account.updatedAt = normalizeEpochMs(entry.last_used) ?? normalizeEpochMs(entry.added_at ?? undefined) ?? Date.now();

  if (entry.quota !== undefined) {
    account.quotaSummary = entry.quota ? normalizeQuotaSummary(fromSharedQuota(entry.quota)) : undefined;
    if (account.quotaSummary) {
      account.lastQuotaAt = account.updatedAt;
    }
  }

  if (entry.quota_error !== undefined) {
    account.quotaError = fromSharedQuotaError(entry.quota_error);
    if (account.quotaError) {
      account.lastQuotaAt = account.updatedAt;
    }
  }
}
