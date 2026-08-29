export interface AutoQueueWindowOrderValue {
  percentage?: number;
  resetAt?: number;
}

export interface AutoQueueOrderValue {
  windows: readonly AutoQueueWindowOrderValue[];
  credits?: number;
  subscriptionExpiresAt?: number;
  lastQuotaAt?: number;
}

/**
 * Compares auto-queue candidates by remaining quota and the time until that
 * window resets. A criterion is ignored when either candidate is missing it,
 * so incomplete API responses do not penalize an otherwise usable account.
 */
export function compareAutoQueueOrderValues(left: AutoQueueOrderValue, right: AutoQueueOrderValue): number {
  const windowCount = Math.max(left.windows.length, right.windows.length);
  for (let index = 0; index < windowCount; index += 1) {
    const leftWindow = left.windows[index];
    const rightWindow = right.windows[index];
    if (!leftWindow || !rightWindow) {
      continue;
    }

    const quotaDifference = compareWhenBoth(leftWindow.percentage, rightWindow.percentage, -1);
    if (quotaDifference !== 0) {
      return quotaDifference;
    }

    // When quota is tied, use the account whose quota renews sooner first.
    const resetDifference = compareWhenBoth(leftWindow.resetAt, rightWindow.resetAt, 1);
    if (resetDifference !== 0) {
      return resetDifference;
    }
  }

  const creditsDifference = compareWhenBoth(left.credits, right.credits, -1);
  if (creditsDifference !== 0) {
    return creditsDifference;
  }

  const expiryDifference = compareWhenBoth(left.subscriptionExpiresAt, right.subscriptionExpiresAt, 1);
  if (expiryDifference !== 0) {
    return expiryDifference;
  }

  return compareWhenBoth(left.lastQuotaAt, right.lastQuotaAt, -1);
}

export function parseCreditsOrderValue(
  credits: { hasCredits: boolean; unlimited: boolean; overageLimitReached: boolean; balance: string } | undefined
): number | undefined {
  if (!credits) {
    return undefined;
  }
  if (credits.unlimited) {
    return Number.POSITIVE_INFINITY;
  }
  if (credits.overageLimitReached || !credits.hasCredits) {
    return 0;
  }

  const numericBalance = Number(credits.balance.replace(/[^0-9.-]/g, ""));
  return credits.balance.trim() && Number.isFinite(numericBalance) ? numericBalance : undefined;
}

function compareWhenBoth(left: number | undefined, right: number | undefined, direction: 1 | -1): number {
  if (left === undefined || right === undefined) {
    return 0;
  }
  if (!Number.isFinite(left) && left !== Number.POSITIVE_INFINITY) {
    return 0;
  }
  if (!Number.isFinite(right) && right !== Number.POSITIVE_INFINITY) {
    return 0;
  }
  if (left === right) {
    return 0;
  }
  return direction * (left - right);
}
