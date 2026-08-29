const MAX_DEVICE_LABEL_LENGTH = 120;
const MAX_IDENTIFIER_LENGTH = 4096;

/**
 * One durable enablement record per account. An enabled record identifies the
 * single PC that may use the account; a disabled record releases it for all PCs.
 */
export type SyncAccountEnablement = {
  accountId: string;
  deviceId: string;
  deviceName: string;
  enabled: boolean;
  revision: number;
  updatedAt: number;
};

export function createSyncAccountEnablement(params: {
  accountId: string;
  deviceId: string;
  deviceName: string;
  enabled: boolean;
  revision?: number;
  now?: number;
}): SyncAccountEnablement {
  return {
    accountId: params.accountId,
    deviceId: params.deviceId,
    deviceName: sanitizeDeviceName(params.deviceName),
    enabled: params.enabled,
    revision: params.revision ?? 1,
    updatedAt: params.now ?? Date.now()
  };
}

/**
 * Merge the plain registry without trusting wall clocks. Revisions win first;
 * a device ID tie-break makes concurrent writes converge deterministically.
 */
export function mergeSyncAccountEnablement(
  local: readonly SyncAccountEnablement[],
  remote: readonly SyncAccountEnablement[]
): SyncAccountEnablement[] {
  return canonicalizeSyncAccountEnablement([...local, ...remote]);
}

export function canonicalizeSyncAccountEnablement(
  entries: readonly SyncAccountEnablement[]
): SyncAccountEnablement[] {
  const byAccount = new Map<string, SyncAccountEnablement>();
  for (const candidate of entries) {
    if (!isValidSyncAccountEnablement(candidate)) continue;
    const current = byAccount.get(candidate.accountId);
    if (!current || compareEnablementFreshness(candidate, current) > 0) {
      byAccount.set(candidate.accountId, candidate);
    }
  }
  return [...byAccount.values()]
    .map((entry) => ({ ...entry, deviceName: sanitizeDeviceName(entry.deviceName) }))
    .sort((left, right) => left.accountId.localeCompare(right.accountId));
}

export function isValidSyncAccountEnablement(value: unknown): value is SyncAccountEnablement {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<SyncAccountEnablement>;
  return (
    isNonEmptyBoundedString(candidate.accountId, MAX_IDENTIFIER_LENGTH) &&
    isNonEmptyBoundedString(candidate.deviceId, MAX_IDENTIFIER_LENGTH) &&
    isNonEmptyBoundedString(candidate.deviceName, MAX_DEVICE_LABEL_LENGTH) &&
    typeof candidate.enabled === "boolean" &&
    typeof candidate.revision === "number" &&
    Number.isSafeInteger(candidate.revision) &&
    candidate.revision > 0 &&
    typeof candidate.updatedAt === "number" &&
    Number.isFinite(candidate.updatedAt) &&
    candidate.updatedAt > 0
  );
}

function compareEnablementFreshness(left: SyncAccountEnablement, right: SyncAccountEnablement): number {
  return left.revision - right.revision || left.deviceId.localeCompare(right.deviceId);
}

function sanitizeDeviceName(value: string): string {
  const normalized = value.trim().slice(0, MAX_DEVICE_LABEL_LENGTH);
  return normalized || "Unknown PC";
}

function isNonEmptyBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}
