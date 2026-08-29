export type AccountAutomationState = {
  lastCheckAt?: number;
  lastRefreshAt?: number;
  lastError?: string;
  lastErrorAt?: number;
};

export type TokenAutomationSnapshot = {
  enabled: boolean;
  intervalMs: number;
  skewSeconds: number;
  lastSweepAt?: number;
  nextSweepAt?: number;
  lastSuccessAt?: number;
  lastFailureMessage?: string;
  accounts: Record<string, AccountAutomationState>;
};

const state: TokenAutomationSnapshot = {
  enabled: false,
  intervalMs: 0,
  skewSeconds: 0,
  accounts: {}
};

export function getTokenAutomationSnapshot(): TokenAutomationSnapshot {
  return {
    ...state,
    accounts: Object.fromEntries(
      Object.entries(state.accounts).map(([accountId, accountState]) => [accountId, { ...accountState }])
    )
  };
}

export function configureTokenAutomation(enabled: boolean, intervalMs: number, skewSeconds: number): void {
  state.enabled = enabled;
  state.intervalMs = intervalMs;
  state.skewSeconds = skewSeconds;
  state.nextSweepAt = enabled && intervalMs > 0 ? Date.now() + intervalMs : undefined;
  if (!enabled) {
    state.lastFailureMessage = undefined;
  }
}

export function markTokenAutomationSweepStarted(): void {
  state.lastSweepAt = Date.now();
  state.lastFailureMessage = undefined;
}

export function markTokenAutomationSweepFinished(lastFailureMessage?: string): void {
  state.nextSweepAt = state.enabled && state.intervalMs > 0 ? Date.now() + state.intervalMs : undefined;
  state.lastFailureMessage = lastFailureMessage;
}

export function markTokenAutomationCheck(accountId: string): void {
  const accountState = ensureAccountState(accountId);
  accountState.lastCheckAt = Date.now();
}

export function markTokenAutomationRefreshSuccess(accountId: string): void {
  const now = Date.now();
  const accountState = ensureAccountState(accountId);
  accountState.lastCheckAt = now;
  accountState.lastRefreshAt = now;
  accountState.lastError = undefined;
  accountState.lastErrorAt = undefined;
  state.lastSuccessAt = now;
}

export function markTokenAutomationRefreshFailure(accountId: string, message: string): void {
  const now = Date.now();
  const accountState = ensureAccountState(accountId);
  accountState.lastCheckAt = now;
  accountState.lastError = message;
  accountState.lastErrorAt = now;
  state.lastFailureMessage = message;
}

export function clearTokenAutomationError(accountId: string): void {
  const accountState = ensureAccountState(accountId);
  accountState.lastError = undefined;
  accountState.lastErrorAt = undefined;
}

function ensureAccountState(accountId: string): AccountAutomationState {
  state.accounts[accountId] ??= {};
  return state.accounts[accountId];
}
