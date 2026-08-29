export type AccountUsageSnapshot = {
  isActive: boolean;
  sessionStartedAt?: number;
  totalUsageMs?: number;
};

export function getCurrentSessionUsageMs(account: AccountUsageSnapshot, now = Date.now()): number {
  if (!account.isActive || !isFiniteTimestamp(account.sessionStartedAt)) {
    return 0;
  }
  return Math.max(0, now - account.sessionStartedAt);
}

export function getTotalAccountUsageMs(account: AccountUsageSnapshot, now = Date.now()): number {
  const completedUsage =
    typeof account.totalUsageMs === "number" && Number.isFinite(account.totalUsageMs)
      ? Math.max(0, account.totalUsageMs)
      : 0;
  return completedUsage + getCurrentSessionUsageMs(account, now);
}

export function formatAccountUsageDuration(
  account: AccountUsageSnapshot,
  now = Date.now(),
  lang = "en"
): string {
  const current = formatUsageDuration(getCurrentSessionUsageMs(account, now), lang);
  const total = formatUsageDuration(getTotalAccountUsageMs(account, now), lang);
  return `${current} / ${total}`;
}

export function formatUsageDuration(durationMs: number, lang = "en"): string {
  const totalMinutes = Math.max(0, Math.floor(durationMs / 60_000));
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  if (lang === "zh" || lang === "zh-hant") {
    if (days > 0) {
      return `${days}天 ${hours}小时`;
    }
    if (hours > 0) {
      return `${hours}小时 ${minutes}分`;
    }
    return `${minutes}分钟`;
  }
  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function isFiniteTimestamp(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
