import { DashboardAccountViewModel, DashboardMetricViewModel, DashboardState } from "../../domain/dashboard/types";
import { AccountsRepository } from "../../storage";
import { ExtensionSettingsStore } from "../../infrastructure/config/extensionSettings";
import { formatAccountStructure, formatAuthProvider, formatPlanType, getDashboardCopy } from "./copy";
import { CodexAccountRecord } from "../../core/types";
import { resolveCodexAppLaunchPath } from "../../utils/codexApp";
import { getCurrentWindowRuntimeAccountId } from "../../presentation/workbench/windowRuntimeAccount";
import { getQuotaIssueKind } from "../../utils/quotaIssue";
import { getTokenAutomationSnapshot } from "../../presentation/workbench/tokenAutomationState";
import { getAutoSwitchRuntimeSnapshot } from "../../presentation/workbench/autoSwitchState";
import { getAccountAutomationState, isHealthDismissed, resolveAccountHealth } from "../accounts/health";

export async function buildDashboardState(
  repo: AccountsRepository,
  settingsStore: ExtensionSettingsStore,
  logoUri: string
): Promise<DashboardState> {
  const lang = settingsStore.resolveLanguage();
  const baseSettings = settingsStore.getDashboardSettings();
  const settings = {
    ...baseSettings,
    resolvedCodexAppPath: (await resolveCodexAppLaunchPath(baseSettings.codexAppPath)) ?? ""
  };
  const copy = getDashboardCopy(lang);
  const currentWindowAccountId = getCurrentWindowRuntimeAccountId();
  const tokenAutomation = getTokenAutomationSnapshot();
  const autoSwitchRuntime = getAutoSwitchRuntimeSnapshot();
  const indexHealth = await repo.getIndexHealthSummary();
  const accounts = await repo.listAccounts();
  const tokenEntries = await Promise.all(accounts.map(async (account) => [account.id, await repo.getTokens(account.id)] as const));
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
  const sortedAccounts = [...accounts].sort(
    (a, b) =>
      Number(b.isActive) - Number(a.isActive) ||
      (accountViewStateById.get(b.id)?.healthPriority ?? 0) - (accountViewStateById.get(a.id)?.healthPriority ?? 0) ||
      b.createdAt - a.createdAt ||
      a.email.localeCompare(b.email)
  );
  const extraSelectedCount = sortedAccounts.filter((account) => !account.isActive && account.showInStatusBar).length;

  return {
    lang,
    panelTitle: copy.panelTitle,
    brandSub: copy.brandSub,
    logoUri,
    settings,
    copy,
    tokenAutomation: {
      enabled: settings.backgroundTokenRefreshEnabled,
      lastCheckAt: tokenAutomation.lastSweepAt,
      nextCheckAt: tokenAutomation.nextSweepAt,
      lastRefreshAt: tokenAutomation.lastSuccessAt,
      lastFailureMessage: tokenAutomation.lastFailureMessage
    },
    indexHealth,
    accounts: sortedAccounts.map((account) =>
      mapAccount(
        account,
        accountViewStateById.get(account.id),
        extraSelectedCount,
        lang,
        settings.showCodeReviewQuota,
        copy,
        currentWindowAccountId,
        autoSwitchRuntime
      )
    )
  };
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
  showCodeReviewQuota: boolean,
  copy: DashboardState["copy"],
  currentWindowAccountId?: string,
  autoSwitchRuntime?: ReturnType<typeof getAutoSwitchRuntimeSnapshot>
): DashboardAccountViewModel {
  const canToggleStatusBar = account.isActive ? false : Boolean(account.showInStatusBar) || extraSelectedCount < 2;
  const health = viewState?.health ?? resolveAccountHealth(account, viewState?.tokens, getTokenAutomationSnapshot());
  const dismissedHealth = viewState?.dismissedHealth ?? isHealthDismissed(account, health);
  const automationState = viewState?.automationState;

  return {
    quotaIssueKind: getQuotaIssueKind(account.quotaError),
    id: account.id,
    displayName: account.accountName?.trim() ?? account.email,
    email: account.email,
    accountName: account.accountName,
    tags: [...(account.tags ?? [])],
    authProviderLabel: formatAuthProvider(account.authProvider, lang),
    accountStructureLabel: formatAccountStructure(account.accountStructure, lang),
    planTypeLabel: formatPlanType(account.planType, lang),
    userId: account.userId,
    accountId: account.accountId,
    organizationId: account.organizationId,
    isActive: account.isActive,
    isCurrentWindowAccount: account.id === currentWindowAccountId,
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
    autoSwitchLockedUntil: autoSwitchRuntime?.lockedAccountId === account.id ? autoSwitchRuntime.lockedUntil : undefined,
    lastAutoSwitchReason:
      autoSwitchRuntime?.lastReason &&
      (autoSwitchRuntime.lastReason.fromAccountId === account.id || autoSwitchRuntime.lastReason.toAccountId === account.id)
        ? autoSwitchRuntime.lastReason
        : undefined,
    metrics: buildMetrics(account, showCodeReviewQuota, copy)
  };
}

function buildMetrics(
  account: CodexAccountRecord,
  showCodeReviewQuota: boolean,
  copy: DashboardState["copy"]
): DashboardMetricViewModel[] {
  const quota = account.quotaSummary;
  return [
    {
      key: "hourly",
      label: copy.hourlyLabel,
      percentage: quota?.hourlyPercentage,
      resetAt: quota?.hourlyResetTime,
      visible: quota ? Boolean(quota.hourlyWindowPresent) : true
    },
    {
      key: "weekly",
      label: copy.weeklyLabel,
      percentage: quota?.weeklyPercentage,
      resetAt: quota?.weeklyResetTime,
      visible: quota ? Boolean(quota.weeklyWindowPresent) : true
    },
    {
      key: "review",
      label: copy.reviewLabel,
      percentage: quota?.codeReviewPercentage,
      resetAt: quota?.codeReviewResetTime,
      visible: showCodeReviewQuota && (quota ? Boolean(quota.codeReviewWindowPresent) : true)
    }
  ];
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
