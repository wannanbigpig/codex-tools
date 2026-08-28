import {
  DashboardAccountViewModel,
  DashboardCopy,
  DashboardMetricViewModel,
  DashboardState
} from "../../domain/dashboard/types";
import { parseCreditsOrderValue } from "../../domain/autoQueueOrder";
import { AccountsRepository } from "../../storage";
import { ExtensionSettingsStore } from "../../infrastructure/config/extensionSettings";
import { formatAccountStructure, formatAuthProvider, formatPlanType, getDashboardCopy } from "./copy";
import { CodexAccountRecord, CodexCreditsSummary, CodexTokens, type CodexAnnouncementState } from "../../core/types";
import { resolveCodexAppLaunchPath } from "../../utils/codexApp";
import {
  getCurrentWindowRuntimeAccountId,
  getQueuedAccountSwitch
} from "../../presentation/workbench/windowRuntimeAccount";
import { getQuotaIssueKind } from "../../utils/quotaIssue";
import { getTokenAutomationSnapshot } from "../../presentation/workbench/tokenAutomationState";
import { getAutoSwitchRuntimeSnapshot } from "../../presentation/workbench/autoSwitchState";
import { getAccountAutomationState, isHealthDismissed, resolveAccountHealth } from "../accounts/health";
import { isFreePlanType, isMonthlyQuotaWindow, resolveLongQuotaLabel } from "../../utils/quotaLabels";
import { parseSubscriptionExpiryMs } from "../../utils/subscriptionExpiry";
import {
  doesEncryptedSyncNeedConfiguration,
  doesEncryptedSyncNeedSettingsSync,
  getEncryptedSyncStatus,
  getPendingEnablementAccountIds,
  getSyncedAccountLeases,
  isEncryptedSyncRegistryOverrideEnabled
} from "../../services/encryptedSync";

export async function buildDashboardState(
  repo: AccountsRepository,
  settingsStore: ExtensionSettingsStore,
  logoUri: string,
  announcements: CodexAnnouncementState
): Promise<DashboardState> {
  const lang = settingsStore.resolveLanguage();
  const baseSettings = settingsStore.getDashboardSettings();
  const settings = {
    ...baseSettings,
    encryptedSyncRegistryOverrideEnabled: isEncryptedSyncRegistryOverrideEnabled(),
    resolvedCodexAppPath: (await resolveCodexAppLaunchPath(baseSettings.codexAppPath)) ?? ""
  };
  const copy = getDashboardCopy(lang);
  const encryptedSyncStatus = getEncryptedSyncStatus();
  const currentWindowAccountId = getCurrentWindowRuntimeAccountId();
  const tokenAutomation = getTokenAutomationSnapshot();
  const autoSwitchRuntime = getAutoSwitchRuntimeSnapshot();
  const indexHealth = await repo.getIndexHealthSummary();
  const accounts = await repo.listAccounts();
  const activeAccount = accounts.find((account) => account.isActive);
  const queuedSwitch = resolveDashboardQueuedSwitch(accounts, getQueuedAccountSwitch());
  const leasesByAccountId = new Map(getSyncedAccountLeases().map((lease) => [lease.accountId, lease]));
  const pendingEnablementAccountIds = new Set(getPendingEnablementAccountIds());
  const tokenEntries = await Promise.all(
    accounts.map(async (account) => [account.id, await repo.getTokens(account.id, { syncExternal: false })] as const)
  );
  const tokensByAccountId = new Map(tokenEntries);
  const accountViewStateById = new Map(
    accounts.map((account) => {
      const tokens = tokensByAccountId.get(account.id);
      const health = resolveAccountHealth(account, tokens, tokenAutomation);
      return [
        account.id,
        {
          tokens,
          health,
          dismissedHealth: isHealthDismissed(account, health),
          automationState: getAccountAutomationState(tokenAutomation, account.id),
          healthPriority: getHealthPriority(health)
        }
      ] as const;
    })
  );
  const sortedAccounts = sortDashboardAccounts(accounts, currentWindowAccountId, accountViewStateById);
  const extraSelectedCount = sortedAccounts.filter((account) => !account.isActive && account.showInStatusBar).length;

  return {
    lang,
    panelTitle: copy.panelTitle,
    brandSub: copy.brandSub,
    logoUri,
    settings,
    encryptedSyncNeedsConfiguration: doesEncryptedSyncNeedConfiguration(),
    encryptedSyncNeedsSettingsSync: doesEncryptedSyncNeedSettingsSync(),
    encryptedSyncLastCompletedAt: encryptedSyncStatus.lastCompletedAt,
    encryptedSyncSessionCount: encryptedSyncStatus.sessionCount,
    encryptedSyncEnabledSessionCount: encryptedSyncStatus.enabledSessionCount,
    copy,
    tokenAutomation: {
      enabled: settings.backgroundTokenRefreshEnabled,
      lastCheckAt: tokenAutomation.lastSweepAt,
      nextCheckAt: tokenAutomation.nextSweepAt,
      lastRefreshAt: tokenAutomation.lastSuccessAt,
      lastFailureMessage: tokenAutomation.lastFailureMessage
    },
    announcements,
    indexHealth,
    terminalNotice: resolveTerminalNotice(autoSwitchRuntime.dashboardNotice, activeAccount, copy),
    accounts: sortedAccounts.map((account) =>
      mapAccount(
        account,
        accountViewStateById.get(account.id),
        extraSelectedCount,
        lang,
        copy,
        currentWindowAccountId,
        autoSwitchRuntime,
        leasesByAccountId.get(account.id),
        queuedSwitch,
        pendingEnablementAccountIds.has(account.id)
      )
    )
  };
}

