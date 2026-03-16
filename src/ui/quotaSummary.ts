import * as vscode from "vscode";
import { AccountsRepository } from "../storage";
import { CodexAccountRecord } from "../core/types";
import { formatRelativeReset, formatTimestamp } from "../utils/time";
import { colorForPercentage, escapeHtml, escapeHtmlAttr } from "../utils";

let quotaSummaryPanel: vscode.WebviewPanel | undefined;

export function openQuotaSummaryPanel(context: vscode.ExtensionContext, repo: AccountsRepository): void {
  const lang = resolveLanguage();
  const t = lang === "zh" ? zh : en;
  const iconUri = vscode.Uri.joinPath(context.extensionUri, "media", "CT_logo_transparent_square_hd.png");
  if (!quotaSummaryPanel) {
    quotaSummaryPanel = vscode.window.createWebviewPanel("codexQuotaSummary", t.panelTitle, vscode.ViewColumn.Beside, {
      enableScripts: true,
      retainContextWhenHidden: true
    });
    quotaSummaryPanel.iconPath = iconUri;

    quotaSummaryPanel.onDidDispose(() => {
      quotaSummaryPanel = undefined;
    });

    quotaSummaryPanel.webview.onDidReceiveMessage(async (message: { type?: string; accountId?: string }) => {
      const account = message.accountId ? await repo.getAccount(message.accountId) : undefined;

      switch (message.type) {
        case "addAccount":
          await vscode.commands.executeCommand("codexAccounts.addAccount");
          break;
        case "importCurrent":
          await vscode.commands.executeCommand("codexAccounts.importCurrentAuth");
          break;
        case "refreshAll":
          await vscode.commands.executeCommand("codexAccounts.refreshAllQuotas");
          break;
        case "details":
          if (account) {
            await vscode.commands.executeCommand("codexAccounts.openDetails", account);
          }
          break;
        case "switch":
          if (account) {
            await vscode.commands.executeCommand("codexAccounts.switchAccount", account);
          }
          break;
        case "refresh":
          if (account) {
            await vscode.commands.executeCommand("codexAccounts.refreshQuota", account);
          }
          break;
        case "remove":
          if (account) {
            await vscode.commands.executeCommand("codexAccounts.removeAccount", account);
          }
          break;
        case "toggleStatusBar":
          if (account) {
            await vscode.commands.executeCommand("codexAccounts.toggleStatusBarAccount", account);
          }
          break;
        default:
          break;
      }

      await rerender();
    });
  } else {
    quotaSummaryPanel.title = t.panelTitle;
    quotaSummaryPanel.iconPath = iconUri;
    quotaSummaryPanel.reveal(vscode.ViewColumn.Beside, false);
  }

  const panel = quotaSummaryPanel;
  const webviewIconUri = panel.webview.asWebviewUri(iconUri).toString();

  const rerender = async (): Promise<void> => {
    panel.webview.html = renderHtml(await repo.listAccounts(), webviewIconUri);
  };

  void rerender();
}

