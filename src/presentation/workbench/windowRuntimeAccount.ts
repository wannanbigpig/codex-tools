let currentWindowRuntimeAccountId: string | undefined;
let queuedAccountSwitch:
  | { fromAccountId?: string; toAccountId: string; queuedAt: number }
  | undefined;

export function getCurrentWindowRuntimeAccountId(): string | undefined {
  return currentWindowRuntimeAccountId;
}

export function setCurrentWindowRuntimeAccountId(accountId?: string): void {
  currentWindowRuntimeAccountId = accountId;
  if (accountId && queuedAccountSwitch?.toAccountId === accountId) {
    queuedAccountSwitch = undefined;
  }
}

export function needsWindowReloadForAccount(accountId?: string): boolean {
  return Boolean(accountId) && currentWindowRuntimeAccountId !== accountId;
}

export function queueAccountSwitch(toAccountId: string, fromAccountId?: string): void {
  queuedAccountSwitch = { fromAccountId, toAccountId, queuedAt: Date.now() };
}

export function getQueuedAccountSwitch():
  | { fromAccountId?: string; toAccountId: string; queuedAt: number }
  | undefined {
  return queuedAccountSwitch;
}

export function clearQueuedAccountSwitch(): void {
  queuedAccountSwitch = undefined;
}