function resolveTerminalNotice(
  notice: ReturnType<typeof getAutoSwitchRuntimeSnapshot>["dashboardNotice"],
  activeAccount: CodexAccountRecord | undefined,
  copy: DashboardCopy
): DashboardState["terminalNotice"] {
  if (!notice) {
    return undefined;
  }
  if (notice.accountId && activeAccount && notice.accountId !== activeAccount.id) {
    return undefined;
  }
  if (!notice.switchResult || !activeAccount) {
    return notice;
  }

  const template =
    notice.switchResult === "switched-and-reloaded"
      ? copy.autoSwitchToastSwitchedAndReloaded
      : copy.autoSwitchToastSwitched;
  return {
    level: notice.level,
    message: template.replace("{account}", activeAccount.email),
    createdAt: notice.createdAt
  };
}

export function resolveDashboardQueuedSwitch(
  accounts: readonly Pick<CodexAccountRecord, "id">[],
  queuedSwitch: ReturnType<typeof getQueuedAccountSwitch>
): ReturnType<typeof getQueuedAccountSwitch> {
  if (!queuedSwitch?.fromAccountId || queuedSwitch.fromAccountId === queuedSwitch.toAccountId) {
    return undefined;
  }

  const accountIds = new Set(accounts.map((account) => account.id));
  return accountIds.has(queuedSwitch.fromAccountId) && accountIds.has(queuedSwitch.toAccountId)
    ? queuedSwitch
    : undefined;
}

export function sortDashboardAccounts<T extends Pick<CodexAccountRecord, "id" | "isActive" | "createdAt" | "email">>(
  accounts: readonly T[],
  currentWindowAccountId?: string,
  accountViewStateById?: Map<string, { healthPriority: number }>
): T[] {
  return [...accounts].sort(
    (a, b) =>
      Number(b.id === currentWindowAccountId) - Number(a.id === currentWindowAccountId) ||
      Number(b.isActive) - Number(a.isActive) ||
      (accountViewStateById?.get(b.id)?.healthPriority ?? 0) - (accountViewStateById?.get(a.id)?.healthPriority ?? 0) ||
      b.createdAt - a.createdAt ||
      a.email.localeCompare(b.email)
  );
}

