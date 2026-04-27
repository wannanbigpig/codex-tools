import { CodexAdditionalQuotaLimit, CodexCreditsSummary, CodexQuotaSummary } from "../core/types";

const MAX_HOURLY_WINDOW_MINUTES = 360;
const MIN_WEEKLY_WINDOW_MINUTES = 1440;

type QuotaWindowSnapshot = {
  slot: "hourly" | "weekly";
  percentage: number;
  resetTime?: number;
  requestsLeft?: number;
  requestsLimit?: number;
  windowMinutes?: number;
};

export function normalizeQuotaSummary(summary?: CodexQuotaSummary): CodexQuotaSummary | undefined {
  if (!summary) {
    return summary;
  }

  const hourlyWindow = createQuotaWindowSnapshot(
    "hourly",
    summary.hourlyWindowPresent,
    summary.hourlyPercentage,
    summary.hourlyResetTime,
    summary.hourlyRequestsLeft,
    summary.hourlyRequestsLimit,
    summary.hourlyWindowMinutes
  );
  const weeklyWindow = createQuotaWindowSnapshot(
    "weekly",
    summary.weeklyWindowPresent,
    summary.weeklyPercentage,
    summary.weeklyResetTime,
    summary.weeklyRequestsLeft,
    summary.weeklyRequestsLimit,
    summary.weeklyWindowMinutes
  );

  const classified = classifyQuotaWindows([hourlyWindow, weeklyWindow].filter(Boolean) as QuotaWindowSnapshot[]);
  const resolvedHourly = classified.hourly ?? (isHourlyWindow(hourlyWindow) ? hourlyWindow : undefined);
  const resolvedWeekly = classified.weekly ?? (isWeeklyWindow(weeklyWindow) ? weeklyWindow : undefined);

  return {
    hourlyPercentage: resolvedHourly?.percentage ?? 0,
    hourlyResetTime: resolvedHourly?.resetTime,
    hourlyRequestsLeft: resolvedHourly?.requestsLeft,
    hourlyRequestsLimit: resolvedHourly?.requestsLimit,
    hourlyWindowMinutes: resolvedHourly?.windowMinutes,
    hourlyWindowPresent: Boolean(resolvedHourly),
    weeklyPercentage: resolvedWeekly?.percentage ?? 0,
    weeklyResetTime: resolvedWeekly?.resetTime,
    weeklyRequestsLeft: resolvedWeekly?.requestsLeft,
    weeklyRequestsLimit: resolvedWeekly?.requestsLimit,
    weeklyWindowMinutes: resolvedWeekly?.windowMinutes,
    weeklyWindowPresent: Boolean(resolvedWeekly),
    codeReviewPercentage: summary.codeReviewPercentage,
    codeReviewResetTime: summary.codeReviewResetTime,
    codeReviewRequestsLeft: summary.codeReviewRequestsLeft,
    codeReviewRequestsLimit: summary.codeReviewRequestsLimit,
    codeReviewWindowMinutes: summary.codeReviewWindowMinutes,
    codeReviewWindowPresent: summary.codeReviewWindowPresent,
    additionalRateLimits:
      summary.additionalRateLimits?.map((limit) => ({ ...limit })) ?? readAdditionalRateLimitsFromRawData(summary.rawData),
    credits: summary.credits ? { ...summary.credits } : readCreditsFromRawData(summary.rawData),
    rawData: summary.rawData
  };
}

