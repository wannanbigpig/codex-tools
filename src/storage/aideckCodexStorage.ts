import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import type { CodexAccountRecord, CodexQuotaSummary, CodexTokens, SharedCodexAccountJson } from "../core/types";
import { extractClaims } from "../utils/jwt";

type JsonRecord = Record<string, unknown>;

export type AideckMirrorTokenSnapshot = Partial<CodexTokens> & {
  email?: string;
  userId?: string;
  organizationId?: string;
};

export async function readAideckCodexTokens(accountId: string): Promise<AideckMirrorTokenSnapshot | undefined> {
  const filePath = getAideckCodexAccountFilePath(accountId);
  try {
    const parsed = (await readJsonFile(filePath)) ?? {};
    const tokenSource = getRecord(parsed["tokens"]);
    const idToken = readString(tokenSource?.["id_token"]) ?? readString(parsed["id_token"]);
    const accessToken =
      readString(tokenSource?.["access_token"]) ??
      readString(parsed["access_token"]) ??
      readString(parsed["token"]);
    const refreshToken =
      readString(tokenSource?.["refresh_token"]) ??
      readString(parsed["refresh_token"]) ??
      undefined;
    const externalAccountId =
      readString(tokenSource?.["account_id"]) ??
      readString(parsed["account_id"]) ??
      undefined;

    if (!idToken && !accessToken && !refreshToken && !externalAccountId) {
      return undefined;
    }

    const snapshot = {
      idToken,
      accessToken,
      refreshToken,
      accountId: externalAccountId,
      email: readString(parsed["email"]),
      userId: readString(parsed["user_id"]),
      organizationId: readString(parsed["organization_id"])
    };

    return isMirrorSnapshotConsistent(snapshot) ? snapshot : undefined;
  } catch {
    return undefined;
  }
}

export async function listAideckCodexSharedAccounts(): Promise<SharedCodexAccountJson[]> {
  const root = getAideckCodexRoot();
  const accountFiles = new Set<string>();

  try {
    const index = (await readJsonFile(path.join(root, "accounts-index.json"))) ?? {};
    const accounts = Array.isArray(index["accounts"]) ? index["accounts"] : [];
    for (const item of accounts) {
      const record = getRecord(item);
      const id = readString(record?.["id"]);
      if (id) {
        accountFiles.add(getAideckCodexAccountFilePath(id));
      }
    }
  } catch {}

  try {
    const dir = path.join(root, "accounts");
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".json")) {
        accountFiles.add(path.join(dir, entry.name));
      }
    }
  } catch {}

  const shared: SharedCodexAccountJson[] = [];
  for (const filePath of accountFiles) {
    const parsed = await readJsonFile(filePath);
    const entry = parsed ? toSharedCodexAccount(parsed) : undefined;
    if (entry) {
      shared.push(entry);
    }
  }

  return shared;
}

export async function mirrorAideckCodexAccount(account: CodexAccountRecord, tokens?: CodexTokens): Promise<void> {
  if (!account.id || !account.email) {
    return;
  }

  try {
    const now = Date.now();
    const filePath = getAideckCodexAccountFilePath(account.id);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const existing = (await readJsonFile(filePath)) ?? {};
    const existingTokens = getRecord(existing["tokens"]) ?? {};
    const existingQuota = getRecord(existing["quota"]);
    const existingQuotaError = getSharedQuotaError(existing["quota_error"]);
    const safeTokens = shouldMirrorTokensForAccount(account, tokens) ? tokens : undefined;
    const nextTokens = safeTokens
      ? {
          ...existingTokens,
          id_token: safeTokens.idToken,
          access_token: safeTokens.accessToken,
          refresh_token: safeTokens.refreshToken,
          account_id: account.accountId ?? safeTokens.accountId ?? readString(existingTokens["account_id"]) ?? ""
        }
      : existingTokens;
    const next = {
      ...existing,
      id: account.id,
      email: account.email.trim().toLowerCase(),
      auth_mode: readString(existing["auth_mode"]) ?? "",
      user_id: account.userId ?? readString(existing["user_id"]) ?? "",
      // The Aideck mirror is a compatibility layer, not an authority for workspace-scoped metadata.
      // Preserve existing workspace/quota fields when they already exist to avoid amplifying stale context from VS Code.
      plan_type: readString(existing["plan_type"]) ?? account.planType ?? "",
      subscription_active_until:
        readString(existing["subscription_active_until"]) ?? account.subscriptionActiveUntil ?? "",
      account_id: account.accountId ?? readString(existing["account_id"]) ?? "",
      organization_id: account.organizationId ?? readString(existing["organization_id"]) ?? "",
      account_name: readString(existing["account_name"]) ?? account.accountName ?? "",
      account_structure: readString(existing["account_structure"]) ?? account.accountStructure ?? "",
      added_via: account.addedVia ?? readString(existing["added_via"]) ?? "",
      added_at: readNumber(existing["added_at"]) ?? account.createdAt ?? now,
      created_at: account.createdAt ?? readNumber(existing["created_at"]) ?? now,
      last_used: account.isActive ? now : (readNumber(existing["last_used"]) ?? account.updatedAt ?? 0),
      updated_at: now,
      tokens: nextTokens,
      quota: existingQuota ?? (account.quotaSummary ? toAideckQuota(account.quotaSummary, account.lastQuotaAt) : null),
      quota_error:
        existingQuotaError ??
        (account.quotaError
          ? {
              code: account.quotaError.code,
              message: account.quotaError.message,
              timestamp: account.quotaError.timestamp
            }
          : null),
      tags: account.tags?.length ? [...account.tags] : []
    };

    await writeJsonFile(filePath, next);
    await writeAideckCodexIndex(account.id, next);
  } catch {
    // Aideck storage is a compatibility mirror. Failing to mirror must not break the VS Code extension store.
  }
}