function mapAccount(
  account: CodexAccountRecord,
  viewState:
    | {
        tokens: Awaited<ReturnType<AccountsRepository["getTokens"]>>;
        health: ReturnType<typeof resolveAccountHealth>;
        dismissedHealth: boolean;
        automationState: ReturnType<typeof getAccountAutomationState>;
      }
    | undefined,
  extraSelectedCount: number,
  lang: DashboardState["lang"],
  copy: DashboardState["copy"],
  currentWindowAccountId?: string,
  autoSwitchRuntime?: ReturnType<typeof getAutoSwitchRuntimeSnapshot>,
  accountLease?: ReturnType<typeof getSyncedAccountLeases>[number],
  queuedSwitch?: ReturnType<typeof getQueuedAccountSwitch>,
  enablementSyncPending = false
): DashboardAccountViewModel {
  const canToggleStatusBar = account.isActive ? false : Boolean(account.showInStatusBar) || extraSelectedCount < 2;
  const health = viewState?.health ?? resolveAccountHealth(account, viewState?.tokens, getTokenAutomationSnapshot());
  const dismissedHealth = viewState?.dismissedHealth ?? isHealthDismissed(account, health);
  const automationState = viewState?.automationState;
  const switchQueued = queuedSwitch?.toAccountId === account.id;
  const displayedIsActive = switchQueued
    ? false
    : queuedSwitch?.fromAccountId === account.id
      ? true
      : account.isActive;
  const subscription = resolveSubscriptionDisplay(account, viewState?.tokens, copy, lang);
  const subscriptionExpiresAt = readSubscriptionTimestampMs(account, viewState?.tokens);
  const creditsOrderValue = parseCreditsOrderValue(account.quotaSummary?.credits);
  const resetCreditsAvailable = account.quotaSummary?.resetCreditsAvailable;
  const resetCreditsNextExpiresAt = account.quotaSummary?.resetCreditsNextExpiresAt;
  if ((resetCreditsAvailable ?? 0) > 0 && resetCreditsNextExpiresAt == null) {
    console.info("[codexAccounts] dashboard state missing reset credits expiry", {
      accountId: account.id,
      remoteAccountId: account.accountId,
      resetCreditsAvailable,
      lastQuotaAt: account.lastQuotaAt ?? null,
      updatedAt: account.updatedAt
    });
  }

  return {
    quotaIssueKind: getQuotaIssueKind(account.quotaError),
    id: account.id,
    displayName: account.accountName?.trim() ?? account.email,
    email: account.email,
    authMode: account.authMode ?? "chatgpt",
    accountName: account.accountName,
    tags: [...(account.tags ?? [])],
    authProviderLabel: formatAuthProvider(account.authProvider, lang),
    accountStructureLabel: formatAccountStructure(account.accountStructure, lang),
    workspaceLabel: resolveWorkspaceDisplay(account),
    isTeamWorkspace: isTeamWorkspace(account),
    subscriptionText: subscription.text,
    subscriptionTitle: subscription.title,
    subscriptionColor: subscription.color,
    subscriptionExpiresAt,
    addMethodLabel: `${formatAddMethod(account.addedVia, lang)} | ${formatAuthProvider(account.authProvider, lang)}`,
    addedAtLabel: formatAddedAt(account.createdAt, copy.never),
    loginAt: account.loginAt,
    sessionStartedAt: account.sessionStartedAt,
    totalUsageMs: account.totalUsageMs,
    runningDeviceName: accountLease?.deviceName,
    runningOnThisDevice: accountLease?.isCurrentDevice,
    enablementSyncPending,
    statusColor: displayedIsActive ? "var(--accent-green)" : health.kind === "healthy" ? undefined : "#ef4444",
    planTypeLabel: formatPlanTypeWithQuota(account, lang),
    creditsText: formatCreditsText(account.quotaSummary?.credits, lang),
    creditsBalance:
      creditsOrderValue !== undefined && Number.isFinite(creditsOrderValue) ? creditsOrderValue : undefined,
    creditsUnlimited: creditsOrderValue === Number.POSITIVE_INFINITY,
    userId: account.userId,
    accountId: account.accountId,
    organizationId: account.organizationId,
    isActive: displayedIsActive,
    isCurrentWindowAccount: account.id === currentWindowAccountId,
    enabled: account.enabled !== false,
    queuePriority: account.queuePriority === true,
    tokenRefreshEnabled: account.tokenRefreshEnabled === true,
    canRefreshToken: Boolean(viewState?.tokens?.refreshToken?.trim()),
    switchQueued,
    showInStatusBar: Boolean(account.showInStatusBar),
    canToggleStatusBar,
    statusToggleTitle: canToggleStatusBar
      ? account.showInStatusBar
        ? copy.statusToggleTipChecked
        : copy.statusToggleTip
      : copy.statusLimitTip,
    hasQuota402: hasQuota402(account),
    healthKind: health.kind,
    healthLabel: formatHealthLabel(health.kind, copy),
    healthMessage: health.message,
    healthIssueKey: health.issueKey,
    dismissedHealth,
    lastTokenCheckAt: automationState?.lastCheckAt,
    lastTokenRefreshAt: automationState?.lastRefreshAt,
    lastTokenRefreshError: automationState?.lastError,
    lastQuotaAt: account.lastQuotaAt,
    resetCreditsAvailable,
    resetCreditsNextExpiresAt,
    autoSwitchLockedUntil:
      autoSwitchRuntime?.lockedAccountId === account.id ? autoSwitchRuntime.lockedUntil : undefined,
    metrics: buildMetrics(account, copy, lang)
  };
}

