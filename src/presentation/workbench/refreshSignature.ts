import type { CodexAccountRecord, CodexIndexHealthSummary } from "../../core/types";
import type { TokenAutomationSnapshot } from "./tokenAutomationState";

export function buildWorkbenchRefreshSignature(params: {
  observedAuthIdentity?: string;
  indexHealth: CodexIndexHealthSummary;
  accounts: CodexAccountRecord[];
  tokenAutomation?: TokenAutomationSnapshot;
}): string {
  const accountSignature = params.accounts
    .map((account) =>
      [
        account.id,
        account.email,
        account.accountName ?? "",
        account.planType ?? "",
        account.accountId ?? "",
        account.organizationId ?? "",
        account.userId ?? "",
        (account.tags ?? []).join(","),
        account.isActive ? "1" : "0",
        account.showInStatusBar ? "1" : "0",
        account.lastQuotaAt ?? 0,
        account.updatedAt,
        account.quotaError?.code ?? "",
        account.quotaError?.message ?? "",
        account.quotaError?.timestamp ?? 0,
        account.quotaSummary?.hourlyPercentage ?? "",
        account.quotaSummary?.hourlyResetTime ?? "",
        account.quotaSummary?.hourlyRequestsLeft ?? "",
        account.quotaSummary?.hourlyRequestsLimit ?? "",
        account.quotaSummary?.hourlyWindowMinutes ?? "",
        account.quotaSummary?.hourlyWindowPresent ? "1" : "0",
        account.quotaSummary?.weeklyPercentage ?? "",
        account.quotaSummary?.weeklyResetTime ?? "",
        account.quotaSummary?.weeklyRequestsLeft ?? "",
        account.quotaSummary?.weeklyRequestsLimit ?? "",
        account.quotaSummary?.weeklyWindowMinutes ?? "",
        account.quotaSummary?.weeklyWindowPresent ? "1" : "0",
        account.quotaSummary?.credits?.balance ?? "",
        account.quotaSummary?.additionalRateLimits
          ?.map(
            (limit) =>
              `${limit.limitName}:${limit.hourlyPercentage ?? ""}:${limit.hourlyResetTime ?? ""}:${limit.weeklyPercentage ?? ""}:${limit.weeklyResetTime ?? ""}`
          )
          .join(",") ?? ""
      ].join(":")
    )
    .join("|");
  const tokenAutomationSignature = params.tokenAutomation
    ? [
        params.tokenAutomation.enabled ? "1" : "0",
        params.tokenAutomation.intervalMs,
        params.tokenAutomation.skewSeconds,
        params.tokenAutomation.lastSweepAt ?? "",
        params.tokenAutomation.nextSweepAt ?? "",
        params.tokenAutomation.lastSuccessAt ?? "",
        params.tokenAutomation.lastFailureMessage ?? "",
        Object.entries(params.tokenAutomation.accounts)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(
            ([accountId, state]) =>
              `${accountId}:${state.lastCheckAt ?? ""}:${state.lastRefreshAt ?? ""}:${state.lastError ?? ""}:${
                state.lastErrorAt ?? ""
              }`
          )
          .join("|")
      ].join(":")
    : "";

  return [
    params.observedAuthIdentity ?? "",
    params.indexHealth.status,
    params.indexHealth.lastRestoreSource ?? "",
    params.indexHealth.availableBackups,
    params.indexHealth.lastErrorMessage ?? "",
    params.indexHealth.lastRecoveredAt ?? "",
    tokenAutomationSignature,
    accountSignature
  ].join("||");
}

export function shouldRunAccountScheduler(accountCount: number): boolean {
  return accountCount > 0;
}
