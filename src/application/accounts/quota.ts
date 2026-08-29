import * as vscode from "vscode";
import { createError } from "../../core";
import { CodexAccountRecord, CodexTokens } from "../../core/types";
import {
  getCodexAccountsConfiguration,
  isBackgroundTokenRefreshEnabled,
  normalizeAutoSwitchThreshold,
  normalizeQuotaWarningThreshold
} from "../../infrastructure/config/extensionSettings";
import { QuotaRefreshResult, refreshQuota, fetchResetCredits } from "../../services";
import { AccountsRepository } from "../../storage";
import { needsWindowReloadForAccount } from "../../presentation/workbench/windowRuntimeAccount";
import {
  clearAutoSwitchLock,
  consumeAutoSwitchNotice,
  isAutoSwitchLocked,
  queueAutoSwitchNotice,
  recordAutoSwitchDashboardNotice,
  recordAutoSwitchReason
} from "../../presentation/workbench/autoSwitchState";
import { clearTokenAutomationError } from "../../presentation/workbench/tokenAutomationState";
import { getCommandCopy, getLanguage, getQuotaWarningCopy, resolveLongQuotaLabel } from "../../utils";
import { getQuotaIssueKind } from "../../utils/quotaIssue";
import { getDashboardCopy } from "../dashboard/copy";
import {
  compareCodexAccountAutoQueueOrder,
  hasComparableHourlyWindow,
  hasComparableWeeklyWindow
} from "./autoQueueOrder";
import {
  autoReloadWindowForAccount,
  handleCodexAppRestartPreference,
  promptWindowReloadForAccount
} from "./switchEffects";

const AUTO_SWITCH_ENABLED = "autoSwitchEnabled";
const HOURLY_QUOTA_CONTROL_ENABLED = "hourlyQuotaControlEnabled";
const AUTO_SWITCH_RELOAD_WINDOW_ENABLED = "autoSwitchReloadWindowEnabled";
const AUTO_SWITCH_HOURLY_THRESHOLD = "autoSwitchHourlyThreshold";
const AUTO_SWITCH_WEEKLY_THRESHOLD = "autoSwitchWeeklyThreshold";
const QUOTA_WARNING_ENABLED = "quotaWarningEnabled";
const QUOTA_WARNING_THRESHOLD = "quotaWarningThreshold";
const MAX_WARNINGS_PER_CYCLE = 3;
const quotaWarningCounts = new Map<string, number>();
let autoSwitchInFlight: Promise<boolean> | undefined;
let lastBlockedAutoSwitchKey: string | undefined;
let lastAutoSwitchFailure: { key: string; shownAt: number } | undefined;
const AUTO_SWITCH_FAILURE_NOTICE_COOLDOWN_MS = 15 * 60 * 1000;

export type RefreshView = {
  refresh(): void;
  markObservedAuthIdentity?: (accountId?: string) => void;
};

type RefreshSingleQuotaOptions = {
  announce?: boolean;
  allowTokenRefresh?: boolean;
  skipDisabled?: boolean;
  awaitSubscriptionRefresh?: boolean;
  forceRefresh?: boolean;
  refreshView?: boolean;
  warnQuota?: boolean;
};

export async function refreshSingleQuota(
  repo: AccountsRepository,
  view: RefreshView,
  accountId: string,
  options: RefreshSingleQuotaOptions = {}
): Promise<QuotaRefreshResult> {
  return runAndFlush(repo, () => refreshSingleQuotaInternal(repo, view, accountId, options));
}

