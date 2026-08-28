import type { DashboardAccountViewModel } from "../../src/domain/dashboard/types";

/** Only the PC holding the synchronized account enablement may run it. */
export function canRunAccountOnThisPc(
  account: Pick<DashboardAccountViewModel, "enabled" | "runningDeviceName" | "runningOnThisDevice">,
  busy: boolean,
  registryOverrideEnabled = false
): boolean {
  return (
    !busy &&
    account.enabled &&
    (registryOverrideEnabled || !Boolean(account.runningDeviceName && !account.runningOnThisDevice))
  );
}
