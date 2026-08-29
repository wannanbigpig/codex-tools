import * as vscode from "vscode";
import { AccountsRepository } from "../storage";
import { CodexAccountRecord } from "../core/types";
import { formatPlanType } from "../application/dashboard/copy";
import { isHourlyQuotaControlEnabled } from "../infrastructure/config/extensionSettings";
import { getCurrentWindowRuntimeAccountId } from "../presentation/workbench/windowRuntimeAccount";
import { formatRelativeReset } from "../utils/time";
import { escapeMarkdown, getLanguage, quotaMarkerForPercentage, resolveLongQuotaLabel, t } from "../utils";
import { formatAccountUsageDuration } from "../utils/accountUsage";

const STATUS_BAR_ICON = "$(codex-openai)";

export class AccountsStatusBarProvider {
  private readonly item: vscode.StatusBarItem;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly repo: AccountsRepository
  ) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.name = "Codex Manager Quota";
    this.item.command = "codexAccounts.showQuotaSummary";
    this.showStarting();
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
          void this.refresh().catch((error: unknown) => {
            const detail = error instanceof Error ? error.message : String(error);
            this.showActivationFailure(detail);
            void vscode.window.showWarningMessage(
              `Codex Manager could not refresh its status. It will retry automatically: ${detail}`
            );
          });
        }
      })
    );
  }

  async refresh(): Promise<void> {
    const accounts = await this.repo.listAccounts();
    this.item.command = "codexAccounts.showQuotaSummary";
    const currentWindowAccountId = getCurrentWindowRuntimeAccountId();
    const primary = resolveStatusBarAccount(accounts, currentWindowAccountId);
    const showHourlyQuota = isHourlyQuotaControlEnabled();
    const _t = t();

    if (!primary) {
      this.item.text = `${STATUS_BAR_ICON} Codex Manager`;
      const md = new vscode.MarkdownString(undefined, true);
      md.isTrusted = true;
      md.appendMarkdown("**Codex Manager**\n\n");
      md.appendMarkdown(_t("status.noAccounts"));
      md.appendMarkdown(
        "\n\n**Quick access**  \n" +
          "`Ctrl+Shift+P` — find every **Codex Accounts** command  \n" +
          "`Ctrl+K Ctrl+S` — view or assign keyboard shortcuts  \n" +
          "Command: **Codex Accounts: Keyboard Shortcuts & Help**"
      );
      this.item.tooltip = md;
      this.item.show();
      return;
    }

    this.item.text = buildStatusText(primary, showHourlyQuota);
    this.item.tooltip = buildTooltip(primary, showHourlyQuota);
    this.item.show();
  }

  showStarting(): void {
    this.item.text = "$(sync~spin) Codex Manager";
    this.item.tooltip = "Codex Manager is starting…";
    this.item.command = "workbench.action.showCommands";
    this.item.show();
  }

  showActivationFailure(detail: string): void {
    this.item.text = "$(warning) Codex Manager";
    this.item.tooltip = `Codex Manager needs attention: ${detail}`;
    this.item.command = "workbench.action.showCommands";
    this.item.show();
  }
}

export function resolveStatusBarAccount(
  accounts: CodexAccountRecord[],
  currentWindowAccountId?: string
): CodexAccountRecord | undefined {
  return (
    accounts.find((account) => account.isActive) ??
    accounts.find((account) => account.id === currentWindowAccountId) ??
    accounts[0]
  );
}

export function buildStatusText(account: CodexAccountRecord, showHourlyQuota: boolean): string {
  const hourly = account.quotaSummary?.hourlyPercentage;
  const weekly = account.quotaSummary?.weeklyPercentage;
  if (!showHourlyQuota && typeof weekly === "number") {
    return `${STATUS_BAR_ICON} ${account.email} ${weekly}%`;
  }
  if (typeof hourly === "number" && typeof weekly === "number") {
    return `${STATUS_BAR_ICON} ${account.email} ${hourly}%/${weekly}%`;
  }
  return `${STATUS_BAR_ICON} ${account.email}`;
}

function buildTooltip(
  primary: CodexAccountRecord,
  showHourlyQuota: boolean
): vscode.MarkdownString {
  const _t = t();
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = true;

  md.appendMarkdown("**Codex Manager**\n\n");
  md.appendMarkdown(renderAccountPanel(primary, showHourlyQuota));

  md.appendMarkdown(`\n\n---\n${_t("status.tooltip")}`);
  md.appendMarkdown(
    "\n\n**Quick access**  \n" +
      "Click this status item — open the quota dashboard  \n" +
      "`Ctrl+Shift+P` — find every **Codex Accounts** command  \n" +
      "`Ctrl+K Ctrl+S` — view or assign keyboard shortcuts  \n" +
      "Command: **Codex Accounts: Keyboard Shortcuts & Help**"
  );
  return md;
}

export function renderAccountPanel(
  account: CodexAccountRecord,
  showHourlyQuota: boolean
): string {
  const _t = t();
  const language = getLanguage();
  const plan = formatPlanType(account.planType ?? "team", language);
  const credit = formatCredits(account);
  const header = `**${escapeMarkdown(account.email)}**  ${escapeMarkdown(plan)}`;

  const lines = [
    header,
    `**Subscription**  ${escapeMarkdown(formatSubscriptionExpiry(account.subscriptionActiveUntil))}`,
    `**Workspace**  ${escapeMarkdown(formatWorkspace(account))}  |  **Last refresh**  ${escapeMarkdown(
      formatRelativeAge(account.lastQuotaAt)
    )}`,
    `**Account ID**  ${escapeMarkdown(account.accountId ?? "—")}`,
    `**Duration**  ${escapeMarkdown(formatAccountUsageDuration(account))}  |  **Login date**  ${escapeMarkdown(
      formatLoginDate(account.loginAt)
    )}`,
    ...(credit ? [`**Credit**  ${escapeMarkdown(credit)}`] : []),
    ...((account.quotaSummary?.resetCreditsAvailable ?? 0) > 0
      ? [`**Reset**  ${account.quotaSummary?.resetCreditsAvailable}`]
      : []),
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

function formatWorkspace(account: CodexAccountRecord): string {
  const structure = account.accountStructure?.trim().toLowerCase();
  if (!structure || structure === "personal") return "Personal";
  const name = account.accountName?.trim();
  return name ? `Team | ${name}` : "Team";
}

function formatSubscriptionExpiry(value?: string): string {
  if (!value) return "—";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const days = Math.ceil((timestamp - Date.now()) / 86_400_000);
  const relative = days >= 0 ? `${days}d` : `${Math.abs(days)}d ago`;
  return `${formatTooltipDate(timestamp)} (${relative})`;
}

function formatTooltipDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatLoginDate(timestamp?: number): string {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatCredits(account: CodexAccountRecord): string | undefined {
  const credits = account.quotaSummary?.credits;
  if (!credits || (!credits.unlimited && !credits.hasCredits)) return undefined;
  return credits.unlimited ? "Unlimited" : credits.balance || "Available";
}

function formatRelativeAge(timestamp?: number): string {
  if (!timestamp) return "—";
  const totalMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (totalMinutes < 1) return "Just now";
  if (totalMinutes < 60) return `${totalMinutes}m ago`;
  const hours = Math.floor(totalMinutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
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
