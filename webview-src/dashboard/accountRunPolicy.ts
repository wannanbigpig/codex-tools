import type { DashboardAccountViewModel } from "../../src/domain/dashboard/types";

/** Only the PC holding synchronized enablement may run it unless rescue is active. */
export function canRunAccountOnThisPc(
  account: Pick<DashboardAccountViewModel, "enabled" | "runningDeviceName" | "runningOnThisDevice">,
  busy: boolean,
  registryOverrideEnabled = false
): boolean {
  return (
    !busy &&
    (account.enabled || registryOverrideEnabled) &&
    (registryOverrideEnabled || !Boolean(account.runningDeviceName && !account.runningOnThisDevice))
  );
}
