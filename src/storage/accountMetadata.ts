import type { CodexAccountRecord, CodexTokens, DecodedAuthClaims } from "../core/types";

export type RemoteAccountProfileLike = {
  email?: string;
  userId?: string;
  planType?: string;
  organizationId?: string;
  accountName?: string;
  accountStructure?: string;
  accountId?: string;
  subscriptionActiveUntil?: string;
};

export function pickWorkspaceLikeTitle(candidates?: Array<string | undefined>, planType?: string): string | undefined {
  if (!candidates?.length) {
    return undefined;
  }

  const normalized = (candidates ?? [])
    .filter((item): item is string => Boolean(item?.trim()))
    .map((item) => item.trim());

  const preferred = normalized.find((item) => !isGenericPersonalWorkspaceName(item));
  if (preferred) {
    return preferred;
  }

  return sanitizeWorkspaceName(normalized[0], planType);
}

export function resolveAccountStructure(
  remoteAccountStructure: string | undefined,
  existingAccountStructure: string | undefined,
  planType?: string,
  organizationId?: string
): string | undefined {
  if (remoteAccountStructure?.trim()) {
    return remoteAccountStructure;
  }

  const inferred = inferAccountStructure(planType, organizationId);
  if (!existingAccountStructure?.trim()) {
    return inferred;
  }

  const existing = existingAccountStructure.trim().toLowerCase();
  if (!inferred) {
    return existing;
  }

  if (existing === "organization" || inferred === "organization") {
    return inferred === "organization" ? inferred : existing;
  }

  if (isCollaborativeWorkspaceStructure(existing) || isCollaborativeWorkspaceStructure(inferred)) {
    return isCollaborativeWorkspaceStructure(inferred) ? inferred : existing;
  }

  return existing;
}

export function shouldRepairWorkspaceMetadata(account: CodexAccountRecord, planType?: string): boolean {
  if (!account.accountName?.trim()) {
    return true;
  }

  const normalizedStructure = account.accountStructure?.trim().toLowerCase();
  const normalizedPlanType = planType?.trim().toLowerCase();
  if (!normalizedPlanType) {
    return false;
  }

  return ["team", "business", "enterprise"].includes(normalizedPlanType) && normalizedStructure === "personal";
}

export function sanitizeWorkspaceName(name: string | undefined, planType?: string): string | undefined {
  const trimmed = name?.trim();
  if (!trimmed) {
    return undefined;
  }

  if (isGenericPersonalWorkspaceName(trimmed) && !isPersonalLikePlan(planType)) {
    return undefined;
  }

  return trimmed;
}

export function didRemoteAccountMatchClaims(
  remoteProfile: { accountId?: string } | undefined,
  claimsAccountId?: string
): boolean {
  if (!remoteProfile) {
    return false;
  }

  if (!claimsAccountId) {
    return true;
  }

  return !remoteProfile.accountId || remoteProfile.accountId === claimsAccountId;
}

export function reconcileStatusBarSelections(
  index: { accounts: CodexAccountRecord[] },
  nextActiveId: string,
  previousActiveId?: string
): void {
  const nextActive = index.accounts.find((account) => account.id === nextActiveId);
  if (nextActive) {
    nextActive.showInStatusBar = false;
  }

  const extras = index.accounts.filter((account) => account.id !== nextActiveId && account.showInStatusBar);
  if (extras.length > 2) {
    extras
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(2)
      .forEach((account) => {
        account.showInStatusBar = false;
      });
  }

  if (!previousActiveId || previousActiveId === nextActiveId) {
    return;
  }

  const previousActive = index.accounts.find((account) => account.id === previousActiveId);
  if (!previousActive) {
    return;
  }

  const currentExtraCount = index.accounts.filter(
    (account) => account.id !== nextActiveId && account.showInStatusBar
  ).length;

  previousActive.showInStatusBar = currentExtraCount < 2;
  previousActive.updatedAt = Date.now();
}