async function refreshSingleQuotaInternal(
  repo: AccountsRepository,
  view: RefreshView,
  accountId: string,
  options: RefreshSingleQuotaOptions = {}
): Promise<QuotaRefreshResult> {
  const announce = options.announce ?? true;
  const forceRefresh = options.forceRefresh ?? announce;
  const awaitSubscriptionRefresh = options.awaitSubscriptionRefresh ?? false;
  const shouldRefreshView = options.refreshView ?? true;
  const warnQuota = options.warnQuota ?? true;
  const account = await repo.getAccount(accountId);
  if (!account) {
    throw createError.accountNotFound(accountId);
  }
  if (account.enabled === false && options.skipDisabled) {
    if (announce) {
      void vscode.window.showWarningMessage(formatDisabledQuotaSkip(formatAccountToastLabel(account)));
    }
    return { skipped: "disabled" };
  }

  // Quota refresh can rotate OAuth tokens. Read through to SecretStorage so a
  // concurrent background refresh (or another Codex process) cannot leave this
  // request using a stale cached refresh token.
  const tokens = await repo.getTokens(accountId, { bypassCache: true });
  if (!tokens) {
    throw createError.accountNotFound(account.email);
  }

  const allowTokenRefresh =
    (options.allowTokenRefresh ?? isBackgroundTokenRefreshEnabled()) && account.tokenRefreshEnabled === true;
  let result = await refreshQuota(account, tokens, forceRefresh, {
    allowTokenRefresh
  });
  let effectiveTokens = tokens;
  if (!allowTokenRefresh && account.isActive && getQuotaIssueKind(result.error) === "auth") {
    const retry = await retryQuotaFromTrackedAuthFile(repo, accountId, account, tokens, result);
    result = retry.result;
    effectiveTokens = retry.tokens;
  }
  const updatedAccount = await repo.updateQuota(
    accountId,
    result.quota,
    result.error,
    result.updatedTokens,
    result.updatedPlanType,
    result.updatedSubscriptionActiveUntil
  );
  const subscriptionRefresh = repo.refreshSubscriptionState(accountId, forceRefresh).catch(() => undefined);
  if (awaitSubscriptionRefresh) {
    // 账号信息同步需要等订阅写入完成后再发布页面状态，避免继续展示旧套餐和旧到期时间。
    await subscriptionRefresh;
  } else {
    // Finish the account-level state write before this action reports success.
    await subscriptionRefresh;
  }
  // 后台异步拉取重置次数明细（含最新可用次数与最近到期时间），不阻塞配额刷新
  if (!result.error && updatedAccount.quotaSummary) {
    const credTokens = result.updatedTokens ?? effectiveTokens;
    const credAccountId = updatedAccount.accountId ?? account.accountId ?? undefined;
    await syncResetCreditsSnapshot(repo, view, accountId, updatedAccount, credTokens.accessToken, credAccountId);
  }
  if (!result.error) {
    clearTokenAutomationError(accountId);
  }
  if (shouldRefreshView) {
    view.refresh();
  }
  if (warnQuota && account.isActive) {
    await maybeAutoSwitchForActiveQuota(repo, view);
  }
  if (warnQuota) {
    // Keep the warning check independent from auto-switch. If auto-switch
    // succeeds the new active account normally has enough quota, while a
    // locked/failed/disabled switch still surfaces the warning choices.
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
  return result;
}

export async function refreshImportedAccountQuota(
  repo: AccountsRepository,
  accountId: string
): Promise<QuotaRefreshResult> {
  return runAndFlush(repo, () => refreshImportedAccountQuotaInternal(repo, accountId));
}

async function runAndFlush<T>(repo: AccountsRepository, task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } finally {
    await repo.flush?.();
  }
}

async function refreshImportedAccountQuotaInternal(
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

  const result = await refreshQuota(account, tokens, true, {
    allowTokenRefresh: isBackgroundTokenRefreshEnabled() && account.tokenRefreshEnabled === true
  });
  const updatedAccount = await repo.updateQuota(
    accountId,
    result.quota,
    result.error,
    result.updatedTokens,
    result.updatedPlanType,
    result.updatedSubscriptionActiveUntil
  );
  await repo.refreshSubscriptionState(accountId, true).catch(() => undefined);
  if (!result.error && updatedAccount.quotaSummary) {
    const credTokens = result.updatedTokens ?? tokens;
    const credAccountId = updatedAccount.accountId ?? account.accountId ?? undefined;
    await syncResetCreditsSnapshot(repo, undefined, accountId, updatedAccount, credTokens.accessToken, credAccountId);
  }
  if (!result.error) {
    clearTokenAutomationError(accountId);
  }
  await maybeWarnForAccount(repo, accountId);
  return result;
}

