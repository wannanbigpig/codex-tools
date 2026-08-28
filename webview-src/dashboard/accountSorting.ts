import type { DashboardAccountViewModel } from "../../src/domain/dashboard/types";
import { compareAutoQueueOrderValues } from "../../src/domain/autoQueueOrder";

export function compareDashboardAutoQueueAccounts(
  left: DashboardAccountViewModel,
  right: DashboardAccountViewModel
): number {
  const metricForPeriod = (account: DashboardAccountViewModel, period: "hourly" | "weekly" | "monthly") =>
    account.metrics.find(
      (metric) =>
        metric.visible &&
        metric.period === period &&
        typeof metric.percentage === "number" &&
        Number.isFinite(metric.percentage)
    );
  const orderValue = (account: DashboardAccountViewModel) => ({
    windows: (["hourly", "weekly", "monthly"] as const).map((period) => {
      const metric = metricForPeriod(account, period);
      return { percentage: metric?.percentage, resetAt: metric?.resetAt };
    }),
    credits: account.creditsUnlimited ? Number.POSITIVE_INFINITY : account.creditsBalance,
    subscriptionExpiresAt: account.subscriptionExpiresAt,
    lastQuotaAt: account.lastQuotaAt
  });

  return compareAutoQueueOrderValues(orderValue(left), orderValue(right));
}

export function hasDashboardAutoQueueCapability(account: DashboardAccountViewModel): boolean {
  const hasQuota = account.metrics.some(
    (metric) =>
      metric.visible &&
      typeof metric.percentage === "number" &&
      Number.isFinite(metric.percentage) &&
      metric.percentage > 0
  );
  return account.creditsUnlimited === true || hasQuota || (account.creditsBalance ?? 0) > 0;
}

/**
 * Keep the account that is waiting for a window reload immediately after the
 * currently active account, regardless of the selected secondary sort key.
 * This makes a pending switch visible and actionable instead of allowing
 * quota/health/name sorting to bury it in the list.
 */
export function sortWithQueuedAccount(
  accounts: readonly DashboardAccountViewModel[],
  compare: (left: DashboardAccountViewModel, right: DashboardAccountViewModel) => number
): DashboardAccountViewModel[] {
  return [...accounts].sort((left, right) => {
    const rank = (account: DashboardAccountViewModel): number => (account.isActive ? 0 : account.switchQueued ? 1 : 2);
    return rank(left) - rank(right) || compare(left, right);
  });
}