export async function mirrorAideckCurrentAccount(accountId: string): Promise<void> {
  if (!accountId.trim()) {
    return;
  }

  try {
    const currentPath = path.join(getAideckCodexRoot(), "current.json");
    await fs.mkdir(path.dirname(currentPath), { recursive: true });
    await writeJsonFile(currentPath, {
      id: accountId,
      updated_at: Date.now()
    });
  } catch {
    // Best-effort compatibility mirror.
  }
}

export async function removeAideckCodexAccount(accountId: string): Promise<void> {
  if (!accountId.trim()) {
    return;
  }

  try {
    await fs.rm(getAideckCodexAccountFilePath(accountId), { force: true });
    await removeAideckCodexIndexRecord(accountId);
    await clearAideckCurrentAccountIfMatches(accountId);
  } catch {
    // Aideck storage is a compatibility mirror. Failing to clean it must not block the VS Code extension store.
  }
}

export function getAideckCodexAccountFilePath(accountId: string): string {
  return path.join(getAideckCodexRoot(), "accounts", `${sanitizeFileStem(accountId)}.json`);
}

function getAideckCodexRoot(): string {
  return path.join(getAideckDataRoot(), "accounts", "codex");
}

function getAideckDataRoot(): string {
  const envDataRoot = process.env["AIDECK_DATA_DIR"]?.trim();
  return envDataRoot ? envDataRoot.replace(/^['"]|['"]$/g, "") : path.join(os.homedir(), ".ai_deck");
}

async function writeAideckCodexIndex(accountId: string, account: JsonRecord): Promise<void> {
  const indexPath = path.join(getAideckCodexRoot(), "accounts-index.json");
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  const existing = (await readJsonFile(indexPath)) ?? {};
  const accounts: unknown[] = Array.isArray(existing["accounts"]) ? existing["accounts"].slice() : [];
  const summary = buildAideckIndexRecord(account);
  const nextAccounts = accounts.filter((item) => getRecord(item)?.["id"] !== accountId);
  nextAccounts.push(summary);
  await writeJsonFile(indexPath, {
    ...existing,
    schema_version: readNumber(existing["schema_version"]) ?? 1,
    updated_at: Date.now(),
    accounts: nextAccounts
  });
}

async function removeAideckCodexIndexRecord(accountId: string): Promise<void> {
  const indexPath = path.join(getAideckCodexRoot(), "accounts-index.json");
  const existing = await readJsonFile(indexPath);
  if (!existing) {
    return;
  }

  const accounts: unknown[] = Array.isArray(existing["accounts"]) ? existing["accounts"] : [];
  const nextAccounts = accounts.filter((item) => getRecord(item)?.["id"] !== accountId);
  if (nextAccounts.length === accounts.length) {
    return;
  }

  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  await writeJsonFile(indexPath, {
    ...existing,
    schema_version: readNumber(existing["schema_version"]) ?? 1,
    updated_at: Date.now(),
    accounts: nextAccounts
  });
}

async function clearAideckCurrentAccountIfMatches(accountId: string): Promise<void> {
  const currentPath = path.join(getAideckCodexRoot(), "current.json");
  const current = await readJsonFile(currentPath);
  if (readString(current?.["id"]) !== accountId) {
    return;
  }

  await fs.rm(currentPath, { force: true });
}

function buildAideckIndexRecord(account: JsonRecord): JsonRecord {
  const quota = getRecord(account["quota"]);
  return {
    id: readString(account["id"]) ?? "",
    email: readString(account["email"]) ?? "",
    name: readString(account["name"]) ?? readString(account["account_name"]) ?? "",
    auth_mode: readString(account["auth_mode"]) ?? "",
    plan_type: readString(account["plan_type"]) ?? "",
    subscription_active_until: readString(account["subscription_active_until"]) ?? "",
    plan_name: readString(account["plan_name"]) ?? "",
    tier_id: readString(account["tier_id"]) ?? "",
    tags: Array.isArray(account["tags"]) ? account["tags"].slice(0, 50) : [],
    created_at: readNumber(account["created_at"]) ?? Date.now(),
    last_used: readNumber(account["last_used"]) ?? 0,
    updated_at: readNumber(account["updated_at"]) ?? Date.now(),
    has_quota: Boolean(
      quota &&
        (typeof quota["hourly_percentage"] === "number" ||
          typeof quota["weekly_percentage"] === "number" ||
          Array.isArray(quota["additional_rate_limits"]) ||
          typeof quota["code_review_percentage"] === "number")
    ),
    quota_updated_at: readNumber(quota?.["updated_at"]) ?? 0
  };
}

function toSharedCodexAccount(account: JsonRecord): SharedCodexAccountJson | undefined {
  const tokenSource = getRecord(account["tokens"]) ?? {};
  const idToken = readString(tokenSource["id_token"]) ?? readString(account["id_token"]);
  const accessToken =
    readString(tokenSource["access_token"]) ??
    readString(account["access_token"]) ??
    readString(account["token"]);
  const refreshToken = readString(tokenSource["refresh_token"]) ?? readString(account["refresh_token"]);
  const externalAccountId =
    readString(tokenSource["account_id"]) ??
    readString(account["account_id"]) ??
    undefined;

  if (!idToken || !accessToken) {
    return undefined;
  }

  return {
    id: readString(account["id"]),
    email: readString(account["email"]),
    auth_mode: readString(account["auth_mode"]),
    user_id: readString(account["user_id"]),
    plan_type: readString(account["plan_type"]),
    subscription_active_until: readString(account["subscription_active_until"]) ?? readNumber(account["subscription_active_until"]) ?? null,
    account_id: externalAccountId ?? null,
    organization_id: readString(account["organization_id"]) ?? null,
    account_name: readString(account["account_name"]) ?? readString(account["name"]) ?? null,
    account_structure: readString(account["account_structure"]) ?? null,
    added_via: readString(account["added_via"]) ?? "aideck",
    added_at: readNumber(account["added_at"]) ?? readNumber(account["created_at"]) ?? null,
    tokens: {
      id_token: idToken,
      access_token: accessToken,
      refresh_token: refreshToken,
      account_id: externalAccountId ?? null
    },
    quota: getSharedQuota(account["quota"]),
    quota_error: getSharedQuotaError(account["quota_error"]),
    tags: getStringArray(account["tags"]) ?? null,
    created_at: readNumber(account["created_at"]),
    last_used: readNumber(account["last_used"]) ?? readNumber(account["updated_at"])
  };
}

function toAideckQuota(summary: CodexQuotaSummary, updatedAt?: number): JsonRecord {
  return {
    hourly_percentage: summary.hourlyPercentage,
    hourly_reset_time: summary.hourlyResetTime,
    hourly_requests_left: summary.hourlyRequestsLeft,
    hourly_requests_limit: summary.hourlyRequestsLimit,
    hourly_window_minutes: summary.hourlyWindowMinutes,
    weekly_percentage: summary.weeklyPercentage,
    weekly_reset_time: summary.weeklyResetTime,
    weekly_requests_left: summary.weeklyRequestsLeft,
    weekly_requests_limit: summary.weeklyRequestsLimit,
    weekly_window_minutes: summary.weeklyWindowMinutes,
    code_review_percentage: summary.codeReviewPercentage,
    code_review_reset_time: summary.codeReviewResetTime,
    code_review_requests_left: summary.codeReviewRequestsLeft,
    code_review_requests_limit: summary.codeReviewRequestsLimit,
    code_review_window_minutes: summary.codeReviewWindowMinutes,
    additional_rate_limits: summary.additionalRateLimits?.map((limit) => ({
      limit_name: limit.limitName,
      metered_feature: limit.meteredFeature,
      hourly_percentage: limit.hourlyPercentage,
      hourly_reset_time: limit.hourlyResetTime,
      hourly_requests_left: limit.hourlyRequestsLeft,
      hourly_requests_limit: limit.hourlyRequestsLimit,
      hourly_window_minutes: limit.hourlyWindowMinutes,
      weekly_percentage: limit.weeklyPercentage,
      weekly_reset_time: limit.weeklyResetTime,
      weekly_requests_left: limit.weeklyRequestsLeft,
      weekly_requests_limit: limit.weeklyRequestsLimit,
      weekly_window_minutes: limit.weeklyWindowMinutes
    })) ?? [],
    credits: summary.credits
      ? {
          has_credits: summary.credits.hasCredits,
          unlimited: summary.credits.unlimited,
          overage_limit_reached: summary.credits.overageLimitReached,
          balance: summary.credits.balance,
          approx_local_messages: summary.credits.approxLocalMessages,
          approx_cloud_messages: summary.credits.approxCloudMessages
        }
      : null,
    updated_at: updatedAt ?? Date.now()
  };
}

function getSharedQuota(value: unknown): SharedCodexAccountJson["quota"] {
  const quota = getRecord(value);
  return quota ? (quota as NonNullable<SharedCodexAccountJson["quota"]>) : null;
}

function getSharedQuotaError(value: unknown): SharedCodexAccountJson["quota_error"] {
  const error = getRecord(value);
  if (!error) {
    return null;
  }
  const message = readString(error["message"]);
  if (!message) {
    return null;
  }
  return {
    code: readString(error["code"]),
    message,
    timestamp: readNumber(error["timestamp"])
  };
}

function getStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const out = value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
  return out.length ? out : undefined;
}

function shouldMirrorTokensForAccount(account: CodexAccountRecord, tokens: CodexTokens | undefined): tokens is CodexTokens {
  if (!tokens?.idToken || !tokens.accessToken) {
    return false;
  }

  const claims = safeExtractMirrorClaims(tokens);
  if (!claims) {
    return false;
  }

  return !(
    hasRequiredIdentityMismatch(normalizeEmail(account.email), claims.email) ||
    hasRequiredIdentityMismatch(account.userId, claims.userId) ||
    hasRequiredIdentityMismatch(account.accountId, tokens.accountId ?? claims.accountId) ||
    hasRequiredIdentityMismatch(account.organizationId, claims.organizationId)
  );
}

function isMirrorSnapshotConsistent(snapshot: AideckMirrorTokenSnapshot): boolean {
  if (!snapshot.idToken) {
    return true;
  }

  const claims = safeExtractMirrorClaims(snapshot);
  if (!claims) {
    return false;
  }

  return !(
    hasRequiredIdentityMismatch(normalizeEmail(snapshot.email), claims.email) ||
    hasRequiredIdentityMismatch(snapshot.userId, claims.userId) ||
    hasRequiredIdentityMismatch(snapshot.accountId, claims.accountId) ||
    hasRequiredIdentityMismatch(snapshot.organizationId, claims.organizationId)
  );
}

function safeExtractMirrorClaims(tokens: Partial<CodexTokens> | undefined):
  | {
      email?: string;
      userId?: string;
      accountId?: string;
      organizationId?: string;
    }
  | undefined {
  if (!tokens?.idToken) {
    return undefined;
  }

  try {
    const claims = extractClaims(tokens.idToken, tokens.accessToken);
    return {
      email: normalizeEmail(claims.email),
      userId: claims.userId,
      accountId: claims.accountId,
      organizationId: claims.organizationId
    };
  } catch {
    return undefined;
  }
}

function normalizeEmail(email: string | undefined): string | undefined {
  const trimmed = email?.trim().toLowerCase();
  return trimmed || undefined;
}

function hasRequiredIdentityMismatch(expected: string | undefined, candidate: string | undefined): boolean {
  // Legacy/opaque tokens can omit optional identity claims. Treat a missing
  // claim as unknown and reject only explicit contradictions.
  return Boolean(expected && candidate && expected !== candidate);
}

async function readJsonFile(filePath: string): Promise<JsonRecord | undefined> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return getRecord(parsed);
  } catch {
    return undefined;
  }
}

async function writeJsonFile(filePath: string, value: JsonRecord): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sanitizeFileStem(value: string): string {
  const raw = value.trim();
  if (!raw) {
    return "item";
  }
  const normalized = raw.replace(/[^a-zA-Z0-9._-]/g, "_");
  return normalized && normalized !== "." && normalized !== ".." ? normalized : "item";
}

function getRecord(value: unknown): JsonRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as JsonRecord;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function readNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
