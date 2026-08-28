import { AccountError, ErrorCode } from "../core/errors";
import type { CodexAccountRecord, CodexAccountsIndex } from "../core/types";
import { markActive } from "./accountsIndex";
import { reconcileStatusBarSelections } from "./accountMetadata";
import { normalizeAccountTags } from "./sharedAccounts";

export function dismissAccountHealthIssue(
  index: CodexAccountsIndex,
  accountId: string,
  issueKey: string | undefined,
  now: number
): CodexAccountRecord | undefined {
  const account = index.accounts.find((item) => item.id === accountId);
  if (!account) {
    return undefined;
  }

  account.dismissedHealthIssueKey = issueKey?.trim() ?? undefined;
  account.updatedAt = now;
  return account;
}

export function setAccountTags(
  index: CodexAccountsIndex,
  accountId: string,
  tags: string[],
  now: number
): CodexAccountRecord | undefined {
  const account = index.accounts.find((item) => item.id === accountId);
  if (!account) {
    return undefined;
  }

  account.tags = normalizeAccountTags(tags);
  account.updatedAt = now;
  return { ...account, tags: [...(account.tags ?? [])] };
}

export function addAccountTags(
  index: CodexAccountsIndex,
  accountIds: string[],
  tags: string[],
  now: number
): CodexAccountRecord[] {
  const normalizedTags = normalizeAccountTags(tags) ?? [];
  if (!normalizedTags.length) {
    return [];
  }

  const idSet = new Set(accountIds);
  const updated: CodexAccountRecord[] = [];

  for (const account of index.accounts) {
    if (!idSet.has(account.id)) {
      continue;
    }

    account.tags = normalizeAccountTags([...(account.tags ?? []), ...normalizedTags]);
    account.updatedAt = now;
    updated.push({ ...account, tags: [...(account.tags ?? [])] });
  }

  return updated;
}

export function removeAccountTags(
  index: CodexAccountsIndex,
  accountIds: string[],
  tags: string[],
  now: number
): CodexAccountRecord[] {
  const normalizedTags = normalizeAccountTags(tags) ?? [];
  if (!normalizedTags.length) {
    return [];
  }

  const removeSet = new Set(normalizedTags.map((tag) => tag.toLowerCase()));
  const idSet = new Set(accountIds);
  const updated: CodexAccountRecord[] = [];

  for (const account of index.accounts) {
    if (!idSet.has(account.id)) {
      continue;
    }

    const nextTags = (account.tags ?? []).filter((tag) => !removeSet.has(tag.toLowerCase()));
    account.tags = normalizeAccountTags(nextTags);
    account.updatedAt = now;
    updated.push({ ...account, tags: [...(account.tags ?? [])] });
  }

  return updated;
}

export function switchActiveAccount(
  index: CodexAccountsIndex,
  accountId: string,
  now = Date.now()
): CodexAccountRecord | undefined {
  const account = index.accounts.find((item) => item.id === accountId);
  if (!account) {
    return undefined;
  }

  const previousActiveId = index.currentAccountId;
  markActive(index, accountId, now);
  reconcileStatusBarSelections(index, accountId, previousActiveId);
  return index.accounts.find((item) => item.id === accountId);
}

export function setAccountEnabled(
  index: CodexAccountsIndex,
  accountId: string,
  enabled: boolean,
  _now: number
): CodexAccountRecord | undefined {
  const account = index.accounts.find((item) => item.id === accountId);
  if (!account) {
    return undefined;
  }

  account.enabled = enabled;
  return account;
}

export function setAccountQueuePriority(
  index: CodexAccountsIndex,
  accountId: string,
  queuePriority: boolean,
  _now: number
): CodexAccountRecord | undefined {
  const account = index.accounts.find((item) => item.id === accountId);
  if (!account) {
    return undefined;
  }

  account.queuePriority = queuePriority;
  return account;
}

export function setAccountTokenRefreshEnabled(
  index: CodexAccountsIndex,
  accountId: string,
  enabled: boolean,
  now: number
): CodexAccountRecord | undefined {
  const account = index.accounts.find((item) => item.id === accountId);
  if (!account) {
    return undefined;
  }

  account.tokenRefreshEnabled = enabled;
  account.updatedAt = now;
  return account;
}

export function removeAccountFromIndex(index: CodexAccountsIndex, accountId: string): boolean {
  const before = index.accounts.length;
  index.accounts = index.accounts.filter((item) => item.id !== accountId);

  if (index.currentAccountId === accountId) {
    index.currentAccountId = undefined;
  }

  return index.accounts.length !== before;
}

export function setStatusBarVisibility(
  index: CodexAccountsIndex,
  accountId: string,
  visible: boolean,
  now: number
): CodexAccountRecord | undefined {
  const account = index.accounts.find((item) => item.id === accountId);
  if (!account) {
    return undefined;
  }

  if (account.isActive) {
    account.showInStatusBar = false;
  } else if (visible) {
    const enabledCount = index.accounts.filter((item) => !item.isActive && item.showInStatusBar).length;
    if (enabledCount >= 2) {
      throw new AccountError("Only 2 extra accounts can be shown in the status popup", {
        code: ErrorCode.ACCOUNT_INVALID_DATA,
        i18nKey: "status.limitTip"
      });
    }
    account.showInStatusBar = true;
  } else {
    account.showInStatusBar = false;
  }

  account.updatedAt = now;
  return account;
}
