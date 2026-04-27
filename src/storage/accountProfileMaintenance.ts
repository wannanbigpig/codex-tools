import type { CodexAccountRecord, CodexQuotaSummary, CodexTokens } from "../core/types";
import { extractClaims } from "../utils/jwt";
import { normalizeQuotaSummary } from "../utils/quotaWindows";
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
  params.account.quotaSummary = normalizeQuotaSummary(params.quotaSummary);
  params.account.quotaError = params.quotaError;
  params.account.dismissedHealthIssueKey = undefined;

  if (params.updatedPlanType) {
    params.account.planType = params.updatedPlanType;
  }
  if (params.updatedSubscriptionActiveUntil) {
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
}): boolean {
  const claims = extractClaims(params.tokens.idToken, params.tokens.accessToken);
  return applyRemoteProfileToAccount({
    account: params.account,
    claims,
    remoteProfile: params.remoteProfile,
    planType: params.planType ?? params.account.planType
  });
}
