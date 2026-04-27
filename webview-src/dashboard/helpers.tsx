import type { ComponentChildren } from "preact";
import type { DashboardAccountViewModel, DashboardCopy, DashboardSettings, DashboardState } from "../../src/domain/dashboard/types";
import { formatResetRelativeTime } from "../../src/utils/resetTime";

type SensitiveKind = "email" | "id" | "name";

export function createShareFileName(): string {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");
  const second = String(now.getSeconds()).padStart(2, "0");
  return `codex-accounts-share-${year}${month}${day}-${hour}${minute}${second}.json`;
}

export function maskSharedJson(raw: string): string {
  if (!raw.trim()) {
    return raw;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return JSON.stringify(maskSharedValue(parsed), null, 2);
  } catch {
    return raw;
  }
}

export function clampPercent(value?: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, value));
}

export function colorForPercentage(value: number | undefined, settings: DashboardSettings): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "#2a6e3f";
  }
  if (value >= settings.quotaGreenThreshold) {
    return "#2a6e3f";
  }
  if (value >= settings.quotaYellowThreshold) {
    return "#e18a3b";
  }
  return "#c12c1f";
}

export function formatPercent(value?: number): string {
  return typeof value === "number" ? `${value}%` : "--";
}

export function formatRequestsLabel(requestsLeft?: number, requestsLimit?: number): string {
  if (typeof requestsLeft !== "number" || typeof requestsLimit !== "number") {
    return "";
  }

  return `${requestsLeft} / ${requestsLimit}`;
}

export function formatTimestamp(epochMs: number | undefined, fallback: string): string {
  if (!epochMs) {
    return fallback;
  }

  return new Date(epochMs).toLocaleString();
}

export function formatResetLabel(
  resetAt: number | undefined,
  fallback: string,
  now: number,
  lang: DashboardState["lang"]
): string {
  if (!resetAt) {
    return fallback;
  }

  const target = new Date(resetAt * 1000);
  const month = String(target.getMonth() + 1).padStart(2, "0");
  const day = String(target.getDate()).padStart(2, "0");
  const hour = String(target.getHours()).padStart(2, "0");
  const minute = String(target.getMinutes()).padStart(2, "0");

  return `${formatResetRelativeTime(resetAt, now, lang)} (${month}/${day} ${hour}:${minute})`;
}

export function formatTemplate(template: string, value: number | Record<string, string | number>): string {
  if (typeof value === "number") {
    return template.replace("{value}", String(value));
  }

  return Object.entries(value).reduce(
    (result, [key, item]) => result.replace(new RegExp(`\\{${key}\\}`, "g"), String(item)),
    template
  );
}

export function formatSavedAccountsSummary(
  lang: DashboardState["lang"],
  count: number,
  validCount: number,
  invalidCount: number
): string {
  switch (lang) {
    case "zh":
      return `共 ${count} 个，有效 ${validCount}，失效 ${invalidCount}`;
    case "zh-hant":
      return `共 ${count} 個，有效 ${validCount}，失效 ${invalidCount}`;
    case "ja":
      return `合計 ${count} 件・有効 ${validCount}・無効 ${invalidCount}`;
    default:
      return `${count} total · ${validCount} valid · ${invalidCount} invalid`;
  }
}

export function normalizeThresholds(green: number, yellow: number): { green: number; yellow: number } {
  const safeYellowBase = Number.isFinite(yellow) ? Math.max(0, Math.min(99, yellow)) : 20;
  const safeGreenBase = Number.isFinite(green) ? Math.max(1, Math.min(100, green)) : 60;
  const safeYellow = Math.min(safeYellowBase, safeGreenBase - 10);
  const safeGreen = Math.max(safeGreenBase, safeYellow + 10);

  return {
    green: safeGreen,
    yellow: safeYellow
  };
}