function renderHtml(accounts: CodexAccountRecord[], logoUri: string): string {
  const lang = resolveLanguage();
  const t = lang === "zh" ? zh : en;
  const sorted = [...accounts].sort(
    (a, b) => Number(b.isActive) - Number(a.isActive) || a.email.localeCompare(b.email)
  );
  const active = sorted[0];
  const activeEmail = active?.email ?? t.unknown;
  const activeTeam = active?.accountName?.trim() ?? t.unknown;

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    :root {
      --bg-1: #1f2336;
      --bg-2: #242a40;
      --card: rgba(255, 255, 255, 0.05);
      --line: rgba(168, 176, 255, 0.18);
      --text: #f4f7ff;
      --muted: #aeb6d9;
      --track: rgba(255,255,255,0.11);
      --success: #7ddc7a;
      --warning: #fbbf24;
      --danger: #ef4444;
      --shadow: 0 18px 40px rgba(0, 0, 0, 0.28);
      --cyan: #47c7f4;
      --cyan-soft: rgba(71, 199, 244, 0.14);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 10px;
      background:
        radial-gradient(circle at top left, rgba(139,92,246,0.22), transparent 30%),
        radial-gradient(circle at top right, rgba(34,197,94,0.12), transparent 25%),
        linear-gradient(180deg, var(--bg-1), var(--bg-2));
      color: var(--text);
      font-family: "Avenir Next", "PingFang SC", "Segoe UI", sans-serif;
    }
    .panel {
      border: 1px solid var(--line);
      border-radius: 16px;
      background:
        linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02)),
        linear-gradient(135deg, rgba(139,92,246,0.12), rgba(255,255,255,0.02));
      box-shadow: var(--shadow);
      overflow: hidden;
    }
    .section {
      padding: 14px 16px;
    }
    .section + .section {
      border-top: 1px solid rgba(168, 176, 255, 0.16);
    }
    .header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 14px;
    }
    .header-title {
      font-weight: 800;
      letter-spacing: 0.01em;
      font-size: 15px;
    }
    .header-sub {
      color: var(--muted);
      font-size: 12px;
      margin-top: 4px;
    }
    .hero {
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 16px;
      background: linear-gradient(135deg, rgba(139,92,246,0.14), rgba(255,255,255,0.03));
      padding: 16px;
      margin-bottom: 16px;
    }
    .hero-top {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .logo {
      width: 36px;
      height: 36px;
      border-radius: 12px;
      flex: none;
      display: block;
      object-fit: contain;
      filter: drop-shadow(0 12px 28px rgba(79, 70, 229, 0.28));
    }
    .brand h1 {
      margin: 0;
      font-size: 18px;
      letter-spacing: 0.02em;
    }
    .brand p {
      margin: 4px 0 0;
      font-size: 12px;
      color: var(--muted);
    }
    .hero-summary {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      margin-top: 14px;
    }
    .summary-card {
      background: rgba(9, 11, 25, 0.28);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 14px;
      padding: 12px;
      min-width: 0;
    }
    .summary-label {
      font-size: 11px;
      letter-spacing: 0.08em;
      color: var(--muted);
      text-transform: uppercase;
    }
    .summary-value {
      margin-top: 8px;
      font-size: 16px;
      font-weight: 800;
      word-break: break-word;
    }
    .toolbar {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
      margin-top: 14px;
    }
    .primary-btn {
      background: linear-gradient(135deg, #8b5cf6, #6d28d9);
      border-color: transparent;
    }
    .account-title {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .title { font-weight: 800; font-size: 14px; }
    .pill {
      padding: 3px 8px;
      border-radius: 999px;
      background: rgba(255,255,255,0.08);
      color: var(--muted);
      font-size: 10px;
      font-weight: 700;
    }
    .pill.active {
      background: rgba(34,197,94,0.14);
      color: #b8ffce;
    }
    .pill.plan {
      background: rgba(139,92,246,0.16);
      color: #d9c3ff;
      border: 1px solid rgba(139,92,246,0.24);
    }
    .identity {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.55;
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 18px;
      align-items: start;
    }
    .metric-gauge {
      display: grid;
      justify-items: center;
      gap: 8px;
      min-width: 0;
    }
    .metric-gauge-ring {
      --width: 132px;
      --height: 72px;
      --inner-bg: rgba(31,35,54,1);
      --track-color: rgba(255,255,255,0.11);
      width: var(--width);
      height: var(--height);
      border-radius: calc(var(--width) / 2) calc(var(--width) / 2) 0 0;
      position: relative;
      box-shadow:
        inset 0 0 0 1px rgba(255,255,255,0.05),
        0 10px 28px rgba(0, 0, 0, 0.22);
      overflow: hidden;
    }
    .metric-gauge-ring::before {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: inherit;
      background:
        repeating-conic-gradient(
          from 270deg at 50% 100%,
          rgba(255,255,255,0.32) 0deg 1deg,
          transparent 1deg 4.5deg
        ),
        conic-gradient(
          from 270deg at 50% 100%,
          var(--gauge-color) calc(var(--pct) * 1.8deg),
          rgba(255,255,255,0.10) 0deg 180deg,
          transparent 0
        );
      -webkit-mask:
        radial-gradient(circle at 50% 100%, transparent 0 50px, #000 51px 70px, transparent 71px);
      mask:
        radial-gradient(circle at 50% 100%, transparent 0 50px, #000 51px 70px, transparent 71px);
    }
    .metric-gauge-ring::after {
      content: "";
      position: absolute;
      left: 50%;
      bottom: 0;
      width: 92px;
      height: 46px;
      transform: translateX(-50%);
      border-radius: 92px 92px 0 0;
      background: linear-gradient(180deg, rgba(255,255,255,0.05), var(--inner-bg));
      border: 1px solid rgba(255,255,255,0.05);
      border-bottom: 0;
    }
    .metric-gauge-value {
      position: absolute;
      left: 50%;
      bottom: 10px;
      transform: translateX(-50%);
      z-index: 1;
      font-size: 22px;
      font-weight: 800;
      letter-spacing: -0.02em;
      color: var(--text);
      white-space: nowrap;
    }
    .metric-gauge-label {
      font-size: 13px;
      font-weight: 700;
      color: var(--text);
      text-align: center;
    }
    .metric-gauge-foot {
      font-size: 11px;
      color: var(--muted);
      text-align: center;
      line-height: 1.45;
      max-width: 160px;
    }
    .row { display: grid; gap: 6px; }
    .row-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--muted); }
    .label-wrap {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .metric-label {
      color: var(--text);
      font-weight: 700;
      min-width: 68px;
    }
    .percent { color: var(--metric-color, var(--success)); font-weight: 800; flex: none; }
    .bar { height: 6px; border-radius: 999px; overflow: hidden; background: var(--track); }
    .bar > span { display:block; height:100%; border-radius:inherit; background: var(--metric-color, var(--success)); }
    .foot {
      font-size: 11px;
      color: var(--muted);
      display: grid;
      justify-items: end;
      text-align: right;
      min-height: 16px;
      width: 100%;
    }
    .grid-two {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px 14px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.45;
    }
    .grid-label {
      display: block;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-bottom: 4px;
      color: #c2cbef;
    }
    .accounts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(360px, 360px));
      gap: 16px;
      justify-content: start;
      align-items: start;
    }
    .saved-card {
      border-radius: 18px;
      border: 1px solid rgba(168, 176, 255, 0.2);
      background: rgba(255,255,255,0.04);
      overflow: hidden;
      box-shadow: var(--shadow);
      min-width: 0;
    }
    .saved-card.active {
      border-color: rgba(34,197,94,0.34);
      background: linear-gradient(180deg, rgba(34,197,94,0.08), rgba(255,255,255,0.04));
    }
    .saved-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 10px;
      padding: 14px 14px 10px;
      position: relative;
    }
    .saved-title h3 {
      margin: 0;
      font-size: 14px;
      line-height: 1.25;
      word-break: break-all;
    }
    .saved-sub {
      margin-top: 4px;
      color: var(--muted);
      font-size: 11px;
      line-height: 1.5;
    }
    .saved-sub.truncate {
      display: block;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .saved-meta {
      margin-top: 6px;
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .saved-toggle {
      position: absolute;
      top: 14px;
      right: 14px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      min-width: 34px;
      height: 28px;
      padding: 0 8px;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,0.12);
      background: linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.03));
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.05);
      cursor: pointer;
      transition: background 120ms ease, border-color 120ms ease, transform 120ms ease;
    }
    .saved-toggle:hover {
      background: linear-gradient(180deg, rgba(255,255,255,0.1), rgba(255,255,255,0.05));
      border-color: rgba(255,255,255,0.2);
      transform: translateY(-1px);
    }
    .saved-toggle.disabled {
      opacity: 0.45;
      cursor: not-allowed;
      transform: none;
    }
    .saved-toggle.disabled:hover {
      background: linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.03));
      border-color: rgba(255,255,255,0.12);
      transform: none;
    }
    .saved-toggle input {
      position: absolute;
      inset: 0;
      opacity: 0;
      cursor: pointer;
      margin: 0;
    }
    .saved-toggle.disabled input {
      cursor: not-allowed;
    }
    .saved-toggle-mark {
      width: 14px;
      height: 14px;
      border-radius: 4px;
      border: 1px solid rgba(255,255,255,0.22);
      background: rgba(14, 18, 34, 0.5);
      position: relative;
      pointer-events: none;
      transition: background 120ms ease, border-color 120ms ease, box-shadow 120ms ease;
    }
    .saved-toggle input:checked + .saved-toggle-mark {
      border-color: rgba(34,197,94,0.45);
      background: linear-gradient(180deg, rgba(34,197,94,0.28), rgba(34,197,94,0.14));
      box-shadow: 0 0 0 3px rgba(34,197,94,0.12);
    }
    .saved-toggle input:checked + .saved-toggle-mark::after {
      content: "";
      position: absolute;
      left: 4px;
      top: 1px;
      width: 3px;
      height: 7px;
      border: solid #b8ffce;
      border-width: 0 2px 2px 0;
      transform: rotate(45deg);
    }
    .saved-toggle-text {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.02em;
      color: var(--muted);
      pointer-events: none;
    }
    .saved-toggle input:checked ~ .saved-toggle-text {
      color: #b8ffce;
    }
    .saved-progress {
      display: grid;
      gap: 10px;
      padding: 0 14px 12px;
    }
    .saved-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      padding: 0 14px 14px;
      border-top: 1px solid rgba(255,255,255,0.08);
      padding-top: 12px;
      justify-content: flex-end;
    }
    .saved-refresh {
      padding: 0 14px 10px;
      color: var(--muted);
      font-size: 11px;
      text-align: left;
    }
    .toggle-on {
      border-color: rgba(34,197,94,0.28);
      color: #b8ffce;
      background: rgba(34,197,94,0.12);
    }
    .other-list {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 320px));
      gap: 14px;
      align-items: start;
      justify-content: start;
    }
    .other-item {
      display: grid;
      gap: 10px;
      padding: 14px;
      border-radius: 14px;
      border: 1px solid rgba(168, 176, 255, 0.16);
      background: rgba(255,255,255,0.04);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
    }
    .other-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .other-name {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .status-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--metric-color, var(--success));
      box-shadow: 0 0 12px color-mix(in srgb, var(--metric-color, var(--success)) 60%, transparent);
      flex: none;
    }
    .other-label {
      font-size: 13px;
      font-weight: 700;
      word-break: break-word;
    }
    .other-meta {
      color: var(--muted);
      font-size: 11px;
    }
    .other-sub {
      color: var(--muted);
      font-size: 11px;
      line-height: 1.5;
      padding-left: 18px;
    }
    .mini-metrics {
      display: grid;
      gap: 6px;
      padding-left: 18px;
      padding-top: 4px;
    }
    .mini-metric {
      display: grid;
      gap: 4px;
    }
    .mini-row {
      display: grid;
      grid-template-columns: 52px 1fr auto;
      gap: 8px;
      align-items: center;
      font-size: 11px;
    }
    .mini-label { color: var(--muted); font-weight: 700; }
    .mini-bar {
      height: 4px;
      border-radius: 999px;
      background: var(--track);
      overflow: hidden;
    }
    .mini-bar > span {
      display: block;
      height: 100%;
      background: var(--metric-color, var(--success));
      border-radius: inherit;
    }
    .mini-value {
      color: var(--text);
      font-weight: 700;
      white-space: nowrap;
    }
    .mini-foot {
      padding-left: 60px;
      color: var(--muted);
      font-size: 10px;
      line-height: 1.4;
    }
    .card-actions {
      display: flex;
      gap: 8px;
      padding-left: 18px;
      padding-top: 4px;
      flex-wrap: wrap;
    }
    .ghost-btn {
      padding: 6px 10px;
      font-size: 10px;
      border-radius: 10px;
      background: rgba(255,255,255,0.04);
    }
    button {
      appearance: none;
      border: 1px solid rgba(255,255,255,0.12);
      background: rgba(255,255,255,0.06);
      color: var(--text);
      border-radius: 12px;
      padding: 8px 10px;
      font-size: 11px;
      font-weight: 700;
      cursor: pointer;
      min-width: 0;
    }
    @media (max-width: 540px) {
      .hero-summary,
      .grid-two {
        grid-template-columns: 1fr;
      }
      .metrics {
        grid-template-columns: 1fr;
      }
      .toolbar,
      .accounts-grid,
      .other-list {
        grid-template-columns: 1fr;
      }
      .mini-metrics {
        padding-left: 0;
      }
    }
  </style>
