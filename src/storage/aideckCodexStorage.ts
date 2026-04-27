import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import type { CodexAccountRecord, CodexQuotaSummary, CodexTokens } from "../core/types";

type JsonRecord = Record<string, unknown>;

export async function readAideckCodexTokens(accountId: string): Promise<Partial<CodexTokens> | undefined> {
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

    return {
      idToken,
      accessToken,
      refreshToken,
      accountId: externalAccountId
    };
  } catch {
    return undefined;
  }
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
    const nextTokens = tokens
      ? {
          ...existingTokens,
          id_token: tokens.idToken,
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken,
          account_id: account.accountId ?? tokens.accountId ?? readString(existingTokens["account_id"]) ?? ""
        }
      : existingTokens;
    const next = {
      ...existing,
      id: account.id,
      email: account.email.trim().toLowerCase(),
      auth_mode: readString(existing["auth_mode"]) ?? "oauth",
      user_id: account.userId ?? readString(existing["user_id"]) ?? "",
      plan_type: account.planType ?? readString(existing["plan_type"]) ?? "",
      subscription_active_until:
        account.subscriptionActiveUntil ?? readString(existing["subscription_active_until"]) ?? "",
      account_id: account.accountId ?? readString(existing["account_id"]) ?? "",
      organization_id: account.organizationId ?? readString(existing["organization_id"]) ?? "",
      account_name: account.accountName ?? readString(existing["account_name"]) ?? "",
      account_structure: account.accountStructure ?? readString(existing["account_structure"]) ?? "",
      added_via: account.addedVia ?? readString(existing["added_via"]) ?? "",
      added_at: readNumber(existing["added_at"]) ?? account.createdAt ?? now,
      created_at: account.createdAt ?? readNumber(existing["created_at"]) ?? now,
      last_used: account.isActive ? now : (readNumber(existing["last_used"]) ?? account.updatedAt ?? 0),
      updated_at: now,
      tokens: nextTokens,
      quota: account.quotaSummary ? toAideckQuota(account.quotaSummary, account.lastQuotaAt) : existing["quota"] ?? null,
      quota_error: account.quotaError
        ? {
            code: account.quotaError.code,
            message: account.quotaError.message,
            timestamp: account.quotaError.timestamp
          }
        : null,
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