function readAdditionalRateLimitsFromRawData(rawData: unknown): CodexAdditionalQuotaLimit[] | undefined {
  const raw = getRecord(rawData);
  const items = raw?.["additional_rate_limits"] ?? raw?.["additionalRateLimits"];
  if (!Array.isArray(items)) {
    return undefined;
  }

  const limits = items.flatMap((item) => {
    const record = getRecord(item);
    const rateLimit = getRecord(record?.["rate_limit"]) ?? getRecord(record?.["rateLimit"]);
    if (!record || !rateLimit) {
      return [];
    }

    const primary = getRecord(rateLimit["primary_window"]) ?? getRecord(rateLimit["primaryWindow"]);
    const secondary = getRecord(rateLimit["secondary_window"]) ?? getRecord(rateLimit["secondaryWindow"]);
    const hourly = pickWindowByDuration([primary, secondary], "hourly");
    const weekly = pickWindowByDuration([primary, secondary], "weekly");
    const hourlyPercentage = resolveRemainingPercentage(hourly);
    const weeklyPercentage = resolveRemainingPercentage(weekly);

    return [
      {
        limitName: readString(record["limit_name"]) ?? readString(record["limitName"]) ?? readString(record["name"]) ?? "额外模型",
        meteredFeature: readString(record["metered_feature"]) ?? readString(record["meteredFeature"]),
        hourlyPercentage,
        hourlyResetTime: readResetTime(hourly),
        hourlyRequestsLeft: readNumberField(hourly, "remaining", "requests_left", "requestsLeft"),
        hourlyRequestsLimit: readNumberField(hourly, "limit", "requests_limit", "requestsLimit"),
        hourlyWindowMinutes: readWindowMinutes(hourly),
        hourlyWindowPresent: hourlyPercentage !== undefined,
        weeklyPercentage,
        weeklyResetTime: readResetTime(weekly),
        weeklyRequestsLeft: readNumberField(weekly, "remaining", "requests_left", "requestsLeft"),
        weeklyRequestsLimit: readNumberField(weekly, "limit", "requests_limit", "requestsLimit"),
        weeklyWindowMinutes: readWindowMinutes(weekly),
        weeklyWindowPresent: weeklyPercentage !== undefined
      }
    ];
  });

  return limits.length ? limits : undefined;
}

function readCreditsFromRawData(rawData: unknown): CodexCreditsSummary | undefined {
  const credits = getRecord(getRecord(rawData)?.["credits"]);
  if (!credits) {
    return undefined;
  }

  return {
    hasCredits: credits["has_credits"] === true || credits["hasCredits"] === true,
    unlimited: credits["unlimited"] === true,
    overageLimitReached: credits["overage_limit_reached"] === true || credits["overageLimitReached"] === true,
    balance: String(credits["balance"] ?? "").trim(),
    approxLocalMessages: Array.isArray(credits["approx_local_messages"])
      ? credits["approx_local_messages"]
      : Array.isArray(credits["approxLocalMessages"])
        ? credits["approxLocalMessages"]
        : [],
    approxCloudMessages: Array.isArray(credits["approx_cloud_messages"])
      ? credits["approx_cloud_messages"]
      : Array.isArray(credits["approxCloudMessages"])
        ? credits["approxCloudMessages"]
        : []
  };
}

function createQuotaWindowSnapshot(
  slot: "hourly" | "weekly",
  present: boolean | undefined,
  percentage: number,
  resetTime?: number,
  requestsLeft?: number,
  requestsLimit?: number,
  windowMinutes?: number
): QuotaWindowSnapshot | undefined {
  if (!present) {
    return undefined;
  }

  return {
    slot,
    percentage,
    resetTime,
    requestsLeft,
    requestsLimit,
    windowMinutes
  };
}

function classifyQuotaWindows(windows: QuotaWindowSnapshot[]): {
  hourly?: QuotaWindowSnapshot;
  weekly?: QuotaWindowSnapshot;
} {
  const result: {
    hourly?: QuotaWindowSnapshot;
    weekly?: QuotaWindowSnapshot;
  } = {};

  for (const window of windows) {
    if (isWeeklyWindow(window)) {
      result.weekly = selectPreferredWindow(result.weekly, window, "weekly");
      continue;
    }

    if (isHourlyWindow(window)) {
      result.hourly = selectPreferredWindow(result.hourly, window, "hourly");
    }
  }

  return result;
}

