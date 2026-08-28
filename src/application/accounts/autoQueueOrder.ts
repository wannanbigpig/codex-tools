import type { CodexAccountRecord } from "../../core/types";
import { compareAutoQueueOrderValues, parseCreditsOrderValue } from "../../domain/autoQueueOrder";
import { isMonthlyQuotaWindow } from "../../utils/quotaLabels";
import { parseSubscriptionExpiryMs } from "../../utils/subscriptionExpiry";

export function compareCodexAccountAutoQueueOrder(left: CodexAccountRecord, right: CodexAccountRecord): number {
  const leftPriority = left.queuePriority === true && hasCodexAccountAutoQueueCapability(left);
  const rightPriority = right.queuePriority === true && hasCodexAccountAutoQueueCapability(right);
  if (leftPriority !== rightPriority) {
    return leftPriority ? -1 : 1;
  }

  return compareAutoQueueOrderValues(toOrderValue(left), toOrderValue(right));
}

export function hasCodexAccountAutoQueueCapability(account: CodexAccountRecord): boolean {
  const quota = account.quotaSummary;
  const hasQuota =
    (hasComparableHourlyWindow(account) && (quota?.hourlyPercentage ?? 0) > 0) ||
    (hasComparableWeeklyWindow(account) && (quota?.weeklyPercentage ?? 0) > 0);
  const credits = parseCreditsOrderValue(quota?.credits);
  return hasQuota || credits === Number.POSITIVE_INFINITY || (credits !== undefined && credits > 0);
}

export function hasComparableHourlyWindow(account: CodexAccountRecord): boolean {
  const quota = account.quotaSummary;
  if (!quota?.hourlyWindowPresent) {
    return false;
  }

  const windowMinutes = quota.hourlyWindowMinutes;
  return (
    typeof quota.hourlyPercentage === "number" &&
    Number.isFinite(quota.hourlyPercentage) &&
    typeof windowMinutes === "number" &&
    windowMinutes > 0 &&
    windowMinutes <= 360
  );
}

export function hasComparableWeeklyWindow(account: CodexAccountRecord): boolean {
  const quota = account.quotaSummary;
  if (!quota?.weeklyWindowPresent) {
    return false;
  }

  const windowMinutes = quota.weeklyWindowMinutes;
  return (
    typeof quota.weeklyPercentage === "number" &&
    Number.isFinite(quota.weeklyPercentage) &&
    typeof windowMinutes === "number" &&
    windowMinutes >= 1440
  );
}

function toOrderValue(account: CodexAccountRecord) {
  const quota = account.quotaSummary;
  const hourly = hasComparableHourlyWindow(account)
    ? { percentage: quota?.hourlyPercentage, resetAt: quota?.hourlyResetTime }
    : {};
  const hasLongWindow = hasComparableWeeklyWindow(account);
  const isMonthly = hasLongWindow && isMonthlyQuotaWindow(account.planType, quota?.weeklyWindowMinutes);
  const longWindow = hasLongWindow ? { percentage: quota?.weeklyPercentage, resetAt: quota?.weeklyResetTime } : {};

  return {
    windows: [hourly, isMonthly ? {} : longWindow, isMonthly ? longWindow : {}],
    credits: parseCreditsOrderValue(quota?.credits),
    subscriptionExpiresAt: parseSubscriptionExpiryMs(account.subscriptionActiveUntil),
    lastQuotaAt: account.lastQuotaAt
  };
}
