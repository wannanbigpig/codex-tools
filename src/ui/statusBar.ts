import * as vscode from "vscode";
import { AccountsRepository } from "../storage";
import { CodexAccountRecord } from "../core/types";
import { formatPlanType } from "../application/dashboard/copy";
import { isHourlyQuotaControlEnabled } from "../infrastructure/config/extensionSettings";
import { getCurrentWindowRuntimeAccountId } from "../presentation/workbench/windowRuntimeAccount";
import { formatRelativeReset } from "../utils/time";
import { escapeMarkdown, getLanguage, quotaMarkerForPercentage, resolveLongQuotaLabel, t } from "../utils";

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
          event.affectsConfiguration("codexAccounts.dashboardTheme") ||
          event.affectsConfiguration("codexAccounts.quotaGreenThreshold") ||
          event.affectsConfiguration("codexAccounts.quotaYellowThreshold") ||
          event.affectsConfiguration("codexAccounts.hourlyQuotaControlEnabled")
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
    const showHourlyQuota = isHourlyQuotaControlEnabled();
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

    this.item.text = buildStatusText(primary, showHourlyQuota);
    this.item.tooltip = buildTooltip(primary, active, accounts, showHourlyQuota);
    this.item.show();
  }
}

export function buildStatusText(account: CodexAccountRecord, showHourlyQuota: boolean): string {
  const hourly = account.quotaSummary?.hourlyPercentage;
  const weekly = account.quotaSummary?.weeklyPercentage;
  if (!showHourlyQuota && typeof weekly === "number") {
    return `${STATUS_BAR_ICON} codex ${weekly}%`;
  }
  if (typeof hourly === "number" && typeof weekly === "number") {
    return `${STATUS_BAR_ICON} codex ${hourly}%/${weekly}%`;
  }
  return `${STATUS_BAR_ICON} Codex Accounts Manager`;
}

function buildTooltip(
  primary: CodexAccountRecord,
  active: CodexAccountRecord | undefined,
  accounts: CodexAccountRecord[],
  showHourlyQuota: boolean
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
  md.appendMarkdown(renderAccountPanel(primary, true, primary.id === active?.id, showHourlyQuota));
  for (const account of [...fallbackActive, ...selectedExtras]) {
    md.appendMarkdown(`\n---\n\n`);
    md.appendMarkdown(renderAccountPanel(account, false, account.id === active?.id, showHourlyQuota));
  }

  md.appendMarkdown(`\n\n---\n${_t("status.tooltip")}`);
  return md;
}

export function renderAccountPanel(
  account: CodexAccountRecord,
  current: boolean,
  primary: boolean,
  showHourlyQuota: boolean
): string {
  const _t = t();
  const language = getLanguage();
  const title = `${account.accountName ?? account.email} · ${account.email}`;
  const plan = formatPlanType(account.planType ?? "team", language);
  const markers = [
    current ? _t("account.current") : undefined,
    primary ? _t("account.primary") : undefined,
    plan
  ].filter((value): value is string => Boolean(value));
  const header = `**${escapeMarkdown(title)}**  ${markers.map((value) => escapeMarkdown(value)).join(" · ")}`;

  const lines = [
    header,
    ...(showHourlyQuota && account.quotaSummary?.hourlyWindowPresent
      ? [
          renderMetricRow(
            _t("quota.hourly"),
            account.quotaSummary?.hourlyPercentage,
            account.quotaSummary?.hourlyResetTime
          )
        ]
      : []),
    ...(account.quotaSummary?.weeklyWindowPresent
      ? [
          renderMetricRow(
            resolveLongQuotaLabel(
              account.planType,
              account.quotaSummary?.weeklyWindowMinutes,
              language,
              _t("quota.weekly")
            ),
            account.quotaSummary?.weeklyPercentage,
            account.quotaSummary?.weeklyResetTime
          )
        ]
      : [])
  ];

  for (const limit of account.quotaSummary?.additionalRateLimits ?? []) {
    if (showHourlyQuota && limit.hourlyWindowPresent) {
      lines.push(
        renderMetricRow(`${limit.limitName} ${_t("quota.hourly")}`, limit.hourlyPercentage, limit.hourlyResetTime)
      );
    }
    if (limit.weeklyWindowPresent) {
      lines.push(
        renderMetricRow(
          `${limit.limitName} ${resolveLongQuotaLabel(undefined, limit.weeklyWindowMinutes, language, _t("quota.weekly"))}`,
          limit.weeklyPercentage,
          limit.weeklyResetTime
        )
      );
    }
  }

  return `${lines.join("  \n")}\n`;
}

export function renderMetricRow(label: string, percent?: number, resetAt?: number): string {
  const value = typeof percent === "number" ? `${percent}%` : "--";
  const reset = resetAt ? `${formatRelativeReset(resetAt)} (${formatResetClock(resetAt)})` : t()("quota.resetUnknown");
  return `${quotaMarker(percent)} ${escapeMarkdown(padLabel(label, 5))} ${buildThinBar(percent, 10)} ${escapeMarkdown(value)}  ${escapeMarkdown(reset)}`;
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
