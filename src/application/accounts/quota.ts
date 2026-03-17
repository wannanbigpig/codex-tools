import * as vscode from "vscode";
import { createError } from "../../core";
import { CodexAccountRecord } from "../../core/types";
import { QuotaRefreshResult, refreshQuota } from "../../services";
import { AccountsRepository } from "../../storage";
import { getCommandCopy, getQuotaWarningCopy } from "../../utils";

const QUOTA_WARNING_ENABLED = "quotaWarningEnabled";
const QUOTA_WARNING_THRESHOLD = "quotaWarningThreshold";
const SHOW_CODE_REVIEW_QUOTA = "showCodeReviewQuota";
const warnedQuotaKeys = new Set<string>();

export type RefreshView = {
  refresh(): void;
};

export type RefreshSingleQuotaOptions = {
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
  if (warnQuota) {
    await maybeWarnForAccount(repo, accountId);
  }

  if (announce) {
    const copy = getCommandCopy();
    if (result.error) {
      void vscode.window.showWarningMessage(copy.failedToRefresh(account.email, result.error.message));
    } else {
      void vscode.window.showInformationMessage(copy.quotaRefreshed(account.email));
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
  accountId: string
): Promise<void> {
  try {
    await refreshSingleQuota(repo, view, accountId, {
      announce: false,
      forceRefresh: false,
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

export async function maybeWarnForAccount(repo: AccountsRepository, accountId: string): Promise<void> {
  const config = vscode.workspace.getConfiguration("codexAccounts");
  if (!config.get<boolean>(QUOTA_WARNING_ENABLED)) {
    warnedQuotaKeys.clear();
    return;
  }

  const threshold = config.get<number>(QUOTA_WARNING_THRESHOLD, 20);
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
      warnedQuotaKeys.delete(warnKey);
      continue;
    }

    if (warnedQuotaKeys.has(warnKey)) {
      continue;
    }

    warnedQuotaKeys.add(warnKey);
    void vscode.window.showWarningMessage(
      copy.message(formatAccountToastLabel(account), check.label, check.value, threshold),
      { modal: true },
      copy.dismiss
    );
  }
}

export function formatAccountToastLabel(account: CodexAccountRecord): string {
  const team = account.accountName?.trim();
  if (team) {
    return `${team} · ${account.email}`;
  }
  return account.email;
}