export function buildMetrics(
  account: CodexAccountRecord,
  copy: DashboardState["copy"],
  lang: DashboardState["lang"]
): DashboardMetricViewModel[] {
  const quota = account.quotaSummary;
  const isFree = isFreePlanType(account.planType);
  const metrics: DashboardMetricViewModel[] = [];

  if (!isFree) {
    metrics.push({
      key: "hourly",
      label: copy.hourlyLabel,
      period: "hourly",
      percentage: quota?.hourlyPercentage,
      resetAt: quota?.hourlyResetTime,
      requestsLeft: quota?.hourlyRequestsLeft,
      requestsLimit: quota?.hourlyRequestsLimit,
      visible: quota ? Boolean(quota.hourlyWindowPresent) : true
    });
  }

  metrics.push({
    key: "weekly",
    label: resolveLongQuotaLabel(account.planType, quota?.weeklyWindowMinutes, lang, copy.weeklyLabel),
    period: isMonthlyQuotaWindow(account.planType, quota?.weeklyWindowMinutes) ? "monthly" : "weekly",
    percentage: quota?.weeklyPercentage,
    resetAt: quota?.weeklyResetTime,
    requestsLeft: quota?.weeklyRequestsLeft,
    requestsLimit: quota?.weeklyRequestsLimit,
    visible: quota ? Boolean(quota.weeklyWindowPresent) : true
  });

  for (const [index, limit] of quota?.additionalRateLimits?.entries() ?? []) {
    if (limit.hourlyWindowPresent) {
      metrics.push({
        key: `additional-${index}-hourly`,
        label: `${limit.limitName} ${copy.hourlyLabel}`,
        period: "hourly",
        percentage: limit.hourlyPercentage,
        resetAt: limit.hourlyResetTime,
        requestsLeft: limit.hourlyRequestsLeft,
        requestsLimit: limit.hourlyRequestsLimit,
        visible: true
      });
    }
    if (limit.weeklyWindowPresent) {
      metrics.push({
        key: `additional-${index}-weekly`,
        label: `${limit.limitName} ${resolveLongQuotaLabel(undefined, limit.weeklyWindowMinutes, lang, copy.weeklyLabel)}`,
        period: isMonthlyQuotaWindow(undefined, limit.weeklyWindowMinutes) ? "monthly" : "weekly",
        percentage: limit.weeklyPercentage,
        resetAt: limit.weeklyResetTime,
        requestsLeft: limit.weeklyRequestsLeft,
        requestsLimit: limit.weeklyRequestsLimit,
        visible: true
      });
    }
  }

  return metrics;
}

