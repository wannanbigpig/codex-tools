import * as vscode from "vscode";
import { AccountsRepository } from "../storage";
import { CodexAccountRecord } from "../core/types";
import { getCurrentWindowRuntimeAccountId } from "../presentation/workbench/windowRuntimeAccount";
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
    const active = accounts.find((item) => item.isActive);
    const currentWindowAccountId = getCurrentWindowRuntimeAccountId();
    const primary = accounts.find((item) => item.id === currentWindowAccountId) ?? active ?? accounts[0];
    const _t = t();

    if (!primary) {
      this.item.text = `${STATUS_BAR_ICON} Codex Accounts Manager`;
      const md = new vscode.MarkdownString(undefined, true);
      md.isTrusted = true;
      md.appendMarkdown(`**${_t("panel.dashboard.title")}**\n\n`);
      md.appendMarkdown(_t("status.noAccounts"));
      this.item.tooltip = md;
      this.item.show();
      return;
    }

    this.item.text = buildStatusText(primary);
    this.item.tooltip = buildTooltip(primary, active, accounts);
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

function buildTooltip(
  primary: CodexAccountRecord,
  active: CodexAccountRecord | undefined,
  accounts: CodexAccountRecord[]
): vscode.MarkdownString {
  const _t = t();
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = true;
  const fallbackActive = active && active.id !== primary.id ? [active] : [];
  const selectedExtras = accounts
    .filter((account) => account.id !== primary.id && account.id !== active?.id && account.showInStatusBar)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 2);

  md.appendMarkdown(`**${_t("panel.dashboard.title")}**\n\n`);
  md.appendMarkdown(renderAccountPanel(primary, true, primary.id === active?.id));
  for (const account of [...fallbackActive, ...selectedExtras]) {
    md.appendMarkdown(`\n---\n\n`);
    md.appendMarkdown(renderAccountPanel(account, false, account.id === active?.id));
  }

  md.appendMarkdown(`\n\n---\n${_t("status.tooltip")}`);
  return md;
}

function renderAccountPanel(
  account: CodexAccountRecord,
  current: boolean,
  primary: boolean
): string {
  const _t = t();
  const title = `${account.accountName ?? account.email} · ${account.email}`;
  const plan = (account.planType ?? "team").toUpperCase();
  const markers = [
    current ? _t("account.current") : undefined,
    primary ? _t("account.primary") : undefined,
    plan
  ].filter((value): value is string => Boolean(value));
  const header = `**${escapeMarkdown(title)}**  ${markers.map((value) => escapeMarkdown(value)).join(" · ")}`;

  const lines = [
    header,
    ...(account.quotaSummary?.hourlyWindowPresent
      ? [renderMetricRow(_t("quota.hourly"), account.quotaSummary?.hourlyPercentage, account.quotaSummary?.hourlyResetTime)]
      : []),
    ...(account.quotaSummary?.weeklyWindowPresent
      ? [renderMetricRow(_t("quota.weekly"), account.quotaSummary?.weeklyPercentage, account.quotaSummary?.weeklyResetTime)]
      : [])
  ];

  for (const limit of account.quotaSummary?.additionalRateLimits ?? []) {
    if (limit.hourlyWindowPresent) {
      lines.push(renderMetricRow(`${limit.limitName} ${_t("quota.hourly")}`, limit.hourlyPercentage, limit.hourlyResetTime));
    }
    if (limit.weeklyWindowPresent) {
      lines.push(renderMetricRow(`${limit.limitName} ${_t("quota.weekly")}`, limit.weeklyPercentage, limit.weeklyResetTime));
    }
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

export function buildThinBar(percent?: number, width = 10): string {
  if (typeof percent !== "number") {
    return "╌".repeat(width);
  }

  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * width);
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
