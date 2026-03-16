/**
 * 账号详情面板模块
 *
 * 优化内容:
 * - 添加 JSDoc 注释
 * - 修复未使用参数警告
 * - 添加类型守卫
 * - 复用共享 UI 工具函数
 */

import * as vscode from "vscode";
import { CodexAccountRecord } from "../core/types";
import { formatRelativeReset, formatTimestamp } from "../utils/time";
import { colorForPercentage, escapeHtml, prettyAuthProvider } from "../utils";

let detailsPanel: vscode.WebviewPanel | undefined;

/**
 * 打开账号详情面板
 */
export function openDetailsPanel(_context: vscode.ExtensionContext, account: CodexAccountRecord): void {
  if (!detailsPanel) {
    detailsPanel = vscode.window.createWebviewPanel(
      "codexAccountDetails",
      `Codex: ${account.email}`,
      vscode.ViewColumn.Beside,
      {
        enableFindWidget: true
      }
    );

    detailsPanel.onDidDispose(() => {
      detailsPanel = undefined;
    });
  } else {
    detailsPanel.title = `Codex: ${account.email}`;
    detailsPanel.reveal(vscode.ViewColumn.Beside, false);
  }

  detailsPanel.webview.html = renderHtml(account);
}

function renderHtml(account: CodexAccountRecord): string {
  const quota = account.quotaSummary;
  const raw = quota?.rawData ? JSON.stringify(quota.rawData, null, 2) : "No raw quota payload captured.";
  const accountStatus = account.isActive ? "Currently active" : "Saved account";
  const provider = prettyAuthProvider(account.authProvider);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    :root {
      --bg-1: #1f2336;
      --bg-2: #242a40;
      --card: rgba(255, 255, 255, 0.05);
      --card-strong: rgba(255, 255, 255, 0.07);
      --line: rgba(168, 176, 255, 0.18);
      --text: #f4f7ff;
      --muted: #aeb6d9;
      --accent: #8b5cf6;
      --success: #7ddc7a;
      --warning: #fbbf24;
      --danger: #ef4444;
      --shadow: 0 18px 40px rgba(0, 0, 0, 0.28);
      --track: rgba(255,255,255,0.11);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 18px;
      background:
        radial-gradient(circle at top left, rgba(139,92,246,0.22), transparent 30%),
        radial-gradient(circle at top right, rgba(34,197,94,0.12), transparent 25%),
        linear-gradient(180deg, var(--bg-1), var(--bg-2));
      color: var(--text);
      font-family: "Avenir Next", "PingFang SC", "Segoe UI", sans-serif;
    }
    .shell { display: grid; gap: 14px; }
    .panel {
      border-radius: 20px;
      border: 1px solid var(--line);
      background: linear-gradient(135deg, rgba(139,92,246,0.10), rgba(255,255,255,0.03));
      box-shadow: var(--shadow);
      overflow: hidden;
    }
    .panel-inner {
      padding: 18px;
    }
    .hero {
      display: grid;
      gap: 14px;
    }
    .hero-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 14px;
    }
    h1 {
      margin: 0;
      font-size: 24px;
      line-height: 1.2;
      word-break: break-word;
    }
    h2 {
      margin: 0 0 10px;
      font-size: 15px;
      letter-spacing: 0.02em;
    }
    .meta {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.6;
    }
    .badges {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .pill {
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 700;
      background: rgba(255,255,255,0.08);
      color: var(--muted);
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
    .summary {
      display: grid;
      gap: 8px;
    }
    .summary strong {
      color: var(--text);
      font-weight: 700;
    }
    .quota-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
      gap: 12px;
    }
    .quota-card,
    .meta-card,
    .raw-card {
      background: var(--card);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 18px;
      box-shadow: var(--shadow);
    }
    .quota-card,
    .meta-card,
    .raw-card {
      padding: 16px;
    }
    .quota-value {
      font-size: 28px;
      font-weight: 800;
      color: var(--metric-color, var(--success));
      margin-bottom: 8px;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 10px;
    }
    .meta-box {
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 14px;
      padding: 12px;
    }
    .meta-box .label {
      color: var(--muted);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: .06em;
      margin-bottom: 6px;
    }
    .meta-box .content {
      color: var(--text);
      font-size: 13px;
      word-break: break-word;
    }
    pre {
      margin: 0;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 12px;
      line-height: 1.55;
      color: #d6ddf5;
    }
    @media (max-width: 540px) {
      body { padding: 12px; }
      .panel-inner,
      .quota-card,
      .meta-card,
      .raw-card { padding: 14px; }
      .hero-top { flex-direction: column; }
      .badges { justify-content: flex-start; }
      h1 { font-size: 20px; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <section class="panel">
      <div class="panel-inner hero">
        <div class="hero-top">
          <div class="badges">
            ${account.isActive ? `<span class="pill active">当前</span>` : `<span class="pill">已保存</span>`}
            <span class="pill plan">${escapeHtml((account.planType ?? "unknown").toUpperCase())}</span>
          </div>
        </div>
        <div class="summary">
          <div class="meta"><strong>Team Name:</strong> ${escapeHtml(account.accountName ?? "-")}</div>
          <div class="meta"><strong>Login:</strong> ${escapeHtml(provider)}</div>
          <div class="meta"><strong>User ID:</strong> ${escapeHtml(account.userId ?? account.accountId ?? "-")}</div>
          <div class="meta"><strong>Status:</strong> ${escapeHtml(accountStatus)}</div>
        </div>
      </div>
    </section>

    <section class="quota-grid">
      <div class="quota-card">
        <h2>Hourly quota</h2>
        <div class="quota-value" style="--metric-color:${colorForPercentage(quota?.hourlyPercentage)};">${quota?.hourlyPercentage ?? "-"}%</div>
        <div class="meta">Reset ${escapeHtml(formatRelativeReset(quota?.hourlyResetTime))}</div>
      </div>
      <div class="quota-card">
        <h2>Weekly quota</h2>
        <div class="quota-value" style="--metric-color:${colorForPercentage(quota?.weeklyPercentage)};">${quota?.weeklyPercentage ?? "-"}%</div>
        <div class="meta">Reset ${escapeHtml(formatRelativeReset(quota?.weeklyResetTime))}</div>
      </div>
      <div class="quota-card">
        <h2>Code review quota</h2>
        <div class="quota-value" style="--metric-color:${colorForPercentage(quota?.codeReviewPercentage)};">${quota?.codeReviewPercentage ?? "-"}%</div>
        <div class="meta">Reset ${escapeHtml(formatRelativeReset(quota?.codeReviewResetTime))}</div>
      </div>
    </section>

    <section class="meta-card">
      <h2>Metadata</h2>
      <div class="meta-grid">
        <div class="meta-box">
          <div class="label">Account ID</div>
          <div class="content">${escapeHtml(account.accountId ?? "-")}</div>
        </div>
        <div class="meta-box">
          <div class="label">Organization ID</div>
          <div class="content">${escapeHtml(account.organizationId ?? "-")}</div>
        </div>
        <div class="meta-box">
          <div class="label">Last quota refresh</div>
          <div class="content">${escapeHtml(formatTimestamp(account.lastQuotaAt))}</div>
        </div>
      </div>
    </section>

    <section class="raw-card">
      <h2>Raw quota payload</h2>
      <pre>${escapeHtml(raw)}</pre>
    </section>
  </div>
</body>
</html>`;
}
