import type * as vscode from "vscode";
import type {
  DashboardDailyUsageCacheEntry,
  DashboardState,
  DashboardUsageSample
} from "../domain/dashboard/types";
import type { CodexDailyUsageBreakdown } from "../core/types";

const STORAGE_KEY = "codexAccounts.dashboardUsageHistory.v1";
const MAX_SAMPLES = 10_000;
const DAILY_USAGE_CACHE_KEY = "codexAccounts.dashboardDailyUsageCache.v1";
const MAX_DAILY_USAGE_CACHE_ENTRIES = 64;

export function readDashboardUsageHistory(context: vscode.ExtensionContext): DashboardUsageSample[] {
  return normalizeDashboardUsageHistory(context.globalState.get<unknown>(STORAGE_KEY));
}

export function readDashboardDailyUsageCache(context: vscode.ExtensionContext): DashboardDailyUsageCacheEntry[] {
  return normalizeDashboardDailyUsageCache(context.globalState.get<unknown>(DAILY_USAGE_CACHE_KEY));
}

export async function saveDashboardDailyUsageCache(
  context: vscode.ExtensionContext,
  entries: readonly DashboardDailyUsageCacheEntry[]
): Promise<void> {
  await context.globalState.update(DAILY_USAGE_CACHE_KEY, normalizeDashboardDailyUsageCache(entries));
}

export async function upsertDashboardDailyUsageCache(
  context: vscode.ExtensionContext,
  accountId: string,
  usage: CodexDailyUsageBreakdown,
  fetchedAt = Date.now()
): Promise<DashboardDailyUsageCacheEntry[]> {
  const entries = readDashboardDailyUsageCache(context).filter((entry) => entry.accountId !== accountId);
  entries.push({ accountId, fetchedAt, usage });
  const normalized = normalizeDashboardDailyUsageCache(entries);
  await context.globalState.update(DAILY_USAGE_CACHE_KEY, normalized);
  return normalized;
}

export function normalizeDashboardDailyUsageCache(value: unknown): DashboardDailyUsageCacheEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is DashboardDailyUsageCacheEntry => {
      if (!item || typeof item !== "object") return false;
      const entry = item as Partial<DashboardDailyUsageCacheEntry>;
      return (
        typeof entry.accountId === "string" && entry.accountId.length > 0 && entry.accountId.length <= 4096 &&
        typeof entry.fetchedAt === "number" && Number.isFinite(entry.fetchedAt) &&
        isDailyUsageBreakdown(entry.usage)
      );
    })
    .sort((left, right) => right.fetchedAt - left.fetchedAt)
    .slice(0, MAX_DAILY_USAGE_CACHE_ENTRIES);
}

function isDailyUsageBreakdown(value: unknown): value is CodexDailyUsageBreakdown {
  if (!value || typeof value !== "object") return false;
  const usage = value as Partial<CodexDailyUsageBreakdown>;
  return (
    typeof usage.days === "number" && Number.isFinite(usage.days) && usage.days >= 1 && usage.days <= 30 &&
    Array.isArray(usage.points) && usage.points.length <= 31 &&
    usage.points.every((point) => point && typeof point.date === "string" && point.date.length <= 64 &&
      typeof point.totalTokens === "number" && Number.isFinite(point.totalTokens) && point.totalTokens >= 0)
  );
}

export async function saveDashboardUsageHistory(
  context: vscode.ExtensionContext,
  samples: readonly DashboardUsageSample[]
): Promise<void> {
  const normalized = normalizeDashboardUsageHistory(samples);
  await context.globalState.update(STORAGE_KEY, normalized);
}

export async function appendDashboardUsageSnapshot(
  context: vscode.ExtensionContext,
  state: DashboardState,
  at = Date.now()
): Promise<DashboardUsageSample[]> {
  const retentionDays = state.settings.usageHistoryRetentionDays;
  const cutoff = retentionDays > 0 ? at - retentionDays * 86_400_000 : Number.NEGATIVE_INFINITY;
  const stored = readDashboardUsageHistory(context);
  const current = stored.filter((sample) => sample.at >= cutoff);
  let changed = current.length !== stored.length;
  for (const account of state.accounts) {
    const sample: DashboardUsageSample = {
      at,
      accountId: account.id,
      hourly: account.metrics.find((metric) => metric.period === "hourly")?.percentage,
      weekly: account.metrics.find((metric) => metric.period === "weekly" || metric.period === "monthly")?.percentage,
      review: account.metrics.find((metric) => metric.key.includes("review"))?.percentage
    };
    const previous = [...current].reverse().find((item) => item.accountId === account.id);
    if (
      previous &&
      previous.hourly === sample.hourly &&
      previous.weekly === sample.weekly &&
      previous.review === sample.review
    ) {
      continue;
    }
    current.push(sample);
    changed = true;
  }
  const normalized = normalizeDashboardUsageHistory(current);
  if (changed) await context.globalState.update(STORAGE_KEY, normalized);
  return normalized;
}

export function normalizeDashboardUsageHistory(value: unknown): DashboardUsageSample[] {
  if (!Array.isArray(value)) return [];
  const normalized: DashboardUsageSample[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const sample = item as Partial<DashboardUsageSample>;
    if (
      typeof sample.at !== "number" ||
      !Number.isFinite(sample.at) ||
      sample.at <= 0 ||
      typeof sample.accountId !== "string" ||
      !sample.accountId.trim() ||
      sample.accountId.length > 4096
    ) {
      continue;
    }
    const hourly = normalizePercentage(sample.hourly);
    const weekly = normalizePercentage(sample.weekly);
    const review = normalizePercentage(sample.review);
    normalized.push({
      at: sample.at,
      accountId: sample.accountId,
      ...(hourly !== undefined ? { hourly } : {}),
      ...(weekly !== undefined ? { weekly } : {}),
      ...(review !== undefined ? { review } : {})
    });
  }
  return normalized.sort((left, right) => left.at - right.at).slice(-MAX_SAMPLES);
}

function normalizePercentage(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : undefined;
}
