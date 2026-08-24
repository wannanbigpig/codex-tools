import type { CodexAccountRecord, CodexQuotaSummary, CodexTokens } from "../core/types";
import { extractClaims } from "../utils/jwt";
import { normalizeQuotaSummary } from "../utils/quotaWindows";
import { isFreePlanType } from "../utils/quotaLabels";
import {
  applyRemoteProfileToAccount,
  type RemoteAccountProfileLike,
  shouldRepairWorkspaceMetadata
} from "./accountMetadata";

export function applyQuotaUpdate(params: {
  account: CodexAccountRecord;
  quotaSummary?: CodexQuotaSummary;
  quotaError?: CodexAccountRecord["quotaError"];
  updatedPlanType?: string;
  updatedSubscriptionActiveUntil?: string;
  now: number;
}): string | undefined {
  params.account.lastQuotaAt = params.now;
  params.account.updatedAt = params.now;
  const previousQuotaSummary = params.account.quotaSummary;
  const nextQuotaSummary = normalizeQuotaSummary(params.quotaSummary);
  const incomingResetCreditsNextExpiresAt = nextQuotaSummary?.resetCreditsNextExpiresAt;
  let preservedResetCreditsExpiry = false;
  if (
    nextQuotaSummary &&
    nextQuotaSummary.resetCreditsNextExpiresAt == null &&
    (nextQuotaSummary.resetCreditsAvailable ?? 0) > 0 &&
    previousQuotaSummary?.resetCreditsNextExpiresAt != null
  ) {
    nextQuotaSummary.resetCreditsNextExpiresAt = previousQuotaSummary.resetCreditsNextExpiresAt;
    preservedResetCreditsExpiry = true;
  }
  if ((previousQuotaSummary?.resetCreditsAvailable ?? nextQuotaSummary?.resetCreditsAvailable ?? 0) > 0) {
    console.info("[codexAccounts] quota reset credits update", {
      accountId: params.account.id,
      remoteAccountId: params.account.accountId,
      previousAvailable: previousQuotaSummary?.resetCreditsAvailable ?? null,
      previousNextExpiresAt: previousQuotaSummary?.resetCreditsNextExpiresAt ?? null,
      incomingAvailable: nextQuotaSummary?.resetCreditsAvailable ?? null,
      incomingNextExpiresAt: incomingResetCreditsNextExpiresAt ?? null,
      storedNextExpiresAt: nextQuotaSummary?.resetCreditsNextExpiresAt ?? null,
      preservedResetCreditsExpiry
    });
  }
  params.account.quotaSummary = nextQuotaSummary;
  params.account.quotaError = params.quotaError;
  params.account.dismissedHealthIssueKey = undefined;

  if (params.updatedPlanType) {
    params.account.planType = params.updatedPlanType;
    if (isFreePlanType(params.updatedPlanType)) {
      params.account.subscriptionActiveUntil = undefined;
    }
  }
  if (params.updatedSubscriptionActiveUntil && !isFreePlanType(params.updatedPlanType)) {
    params.account.subscriptionActiveUntil = params.updatedSubscriptionActiveUntil;
  }

  return params.account.planType;
}

export function syncLoginAtFromTokens(account: CodexAccountRecord, tokens: CodexTokens): void {
  if (account.loginAt) {
    return;
  }

  const claims = extractClaims(tokens.idToken, tokens.accessToken);
  account.loginAt = claims.loginAt ?? account.loginAt;
}

export function shouldAttemptRemoteProfileRepair(account: CodexAccountRecord, planType?: string): boolean {
  return shouldRepairWorkspaceMetadata(account, planType);
}

export function applyRemoteProfileFromTokens(params: {
  account: CodexAccountRecord;
  tokens: CodexTokens;
  remoteProfile?: RemoteAccountProfileLike;
  planType?: string;
  allowAccountIdRepair?: boolean;
}): boolean {
  const claims = extractClaims(params.tokens.idToken, params.tokens.accessToken);
  return applyRemoteProfileToAccount({
    account: params.account,
    claims,
    remoteProfile: params.remoteProfile,
    planType: params.planType ?? params.account.planType,
    allowAccountIdRepair: params.allowAccountIdRepair
  });
}
