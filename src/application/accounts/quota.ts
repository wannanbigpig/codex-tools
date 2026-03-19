import * as vscode from "vscode";
import { createError } from "../../core";
import { CodexAccountRecord } from "../../core/types";
import { QuotaRefreshResult, refreshQuota } from "../../services";
import { AccountsRepository } from "../../storage";
import { getCommandCopy, getLanguage, getQuotaWarningCopy } from "../../utils";
import { getDashboardCopy } from "../dashboard/copy";

const AUTO_SWITCH_ENABLED = "autoSwitchEnabled";
const AUTO_SWITCH_HOURLY_THRESHOLD = "autoSwitchHourlyThreshold";
const AUTO_SWITCH_WEEKLY_THRESHOLD = "autoSwitchWeeklyThreshold";
const QUOTA_WARNING_ENABLED = "quotaWarningEnabled";
const QUOTA_WARNING_THRESHOLD = "quotaWarningThreshold";
const SHOW_CODE_REVIEW_QUOTA = "showCodeReviewQuota";
const MAX_WARNINGS_PER_CYCLE = 3;
const quotaWarningCounts = new Map<string, number>();

export type RefreshView = {
  refresh(): void;
  markObservedAuthIdentity?: (accountId?: string) => void;
};

type RefreshSingleQuotaOptions = {
  announce?: boolean;
  forceRefresh?: boolean;
  refreshView?: boolean;
  warnQuota?: boolean;
};

export async function refreshSingleQuota(
  repo: AccountsRepository,
  view: RefreshView,
  accountId: string,
  options: RefreshSingleQuotaOptions = {}
): Promise<void> {
  const announce = options.announce ?? true;
  const forceRefresh = options.forceRefresh ?? announce;
  const shouldRefreshView = options.refreshView ?? true;
  const warnQuota = options.warnQuota ?? true;
  const account = await repo.getAccount(accountId);
  if (!account) {
    return;
  }

  const tokens = await repo.getTokens(accountId);
  if (!tokens) {
    throw createError.accountNotFound(account.email);
  }

  const result = await refreshQuota(account, tokens, forceRefresh);
  await repo.updateQuota(accountId, result.quota, result.error, result.updatedTokens, result.updatedPlanType);
  if (shouldRefreshView) {
    view.refresh();
  }
  const switched = warnQuota && account.isActive ? await maybeAutoSwitchForActiveQuota(repo, view) : false;
  if (warnQuota) {
    if (switched) {
      return;
    }
    await maybeWarnForAccount(repo, accountId);
  }

  if (announce) {
    const copy = getCommandCopy();
    const label = formatAccountToastLabel(account);
    if (result.error) {
      void vscode.window.showWarningMessage(copy.failedToRefresh(label, result.error.message));
    } else {
      void vscode.window.showInformationMessage(copy.quotaRefreshed(label));
    }
  }
}

export async function refreshImportedAccountQuota(
  repo: AccountsRepository,
  accountId: string
): Promise<QuotaRefreshResult> {
  const account = await repo.getAccount(accountId);
  if (!account) {
    throw createError.accountNotFound(accountId);
  }

  const tokens = await repo.getTokens(accountId);
  if (!tokens) {
    throw createError.accountNotFound(account.email);
  }

  const result = await refreshQuota(account, tokens, true);
  await repo.updateQuota(accountId, result.quota, result.error, result.updatedTokens, result.updatedPlanType);
  await maybeWarnForAccount(repo, accountId);
  return result;
}

export async function refreshSingleQuotaSafely(
  repo: AccountsRepository,
  view: RefreshView,
  accountId: string,
  options: { forceRefresh?: boolean } = {}
): Promise<void> {
  try {
    await refreshSingleQuota(repo, view, accountId, {
      announce: false,
      forceRefresh: options.forceRefresh ?? false,
      refreshView: false,
      warnQuota: false
    });
  } catch (error) {
    const account = await repo.getAccount(accountId);
    const label = account ? formatAccountToastLabel(account) : accountId;
    console.warn(`[codexAccounts] auto refresh failed for ${label}:`, error);
  }
}

