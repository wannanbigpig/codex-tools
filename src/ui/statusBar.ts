import * as vscode from "vscode";
import { AccountsRepository } from "../storage";
import { CodexAccountRecord } from "../core/types";
import { formatRelativeReset } from "../utils/time";
import { t } from "../utils";
import { escapeMarkdown, quotaMarkerForPercentage } from "../utils";

const STATUS_BAR_ICON = "$(dashboard)";

export class AccountsStatusBarProvider {
  private readonly item: vscode.StatusBarItem;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly repo: AccountsRepository
  ) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.name = "Codex Accounts Manager Quota";
    this.item.command = "codexAccounts.showQuotaSummary";
    this.context.subscriptions.push(
      this.item,
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration("codexAccounts.displayLanguage") ||
          event.affectsConfiguration("codexAccounts.showCodeReviewQuota") ||
          event.affectsConfiguration("codexAccounts.quotaGreenThreshold") ||
          event.affectsConfiguration("codexAccounts.quotaYellowThreshold")
        ) {
          void this.refresh();
        }
      })
    );
  }

  async refresh(): Promise<void> {
    const accounts = await this.repo.listAccounts();
    const active = accounts.find((item) => item.isActive) ?? accounts[0];
    const _t = t();

    if (!active) {
      this.item.text = `${STATUS_BAR_ICON} Codex Accounts Manager`;
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
  return `${STATUS_BAR_ICON} Codex Accounts Manager`;
}

function buildTooltip(active: CodexAccountRecord, accounts: CodexAccountRecord[]): vscode.MarkdownString {
  const _t = t();
  const showCodeReview = vscode.workspace.getConfiguration("codexAccounts").get<boolean>("showCodeReviewQuota", true);
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = true;
  const selectedExtras = accounts
    .filter((account) => account.id !== active.id && account.showInStatusBar)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 2);

  md.appendMarkdown(`**${_t("panel.dashboard.title")}**\n\n`);
  md.appendMarkdown(renderAccountPanel(active, true, showCodeReview));
  for (const account of selectedExtras) {
    md.appendMarkdown(`\n`);
    md.appendMarkdown(renderAccountPanel(account, false, showCodeReview));
  }

  md.appendMarkdown(`\n\n---\n${_t("status.tooltip")}`);
  return md;
}

function renderAccountPanel(account: CodexAccountRecord, current: boolean, showCodeReview: boolean): string {
  const _t = t();
  const title = `${account.accountName ?? account.email} · ${account.email}`;
  const plan = (account.planType ?? "team").toUpperCase();
  const header = current
    ? `**${escapeMarkdown(title)}**  ${escapeMarkdown(_t("account.current"))} · ${escapeMarkdown(plan)}`
    : `**${escapeMarkdown(title)}**  ${escapeMarkdown(plan)}`;

  const lines = [
    header,
    renderMetricRow(_t("quota.hourly"), account.quotaSummary?.hourlyPercentage, account.quotaSummary?.hourlyResetTime),
    renderMetricRow(_t("quota.weekly"), account.quotaSummary?.weeklyPercentage, account.quotaSummary?.weeklyResetTime)
  ];

  if (showCodeReview) {
    lines.push(renderMetricRow(_t("quota.review"), account.quotaSummary?.codeReviewPercentage, account.quotaSummary?.codeReviewResetTime));
  }

  return `${lines.join("  \n")}\n`;
}

function renderMetricRow(label: string, percent?: number, resetAt?: number): string {
  const value = typeof percent === "number" ? `${percent}%` : "--";
  const reset = resetAt ? `${formatRelativeReset(resetAt)} (${formatResetClock(resetAt)})` : t()("quota.resetUnknown");
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
  return quotaMarkerForPercentage(value);
}