function selectPreferredWindow(
  existing: QuotaWindowSnapshot | undefined,
  candidate: QuotaWindowSnapshot,
  kind: "hourly" | "weekly"
): QuotaWindowSnapshot {
  if (!existing) {
    return candidate;
  }

  const existingMinutes = existing.windowMinutes ?? (kind === "weekly" ? 0 : Number.MAX_SAFE_INTEGER);
  const candidateMinutes = candidate.windowMinutes ?? (kind === "weekly" ? 0 : Number.MAX_SAFE_INTEGER);
  return kind === "weekly"
    ? candidateMinutes >= existingMinutes
      ? candidate
      : existing
    : candidateMinutes <= existingMinutes
      ? candidate
      : existing;
}

function isHourlyWindow(window?: QuotaWindowSnapshot): boolean {
  if (!window) {
    return false;
  }

  const minutes = window.windowMinutes;
  return typeof minutes === "number" && minutes > 0 && minutes <= MAX_HOURLY_WINDOW_MINUTES;
}

function isWeeklyWindow(window?: QuotaWindowSnapshot): boolean {
  if (!window) {
    return false;
  }

  const minutes = window.windowMinutes;
  return typeof minutes === "number" && minutes >= MIN_WEEKLY_WINDOW_MINUTES;
}

function pickWindowByDuration(
  windows: Array<Record<string, unknown> | undefined>,
  kind: "hourly" | "weekly"
): Record<string, unknown> | undefined {
  const candidates = windows.filter((window): window is Record<string, unknown> => Boolean(window));
  return candidates.find((window) => {
    const minutes = readWindowMinutes(window);
    return kind === "hourly"
      ? typeof minutes === "number" && minutes > 0 && minutes <= MAX_HOURLY_WINDOW_MINUTES
      : typeof minutes === "number" && minutes >= MIN_WEEKLY_WINDOW_MINUTES;
  });
}

function resolveRemainingPercentage(window: Record<string, unknown> | undefined): number | undefined {
  const usedPercent = readNumberField(window, "used_percent", "usedPercent");
  if (typeof usedPercent === "number") {
    return clampPercent(100 - usedPercent);
  }

  const remainingPercent = readNumberField(window, "remaining_percent", "remainingPercent");
  if (typeof remainingPercent === "number") {
    return clampPercent(remainingPercent);
  }

  const remaining = readNumberField(window, "remaining", "requests_left", "requestsLeft");
  const limit = readNumberField(window, "limit", "requests_limit", "requestsLimit");
  if (typeof remaining === "number" && typeof limit === "number" && limit > 0) {
    return clampPercent((remaining / limit) * 100);
  }

  return undefined;
}

function readResetTime(window: Record<string, unknown> | undefined): number | undefined {
  const resetAt = readNumberField(window, "reset_at", "resetAt", "reset_time", "resetTime");
  if (typeof resetAt === "number") {
    return resetAt > 1_000_000_000_000 ? Math.floor(resetAt / 1000) : Math.floor(resetAt);
  }

  const resetAfterSeconds = readNumberField(window, "reset_after_seconds", "resetAfterSeconds", "reset_after", "resetAfter");
  if (typeof resetAfterSeconds === "number" && resetAfterSeconds >= 0) {
    return Math.floor(Date.now() / 1000) + Math.floor(resetAfterSeconds);
  }

  return undefined;
}

function readWindowMinutes(window: Record<string, unknown> | undefined): number | undefined {
  const seconds = readNumberField(window, "limit_window_seconds", "limitWindowSeconds");
  return typeof seconds === "number" && seconds > 0 ? Math.ceil(seconds / 60) : undefined;
}

function readNumberField(source: Record<string, unknown> | undefined, ...keys: string[]): number | undefined {
  if (!source) {
    return undefined;
  }
  for (const key of keys) {
    const value = source[key];
    const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}