export async function maybeWarnForActiveQuota(repo: AccountsRepository): Promise<void> {
  const accounts = await repo.listAccounts();
  const active = accounts.find((account) => account.isActive);
  if (!active) {
    return;
  }
  await maybeWarnForAccount(repo, active.id);
}

export async function maybeAutoSwitchForActiveQuota(repo: AccountsRepository, view: RefreshView): Promise<boolean> {
  const config = vscode.workspace.getConfiguration("codexAccounts");
  if (!config.get<boolean>(AUTO_SWITCH_ENABLED, false)) {
    return false;
  }

  const hourlyThreshold = normalizeAutoSwitchThreshold(config.get<number>(AUTO_SWITCH_HOURLY_THRESHOLD, 20));
  const weeklyThreshold = normalizeAutoSwitchThreshold(config.get<number>(AUTO_SWITCH_WEEKLY_THRESHOLD, 20));
  const accounts = await repo.listAccounts();
  const active = accounts.find((account) => account.isActive);
  if (!active?.quotaSummary || active.quotaError) {
    return false;
  }

  const activeHourlyTriggered =
    hasComparableHourlyWindow(active) && active.quotaSummary.hourlyPercentage <= hourlyThreshold;
  const activeWeeklyTriggered =
    hasComparableWeeklyWindow(active) && active.quotaSummary.weeklyPercentage <= weeklyThreshold;
  const shouldSwitch = activeHourlyTriggered || activeWeeklyTriggered;
  if (!shouldSwitch) {
    return false;
  }

  const candidates = accounts
    .filter(
      (account) =>
        !account.isActive &&
        !!account.quotaSummary &&
        !account.quotaError &&
        (!activeHourlyTriggered ||
          (hasComparableHourlyWindow(account) && account.quotaSummary.hourlyPercentage > hourlyThreshold)) &&
        (!activeWeeklyTriggered ||
          (hasComparableWeeklyWindow(account) && account.quotaSummary.weeklyPercentage > weeklyThreshold))
    )
    .sort(compareAutoSwitchCandidate(hourlyThreshold, weeklyThreshold));

  const next = candidates[0];
  if (!next) {
    return false;
  }

  await repo.switchAccount(next.id);
  view.markObservedAuthIdentity?.(next.id);
  view.refresh();

  const copy = getDashboardCopy(getLanguage());
  const commandCopy = getCommandCopy();
  const choice = await vscode.window.showInformationMessage(
    `${copy.autoSwitchToastSwitched.replace("{account}", formatAccountToastLabel(next))} ${commandCopy.switchedAndAskReload(next.email)}`,
    commandCopy.reloadNow,
    commandCopy.later
  );
  if (choice === commandCopy.reloadNow) {
    await vscode.commands.executeCommand("workbench.action.reloadWindow");
  }
  return true;
}

