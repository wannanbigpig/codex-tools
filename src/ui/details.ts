import * as vscode from "vscode";
import { CodexAccountRecord, CodexDailyUsageBreakdown, CodexDailyUsagePoint } from "../core/types";
import type { DashboardLanguage } from "../localization/languages";
import { getIntlLocale } from "../localization/languages";
import { detailCopyResources } from "../localization/resources/details";
import { fetchDailyUsageBreakdown } from "../services";
import { AccountsRepository } from "../storage";
import { colorForPercentage, escapeHtml, escapeHtmlAttr, getLanguage, prettyAuthProvider } from "../utils";
import { formatRelativeReset, formatTimestamp } from "../utils/time";

let detailsPanel: vscode.WebviewPanel | undefined;
let detailsPanelRequestId = 0;
let detailsPanelConfigWatcher: vscode.Disposable | undefined;

type DetailsUsageState = "loading" | "ready" | "empty" | "error";

type DetailsPanelState = {
  repo?: AccountsRepository;
  accountId?: string;
  styles?: WebviewStyles;
  scripts?: WebviewScripts;
  usageState: DetailsUsageState;
  usage?: CodexDailyUsageBreakdown;
};

const detailsPanelState: DetailsPanelState = {
  usageState: "loading"
};

export function openDetailsPanel(
  context: vscode.ExtensionContext,
  repo: AccountsRepository,
  account: CodexAccountRecord
): void {
  const copy = getCopy();
  if (!detailsPanel) {
    detailsPanel = vscode.window.createWebviewPanel(
      "codexAccountDetails",
      `${copy.titlePrefix}: ${account.email}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        enableFindWidget: true
      }
    );

    detailsPanel.onDidDispose(() => {
      detailsPanelConfigWatcher?.dispose();
      detailsPanelConfigWatcher = undefined;
      detailsPanelState.repo = undefined;
      detailsPanelState.accountId = undefined;
      detailsPanelState.styles = undefined;
      detailsPanelState.scripts = undefined;
      detailsPanelState.usage = undefined;
      detailsPanelState.usageState = "loading";
      detailsPanel = undefined;
    });

    detailsPanelConfigWatcher = vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        !detailsPanel ||
        (!event.affectsConfiguration("codexAccounts.displayLanguage") &&
          !event.affectsConfiguration("codexAccounts.quotaGreenThreshold") &&
          !event.affectsConfiguration("codexAccounts.quotaYellowThreshold"))
      ) {
        return;
      }

      void refreshDetailsPanel();
    });
  } else {
    detailsPanel.title = `${copy.titlePrefix}: ${account.email}`;
    detailsPanel.reveal(vscode.ViewColumn.Beside, false);
  }

  const styles = getWebviewStyles(detailsPanel.webview, context.extensionUri, "details.css");
  const scripts = getWebviewScripts(detailsPanel.webview, context.extensionUri, "details.js");
  detailsPanelState.repo = repo;
  detailsPanelState.accountId = account.id;
  detailsPanelState.styles = styles;
  detailsPanelState.scripts = scripts;
  detailsPanelState.usage = undefined;
  detailsPanelState.usageState = "loading";
  const requestId = ++detailsPanelRequestId;
  renderDetails(account);

  void hydrateUsage(repo, account.id, requestId);
}

async function hydrateUsage(repo: AccountsRepository, accountId: string, requestId: number): Promise<void> {
  try {
    const tokens = await repo.getTokens(accountId);
    if (!tokens || !detailsPanel || requestId !== detailsPanelRequestId || detailsPanelState.accountId !== accountId) {
      return;
    }

    const usage = await fetchDailyUsageBreakdown(tokens, 30);
    if (!detailsPanel || requestId !== detailsPanelRequestId || detailsPanelState.accountId !== accountId) {
      return;
    }

    detailsPanelState.usageState = usage?.points.length ? "ready" : "empty";
    detailsPanelState.usage = usage;
    await refreshDetailsPanel();
  } catch {
    if (!detailsPanel || requestId !== detailsPanelRequestId || detailsPanelState.accountId !== accountId) {
      return;
    }

    detailsPanelState.usageState = "error";
    detailsPanelState.usage = undefined;
    await refreshDetailsPanel();
  }
}

export async function refreshDetailsPanel(): Promise<void> {
  if (
    !detailsPanel ||
    !detailsPanelState.repo ||
    !detailsPanelState.accountId ||
    !detailsPanelState.styles ||
    !detailsPanelState.scripts
  ) {
    return;
  }

  const account = await detailsPanelState.repo.getAccount(detailsPanelState.accountId);
  if (!account) {
    detailsPanel.dispose();
    return;
  }

  renderDetails(account);
}

function renderDetails(account: CodexAccountRecord): void {
  if (!detailsPanel || !detailsPanelState.styles || !detailsPanelState.scripts) {
    return;
  }

  const copy = getCopy();
  detailsPanel.title = `${copy.titlePrefix}: ${account.email}`;
  detailsPanel.webview.html = renderHtml(account, copy, detailsPanelState.styles, detailsPanelState.scripts, {
    usageState: detailsPanelState.usageState,
    usage: detailsPanelState.usage
  });
}

type WebviewStyles = {
  shared: string;
  page: string;
};

type WebviewScripts = {
  page: string;
};

type SensitiveKind = "email" | "id" | "name";

function renderHtml(
  account: CodexAccountRecord,
  copy: DetailCopy,
  styles: WebviewStyles,
  scripts: WebviewScripts,
  options: {
    usageState: "loading" | "ready" | "empty" | "error";
    usage?: CodexDailyUsageBreakdown;
  }
): string {
  const quota = account.quotaSummary;
  const accountStatus = account.isActive ? copy.currentlyActive : copy.savedAccount;
  const provider = prettyAuthProvider(account.authProvider);
  const identityName = account.accountName?.trim() ?? account.email;

  return `<!DOCTYPE html>
<html lang="${copy.lang}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styles.shared}" />
  <link rel="stylesheet" href="${styles.page}" />
</head>
<body>
  <div class="shell">
    <section class="panel">
      <div class="panel-inner hero">
        <div class="hero-top">
          <div class="hero-title">
            <div class="hero-title-row">
              <h1>${renderSensitiveHtml(identityName, "name")}</h1>
              <button
                class="privacy-toggle"
                type="button"
                aria-pressed="false"
                aria-label="${escapeHtmlAttr(copy.hideSensitive)}"
                title="${escapeHtmlAttr(copy.hideSensitive)}"
                data-role="privacy-toggle"
                data-show-label="${escapeHtmlAttr(copy.showSensitive)}"
                data-hide-label="${escapeHtmlAttr(copy.hideSensitive)}"
              >
                <span class="privacy-icon privacy-icon-show">${renderEyeSvg()}</span>
                <span class="privacy-icon privacy-icon-hide">${renderEyeOffSvg()}</span>
              </button>
            </div>
            <div class="meta">${renderSensitiveHtml(account.email, "email")}</div>
            <div class="meta">${escapeHtml(copy.detailsSubtitle)}</div>
          </div>
          <div class="badges">
            ${account.isActive ? `<span class="pill active">${escapeHtml(copy.current)}</span>` : `<span class="pill">${escapeHtml(copy.saved)}</span>`}
            <span class="pill plan">${escapeHtml((account.planType ?? "unknown").toUpperCase())}</span>
          </div>
        </div>
        <div class="summary">
          <div class="meta"><strong>${escapeHtml(copy.teamName)}:</strong> ${renderSensitiveHtml(account.accountName, "name", "-")}</div>
          <div class="meta"><strong>${escapeHtml(copy.login)}:</strong> ${escapeHtml(provider)}</div>
          <div class="meta"><strong>${escapeHtml(copy.loginTime)}:</strong> ${renderLiveTimestamp(account.loginAt, copy)}</div>
          <div class="meta"><strong>${escapeHtml(copy.userId)}:</strong> ${renderSensitiveHtml(account.userId ?? account.accountId, "id", "-")}</div>
          <div class="meta"><strong>${escapeHtml(copy.status)}:</strong> ${escapeHtml(accountStatus)}</div>
        </div>
      </div>
    </section>

    <section class="quota-grid">
      <div class="quota-card">
        <h2>${escapeHtml(copy.hourlyQuota)}</h2>
        <div class="quota-value" style="--metric-color:${colorForPercentage(quota?.hourlyPercentage)};">${renderQuotaValue(quota?.hourlyPercentage)}</div>
        <div class="meta">${escapeHtml(copy.reset)} ${renderLiveReset(quota?.hourlyResetTime, copy)}</div>
      </div>
      <div class="quota-card">
        <h2>${escapeHtml(copy.weeklyQuota)}</h2>
        <div class="quota-value" style="--metric-color:${colorForPercentage(quota?.weeklyPercentage)};">${renderQuotaValue(quota?.weeklyPercentage)}</div>
        <div class="meta">${escapeHtml(copy.reset)} ${renderLiveReset(quota?.weeklyResetTime, copy)}</div>
      </div>
      <div class="quota-card">
        <h2>${escapeHtml(copy.reviewQuota)}</h2>
        <div class="quota-value" style="--metric-color:${colorForPercentage(quota?.codeReviewPercentage)};">${renderQuotaValue(quota?.codeReviewPercentage)}</div>
        <div class="meta">${escapeHtml(copy.reset)} ${renderLiveReset(quota?.codeReviewResetTime, copy)}</div>
      </div>
    </section>

    <section class="usage-card">
      <div class="usage-head">
        <div class="usage-title-block">
          <h2>${escapeHtml(copy.usageTitle)}</h2>
          <div class="usage-note">${escapeHtml(copy.usageHint)}</div>
          <div class="meta">${escapeHtml(copy.usageSubtitle)}</div>
        </div>
        <div class="usage-range">${escapeHtml(copy.rangeLabel(options.usage?.days ?? 30))}</div>
      </div>
      ${renderUsageSection(options.usageState, options.usage, copy)}
    </section>

    <section class="meta-card">
      <h2>${escapeHtml(copy.metadata)}</h2>
      <div class="meta-grid">
        <div class="meta-box">
          <div class="label">${escapeHtml(copy.accountId)}</div>
          <div class="content">${renderSensitiveHtml(account.accountId, "id", "-")}</div>
        </div>
        <div class="meta-box">
          <div class="label">${escapeHtml(copy.organizationId)}</div>
          <div class="content">${renderSensitiveHtml(account.organizationId, "id", "-")}</div>
        </div>
        <div class="meta-box">
          <div class="label">${escapeHtml(copy.lastQuotaRefresh)}</div>
          <div class="content">${renderLiveTimestamp(account.lastQuotaAt, copy)}</div>
        </div>
        <div class="meta-box">
          <div class="label">${escapeHtml(copy.loginTime)}</div>
          <div class="content">${renderLiveTimestamp(account.loginAt, copy)}</div>
        </div>
      </div>
    </section>

  </div>
  <script src="${scripts.page}"></script>
</body>
</html>`;
}

function getWebviewStyles(webview: vscode.Webview, extensionUri: vscode.Uri, pageStylesheet: string): WebviewStyles {
  const shared = vscode.Uri.joinPath(extensionUri, "media", "webview", "shared.css");
  const page = vscode.Uri.joinPath(extensionUri, "media", "webview", pageStylesheet);
  return {
    shared: webview.asWebviewUri(shared).toString(),
    page: webview.asWebviewUri(page).toString()
  };
}

function getWebviewScripts(webview: vscode.Webview, extensionUri: vscode.Uri, pageScript: string): WebviewScripts {
  const page = vscode.Uri.joinPath(extensionUri, "media", "webview", pageScript);
  return {
    page: webview.asWebviewUri(page).toString()
  };
}

function renderUsageSection(
  state: "loading" | "ready" | "empty" | "error",
  usage: CodexDailyUsageBreakdown | undefined,
  copy: DetailCopy
): string {
  if (state === "loading") {
    return `<div class="usage-empty">${escapeHtml(copy.usageLoading)}</div>`;
  }

  if (state === "error") {
    return `<div class="usage-empty">${escapeHtml(copy.usageError)}</div>`;
  }

  if (!usage?.points.length) {
    return `<div class="usage-empty">${escapeHtml(copy.usageEmpty)}</div>`;
  }

  const firstPoint = usage.points[0];
  const lastPoint = usage.points[usage.points.length - 1];
  if (!firstPoint || !lastPoint) {
    return `<div class="usage-empty">${escapeHtml(copy.usageEmpty)}</div>`;
  }

  const surfaceKeys = collectVisibleSurfaceKeys(usage.points);
  const max = usage.points.reduce((current, point) => Math.max(current, point.totalTokens), 0) || 1;
  const startLabel = formatUsageDate(firstPoint.date, copy.lang);
  const endLabel = formatUsageDate(lastPoint.date, copy.lang);
  const bars = usage.points
    .map((point, index) => {
      const totalValue = point.totalTokens;
      const height = Math.max(2, Math.round((totalValue / max) * 100));
      const tooltip = escapeHtml(buildUsageTooltip(point, surfaceKeys, copy));
      const edgeClass = index === 0 ? " edge-left" : index === usage.points.length - 1 ? " edge-right" : "";
      const segments = renderUsageSegments(point, surfaceKeys, totalValue, copy);
      return `<div class="usage-bar${totalValue <= 0 ? " is-zero" : ""}${edgeClass}" data-tip="${tooltip}" style="--bar-height:${height}%;">
        <div class="usage-bar-fill" style="height:${height}%;">${segments}</div>
      </div>`;
    })
    .join("");

  const legends = surfaceKeys
    .map(
      (key) =>
        `<span class="usage-legend"><span class="usage-legend-dot" style="--legend-color:${surfaceColor(key)};"></span>${escapeHtml(formatSurfaceLabel(key))}</span>`
    )
    .join("");

  return `<div class="usage-chart">
    <div class="usage-bars">${bars}</div>
    <div class="usage-axis">
      <span>${escapeHtml(startLabel)}</span>
      <span class="usage-legends">${legends}</span>
      <span>${escapeHtml(endLabel)}</span>
    </div>
  </div>`;
}

function renderQuotaValue(value: number | undefined): string {
  return typeof value === "number" ? `${value}%` : "--";
}

function renderLiveReset(epochSeconds: number | undefined, copy: DetailCopy): string {
  if (!epochSeconds) {
    return copy.resetUnknown;
  }

  return `<span class="live-reset" data-reset-at="${epochSeconds}" data-reset-unknown="${escapeHtml(copy.resetUnknown)}">${escapeHtml(formatRelativeReset(epochSeconds))}</span>`;
}

function renderLiveTimestamp(epochMs: number | undefined, copy: DetailCopy): string {
  if (!epochMs) {
    return copy.never;
  }

  return `<span class="live-timestamp" data-epoch-ms="${epochMs}" data-never="${escapeHtml(copy.never)}">${escapeHtml(formatTimestamp(epochMs))}</span>`;
}

function renderSensitiveHtml(value: string | undefined, kind: SensitiveKind, fallback = "—"): string {
  const normalized = value?.trim();
  if (!normalized) {
    return escapeHtml(fallback);
  }

  return `<span class="privacy-sensitive"><span class="privacy-sensitive-raw">${escapeHtml(normalized)}</span><span class="privacy-sensitive-masked">${escapeHtml(maskSensitiveValue(normalized, kind))}</span></span>`;
}

function maskSensitiveValue(value: string, kind: SensitiveKind): string {
  switch (kind) {
    case "email":
      return maskEmail(value);
    case "name":
      return maskSegmentedValue(value);
    case "id":
      return createMask(value.length, 10, 18);
    default:
      return createMask(value.length);
  }
}

function maskEmail(value: string): string {
  const [localPart, domainPart] = value.split("@");
  if (!localPart || !domainPart) {
    return createMask(value.length);
  }

  return `${createMask(localPart.length, 4, 10)}@${createMask(domainPart.length, 4, 10)}`;
}

function maskSegmentedValue(value: string): string {
  return value
    .split(/(\s+|[._\-\\/]+)/)
    .map((segment) => (/^(\s+|[._\-\\/]+)$/.test(segment) ? segment : createMask(segment.length, 3, 8)))
    .join("");
}

function createMask(length: number, min = 6, max = 12): string {
  return "*".repeat(Math.max(min, Math.min(max, Math.max(1, length))));
}

function renderEyeSvg(): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1.5 12s3.8-6 10.5-6 10.5 6 10.5 6-3.8 6-10.5 6S1.5 12 1.5 12Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"></circle></svg>`;
}

function renderEyeOffSvg(): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path><path d="M10.6 5.7A12.6 12.6 0 0 1 12 5.6c6.7 0 10.5 6.4 10.5 6.4a18.4 18.4 0 0 1-4 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path><path d="M6.2 7.2A18.8 18.8 0 0 0 1.5 12s3.8 6 10.5 6c1.6 0 3-.3 4.3-.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path><path d="M9.9 9.8A3.2 3.2 0 0 0 14.2 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg>`;
}

function formatUsageDate(input: string, lang: DashboardLanguage): string {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return input;
  }

  return new Intl.DateTimeFormat(getIntlLocale(lang), { month: "short", day: "numeric" }).format(date);
}