</head>
<body>
  <div class="panel">
    <section class="section">
      <div class="hero">
        <div class="hero-top">
          <div class="brand">
            <img class="logo" src="${logoUri}" alt="Codex Tools logo" />
            <div>
              <h1>codex-tools</h1>
              <p>${escapeHtml(t.brandSub)}</p>
            </div>
          </div>
        </div>
        <div class="hero-summary">
          <div class="summary-card">
            <div class="summary-label">${escapeHtml(t.activeAccount)}</div>
            <div class="summary-value">${escapeHtml(activeEmail)}</div>
          </div>
          <div class="summary-card">
            <div class="summary-label">${escapeHtml(t.activeTeam)}</div>
            <div class="summary-value">${escapeHtml(activeTeam)}</div>
          </div>
        </div>
        <div class="toolbar">
          <button class="primary-btn" onclick="send('addAccount')">${escapeHtml(t.addAccount)}</button>
          <button onclick="send('importCurrent')">${escapeHtml(t.importCurrent)}</button>
          <button onclick="send('refreshAll')">${escapeHtml(t.refreshAll)}</button>
        </div>
      </div>
      <div class="header">
        <div>
          <div class="header-title">${escapeHtml(t.dashboardTitle)}</div>
          <div class="header-sub">${escapeHtml(t.dashboardSub)}</div>
        </div>
      </div>
      ${active ? renderPrimarySection(accountWithTranslations(active, t), t) : `<div class="identity">${escapeHtml(t.empty)}</div>`}
    </section>
    ${
      sorted.length
        ? `<section class="section">${renderSavedAccounts(
            sorted.map((account) => accountWithTranslations(account, t)),
            t
          )}</section>`
        : ""
    }
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    function send(type, accountId) { vscode.postMessage({ type, accountId }); }
  </script>
