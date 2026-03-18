import { DashboardAccountViewModel, DashboardMetricViewModel, DashboardState } from "../../domain/dashboard/types";
import { AccountsRepository } from "../../storage";
import { ExtensionSettingsStore } from "../../infrastructure/config/extensionSettings";
import { formatAccountStructure, formatAuthProvider, formatPlanType, getDashboardCopy } from "./copy";
import { CodexAccountRecord } from "../../core/types";
import { resolveCodexAppLaunchPath } from "../../utils/codexApp";

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
  const sortedAccounts = [...(await repo.listAccounts())].sort(
    (a, b) => Number(b.isActive) - Number(a.isActive) || a.email.localeCompare(b.email)
  );
  const extraSelectedCount = sortedAccounts.filter((account) => !account.isActive && account.showInStatusBar).length;

  return {
    lang,
    panelTitle: copy.panelTitle,
    brandSub: copy.brandSub,
    logoUri,
    settings,
    copy,
    accounts: sortedAccounts.map((account) => mapAccount(account, extraSelectedCount, lang, settings.showCodeReviewQuota, copy))
  };
}

function mapAccount(
  account: CodexAccountRecord,
  extraSelectedCount: number,
  lang: DashboardState["lang"],
  showCodeReviewQuota: boolean,
  copy: DashboardState["copy"]
): DashboardAccountViewModel {
  const canToggleStatusBar = account.isActive ? false : Boolean(account.showInStatusBar) || extraSelectedCount < 2;

  return {
    id: account.id,
    displayName: account.accountName?.trim() ?? account.email,
    email: account.email,
    accountName: account.accountName,
    authProviderLabel: formatAuthProvider(account.authProvider, lang),
    accountStructureLabel: formatAccountStructure(account.accountStructure, lang),
    planTypeLabel: formatPlanType(account.planType, lang),
    userId: account.userId,
    accountId: account.accountId,
    organizationId: account.organizationId,
    isActive: account.isActive,
    showInStatusBar: Boolean(account.showInStatusBar),
    canToggleStatusBar,
    statusToggleTitle: canToggleStatusBar
      ? account.showInStatusBar
        ? copy.statusToggleTipChecked
        : copy.statusToggleTip
      : copy.statusLimitTip,
    hasQuota402: hasQuota402(account),
    lastQuotaAt: account.lastQuotaAt,
    metrics: buildMetrics(account, showCodeReviewQuota, copy)
  };
}

function buildMetrics(
  account: CodexAccountRecord,
  showCodeReviewQuota: boolean,
  copy: DashboardState["copy"]
): DashboardMetricViewModel[] {
  return [
    {
      key: "hourly",
      label: copy.hourlyLabel,
      percentage: account.quotaSummary?.hourlyPercentage,
      resetAt: account.quotaSummary?.hourlyResetTime,
      visible: true
    },
    {
      key: "weekly",
      label: copy.weeklyLabel,
      percentage: account.quotaSummary?.weeklyPercentage,
      resetAt: account.quotaSummary?.weeklyResetTime,
      visible: true
    },
    {
      key: "review",
      label: copy.reviewLabel,
      percentage: account.quotaSummary?.codeReviewPercentage,
      resetAt: account.quotaSummary?.codeReviewResetTime,
      visible: showCodeReviewQuota
    }
  ];
}

function hasQuota402(account: CodexAccountRecord): boolean {
  const message = account.quotaError?.message ?? "";
  if (message.includes("API returned 402")) {
    return true;
  }

  return account.quotaError?.code === "deactivated_workspace";
}
