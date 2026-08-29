export const ACCOUNT_LEASE_HEARTBEAT_MS = 30_000;
export const ACCOUNT_LEASE_MISSED_HEARTBEATS = 3;
export const ACCOUNT_LEASE_DURATION_MS = ACCOUNT_LEASE_HEARTBEAT_MS * ACCOUNT_LEASE_MISSED_HEARTBEATS;

const MAX_DEVICE_LABEL_LENGTH = 120;
const MAX_IDENTIFIER_LENGTH = 4096;

export type SyncAccountLease = {
  accountId: string;
  deviceId: string;
  deviceName: string;
  updatedAt: number;
  expiresAt: number;
};

export function createSyncAccountLease(params: {
  accountId: string;
  deviceId: string;
  deviceName: string;
  now?: number;
}): SyncAccountLease {
  const now = params.now ?? Date.now();
  return {
    accountId: params.accountId,
    deviceId: params.deviceId,
    deviceName: sanitizeDeviceName(params.deviceName),
    updatedAt: now,
    expiresAt: now + ACCOUNT_LEASE_DURATION_MS
  };
}

/**
 * Keeps valid leases from other devices and replaces this device's previous
 * assignment with its desired account. A live foreign lease always wins.
 */
export function reconcileSyncAccountLeases(
  remote: readonly SyncAccountLease[],
  deviceId: string,
  desiredLease: SyncAccountLease | undefined,
  now = Date.now()
): SyncAccountLease[] {
  const validRemote = canonicalizeSyncAccountLeases(
    remote.filter((lease) => lease.expiresAt > now && lease.deviceId !== deviceId)
  );
  if (!desiredLease || findBlockingSyncAccountLease(validRemote, desiredLease.accountId, deviceId, now)) {
    return validRemote;
  }
  return canonicalizeSyncAccountLeases([...validRemote, desiredLease]);
}

export function findBlockingSyncAccountLease(
  leases: readonly SyncAccountLease[],
  accountId: string,
  deviceId: string,
  now = Date.now()
): SyncAccountLease | undefined {
  return leases.find(
    (lease) => lease.accountId === accountId && lease.deviceId !== deviceId && lease.expiresAt > now
  );
}

export function canonicalizeSyncAccountLeases(leases: readonly SyncAccountLease[]): SyncAccountLease[] {
  const byDevice = new Map<string, SyncAccountLease>();
  for (const lease of leases) {
    const current = byDevice.get(lease.deviceId);
    if (!current || compareLeaseFreshness(lease, current) > 0) {
      byDevice.set(lease.deviceId, lease);
    }
  }

  const byAccount = new Map<string, SyncAccountLease>();
  for (const lease of byDevice.values()) {
    const current = byAccount.get(lease.accountId);
    if (!current || compareLeaseFreshness(lease, current) > 0) {
      byAccount.set(lease.accountId, lease);
    }
  }

  return [...byAccount.values()]
    .map((lease) => ({ ...lease, deviceName: sanitizeDeviceName(lease.deviceName) }))
    .sort((left, right) => left.accountId.localeCompare(right.accountId));
}

export function isValidSyncAccountLease(value: unknown): value is SyncAccountLease {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const lease = value as Partial<SyncAccountLease>;
  return (
    isNonEmptyBoundedString(lease.accountId, MAX_IDENTIFIER_LENGTH) &&
    isNonEmptyBoundedString(lease.deviceId, MAX_IDENTIFIER_LENGTH) &&
    isNonEmptyBoundedString(lease.deviceName, MAX_DEVICE_LABEL_LENGTH) &&
    typeof lease.updatedAt === "number" &&
    Number.isFinite(lease.updatedAt) &&
    typeof lease.expiresAt === "number" &&
    Number.isFinite(lease.expiresAt) &&
    lease.expiresAt >= lease.updatedAt
  );
}

function compareLeaseFreshness(left: SyncAccountLease, right: SyncAccountLease): number {
  return (
    left.updatedAt - right.updatedAt ||
    left.expiresAt - right.expiresAt ||
    left.deviceId.localeCompare(right.deviceId)
  );
}

function sanitizeDeviceName(value: string): string {
  const normalized = value.trim().slice(0, MAX_DEVICE_LABEL_LENGTH);
  return normalized || "Unknown PC";
}

function isNonEmptyBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}