</body>
</html>`;
}

function renderPrimarySection(account: LocalizedAccount, t: CopySet): string {
  return `
    <div class="account-title">
      <div class="title">${escapeHtml(account.accountName ?? account.email)}</div>
      ${account.isActive ? `<div class="pill active">${escapeHtml(t.current)}</div>` : ""}
      <div class="pill plan">${escapeHtml((account.planType ?? "team").toUpperCase())}</div>
    </div>
    <div class="identity" style="margin-top:10px;">
      ${escapeHtml(account.email)}<br />
      ${escapeHtml(account.authProviderLabel)} · ${escapeHtml(account.accountStructureLabel)}
    </div>
    <div class="metrics" style="margin-top:14px;">
      ${renderPrimaryGauge(t.hourlyLabel, account.quotaSummary?.hourlyPercentage, account.quotaSummary?.hourlyResetTime)}
      ${renderPrimaryGauge(t.weeklyLabel, account.quotaSummary?.weeklyPercentage, account.quotaSummary?.weeklyResetTime)}
      ${renderPrimaryGauge(t.reviewLabel, account.quotaSummary?.codeReviewPercentage, account.quotaSummary?.codeReviewResetTime)}
    </div>
    <div class="grid-two" style="margin-top:14px;">
      <div>
        <span class="grid-label">${escapeHtml(t.userId)}</span>
        <span>${escapeHtml(account.userId ?? t.unknown)}</span>
      </div>
      <div>
        <span class="grid-label">${escapeHtml(t.lastRefresh)}</span>
        <span>${escapeHtml(account.lastQuotaAt ? formatTimestamp(account.lastQuotaAt) : t.never)}</span>
      </div>
      <div>
        <span class="grid-label">${escapeHtml(t.accountId)}</span>
        <span>${escapeHtml(account.accountId ?? t.unknown)}</span>
      </div>
      <div>
        <span class="grid-label">${escapeHtml(t.organization)}</span>
        <span>${escapeHtml(account.organizationId ?? t.unknown)}</span>
      </div>
    </div>
  `;
}

function renderSavedAccounts(accounts: LocalizedAccount[], t: CopySet): string {
  const extraSelectedCount = accounts.filter((account) => !account.isActive && account.showInStatusBar).length;
  return `
    <div class="header" style="margin-bottom:12px;">
      <div>
        <div class="header-title" style="font-size:14px;">${escapeHtml(t.savedAccounts)}</div>
        <div class="header-sub">${escapeHtml(t.savedAccountsSub)}</div>
      </div>
    </div>
    <div class="accounts-grid">
      ${accounts.map((account) => renderSavedCard(account, t, extraSelectedCount)).join("")}
    </div>
  `;
}

function renderSavedCard(account: LocalizedAccount, t: CopySet, extraSelectedCount: number): string {
  const toggleDisabled = !account.isActive && !account.showInStatusBar && extraSelectedCount >= 2;
  const toggleTitle = toggleDisabled
    ? t.statusLimitTip
    : account.showInStatusBar
      ? t.statusToggleTipChecked
      : t.statusToggleTip;
  return `<article class="saved-card ${account.isActive ? "active" : ""}">
    <div class="saved-head">
      ${
        account.isActive
          ? ""
          : `<label class="saved-toggle ${toggleDisabled ? "disabled" : ""}" title="${escapeHtmlAttr(toggleTitle)}" aria-label="${escapeHtmlAttr(toggleTitle)}">
        <input type="checkbox" ${account.showInStatusBar ? "checked" : ""} ${toggleDisabled ? "disabled" : ""} onchange="send('toggleStatusBar', '${escapeHtmlAttr(account.id)}')" />
        <span class="saved-toggle-mark"></span>
        <span class="saved-toggle-text">${escapeHtml(t.statusShort)}</span>
      </label>`
      }
      <div class="saved-title">
        <h3>${escapeHtml(account.email)}</h3>
        <div class="saved-sub">${escapeHtml(t.teamName)}: ${escapeHtml(account.accountName ?? t.unknown)}</div>
        <div class="saved-sub">${escapeHtml(t.login)}: ${escapeHtml(account.authProviderLabel)}</div>
        <div class="saved-sub truncate" title="${escapeHtmlAttr(`${t.userId}: ${account.userId ?? account.accountId ?? "-"}`)}">${escapeHtml(t.userId)}: ${escapeHtml(account.userId ?? account.accountId ?? "-")}</div>
        <div class="saved-meta">
          ${account.isActive ? `<span class="pill active">${escapeHtml(t.current)}</span>` : ""}
          <span class="pill plan">${escapeHtml((account.planType ?? "team").toUpperCase())}</span>
          <span class="pill">${escapeHtml(account.accountStructureLabel)}</span>
        </div>
      </div>
    </div>
    <div class="saved-progress">
      ${renderMetric(t.hourlyLabel, account.quotaSummary?.hourlyPercentage, account.quotaSummary?.hourlyResetTime)}
      ${renderMetric(t.weeklyLabel, account.quotaSummary?.weeklyPercentage, account.quotaSummary?.weeklyResetTime)}
      ${renderMetric(t.reviewLabel, account.quotaSummary?.codeReviewPercentage, account.quotaSummary?.codeReviewResetTime)}
    </div>
    <div class="saved-refresh">${escapeHtml(t.lastRefresh)}: ${escapeHtml(account.lastQuotaAt ? formatTimestamp(account.lastQuotaAt) : t.never)}</div>
    <div class="saved-actions">
      <button onclick="send('switch', '${escapeHtmlAttr(account.id)}')">${escapeHtml(t.switchBtn)}</button>
      <button onclick="send('refresh', '${escapeHtmlAttr(account.id)}')">${escapeHtml(t.refreshBtn)}</button>
      <button onclick="send('details', '${escapeHtmlAttr(account.id)}')">${escapeHtml(t.detailsBtn)}</button>
      <button onclick="send('remove', '${escapeHtmlAttr(account.id)}')">${escapeHtml(t.removeBtn)}</button>
    </div>
  </article>`;
}

function renderPrimaryGauge(label: string, percent?: number, resetAt?: number): string {
  const clamped = typeof percent === "number" ? Math.max(0, Math.min(100, percent)) : 0;
  const color = colorForPercentage(percent);
  const resetText = formatResetText(resetAt, resolveLanguage() === "zh" ? zh : en);
  return `<div class="metric-gauge">
    <div class="metric-gauge-ring" style="--pct:${clamped}; --gauge-color:${color};">
      <div class="metric-gauge-value">${typeof percent === "number" ? `${percent}%` : "--"}</div>
    </div>
    <div class="metric-gauge-label">${escapeHtml(label)}</div>
    <div class="metric-gauge-foot">${escapeHtml(resetText)}</div>
  </div>`;
}

/**
 * 渲染指标行
 */
function renderMetric(label: string, percent?: number, resetAt?: number): string {
  const clamped = typeof percent === "number" ? Math.max(0, Math.min(100, percent)) : 0;
  const color = colorForPercentage(percent);
  const resetText = formatResetText(resetAt, resolveLanguage() === "zh" ? zh : en);
  return `<div class="row">
    <div class="row-head">
      <div class="label-wrap">
        <span class="metric-label">${escapeHtml(label)}</span>
      </div>
      <span class="percent" style="--metric-color:${color};">${typeof percent === "number" ? `${percent}%` : "--"}</span>
    </div>
    <div class="bar"><span style="width:${clamped}%; --metric-color:${color};"></span></div>
    <div class="foot">${escapeHtml(resetText)}</div>
  </div>`;
}

/**
 * 格式化重置时间文本
 */
function formatResetText(resetAt: number | undefined, t: CopySet): string {
  if (!resetAt) {
    return t.resetUnknown;
  }

  const target = new Date(resetAt * 1000);
  const mm = String(target.getMonth() + 1).padStart(2, "0");
  const dd = String(target.getDate()).padStart(2, "0");
  const hh = String(target.getHours()).padStart(2, "0");
  const min = String(target.getMinutes()).padStart(2, "0");
  return `${formatRelativeReset(resetAt)} (${mm}/${dd} ${hh}:${min})`;
}

interface CopySet {
  panelTitle: string;
  brandSub: string;
  activeAccount: string;
  activeTeam: string;
  addAccount: string;
  importCurrent: string;
  refreshAll: string;
  dashboardTitle: string;
  dashboardSub: string;
  empty: string;
  current: string;
  hourlyLabel: string;
  weeklyLabel: string;
  reviewLabel: string;
  userId: string;
  lastRefresh: string;
  accountId: string;
  organization: string;
  savedAccounts: string;
  savedAccountsSub: string;
  teamName: string;
  login: string;
  switchBtn: string;
  refreshBtn: string;
  detailsBtn: string;
  removeBtn: string;
  inStatus: string;
  addToStatus: string;
  statusShort: string;
  statusToggleTip: string;
  statusToggleTipChecked: string;
  statusLimitTip: string;
  unknown: string;
  never: string;
  resetUnknown: string;
}

type LocalizedAccount = CodexAccountRecord & {
  authProviderLabel: string;
  accountStructureLabel: string;
};

const zh: CopySet = {
  panelTitle: "codex-tools 配额总览",
  brandSub: "多账号切换与配额监控主面板",
  activeAccount: "当前账号",
  activeTeam: "当前团队",
  addAccount: "添加账号",
  importCurrent: "导入当前账号",
  refreshAll: "刷新配额",
  dashboardTitle: "codex-tools · 配额总览",
  dashboardSub: "主面板视图，适合停留查看和截图",
  empty: "还没有保存账号",
  current: "当前",
  hourlyLabel: "5小时",
  weeklyLabel: "每周",
  reviewLabel: "代码审查",
  userId: "用户 ID",
  lastRefresh: "最近刷新",
  accountId: "账号 ID",
  organization: "组织",
  savedAccounts: "已保存账号",
  savedAccountsSub: "这里接管原来侧边栏的主内容，用于管理全部账号",
  teamName: "团队空间",
  login: "登录方式",
  switchBtn: "切换",
  refreshBtn: "刷新",
  detailsBtn: "详情",
  removeBtn: "删除",
  inStatus: "状态栏已显示",
  addToStatus: "加入状态栏",
  statusShort: "状态栏",
  statusToggleTip: "控制该账号是否显示在底部状态栏弹窗中",
  statusToggleTipChecked: "已显示在底部状态栏弹窗中，点击可取消",
  statusLimitTip: "状态栏最多显示 2 个额外账号，请先取消一个已勾选账号",
  unknown: "未知",
  never: "从未",
  resetUnknown: "重置时间未知"
};

const en: CopySet = {
  panelTitle: "codex-tools quota summary",
  brandSub: "Main dashboard for multi-account switching and quota tracking",
  activeAccount: "Active Account",
  activeTeam: "Active Team",
  addAccount: "Add Account",
  importCurrent: "Import Current",
  refreshAll: "Refresh Quotas",
  dashboardTitle: "codex-tools · Quota Dashboard",
  dashboardSub: "Primary dashboard for monitoring, management, and screenshots",
  empty: "No saved accounts yet",
  current: "Current",
  hourlyLabel: "5h",
  weeklyLabel: "Weekly",
  reviewLabel: "Review",
  userId: "User ID",
  lastRefresh: "Last Refresh",
  accountId: "Account ID",
  organization: "Organization",
  savedAccounts: "Saved Accounts",
  savedAccountsSub: "The main account management content now lives here instead of the sidebar",
  teamName: "Team Name",
  login: "Login",
  switchBtn: "Switch",
  refreshBtn: "Refresh",
  detailsBtn: "Details",
  removeBtn: "Remove",
  inStatus: "In Status",
  addToStatus: "Add To Status",
  statusShort: "Status",
  statusToggleTip: "Control whether this account appears in the bottom status popup",
  statusToggleTipChecked: "This account is already shown in the bottom status popup. Click to remove it",
  statusLimitTip: "You can show at most 2 extra accounts in the status popup. Uncheck one first",
  unknown: "unknown",
  never: "never",
  resetUnknown: "reset unknown"
};

function resolveLanguage(): "zh" | "en" {
  const language = vscode.env.language.toLowerCase();
  return language.startsWith("zh") ? "zh" : "en";
}

function accountWithTranslations(account: CodexAccountRecord, _t: CopySet): LocalizedAccount {
  return {
    ...account,
    authProviderLabel: formatAuthProvider(account.authProvider, resolveLanguage()),
    accountStructureLabel: formatAccountStructure(account.accountStructure, resolveLanguage())
  };
}

function formatAuthProvider(value: string | undefined, lang: "zh" | "en"): string {
  const provider = value?.trim() ?? "OpenAI";
  if (lang === "zh") {
    return `${provider} 登录`;
  }
  return `${provider} login`;
}

function formatAccountStructure(value: string | undefined, lang: "zh" | "en"): string {
  const normalized = (value ?? "workspace").toLowerCase();
  if (lang === "zh") {
    if (normalized === "organization") {
      return "组织空间";
    }
    if (normalized === "team") {
      return "团队空间";
    }
    if (normalized === "personal") {
      return "个人空间";
    }
    return "工作空间";
  }
  return normalized;
}
