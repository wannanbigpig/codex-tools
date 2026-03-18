import { CodexDailyUsageBreakdown, CodexDailyUsagePoint, CodexTokens } from "../core/types";
import { APIError } from "../core/errors";
import { extractClaims } from "../utils/jwt";
import { logNetworkEvent } from "../utils/debug";
import { fetchWithTimeout } from "../utils/network";

const DAILY_USAGE_BREAKDOWN_URL = "https://chatgpt.com/backend-api/wham/usage/daily-token-usage-breakdown";

type UnknownRecord = Record<string, unknown>;

export async function fetchDailyUsageBreakdown(
  tokens: CodexTokens,
  days = 30
): Promise<CodexDailyUsageBreakdown | undefined> {
  const claims = extractClaims(tokens.idToken, tokens.accessToken);
  const headers = new Headers({
    Authorization: `Bearer ${tokens.accessToken}`,
    Accept: "application/json"
  });

  const accountId = tokens.accountId ?? claims.accountId;
  if (accountId) {
    headers.set("ChatGPT-Account-Id", accountId);
  }

  const url = new URL(DAILY_USAGE_BREAKDOWN_URL);
  url.searchParams.set("days", String(days));

  const response = await fetchWithTimeout(
    url.toString(),
    {
      method: "GET",
      headers
    },
    15000,
    "Daily usage request"
  );

  const raw = await response.text();
  logNetworkEvent("daily-usage", {
    accountId,
    days,
    status: response.status,
    ok: response.ok,
    url: url.toString(),
    bodyPreview: raw.slice(0, 1000)
  });
  if (!response.ok) {
    throw new APIError(`Daily usage breakdown API returned ${response.status}: ${raw.slice(0, 200)}`, {
      statusCode: response.status,
      responseBody: raw.slice(0, 200)
    });
  }

  const payload = parseJson(raw);
  return parseDailyUsageBreakdown(payload, days);
}

function parseDailyUsageBreakdown(payload: unknown, fallbackDays: number): CodexDailyUsageBreakdown | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

  const records = collectUsageRecords(payload);
  const parsedPoints = records.map((record) => parseUsagePoint(record));
  const points = parsedPoints.filter(isUsagePoint);
  points.sort((a, b) => a.date.localeCompare(b.date));

  const days = readNumber(payload, ["days", "range_days", "window_days"]) ?? fallbackDays;

  return {
    days,
    points
  };
}

function collectUsageRecords(payload: UnknownRecord): UnknownRecord[] {
  const candidates = [
    payload["daily_usage"],
    payload["daily_token_usage_breakdown"],
    payload["breakdown"],
    payload["data"],
    payload["items"],
    payload["results"]
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter(isRecord);
    }
  }

  for (const value of Object.values(payload)) {
    if (Array.isArray(value) && value.every((item) => isRecord(item) || item == null)) {
      return value.filter(isRecord);
    }
  }

  return [];
}

function parseUsagePoint(value: UnknownRecord): CodexDailyUsagePoint | undefined {
  const date =
    readString(value, ["date", "day", "usage_date", "bucket_date", "time_bucket_start"]) ??
    normalizeTimestamp(readNumber(value, ["timestamp", "start_time", "bucket_start", "epoch_seconds"]));
  const surfaceValues =
    parseSurfaceValues(value["product_surface_usage_values"]) ??
    parseSurfaceValues(value["surface_usage_values"]) ??
    parseSurfaceValues(value["usage_values"]);
  const extensionTokens = surfaceValues?.["vscode"];
  const otherTokens = sumSurfaceValues(surfaceValues, ["vscode"]);
  const totalTokens =
    readNumber(value, ["total_tokens", "token_count", "tokens", "total", "total_token_count", "num_tokens"]) ??
    sumSurfaceValues(surfaceValues) ??
    extensionTokens ??
    sumNestedNumbers(value["product_surface_usage_values"]) ??
    sumNestedNumbers(value["surface_usage_values"]) ??
    sumNestedNumbers(value["usage_values"]);

  if (!date || typeof totalTokens !== "number") {
    return undefined;
  }

  return {
    date,
    totalTokens,
    extensionTokens,
    otherTokens,
    surfaceValues,
    inputTokens: readNumber(value, ["input_tokens", "prompt_tokens", "input", "prompt_token_count"]),
    outputTokens: readNumber(value, ["output_tokens", "completion_tokens", "output", "completion_token_count"]),
    cachedTokens: readNumber(value, ["cached_tokens", "cache_tokens", "cached"])
  };
}

function normalizeTimestamp(value: number | undefined): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  const epochMs = value > 1_000_000_000_000 ? value : value * 1000;
  return new Date(epochMs).toISOString().slice(0, 10);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isUsagePoint(value: CodexDailyUsagePoint | undefined): value is CodexDailyUsagePoint {
  return value !== undefined;
}

function readString(record: UnknownRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function readNumber(record: UnknownRecord, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}

function sumNestedNumbers(value: unknown): number | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  let total = 0;
  let hasNumeric = false;
  for (const nestedValue of Object.values(value)) {
    if (typeof nestedValue === "number" && Number.isFinite(nestedValue)) {
      total += nestedValue;
      hasNumeric = true;
      continue;
    }
    if (typeof nestedValue === "string" && nestedValue.trim()) {
      const parsed = Number(nestedValue);
      if (Number.isFinite(parsed)) {
        total += parsed;
        hasNumeric = true;
      }
    }
  }

  return hasNumeric ? total : undefined;
}

function parseSurfaceValues(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const result: Record<string, number> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (typeof nestedValue === "number" && Number.isFinite(nestedValue)) {
      result[key] = nestedValue;
      continue;
    }

    if (typeof nestedValue === "string" && nestedValue.trim()) {
      const parsed = Number(nestedValue);
      if (Number.isFinite(parsed)) {
        result[key] = parsed;
      }
    }
  }

  return Object.keys(result).length ? result : undefined;
}

function sumSurfaceValues(
  surfaceValues: Record<string, number> | undefined,
  excludedKeys: string[] = []
): number | undefined {
  if (!surfaceValues) {
    return undefined;
  }

  const excluded = new Set(excludedKeys);
  let total = 0;
  let hasValue = false;

  for (const [key, value] of Object.entries(surfaceValues)) {
    if (excluded.has(key)) {
      continue;
    }
    total += value;
    hasValue = true;
  }

  return hasValue ? total : undefined;
}

function parseJson(raw: string): unknown {
  const parsed: unknown = JSON.parse(raw);
  return parsed;
}
