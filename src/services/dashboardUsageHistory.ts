import type * as vscode from "vscode";
import type { DashboardState, DashboardUsageSample } from "../domain/dashboard/types";

const STORAGE_KEY = "codexAccounts.dashboardUsageHistory.v1";
const MAX_SAMPLES = 10_000;

export function readDashboardUsageHistory(context: vscode.ExtensionContext): DashboardUsageSample[] {
  return normalizeDashboardUsageHistory(context.globalState.get<unknown>(STORAGE_KEY));
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
