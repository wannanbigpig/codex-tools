import type {
  DashboardAccountViewModel,
  DashboardCopy,
  DashboardMetricViewModel,
  DashboardSettings,
  DashboardState
} from "../../src/domain/dashboard/types";
import { clampPercent, colorForPercentage, formatPercent, formatRequestsLabel, formatResetLabel } from "./helpers";

export function renderHealthPill(account: DashboardAccountViewModel) {
  if (account.dismissedHealth) {
    return null;
  }

  switch (account.healthKind) {
    case "healthy":
    case "expiring":
      return null;
    case "reauthorize":
    case "refresh_failed":
      return (
        <span class="pill error" title={account.healthLabel}>
          {account.healthLabel}
        </span>
      );
    case "disabled":
      return (
        <span class="pill error" title={account.healthMessage}>
          {account.healthLabel}
        </span>
      );
    case "quota":
      return (
        <span class="pill warning" title={account.healthMessage}>
          {account.healthLabel}
        </span>
      );
    default:
      return null;
  }
}

export function MetricGauge(props: {
  metric: DashboardMetricViewModel;
  lang: DashboardState["lang"];
  settings: DashboardSettings;
  copy: DashboardCopy;
  now: number;
}) {
  const clamped = clampPercent(props.metric.percentage);
  const color = colorForPercentage(props.metric.percentage, props.settings);
  const style = {
    "--pct": String(clamped),
    "--gauge-color": color,
    "--metric-color": color
  } as Record<string, string>;
  const resetLabel = formatResetLabel(props.metric.resetAt, props.copy.resetUnknown, props.now, props.lang);

  return (
    <div class="metric-gauge">
      <div class="metric-gauge-head">
        <span class="metric-gauge-label">{props.metric.label}</span>
        <span class="metric-gauge-reset" title={resetLabel}>
          {resetLabel}
        </span>
        <div class="metric-gauge-value">{formatPercent(props.metric.percentage)}</div>
      </div>
      <div class="bar metric-gauge-bar" style={style}>
        <span style={{ width: `${clamped}%`, "--metric-color": color }}></span>
      </div>
    </div>
  );
}

export function MetricRow(props: {
  metric: DashboardMetricViewModel;
  lang: DashboardState["lang"];
  settings: DashboardSettings;
  copy: DashboardCopy;
  now: number;
}) {
  const clamped = clampPercent(props.metric.percentage);
  const color = colorForPercentage(props.metric.percentage, props.settings);
  const percentStyle = { "--metric-color": color } as Record<string, string>;
  const barStyle = { width: `${clamped}%`, "--metric-color": color } as Record<string, string>;
  const requestsLabel = formatRequestsLabel(props.metric.requestsLeft, props.metric.requestsLimit);
  const resetLabel = formatResetLabel(props.metric.resetAt, props.copy.resetUnknown, props.now, props.lang);

  return (
    <div class="row">
      <div class="row-head">
        <div class="label-wrap">
          <span class="metric-label">{props.metric.label}</span>
        </div>
        <div class="metric-row-summary">
          <span class="metric-reset-inline">{resetLabel}</span>
          <span class="percent" style={percentStyle}>
            {formatPercent(props.metric.percentage)}
          </span>
        </div>
      </div>
      <div class="bar">
        <span style={barStyle}></span>
      </div>
      {requestsLabel ? (
        <div class="foot metric-requests-line">
          <span>{requestsLabel}</span>
        </div>
      ) : null}
    </div>
  );
}
