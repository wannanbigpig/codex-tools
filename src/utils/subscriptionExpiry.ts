const SECOND_MS = 1_000;
const MILLISECOND_TIMESTAMP_MIN = 1_000_000_000_000;

export function parseSubscriptionExpiryMs(value: unknown): number | undefined {
  const normalized = normalizeSubscriptionExpiryValue(value);
  if (!normalized) {
    return undefined;
  }

  const numeric = Number(normalized);
  if (Number.isFinite(numeric)) {
    return numeric < MILLISECOND_TIMESTAMP_MIN ? numeric * SECOND_MS : numeric;
  }

  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeSubscriptionExpiryValue(value: unknown): string | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value === "string") {
    return value.trim() || undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const key of [
      "value",
      "timestamp",
      "ts",
      "seconds",
      "sec",
      "unix",
      "epoch",
      "epoch_seconds",
      "epochSeconds"
    ]) {
      const normalized = normalizeSubscriptionExpiryValue(record[key]);
      if (normalized) {
        return normalized;
      }
    }
  }
  return undefined;
}