async function retryQuotaFromTrackedAuthFile(
  repo: AccountsRepository,
  accountId: string,
  account: CodexAccountRecord,
  tokens: CodexTokens,
  originalResult: QuotaRefreshResult
): Promise<{ result: QuotaRefreshResult; tokens: CodexTokens }> {
  if (typeof repo.syncActiveAccountFromAuthFile !== "function") {
    return { result: originalResult, tokens };
  }
  try {
    await repo.syncActiveAccountFromAuthFile();
    const [latestAccount, latestTokens] = await Promise.all([
      repo.getAccount(accountId),
      repo.getTokens(accountId, { bypassCache: true })
    ]);
    if (!latestAccount || !latestTokens || tokenSnapshot(latestTokens) === tokenSnapshot(tokens)) {
      return { result: originalResult, tokens };
    }

    return {
      result: await refreshQuota(latestAccount, latestTokens, true, { allowTokenRefresh: false }),
      tokens: latestTokens
    };
  } catch (error) {
    console.warn(`[codexAccounts] unable to retry quota from tracked auth.json for ${account.email}:`, error);
    return { result: originalResult, tokens };
  }
}

function tokenSnapshot(tokens: CodexTokens): string {
  return [tokens.idToken, tokens.accessToken, tokens.refreshToken ?? "", tokens.accountId ?? ""].join("\u0000");
}

async function syncResetCreditsSnapshot(
  repo: AccountsRepository,
  view: RefreshView | undefined,
  accountId: string,
  updatedAccount: CodexAccountRecord,
  accessToken: string,
  remoteAccountId?: string
): Promise<void> {
  try {
    const snapshot = await fetchResetCredits(accessToken, remoteAccountId);
    if (updatedAccount.quotaSummary) {
      updatedAccount.quotaSummary.resetCreditsAvailable = snapshot.availableCount;
      updatedAccount.quotaSummary.resetCreditsNextExpiresAt = snapshot.nextExpiresAt;
    }
    await repo
      .updateResetCreditsSnapshot(accountId, snapshot.availableCount, snapshot.nextExpiresAt)
      .catch(() => undefined);
    view?.refresh();
  } catch {
    return;
  }
}

export async function refreshSingleQuotaSafely(
  repo: AccountsRepository,
  view: RefreshView,
  accountId: string,
  options: {
    allowTokenRefresh?: boolean;
    forceRefresh?: boolean;
    announceFailure?: boolean;
    skipDisabled?: boolean;
  } = {}
): Promise<boolean> {
  try {
    const result = await refreshSingleQuota(repo, view, accountId, {
      announce: false,
      allowTokenRefresh: options.allowTokenRefresh,
      skipDisabled: options.skipDisabled ?? true,
      forceRefresh: options.forceRefresh ?? false,
      refreshView: false,
      warnQuota: false
    });
    return !result.error && !result.skipped;
  } catch (error) {
    const account = await repo.getAccount(accountId);
    const label = account ? formatAccountToastLabel(account) : accountId;
    console.warn(`[codexAccounts] auto refresh failed for ${label}:`, error);
    if (options.announceFailure) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showWarningMessage(getCommandCopy().failedToRefresh(label, message));
    }
    return false;
  }
}

function formatDisabledQuotaSkip(label: string): string {
  const lang = getLanguage();
  if (lang === "zh") {
    return `已跳过 ${label} 的配额刷新，因为该账号已禁用。`;
  }
  if (lang === "zh-hant") {
    return `已略過 ${label} 的配額重新整理，因為該帳號已停用。`;
  }
  return `Skipped quota refresh for ${label} because the account is disabled.`;
}

export async function maybeWarnForActiveQuota(repo: AccountsRepository): Promise<void> {
  const accounts = await repo.listAccounts();
  const active = accounts.find((account) => account.isActive);
  if (!active) {
    return;
  }
  await maybeWarnForAccount(repo, active.id);
}

export async function maybeAutoSwitchForActiveQuota(
  repo: AccountsRepository,
  view: RefreshView,
  options: { ignoreEnabled?: boolean; userInitiated?: boolean } = {}
): Promise<boolean> {
  if (autoSwitchInFlight) {
    return autoSwitchInFlight;
  }

  const task = evaluateAutoSwitchForActiveQuota(repo, view, options);
  autoSwitchInFlight = task;
  try {
    return await task;
  } catch (error) {
    showAutoSwitchFailure(error);
    return false;
  } finally {
    if (autoSwitchInFlight === task) {
      autoSwitchInFlight = undefined;
    }
  }
}