function hasQuota402(account: CodexAccountRecord): boolean {
  return getQuotaIssueKind(account.quotaError) === "disabled";
}

function formatHealthLabel(kind: DashboardAccountViewModel["healthKind"], copy: DashboardState["copy"]): string {
  switch (kind) {
    case "expiring":
      return copy.tokenAutomationExpiring;
    case "refresh_failed":
      return copy.tokenAutomationRefreshFailed;
    case "reauthorize":
      return copy.tokenAutomationReauthorize;
    case "disabled":
      return copy.tokenAutomationDisabled;
    case "quota":
      return copy.tokenAutomationQuota;
    default:
      return copy.tokenAutomationHealthy;
  }
}

function resolveWorkspaceDisplay(account: CodexAccountRecord): string {
  if (!isTeamWorkspace(account)) {
    return "Personal";
  }

  const name = account.accountName?.trim();
  return name ? `Team | ${name}` : "Team";
}

function isTeamWorkspace(account: CodexAccountRecord): boolean {
  const structure = account.accountStructure?.trim().toLowerCase();
  return Boolean(structure && structure !== "personal");
}

export function resolveSubscriptionDisplay(
  account: CodexAccountRecord,
  tokens: CodexTokens | undefined,
  copy: DashboardState["copy"],
  lang: DashboardState["lang"]
): { text: string; title: string; color?: string } {
  const timestampMs = readSubscriptionTimestampMs(account, tokens);
  if (!timestampMs) {
    return {
      text: copy.unknown,
      title: copy.unknown
    };
  }

  const diffMs = timestampMs - Date.now();
  const dateText = formatSubscriptionDate(new Date(timestampMs));
  const days = Math.max(0, Math.ceil(diffMs / 86_400_000));
  const dayUnit = lang === "zh-hant" || lang === "zh" ? "天" : "d";
  const text =
    lang === "zh" || lang === "zh-hant" ? `${dateText}（${days} ${dayUnit}）` : `${dateText} (${days}${dayUnit})`;
  const color = diffMs <= 3 * 86_400_000 ? "#ef4444" : diffMs <= 10 * 86_400_000 ? "#f59e0b" : "var(--accent-green)";

  return {
    text,
    title: text,
    color
  };
}

function readSubscriptionTimestampMs(account: CodexAccountRecord, tokens: CodexTokens | undefined): number | undefined {
  const idAuth = getOpenAiAuthClaims(tokens?.idToken);
  const accessAuth = getOpenAiAuthClaims(tokens?.accessToken);
  const raw = normalizeSubscriptionValue(
    account.subscriptionActiveUntil ??
      idAuth?.["chatgpt_subscription_active_until"] ??
      accessAuth?.["chatgpt_subscription_active_until"]
  );
  if (!raw) {
    return undefined;
  }

  return parseSubscriptionExpiryMs(raw);
}

function formatPlanTypeWithQuota(account: CodexAccountRecord, lang: DashboardState["lang"]): string {
  const base = formatPlanType(account.planType, lang);
  const normalized = account.planType?.trim().toLowerCase();
  if (!normalized?.includes("pro")) {
    return base;
  }

  const multiplier = inferProQuotaMultiplier(account);
  return multiplier ? `Pro ${multiplier}` : base;
}