export async function maybeWarnForAccount(repo: AccountsRepository, accountId: string): Promise<void> {
  const config = vscode.workspace.getConfiguration("codexAccounts");
  if (!config.get<boolean>(QUOTA_WARNING_ENABLED, false)) {
    quotaWarningCounts.clear();
    return;
  }

  const threshold = normalizeQuotaWarningThreshold(config.get<number>(QUOTA_WARNING_THRESHOLD, 20));
  const showCodeReview = config.get<boolean>(SHOW_CODE_REVIEW_QUOTA, true);
  const account = await repo.getAccount(accountId);
  if (!account?.isActive || !account.quotaSummary) {
    return;
  }

  const copy = getQuotaWarningCopy();
  const checks = [
    { label: copy.hourlyLabel, value: account.quotaSummary.hourlyPercentage },
    { label: copy.weeklyLabel, value: account.quotaSummary.weeklyPercentage },
    ...(showCodeReview ? [{ label: copy.reviewLabel, value: account.quotaSummary.codeReviewPercentage }] : [])
  ];

  for (const check of checks) {
    const warnKey = `${account.id}:${check.label}:${threshold}`;
    if (typeof check.value !== "number" || check.value > threshold) {
      quotaWarningCounts.delete(warnKey);
      continue;
    }

    const warningCount = quotaWarningCounts.get(warnKey) ?? 0;
    if (warningCount >= MAX_WARNINGS_PER_CYCLE) {
      continue;
    }

    quotaWarningCounts.set(warnKey, warningCount + 1);
    void vscode.window
      .showWarningMessage(
        copy.message(formatAccountToastLabel(account), check.label, check.value, threshold),
        copy.dismiss,
        copy.switchNow
      )
      .then((selection) => {
        if (selection === copy.switchNow) {
          void vscode.commands.executeCommand("codexAccounts.switchAccount");
        }
      });
  }
}

function normalizeAutoSwitchThreshold(value: number): number {
  if (!Number.isFinite(value)) {
    return 20;
  }

  return Math.max(1, Math.min(20, Math.round(value)));
}

function normalizeQuotaWarningThreshold(value: number): number {
  if (!Number.isFinite(value)) {
    return 20;
  }

  const snapped = Math.round(value / 5) * 5;
  return Math.max(5, Math.min(90, snapped));
}

export function formatAccountToastLabel(account: CodexAccountRecord): string {
  const team = account.accountName?.trim();
  if (team) {
    return `${team} · ${account.email}`;
  }
  return account.email;
}

function compareAutoSwitchCandidate(hourlyThreshold: number, weeklyThreshold: number) {
  return (left: CodexAccountRecord, right: CodexAccountRecord): number => {
    const leftScore = getAutoSwitchScore(left, hourlyThreshold, weeklyThreshold);
    const rightScore = getAutoSwitchScore(right, hourlyThreshold, weeklyThreshold);
    return rightScore - leftScore;
  };
}

function getAutoSwitchScore(account: CodexAccountRecord, hourlyThreshold: number, weeklyThreshold: number): number {
  const quota = account.quotaSummary;
  if (!quota) {
    return Number.NEGATIVE_INFINITY;
  }

  const hourlyMargin = hasComparableHourlyWindow(account) ? quota.hourlyPercentage - hourlyThreshold : -1000;
  const weeklyMargin = hasComparableWeeklyWindow(account) ? quota.weeklyPercentage - weeklyThreshold : -1000;
  const safetyFloor = Math.min(hourlyMargin, weeklyMargin);
  const workspacePriority = getAutoSwitchWorkspacePriority(account);
  const freshness = account.lastQuotaAt ?? 0;

  return workspacePriority * 1_000_000 + safetyFloor * 1000 + hourlyMargin + weeklyMargin + freshness / 1_000_000_000_000;
}

function hasComparableHourlyWindow(account: CodexAccountRecord): boolean {
  const quota = account.quotaSummary;
  if (!quota?.hourlyWindowPresent) {
    return false;
  }

  const windowMinutes = quota.hourlyWindowMinutes;
  return typeof windowMinutes === "number" && windowMinutes > 0 && windowMinutes <= 360;
}

function hasComparableWeeklyWindow(account: CodexAccountRecord): boolean {
  const quota = account.quotaSummary;
  if (!quota?.weeklyWindowPresent) {
    return false;
  }

  const windowMinutes = quota.weeklyWindowMinutes;
  return typeof windowMinutes === "number" && windowMinutes >= 1440;
}

function getAutoSwitchWorkspacePriority(account: CodexAccountRecord): number {
  const normalized = account.accountStructure?.trim().toLowerCase();
  if (normalized === "organization") {
    return 3;
  }
  if (normalized === "team" || normalized === "workspace") {
    return 2;
  }
  if (normalized === "personal") {
    return 0;
  }
  return 1;
}
