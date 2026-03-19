let currentWindowRuntimeAccountId: string | undefined;

export function getCurrentWindowRuntimeAccountId(): string | undefined {
  return currentWindowRuntimeAccountId;
}

export function setCurrentWindowRuntimeAccountId(accountId?: string): void {
  currentWindowRuntimeAccountId = accountId;
}