function formatCreditsText(credits: CodexCreditsSummary | undefined, lang: DashboardState["lang"]): string | undefined {
  if (!credits) {
    return undefined;
  }

  const zh = lang === "zh" || lang === "zh-hant";
  const numericBalance = Number(credits.balance.replace(/[^0-9.-]/g, ""));
  if (
    !credits.unlimited &&
    (!credits.hasCredits || (credits.balance.trim() && Number.isFinite(numericBalance) && numericBalance <= 0))
  ) {
    return undefined;
  }
  const value = credits.unlimited ? (zh ? "无限" : "Unlimited") : credits.balance || (zh ? "可用" : "Available");
  const label = zh ? "额度" : "Credit";
  return `${label}: ${value}`;
}

function inferProQuotaMultiplier(account: CodexAccountRecord): "5x" | "20x" | undefined {
  const signals = collectQuotaPlanSignals(account.quotaSummary?.rawData);
  if (account.planType) {
    signals.unshift(account.planType);
  }

  let saw5x = false;
  let saw20x = false;
  for (const signal of signals) {
    const normalized = signal.toLowerCase();
    if (/(^|[^a-z0-9])(?:pro[_\s-]*)?20\s*x([^a-z0-9]|$)/.test(normalized)) {
      saw20x = true;
    }
    if (/(^|[^a-z0-9])(?:pro[_\s-]*)?5\s*x([^a-z0-9]|$)/.test(normalized)) {
      saw5x = true;
    }
  }

  return saw20x ? "20x" : saw5x ? "5x" : undefined;
}

function collectQuotaPlanSignals(value: unknown, depth = 0): string[] {
  if (depth > 4 || value == null) {
    return [];
  }

  if (typeof value === "string") {
    return [value];
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectQuotaPlanSignals(item, depth + 1));
  }

  if (typeof value !== "object") {
    return [];
  }

  const signals: string[] = [];
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "string") {
      signals.push(`${key}:${entry}`);
    }
    signals.push(...collectQuotaPlanSignals(entry, depth + 1));
  }
  return signals;
}

function getOpenAiAuthClaims(token: string | undefined): Record<string, unknown> | undefined {
  const payload = decodeJwtPayload(token);
  const auth = payload?.["https://api.openai.com/auth"];
  return auth && typeof auth === "object" && !Array.isArray(auth) ? (auth as Record<string, unknown>) : undefined;
}

function decodeJwtPayload(token: string | undefined): Record<string, unknown> | undefined {
  const raw = token?.trim();
  if (!raw) {
    return undefined;
  }

  try {
    const payload = raw.split(".")[1];
    if (!payload) {
      return undefined;
    }
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function normalizeSubscriptionValue(value: unknown): string | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value === "string") {
    return value.trim() || undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const key of [
      "value",
      "timestamp",
      "ts",
      "seconds",
      "sec",
      "unix",
      "epoch",
      "epoch_seconds",
      "epochSeconds"
    ]) {
      const normalized = normalizeSubscriptionValue(record[key]);
      if (normalized) {
        return normalized;
      }
    }
  }
  return undefined;
}

function formatSubscriptionDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatAddedAt(epochMs: number | undefined, fallback: string): string {
  if (!epochMs) {
    return fallback;
  }

  const date = new Date(epochMs);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatAddMethod(value: string | undefined, lang: DashboardState["lang"]): string {
  const normalized = value?.trim().toLowerCase();
  const zh = lang === "zh" || lang === "zh-hant";
  switch (normalized) {
    case "local":
      return zh ? "本地导入" : "Local import";
    case "json":
      return zh ? "JSON导入" : "JSON import";
    case "oauth":
      return zh ? "OAuth授权" : "OAuth";
    case "token":
      return zh ? "Token导入" : "Token import";
    case "apikey":
      return zh ? "API Key导入" : "API key import";
    default:
      return zh ? "未知来源" : "Unknown source";
  }
}

function getHealthPriority(health: ReturnType<typeof resolveAccountHealth>): number {
  switch (health.kind) {
    case "reauthorize":
      return 5;
    case "disabled":
      return 4;
    case "refresh_failed":
      return 3;
    case "quota":
      return 2;
    case "expiring":
      return 1;
    default:
      return 0;
  }
}