export function buildAccountRecordDraft(params: {
  storageId: string;
  claims: DecodedAuthClaims & { email: string };
  tokens: Pick<CodexTokens, "accountId">;
  existing?: CodexAccountRecord;
  existingAccounts: CodexAccountRecord[];
  remoteProfile?: RemoteAccountProfileLike;
  addedVia?: CodexAccountRecord["addedVia"];
  forceActive: boolean;
  now: number;
}): CodexAccountRecord {
  const remoteAccountIdMatchesClaims = didRemoteAccountMatchClaims(params.remoteProfile, params.claims.accountId);
  const remoteAccountName = remoteAccountIdMatchesClaims
    ? sanitizeWorkspaceName(params.remoteProfile?.accountName, params.claims.planType)
    : undefined;
  const remoteAccountStructure = remoteAccountIdMatchesClaims ? params.remoteProfile?.accountStructure : undefined;
  const claimsWorkspaceTitle = pickWorkspaceLikeTitle(
    params.claims.organizations?.map((item) => item.title),
    params.claims.planType
  );
  const resolvedAccountName =
    remoteAccountName ??
    sanitizeWorkspaceName(params.existing?.accountName, params.claims.planType) ??
    claimsWorkspaceTitle;

  return {
    id: params.storageId,
    loginAt: params.claims.loginAt ?? params.existing?.loginAt,
    email: params.claims.email,
    userId: params.claims.userId,
    authProvider: params.claims.authProvider,
    planType: params.remoteProfile?.planType ?? params.claims.planType,
    subscriptionActiveUntil: params.remoteProfile?.subscriptionActiveUntil ?? params.claims.subscriptionActiveUntil ?? params.existing?.subscriptionActiveUntil,
    accountId: remoteAccountIdMatchesClaims
      ? params.remoteProfile?.accountId ?? params.claims.accountId ?? params.tokens.accountId
      : params.claims.accountId ?? params.tokens.accountId,
    organizationId: params.remoteProfile?.organizationId ?? params.claims.organizationId,
    accountName: resolvedAccountName,
    tags: normalizeAccountTagsForAccount(params.existing),
    addedVia: params.existing?.addedVia ?? params.addedVia,
    accountStructure: resolveAccountStructure(
      remoteAccountStructure,
      params.existing?.accountStructure,
      params.claims.planType,
      params.claims.organizationId
    ),
    isActive: params.forceActive,
    // New accounts should not silently opt into the status popup.
    showInStatusBar: params.existing?.showInStatusBar ?? false,
    dismissedHealthIssueKey: params.existing?.dismissedHealthIssueKey,
    lastQuotaAt: params.existing?.lastQuotaAt,
    quotaSummary: params.existing?.quotaSummary,
    quotaError: params.existing?.quotaError,
    createdAt: params.existing?.createdAt ?? params.now,
    updatedAt: params.now
  };
}

export function applyRemoteProfileToAccount(params: {
  account: CodexAccountRecord;
  claims: Pick<DecodedAuthClaims, "accountId" | "email" | "organizationId" | "planType" | "subscriptionActiveUntil" | "userId">;
  remoteProfile?: RemoteAccountProfileLike;
  planType?: string;
}): boolean {
  const claimsAccountId = params.claims.accountId ?? params.account.accountId;
  if (!didRemoteAccountMatchClaims(params.remoteProfile, claimsAccountId)) {
    return false;
  }

  const repairedName = sanitizeWorkspaceName(params.remoteProfile?.accountName, params.planType ?? params.account.planType);
  if (repairedName) {
    params.account.accountName = repairedName;
  }

  params.account.email = params.remoteProfile?.email ?? params.claims.email ?? params.account.email;
  params.account.userId = params.remoteProfile?.userId ?? params.claims.userId ?? params.account.userId;
  params.account.planType = params.remoteProfile?.planType ?? params.claims.planType ?? params.account.planType;
  params.account.subscriptionActiveUntil =
    params.remoteProfile?.subscriptionActiveUntil ??
    params.claims.subscriptionActiveUntil ??
    params.account.subscriptionActiveUntil;
  params.account.accountId = params.remoteProfile?.accountId ?? claimsAccountId ?? params.account.accountId;
  params.account.organizationId = params.remoteProfile?.organizationId ?? params.claims.organizationId ?? params.account.organizationId;
  params.account.accountStructure = resolveAccountStructure(
    params.remoteProfile?.accountStructure,
    params.account.accountStructure,
    params.planType ?? params.account.planType,
    params.account.organizationId
  );

  return true;
}

function normalizeAccountTagsForAccount(account?: CodexAccountRecord): string[] | undefined {
  const tags = account?.tags?.filter((tag): tag is string => typeof tag === "string");
  return tags?.length ? [...tags] : undefined;
}

function inferAccountStructure(planType?: string, organizationId?: string): string | undefined {
  if (organizationId) {
    return "organization";
  }
  if (planType && ["team", "business", "enterprise"].includes(planType.toLowerCase())) {
    return "team";
  }
  return "personal";
}

function isCollaborativeWorkspaceStructure(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "team" || normalized === "workspace";
}

function isGenericPersonalWorkspaceName(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "personal" || normalized === "personal workspace" || normalized === "个人空间";
}

function isPersonalLikePlan(planType?: string): boolean {
  const normalized = planType?.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return ["free", "plus", "pro", "personal"].includes(normalized);
}