async function evaluateAutoSwitchForActiveQuota(
  repo: AccountsRepository,
  view: RefreshView,
  options: { ignoreEnabled?: boolean; userInitiated?: boolean }
): Promise<boolean> {
  const config = getCodexAccountsConfiguration();
  if (!options.ignoreEnabled && !config.get<boolean>(AUTO_SWITCH_ENABLED, false)) {
    lastBlockedAutoSwitchKey = undefined;
    return false;
  }

  const hourlyThreshold = normalizeAutoSwitchThreshold(config.get<number>(AUTO_SWITCH_HOURLY_THRESHOLD, 20));
  const weeklyThreshold = normalizeAutoSwitchThreshold(config.get<number>(AUTO_SWITCH_WEEKLY_THRESHOLD, 20));
  const hourlyQuotaControlEnabled = config.get<boolean>(HOURLY_QUOTA_CONTROL_ENABLED, false);
  const accounts = await repo.listAccounts();
  const active = accounts.find((account) => account.isActive);
  if (!active?.quotaSummary || active.quotaError || active.enabled === false) {
    if (options.userInitiated) {
      void vscode.window.showWarningMessage("Auto Select unavailable — refresh the active account and retry.");
    }
    return false;
  }
  if (isAutoSwitchLocked(active.id)) {
    if (options.userInitiated) {
      void vscode.window.showInformationMessage("Auto Select skipped — active account is locked.");
    }
    return false;
  }

  const activeHourlyTriggered =
    hourlyQuotaControlEnabled &&
    hasComparableHourlyWindow(active) &&
    active.quotaSummary.hourlyPercentage <= hourlyThreshold;
  const activeWeeklyTriggered =
    hasComparableWeeklyWindow(active) && active.quotaSummary.weeklyPercentage <= weeklyThreshold;
  const shouldSwitch = activeHourlyTriggered || activeWeeklyTriggered;
  if (!shouldSwitch) {
    lastBlockedAutoSwitchKey = undefined;
    if (options.userInitiated) {
      void vscode.window.showInformationMessage("No switch needed — active account has enough quota.");
    }
    return false;
  }

  const candidates = accounts
    .filter(
      (account) =>
        !account.isActive &&
        account.enabled !== false &&
        !!account.quotaSummary &&
        !account.quotaError &&
        (!activeHourlyTriggered ||
          (hasComparableHourlyWindow(account) && account.quotaSummary.hourlyPercentage > hourlyThreshold)) &&
        (!activeWeeklyTriggered ||
          (hasComparableWeeklyWindow(account) && account.quotaSummary.weeklyPercentage > weeklyThreshold))
    )
    .sort(compareAutoSwitchCandidate);

  const next = candidates[0];
  if (!next) {
    console.info("[codexAccounts] auto switch threshold reached, but no safe candidate is available", {
      activeHourlyTriggered,
      activeWeeklyTriggered,
      hourlyRemaining: active.quotaSummary.hourlyPercentage,
      weeklyRemaining: active.quotaSummary.weeklyPercentage,
      candidateCount: accounts.length - 1
    });
    const blockedKey = [
      active.id,
      activeHourlyTriggered ? `hourly:${active.quotaSummary.hourlyPercentage}` : "",
      activeWeeklyTriggered ? `weekly:${active.quotaSummary.weeklyPercentage}` : "",
      `candidates:${accounts.length - 1}`
    ].join("|");
    if (options.userInitiated || blockedKey !== lastBlockedAutoSwitchKey) {
      lastBlockedAutoSwitchKey = blockedKey;
      void vscode.window.showWarningMessage("No account switched — no enabled account has enough quota.");
    }
    return false;
  }

  lastBlockedAutoSwitchKey = undefined;
  const matchedRules = buildMatchedRules();
  await repo.switchAccount(next.id);
  console.info("[codexAccounts] auto switch completed", {
    trigger:
      activeHourlyTriggered && activeWeeklyTriggered
        ? "hourly_and_weekly"
        : activeHourlyTriggered
          ? "hourly"
          : "weekly",
    reloadEnabled: config.get<boolean>(AUTO_SWITCH_RELOAD_WINDOW_ENABLED, false)
  });
  clearAutoSwitchLock(active.id);
  recordAutoSwitchReason({
    fromAccountId: active.id,
    fromEmail: active.email,
    toAccountId: next.id,
    toEmail: next.email,
    trigger:
      activeHourlyTriggered && activeWeeklyTriggered
        ? "hourly_and_weekly"
        : activeHourlyTriggered
          ? "hourly"
          : "weekly",
    matchedRules,
    hourlyThreshold,
    weeklyThreshold,
    createdAt: Date.now()
  });
  view.markObservedAuthIdentity?.(next.id);
  view.refresh();

  const switchMessage = buildAutoSwitchSuccessMessage(next);

  if (!needsWindowReloadForAccount(next.id)) {
    recordAutoSwitchDashboardNotice(switchMessage, "info", {
      accountId: next.id,
      switchResult: "switched"
    });
    void vscode.window.showInformationMessage(switchMessage);
    return true;
  }

  if (config.get<boolean>(AUTO_SWITCH_RELOAD_WINDOW_ENABLED, false)) {
    await handleCodexAppRestartPreference({ allowManualPrompt: false });
    queueAutoSwitchNotice(buildAutoSwitchSuccessMessage(next, true), next.id);
    try {
      const reloaded = await autoReloadWindowForAccount(next.id);
      if (!reloaded) {
        consumeAutoSwitchNotice();
        const skippedMessage = `Switched to ${next.email}; reload not needed.`;
        recordAutoSwitchDashboardNotice(skippedMessage, "warning", { accountId: next.id });
        void vscode.window.showWarningMessage(skippedMessage);
      }
    } catch (error) {
      consumeAutoSwitchNotice();
      throw error;
    }
    return true;
  }

  await promptWindowReloadForAccount(next, {
    message: `${switchMessage} Reload VS Code?`
  });
  return true;
}