function collectVisibleSurfaceKeys(points: CodexDailyUsagePoint[]): string[] {
  const totals = new Map<string, number>();

  for (const point of points) {
    for (const [key, value] of Object.entries(point.surfaceValues ?? {})) {
      if (value <= 0) {
        continue;
      }
      totals.set(key, (totals.get(key) ?? 0) + value);
    }
  }

  return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key);
}

function renderUsageSegments(
  point: CodexDailyUsagePoint,
  surfaceKeys: string[],
  totalValue: number,
  copy: DetailCopy
): string {
  if (!surfaceKeys.length || totalValue <= 0) {
    return `<div class="usage-segment usage-segment-empty" style="height:100%;"></div>`;
  }

  const segments = surfaceKeys
    .map((key) => {
      const value = point.surfaceValues?.[key] ?? 0;
      if (value <= 0) {
        return "";
      }

      const ratio = (value / totalValue) * 100;
      return `<div class="usage-segment" title="${escapeHtmlAttr(
        `${formatSurfaceLabel(key)} ${copy.usageValueLabel(value, totalValue)}`
      )}" style="height:${Math.max(2, ratio)}%;--segment-color:${surfaceColor(key)};"></div>`;
    })
    .filter(Boolean)
    .join("");

  return segments || `<div class="usage-segment usage-segment-empty" style="height:100%;"></div>`;
}