export function renderTagList(tags: string[]): ComponentChildren {
  if (!tags.length) {
    return null;
  }

  const visible = tags.slice(0, 2);
  const remaining = tags.length - visible.length;
  return (
    <>
      {visible.map((tag) => (
        <span key={tag} class="tag-pill">
          {tag}
        </span>
      ))}
      {remaining > 0 ? <span class="tag-pill muted">+{remaining}</span> : null}
    </>
  );
}

export function resolveLockMinutes(value: number): number {
  return value > 0 ? value : 15;
}

export function formatAutoSwitchReasonSummary(
  reason: NonNullable<DashboardAccountViewModel["lastAutoSwitchReason"]>,
  copy: DashboardCopy
): string {
  const trigger =
    reason.trigger === "hourly"
      ? copy.hourlyLabel
      : reason.trigger === "weekly"
        ? copy.weeklyLabel
        : `${copy.hourlyLabel} + ${copy.weeklyLabel}`;
  const rules = reason.matchedRules.map((rule) => {
    switch (rule) {
      case "same_email":
        return copy.autoSwitchRuleSameEmail;
      case "same_tag":
        return copy.autoSwitchRuleSameTag;
      case "workspace":
        return copy.autoSwitchRuleWorkspace;
      default:
        return copy.autoSwitchRuleQuota;
    }
  });

  return `${copy.autoSwitchReasonTrigger}: ${trigger} · ${copy.autoSwitchReasonMatchedRules}: ${rules.join(" / ")}`;
}

export function resolveDiscreteIndex(values: number[], currentValue: number): number {
  const matchedIndex = values.indexOf(currentValue);
  if (matchedIndex >= 0) {
    return matchedIndex;
  }

  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;

  values.forEach((value, index) => {
    const distance = Math.abs(value - currentValue);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });

  return nearestIndex;
}

export function resolveNearestDiscreteValue(values: number[], rawValue: number): number {
  const nearestIndex = resolveDiscreteIndex(values, rawValue);
  return values[nearestIndex] ?? values[0] ?? 0;
}

export function getSensitiveDisplayValue(
  value: string | undefined,
  hidden: boolean,
  kind: SensitiveKind,
  fallback = "—"
): string {
  const normalized = value?.trim();
  if (!normalized) {
    return fallback;
  }

  return hidden ? maskSensitiveValue(normalized, kind) : normalized;
}

export function resolveDiscretePercent(values: number[], currentValue: number): number {
  const first = values[0];
  const last = values[values.length - 1];
  if (typeof first !== "number" || typeof last !== "number" || first === last) {
    return 0;
  }

  return ((currentValue - first) / (last - first)) * 100;
}

export function pickSparseScaleValues(values: number[]): number[] {
  if (values.length <= 3) {
    return values;
  }

  const first = values[0];
  const middle = values[Math.floor((values.length - 1) / 2)];
  const last = values[values.length - 1];

  return [first, middle, last].filter(
    (value, index, array): value is number => typeof value === "number" && array.indexOf(value) === index
  );
}

function maskSharedValue(value: unknown, parentKey?: string): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => maskSharedValue(item, parentKey));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, maskSharedValue(item, key)])
    );
  }

  if (typeof value !== "string" || !value) {
    return value;
  }

  const sensitiveKeys = new Set([
    "email",
    "user_id",
    "account_id",
    "organization_id",
    "account_name",
    "id_token",
    "access_token",
    "refresh_token",
    "id"
  ]);

  if (parentKey && sensitiveKeys.has(parentKey)) {
    return maskSensitiveString(value);
  }

  return value;
}

function maskSensitiveString(value: string): string {
  if (value.length <= 8) {
    return `${value.slice(0, 1)}***${value.slice(-1)}`;
  }

  return `${value.slice(0, 3)}***${value.slice(-3)}`;
}

function maskSensitiveValue(value: string, kind: SensitiveKind): string {
  switch (kind) {
    case "email":
    case "name":
    case "id":
      return maskSensitiveString(value);
    default:
      return maskSensitiveString(value);
  }
}