export async function maybeWarnForAccount(repo: AccountsRepository, accountId: string): Promise<void> {
  const config = getCodexAccountsConfiguration();
  if (!config.get<boolean>(QUOTA_WARNING_ENABLED, false)) {
    quotaWarningCounts.clear();
    return;
  }

  const threshold = normalizeQuotaWarningThreshold(config.get<number>(QUOTA_WARNING_THRESHOLD, 20));
  const hourlyQuotaControlEnabled = config.get<boolean>(HOURLY_QUOTA_CONTROL_ENABLED, false);
  const account = await repo.getAccount(accountId);
  if (!account?.isActive || !account.quotaSummary || account.enabled === false) {
    return;
  }

  const copy = getQuotaWarningCopy();
  const accounts = await repo.listAccounts();
  if (!hourlyQuotaControlEnabled) {
    clearQuotaWarningCountsForDimension("hourly");
  }

  const checks: Array<{ dimension: "hourly" | "weekly"; label: string; value: number }> = [];
  const weeklyLabel = hasComparableWeeklyWindow(account)
    ? resolveLongQuotaLabel(
        account.planType,
        account.quotaSummary.weeklyWindowMinutes,
        getLanguage(),
        copy.weeklyLabel
      )
    : undefined;
  if (hourlyQuotaControlEnabled && hasComparableHourlyWindow(account)) {
    checks.push({ dimension: "hourly", label: copy.hourlyLabel, value: account.quotaSummary.hourlyPercentage });
  } else {
    clearQuotaWarningCount(account.id, "hourly");
  }
  if (weeklyLabel) {
    checks.push({
      dimension: "weekly",
      label: weeklyLabel,
      value: account.quotaSummary.weeklyPercentage
    });
  } else {
    clearQuotaWarningCount(account.id, "weekly");
  }

  for (const check of checks) {
    const warnKey = `${account.id}:${check.dimension}:${threshold}`;
    if (typeof check.value !== "number" || check.value > threshold) {
      quotaWarningCounts.delete(warnKey);
      continue;
    }

    const warningCount = quotaWarningCounts.get(warnKey) ?? 0;
    if (warningCount >= MAX_WARNINGS_PER_CYCLE) {
      continue;
    }

    quotaWarningCounts.set(warnKey, warningCount + 1);
    const accountLabel = account.email;
    const switchTarget = selectQuotaWarningSwitchTarget(accounts, account, check.dimension, threshold);
    const switchAccount = switchTarget
      ? copy.switchAccount(formatAccountToastLabel(switchTarget))
      : undefined;
    const resetAccount = copy.resetAccount(accountLabel);
    const resetAvailable = (account.quotaSummary.resetCreditsAvailable ?? 0) > 0;
    const actions = [
      ...(switchAccount ? [switchAccount] : []),
      ...(resetAvailable ? [resetAccount] : []),
      copy.selectAccount,
      copy.later
    ];
    const warningMessage =
      copy.message(accountLabel, check.label, check.value, threshold) +
      (check.dimension !== "weekly" && weeklyLabel
        ? ` ${copy.balanceSummary(weeklyLabel, account.quotaSummary.weeklyPercentage)}`
        : "");
    void vscode.window
      .showWarningMessage(
        warningMessage,
        ...actions
      )
      .then((selection) => {
        if (switchAccount && switchTarget && selection === switchAccount) {
          void vscode.commands.executeCommand("codexAccounts.switchAccount", switchTarget);
        } else if (selection === resetAccount) {
          void vscode.commands.executeCommand("codexAccounts.consumeResetCredit", account);
        } else if (selection === copy.selectAccount) {
          void vscode.commands.executeCommand("codexAccounts.switchAccount");
        }
      });
  }
}