function buildUsageTooltip(point: CodexDailyUsagePoint, surfaceKeys: string[], copy: DetailCopy): string {
  const lines = [formatUsageDate(point.date, copy.lang)];
  const totalValue = point.totalTokens;

  for (const key of surfaceKeys) {
    const value = point.surfaceValues?.[key] ?? 0;
    if (value <= 0) {
      continue;
    }
    lines.push(`${formatSurfaceLabel(key)} ${copy.usageValueLabel(value, totalValue)}`);
  }

  if (lines.length === 1) {
    lines.push(copy.usageEmpty);
  }

  return lines.join("\n");
}

function surfaceColor(key: string): string {
  const palette: Record<string, string> = {
    vscode: "#f59e0b",
    web: "#94a3b8",
    github: "#60a5fa",
    github_code_review: "#34d399",
    desktop_app: "#22d3ee",
    exec: "#fbbf24",
    cli: "#fb7185",
    slack: "#f472b6",
    linear: "#a78bfa",
    jetbrains: "#10b981",
    sdk: "#2dd4bf",
    unknown: "#64748b"
  };

  return palette[key] ?? "#64748b";
}

function formatSurfaceLabel(key: string): string {
  return key;
}

type DetailCopy = {
  lang: DashboardLanguage;
  titlePrefix: string;
  detailsSubtitle: string;
  current: string;
  saved: string;
  showSensitive: string;
  hideSensitive: string;
  currentlyActive: string;
  savedAccount: string;
  teamName: string;
  login: string;
  loginTime: string;
  userId: string;
  status: string;
  hourlyQuota: string;
  weeklyQuota: string;
  reviewQuota: string;
  reset: string;
  usageTitle: string;
  usageHint: string;
  usageSubtitle: string;
  usageLoading: string;
  usageEmpty: string;
  usageError: string;
  rangeLabel: (days: number) => string;
  usageValueLabel: (value: number, total: number) => string;
  metadata: string;
  accountId: string;
  organizationId: string;
  lastQuotaRefresh: string;
  resetUnknown: string;
  never: string;
};

function getCopy(): DetailCopy {
  const lang = getLanguage();
  const resource = detailCopyResources[lang];
  return {
    lang,
    ...resource,
    rangeLabel: (days) => resource.rangeLabelTemplate.replace("{days}", String(days)),
    usageValueLabel: (value, total) =>
      `${((value / Math.max(total, 1)) * 100).toLocaleString(getIntlLocale(lang), {
        maximumFractionDigits: 0
      })}%`
  };
}
