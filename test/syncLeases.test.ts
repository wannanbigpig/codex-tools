import { describe, expect, it } from "vitest";
import {
  ACCOUNT_LEASE_DURATION_MS,
  createSyncAccountLease,
  findBlockingSyncAccountLease,
  reconcileSyncAccountLeases
} from "../src/services/syncLeases";

describe("encrypted sync account leases", () => {
  it("replaces this PC's prior assignment with its newly selected account", () => {
    const now = 10_000;
    const leases = reconcileSyncAccountLeases(
      [
        createSyncAccountLease({ accountId: "a", deviceId: "this-pc", deviceName: "Desk", now: 1_000 }),
        createSyncAccountLease({ accountId: "c", deviceId: "other-pc", deviceName: "Laptop", now: 2_000 })
      ],
      "this-pc",
      createSyncAccountLease({ accountId: "b", deviceId: "this-pc", deviceName: "Desk", now }),
      now
    );

    expect(leases.map((lease) => [lease.accountId, lease.deviceName])).toEqual([
      ["b", "Desk"],
      ["c", "Laptop"]
    ]);
  });

  it("does not claim an account with a live lease from another PC", () => {
    const now = 10_000;
    const remote = createSyncAccountLease({ accountId: "a", deviceId: "other-pc", deviceName: "Laptop", now });
    const desired = createSyncAccountLease({ accountId: "a", deviceId: "this-pc", deviceName: "Desk", now });

    const leases = reconcileSyncAccountLeases([remote], "this-pc", desired, now);

    expect(leases).toEqual([remote]);
    expect(findBlockingSyncAccountLease(leases, "a", "this-pc", now)?.deviceName).toBe("Laptop");
  });

  it("allows takeover after another PC's lease expires", () => {
    const now = ACCOUNT_LEASE_DURATION_MS + 1_001;
    const expired = createSyncAccountLease({ accountId: "a", deviceId: "other-pc", deviceName: "Laptop", now: 1_000 });
    const desired = createSyncAccountLease({ accountId: "a", deviceId: "this-pc", deviceName: "Desk", now });

    expect(reconcileSyncAccountLeases([expired], "this-pc", desired, now)).toEqual([desired]);
  });
});