export function selectQuotaWarningSwitchTarget(
  accounts: CodexAccountRecord[],
  active: CodexAccountRecord,
  dimension: "hourly" | "weekly",
  threshold: number
): CodexAccountRecord | undefined {
  return accounts
    .filter((candidate) => {
      if (candidate.id === active.id || candidate.isActive || candidate.enabled === false) return false;
      if (!candidate.quotaSummary || candidate.quotaError) return false;
      if (dimension === "hourly") {
        return hasComparableHourlyWindow(candidate) && candidate.quotaSummary.hourlyPercentage > threshold;
      }
      return hasComparableWeeklyWindow(candidate) && candidate.quotaSummary.weeklyPercentage > threshold;
    })
    .sort(compareAutoSwitchCandidate)[0];
}

function clearQuotaWarningCountsForDimension(dimension: "hourly" | "weekly"): void {
  for (const key of quotaWarningCounts.keys()) {
    if (key.includes(`:${dimension}:`)) {
      quotaWarningCounts.delete(key);
    }
  }
}

function clearQuotaWarningCount(accountId: string, dimension: "hourly" | "weekly"): void {
  const prefix = `${accountId}:${dimension}:`;
  for (const key of quotaWarningCounts.keys()) {
    if (key.startsWith(prefix)) {
      quotaWarningCounts.delete(key);
    }
  }
}

export function formatAccountToastLabel(account: CodexAccountRecord): string {
  const team = account.accountName?.trim();
  if (team) {
    return `${team} · ${account.email}`;
  }
  return account.email;
}

function compareAutoSwitchCandidate(left: CodexAccountRecord, right: CodexAccountRecord): number {
  return compareCodexAccountAutoQueueOrder(left, right);
}

function buildMatchedRules(): string[] {
  return ["quota"];
}

function buildAutoSwitchSuccessMessage(account: CodexAccountRecord, reloaded = false): string {
  const copy = getDashboardCopy(getLanguage());
  const template = reloaded ? copy.autoSwitchToastSwitchedAndReloaded : copy.autoSwitchToastSwitched;
  return template.replace("{account}", account.email);
}

function showAutoSwitchFailure(error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  const key = detail.trim().toLowerCase();
  const now = Date.now();
  if (
    lastAutoSwitchFailure?.key === key &&
    now - lastAutoSwitchFailure.shownAt < AUTO_SWITCH_FAILURE_NOTICE_COOLDOWN_MS
  ) {
    return;
  }
  lastAutoSwitchFailure = { key, shownAt: now };
  const message = `Auto switch failed: ${detail}. Check the account and retry.`;
  recordAutoSwitchDashboardNotice(message, "error");
  void vscode.window.showErrorMessage(message);
}
