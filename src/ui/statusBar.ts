import * as vscode from "vscode";
import { AccountsRepository } from "../storage";
import { CodexAccountRecord } from "../core/types";
import { formatRelativeReset } from "../utils/time";
import { t } from "../utils";
import { escapeMarkdown } from "../utils";

const STATUS_BAR_ICON = "$(dashboard)";

export class AccountsStatusBarProvider {
  private readonly item: vscode.StatusBarItem;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly repo: AccountsRepository
  ) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.name = "Codex Tools Quota";
    this.item.command = "codexAccounts.showQuotaSummary";
    this.context.subscriptions.push(this.item);
  }

  async refresh(): Promise<void> {
    const accounts = await this.repo.listAccounts();
    const active = accounts.find((item) => item.isActive) ?? accounts[0];
    const _t = t();

    if (!active) {
      this.item.text = `${STATUS_BAR_ICON} codex-tools`;
      const md = new vscode.MarkdownString(undefined, true);
      md.isTrusted = true;
      md.appendMarkdown(`**${_t("panel.dashboard.title")}**\n\n`);
      md.appendMarkdown(_t("status.noAccounts"));
      this.item.tooltip = md;
      this.item.show();
      return;
    }

    this.item.text = buildStatusText(active);
    this.item.tooltip = buildTooltip(active, accounts);
    this.item.show();
  }
}

function buildStatusText(account: CodexAccountRecord): string {
  const hourly = account.quotaSummary?.hourlyPercentage;
  const weekly = account.quotaSummary?.weeklyPercentage;
  if (typeof hourly === "number" && typeof weekly === "number") {
    return `${STATUS_BAR_ICON} codex ${hourly}%/${weekly}%`;
  }
  return `${STATUS_BAR_ICON} codex-tools`;
}

function buildTooltip(active: CodexAccountRecord, accounts: CodexAccountRecord[]): vscode.MarkdownString {
  const _t = t();
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = true;
  const selectedExtras = accounts
    .filter((account) => account.id !== active.id && account.showInStatusBar)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 2);

  md.appendMarkdown(`**${_t("panel.dashboard.title")}**\n\n`);
  md.appendMarkdown(renderAccountPanel(active, true));
  for (const account of selectedExtras) {
    md.appendMarkdown(`\n`);
    md.appendMarkdown(renderAccountPanel(account, false));
  }

  md.appendMarkdown(`\n\n---\n${_t("status.tooltip")}`);
  return md;
}

function renderAccountPanel(account: CodexAccountRecord, current: boolean): string {
  const title = `${account.accountName ?? account.email} · ${account.email}`;
  const plan = (account.planType ?? "team").toUpperCase();
  const header = current
    ? `**${escapeMarkdown(title)}**  当前 · ${escapeMarkdown(plan)}`
    : `**${escapeMarkdown(title)}**  ${escapeMarkdown(plan)}`;

  const lines = [
    header,
    renderMetricRow("5h", account.quotaSummary?.hourlyPercentage, account.quotaSummary?.hourlyResetTime),
    renderMetricRow("Week", account.quotaSummary?.weeklyPercentage, account.quotaSummary?.weeklyResetTime),
    renderMetricRow("Review", account.quotaSummary?.codeReviewPercentage, account.quotaSummary?.codeReviewResetTime)
  ];

  return `${lines.join("  \n")}\n`;
}

function renderMetricRow(label: string, percent?: number, resetAt?: number): string {
  const value = typeof percent === "number" ? `${percent}%` : "--";
  const reset = resetAt ? `${formatRelativeReset(resetAt)} (${formatResetClock(resetAt)})` : "reset unknown";
  return `${quotaMarker(percent)} \`${padLabel(label, 5)} ${buildThinBar(percent, 10)}\` ${value.padStart(6, " ")}  ${escapeMarkdown(reset)}`;
}

function padLabel(label: string, width: number): string {
  return label.length >= width ? label : `${label}${" ".repeat(width - label.length)}`;
}

function buildThinBar(percent?: number, width = 10): string {
  if (typeof percent !== "number") {
    return "╌".repeat(width);
  }

  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.max(1, Math.round((clamped / 100) * width));
  return `${"▰".repeat(filled)}${"▱".repeat(Math.max(0, width - filled))}`;
}

function formatResetClock(resetAt: number): string {
  const target = new Date(resetAt * 1000);
  const hh = String(target.getHours()).padStart(2, "0");
  const mm = String(target.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function quotaMarker(value?: number): string {
  if (typeof value !== "number") {
    return "⚪";
  }
  if (value >= 60) {
    return "🟢";
  }
  if (value >= 20) {
    return "🟡";
  }
  return "🔴";
}
