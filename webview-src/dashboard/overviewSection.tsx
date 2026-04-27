import type {
  DashboardAccountViewModel,
  DashboardCopy,
  DashboardSettings,
  DashboardState
} from "../../src/domain/dashboard/types";
import {
  formatAutoSwitchReasonSummary,
  formatTimestamp,
  getSensitiveDisplayValue,
  renderTagList
} from "./helpers";
import { ActionButton } from "./primitives";
import { MetricGauge, renderHealthPill } from "./accountMetricPrimitives";

export function OverviewSection(props: {
  account?: DashboardAccountViewModel;
  hasAccounts: boolean;
  lang: DashboardState["lang"];
  copy: DashboardCopy;
  settings: DashboardSettings;
  now: number;
  privacyMode: boolean;
  disabled: boolean;
  addPending: boolean;
  importPending: boolean;
  refreshAllPending: boolean;
  onToggleAutoSwitchLock: () => void;
  onAddAccount: () => void;
  onImportCurrent: () => void;
  onRefreshAll: () => void;
}) {
  const { account, copy, settings, now, hasAccounts, privacyMode } = props;
  const emptyTitle = hasAccounts ? copy.noActiveAccountTitle : copy.empty;
  const emptySub = hasAccounts ? copy.noActiveAccountSub : copy.savedAccountsSub;
  const teamNameDisplay =
    account?.isTeamWorkspace && account.accountName?.trim()
      ? getSensitiveDisplayValue(account.accountName, privacyMode, "name", account.accountName)
      : undefined;

  return (
    <div class="overview-shell">
      {account ? (
        <div class="overview-account">
          <div class="overview-account-email">{getSensitiveDisplayValue(account.email, privacyMode, "email")}</div>
          {teamNameDisplay ? <div class="overview-account-workspace">{teamNameDisplay}</div> : null}
          {account.tags.length ? <div class="account-tag-row">{renderTagList(account.tags)}</div> : null}
          <div class="overview-account-tags">
            <span class="pill active">{copy.primaryAccount}</span>
            {account.isCurrentWindowAccount ? <span class="pill active">{copy.current}</span> : null}
            <span class="pill plan">{account.planTypeLabel}</span>
            {renderHealthPill(account)}
          </div>
          {account.lastAutoSwitchReason ? (
            <div class="overview-inline-note">
              <strong>{copy.autoSwitchReasonTitle}:</strong> {formatAutoSwitchReasonSummary(account.lastAutoSwitchReason, copy)}
            </div>
          ) : null}
          <div class={`overview-inline-note overview-lock-note ${account.autoSwitchLockedUntil ? "" : "is-empty"}`}>
            {account.autoSwitchLockedUntil ? (
              <>
                <strong>{copy.autoSwitchLockedUntil}:</strong> {formatTimestamp(account.autoSwitchLockedUntil, copy.never)}
              </>
            ) : (
              <span aria-hidden="true">&nbsp;</span>
            )}
          </div>
          <div class="overview-meta">
            <div class="overview-meta-item">
              <span class="grid-label">{copy.accountId}</span>
              <span class="meta-value">
                {getSensitiveDisplayValue(account.accountId, privacyMode, "id", copy.unknown)}
              </span>
            </div>
            <div class="overview-meta-item">
              <span class="grid-label">{copy.lastRefresh}</span>
              <span class="meta-value">{formatTimestamp(account.lastQuotaAt, copy.never)}</span>
            </div>
            <div class="overview-meta-item">
              <span class="grid-label">{copy.organization}</span>
              <span class="meta-value">
                {getSensitiveDisplayValue(account.organizationId, privacyMode, "id", copy.unknown)}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div class="overview-account overview-empty-panel">
          <div class="overview-empty-badge">{copy.dashboardTitle}</div>
          <div class="overview-empty-title">{emptyTitle}</div>
          <div class="overview-empty-sub">{emptySub}</div>
        </div>
      )}
      <div class="overview-main">
        <div class="overview-head">
          <div class="overview-head-title">{copy.dashboardTitle}</div>
          <div class="overview-head-sub">{copy.dashboardSub}</div>
        </div>
        <div class="overview-metrics">
          {account ? (
            <div class="metrics">
              {account.metrics
                .filter((metric) => metric.visible)
                .map((metric) => (
                  <MetricGauge key={metric.key} metric={metric} lang={props.lang} settings={settings} copy={copy} now={now} />
                ))}
            </div>
          ) : (
            <div class="overview-empty-copy">
              <div class="overview-empty-copy-title">{emptyTitle}</div>
              <div class="overview-empty-copy-sub">{emptySub}</div>
            </div>
          )}
        </div>
      </div>
      <div class="overview-actions">
        <div class="toolbar">
          <ActionButton class="toolbar-btn primary-btn" pending={props.addPending} disabled={props.disabled} onClick={props.onAddAccount}>
            {copy.addAccount}
          </ActionButton>
          <ActionButton class="toolbar-btn" pending={props.importPending} disabled={props.disabled} onClick={props.onImportCurrent}>
            {copy.importCurrent}
          </ActionButton>
          <ActionButton class="toolbar-btn" pending={props.refreshAllPending} disabled={props.disabled} onClick={props.onRefreshAll}>
            {copy.refreshAll}
          </ActionButton>
          {account ? (
            <ActionButton class="toolbar-btn" onClick={props.onToggleAutoSwitchLock}>
              {account.autoSwitchLockedUntil ? copy.unlockAutoSwitchBtn : copy.lockAutoSwitchBtn}
            </ActionButton>
          ) : null}
        </div>
      </div>
    </div>
  );
}
