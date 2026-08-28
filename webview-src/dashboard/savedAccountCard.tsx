import { createPortal } from "preact/compat";
import { useEffect, useRef, useState } from "preact/hooks";
import type {
  DashboardAccountViewModel,
  DashboardActionPayload,
  DashboardCopy,
  DashboardSettings,
  DashboardState
} from "../../src/domain/dashboard/types";
import { getSensitiveDisplayValue, isAccountAttention, renderTagList } from "./helpers";
import {
  EditTagsIcon,
  renderDetailsIcon,
  DownloadIcon,
  renderRefreshIcon,
  renderReauthorizeIcon,
  renderReloadIcon,
  renderRemoveIcon,
  renderResyncProfileIcon,
  renderSwitchIcon
} from "./icons";
import { ActionButton } from "./primitives";
import { MetricRow, renderHealthPill } from "./accountMetricPrimitives";
import { canRunAccountOnThisPc } from "./accountRunPolicy";

export function resolvePrimaryAccountControl(
  account: Pick<DashboardAccountViewModel, "healthKind" | "dismissedHealth">
): "enablement" | "reauthorize" {
  return account.healthKind === "reauthorize" ? "reauthorize" : "enablement";
}

export function resolveCompactIdentityBadge(
  planTypeLabel: string,
  runningDeviceLabel?: string
): { kind: "plan" | "running-device"; label: string } {
  return runningDeviceLabel
    ? { kind: "running-device", label: runningDeviceLabel }
    : { kind: "plan", label: planTypeLabel };
}

/** Keep transport/provider details out of the compact card while retaining
 * the actionable health state (for example, "Needs Reauth"). */
export function resolveCardHealthReason(
  account: Pick<DashboardAccountViewModel, "healthKind" | "healthLabel" | "healthMessage">
): string {
  // Raw API responses can contain JSON, request IDs, and internal wording that
  // is both noisy and unsafe to expose in a dense card. The health label is the
  // stable, localized action the user needs.
  if (account.healthKind === "reauthorize" || account.healthKind === "refresh_failed") {
    return account.healthLabel;
  }
  return account.healthLabel || account.healthMessage?.trim() || "Attention required";
}

export function SavedAccountCard(props: {
  account: DashboardAccountViewModel;
  lang: DashboardState["lang"];
  copy: DashboardCopy;
  settings: DashboardSettings;
  now: number;
  privacyMode: boolean;
  busy: boolean;
  reloadPromptPending: boolean;
  switchPending: boolean;
  reauthorizePending: boolean;
  resyncProfilePending: boolean;
  refreshPending: boolean;
  detailsPending: boolean;
  removePending: boolean;
  enabledPending: boolean;
  queuePriorityPending: boolean;
  tokenRefreshPending: boolean;
  manualTokenRefreshPending: boolean;
  updateTagsPending: boolean;
  consumeResetCreditPending: boolean;
  exportPending: boolean;
  selected: boolean;
  metricPriority: string;
  compactRow?: boolean;
  onToggleSelected: () => void;
  onExportAuth: () => void;
  onEditTags: () => void;
  onAction: (
    action:
      | "details"
      | "switch"
      | "reloadPrompt"
      | "reauthorize"
      | "resyncProfile"
      | "refresh"
      | "remove"
      | "toggleAccountEnabled"
      | "setAccountQueuePriority"
      | "setAccountTokenRefreshEnabled"
      | "refreshToken"
      | "consumeResetCredit"
      | "syncNow"
      | "setEncryptedSyncRegistryOverride"
      | "openExternalUrl",
    accountId?: string,
    payload?: DashboardActionPayload
  ) => void;
}) {
  const { account, copy, settings, now, onAction, privacyMode } = props;
  const zh = props.lang === "zh";
  const hant = props.lang === "zh-hant";
  const exportLabel = zh ? "导出 auth" : hant ? "匯出 auth" : "Export auth";
  const infoLabel = zh ? "账号信息" : hant ? "帳號資訊" : "Account info";
  const moreLabel = zh ? "更多操作" : hant ? "更多操作" : "More account actions";
  const queuePriorityLabel = account.queuePriority
    ? zh
      ? "取消队列优先"
      : hant
        ? "取消佇列優先"
        : "Remove queue priority"
    : zh
      ? "置顶自动队列"
      : hant
        ? "置頂自動佇列"
        : "Prioritize in auto queue";
  const tokenRefreshLabel = account.tokenRefreshEnabled
    ? zh
      ? "关闭令牌自动刷新"
      : hant
        ? "關閉權杖自動重新整理"
        : "Disable token refresh"
    : zh
      ? "启用令牌自动刷新"
      : hant
        ? "啟用權杖自動重新整理"
        : "Enable token refresh";
  const manualTokenRefreshLabel = zh ? "立即刷新令牌" : hant ? "立即重新整理權杖" : "Refresh token now";
  const queuedLabel = zh ? "排队中" : hant ? "排隊中" : "Queued";
  const resetLabel = copy.resetCreditsBtn ?? (zh ? "重置配额" : hant ? "重置配額" : "Reset quota");
  const runningOnOtherDevice = Boolean(account.runningDeviceName && !account.runningOnThisDevice);
  const registryOverrideEnabled = settings.encryptedSyncRegistryOverrideEnabled;
  const runningDeviceLabel = runningOnOtherDevice
    ? resolveRunningDeviceLabel(account.runningDeviceName ?? "", props.lang)
    : undefined;
  const compactIdentityBadge = resolveCompactIdentityBadge(account.planTypeLabel, runningDeviceLabel);
  const enablementToggleLabel =
    runningOnOtherDevice && !registryOverrideEnabled
      ? resolveClaimedToggleLabel(account.runningDeviceName ?? "", props.lang)
      : runningOnOtherDevice
        ? resolveOverrideToggleLabel(account.runningDeviceName ?? "", props.lang)
        : account.enabled
          ? copy.accountDisableTip
          : copy.accountEnableTip;
  const userIdDisplay = getSensitiveDisplayValue(account.userId, privacyMode, "id", "-");
  const emailDisplay = getSensitiveDisplayValue(account.email, privacyMode, "email");
  const backEmailDisplay = getSensitiveDisplayValue(account.email, privacyMode, "email");
  const selectionLabel = props.selected ? copy.deselectAccount : copy.selectAccount;
  const showReauthorizeButton = resolvePrimaryAccountControl(account) === "reauthorize";
  const [flipped, setFlipped] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [claimPopoverOpen, setClaimPopoverOpen] = useState(false);
  const actionsMenuRef = useRef<HTMLDivElement>(null);
  const claimPopoverRef = useRef<HTMLDivElement>(null);
  const claimPopoverContentRef = useRef<HTMLDivElement>(null);
  const [claimPopoverPosition, setClaimPopoverPosition] = useState({ top: 0, right: 0 });
  useEffect(() => {
    if (!claimPopoverOpen) return;
    const updatePosition = () => {
      const rect = claimPopoverRef.current?.getBoundingClientRect();
      if (rect) setClaimPopoverPosition({ top: rect.bottom + 8, right: Math.max(8, window.innerWidth - rect.right) });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [claimPopoverOpen]);
  useEffect(() => {
    if (!actionsOpen) return;
    const closeOutside = (event: PointerEvent): void => {
      if (!actionsMenuRef.current?.contains(event.target as Node)) setActionsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setActionsOpen(false);
    };
    window.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [actionsOpen]);
  useEffect(() => {
    if (!claimPopoverOpen) return;
    const closeOutside = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (!claimPopoverRef.current?.contains(target) && !claimPopoverContentRef.current?.contains(target))
        setClaimPopoverOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setClaimPopoverOpen(false);
    };
    window.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [claimPopoverOpen]);
  const showResyncButton = account.healthKind !== "reauthorize";
  const hasResetCredit = account.resetCreditsAvailable != null && account.resetCreditsAvailable > 0;
  const subscriptionRemaining = formatSubscriptionRemaining(account.subscriptionExpiresAt, now, props.lang);
  const resyncButtonLabel =
    (account.healthKind === "disabled" || account.healthKind === "quota") && !account.dismissedHealth
      ? copy.resyncProfileBtn
      : copy.syncProfileBtn;
  const hasErrorHealth = isAccountAttention(account);
  const healthReason = resolveCardHealthReason(account);
  const cardStateClass = [
    account.isActive ? "active" : "",
    !account.enabled ? "account-disabled" : "",
    props.busy ? "is-busy" : "",
    props.selected ? "selected" : "",
    hasErrorHealth ? "health-error" : "",
    runningOnOtherDevice ? "remote-device" : ""
  ]
    .filter(Boolean)
    .join(" ");
  const visibleMetrics = [...account.metrics.filter((metric) => metric.visible)].sort((left, right) => {
    const priority = (metricKey: string): number =>
      metricKey.includes(props.metricPriority)
        ? 0
        : metricKey.includes("weekly")
          ? 1
          : metricKey.includes("hourly")
            ? 2
            : 3;
    return priority(left.key) - priority(right.key);
  });
  const lowQuota = visibleMetrics.some(
    (metric) => typeof metric.percentage === "number" && metric.percentage <= settings.quotaYellowThreshold
  );
  const stopFlip = (event: Event): void => {
    event.stopPropagation();
  };
  const handleFlipKey = (event: KeyboardEvent, nextFlipped: boolean): void => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    setFlipped(nextFlipped);
  };
  const handleEnablementToggle = (): void => {
    if (runningOnOtherDevice) {
      setClaimPopoverOpen((open) => !open);
      return;
    }
    onAction("toggleAccountEnabled", account.id);
  };
  const claimPopover =
    runningOnOtherDevice && claimPopoverOpen
      ? createPortal(
          <div
            ref={claimPopoverContentRef}
            class="claim-popover claim-popover-portal"
            role="dialog"
            aria-label={resolveClaimPopoverText(
              "title",
              account.runningDeviceName ?? "",
              props.lang,
              registryOverrideEnabled
            )}
            onClick={stopFlip}
            style={{ top: `${claimPopoverPosition.top}px`, right: `${claimPopoverPosition.right}px` }}
          >
            <div class="claim-popover-head">
              <div class="claim-popover-title">
                {resolveClaimPopoverText("title", account.runningDeviceName ?? "", props.lang, registryOverrideEnabled)}
              </div>
              <button
                class="claim-popover-close"
                type="button"
                aria-label={resolveClaimPopoverText("close", "", props.lang, registryOverrideEnabled)}
                onClick={() => setClaimPopoverOpen(false)}
              >
                ×
              </button>
            </div>
            <div class="claim-popover-body">
              {resolveClaimPopoverText("body", account.runningDeviceName ?? "", props.lang, registryOverrideEnabled)}
            </div>
            <div class="claim-popover-actions">
              <button
                class={`claim-popover-action ${registryOverrideEnabled ? "is-danger" : "is-primary"}`}
                type="button"
                disabled={props.busy}
                onClick={() => {
                  setClaimPopoverOpen(false);
                  onAction("setEncryptedSyncRegistryOverride", undefined, { enabled: !registryOverrideEnabled });
                }}
              >
                {resolveClaimPopoverText(
                  registryOverrideEnabled ? "disableRescue" : "rescue",
                  "",
                  props.lang,
                  registryOverrideEnabled
                )}
              </button>
              <button
                class="claim-popover-action is-secondary"
                type="button"
                disabled={props.busy}
                onClick={() => {
                  setClaimPopoverOpen(false);
                  onAction("syncNow");
                }}
              >
                {resolveClaimPopoverText("sync", "", props.lang, registryOverrideEnabled)}
              </button>
            </div>
          </div>,
          document.body
        )
      : null;
  const renderPrimaryAccountControl = () =>
    showReauthorizeButton ? (
      <ActionButton
        class="saved-control saved-reauthorize-control"
        icon={renderReauthorizeIcon()}
        iconOnly
        label={copy.reauthorizeBtn}
        pending={props.reauthorizePending}
        disabled={props.busy}
        onClick={() => onAction("reauthorize", account.id)}
      />
    ) : (
      <div class="saved-enabled-control-wrap" ref={claimPopoverRef}>
        <button
          class={`saved-control saved-enabled-toggle ${account.enabled ? "is-checked" : ""} ${runningOnOtherDevice ? "is-remote-claimed" : ""} ${account.enablementSyncPending ? "is-sync-pending" : ""} ${runningOnOtherDevice && registryOverrideEnabled ? "is-claim-bypassed" : ""}`}
          type="button"
          title={enablementToggleLabel}
          aria-label={enablementToggleLabel}
          aria-pressed={account.enabled}
          aria-haspopup={runningOnOtherDevice ? "dialog" : undefined}
          aria-expanded={runningOnOtherDevice ? claimPopoverOpen : undefined}
          disabled={props.busy}
          onClick={handleEnablementToggle}
        >
          {props.enabledPending ? (
            <span class="saved-toggle-spinner" aria-hidden="true"></span>
          ) : (
            <span class="saved-enabled-toggle-indicator" aria-hidden="true">
              <span></span>
            </span>
          )}
        </button>
        {claimPopover}
      </div>
    );

  if (props.compactRow) {
    return (
      <>
        <article
          class={`saved-table-row ${cardStateClass} ${lowQuota ? "low-quota" : ""} ${actionsOpen ? "has-open-menu" : ""}`}
          aria-label={emailDisplay}
        >
          <div class="saved-table-identity">
            <button
              class={`saved-select-toggle ${props.selected ? "selected" : ""}`}
              type="button"
              aria-pressed={props.selected}
              aria-label={selectionLabel}
              title={selectionLabel}
              onClick={props.onToggleSelected}
            >
              <span class="saved-select-toggle-mark" aria-hidden="true"></span>
            </button>
            <div class="saved-table-name-block">
              <div class="saved-table-name-line">
                <strong title={emailDisplay}>{emailDisplay}</strong>
              </div>
              {hasErrorHealth ? (
                <span class={`saved-table-health-reason is-${account.healthKind}`} title={healthReason}>
                  {healthReason}
                </span>
              ) : null}
              <div class="saved-table-meta">
                <>
                  <span
                    class={`pill ${compactIdentityBadge.kind === "plan" ? "plan" : "saved-running-device"}`}
                    title={compactIdentityBadge.label}
                  >
                    {compactIdentityBadge.label}
                  </span>
                  {account.switchQueued ? (
                    <button
                      class="pill warning saved-queued-badge"
                      type="button"
                      title={copy.reloadBtn}
                      aria-label={`${queuedLabel}: ${copy.reloadBtn}`}
                      disabled={props.busy}
                      onClick={(event) => {
                        stopFlip(event);
                        onAction("reloadPrompt", account.id);
                      }}
                    >
                      {props.reloadPromptPending ? <span class="saved-toggle-spinner" aria-hidden="true"></span> : null}
                      {queuedLabel}
                    </button>
                  ) : account.isActive ? (
                    <span class="pill active">{copy.current}</span>
                  ) : null}
                  {renderHealthPill(account)}
                  {subscriptionRemaining ? (
                    <span
                      class={`saved-subscription-remaining ${subscriptionRemaining.expiring ? "is-expiring" : ""}`}
                      title={account.subscriptionTitle}
                    >
                      {subscriptionRemaining.label}
                    </span>
                  ) : null}
                  {account.creditsText ? <span class="saved-table-credit">{account.creditsText}</span> : null}
                  {hasResetCredit ? (
                    <button
                      class={`saved-table-credit saved-reset-badge ${props.consumeResetCreditPending ? "is-pending" : ""}`}
                      type="button"
                      title={formatResetCreditsTitle(
                        account.resetCreditsAvailable,
                        account.resetCreditsNextExpiresAt,
                        props.lang
                      )}
                      aria-label={`${resetLabel}: ${account.resetCreditsAvailable}`}
                      disabled={props.busy}
                      onClick={() => onAction("consumeResetCredit", account.id)}
                    >
                      {props.consumeResetCreditPending ? (
                        <span class="saved-toggle-spinner" aria-hidden="true"></span>
                      ) : null}
                      <span>
                        {resolveCompactResetLabel(props.lang)} {account.resetCreditsAvailable}
                      </span>
                    </button>
                  ) : null}
                </>
              </div>
            </div>
          </div>

          <div class="saved-table-metrics">
            {visibleMetrics.slice(0, 2).map((metric) => (
              <MetricRow key={metric.key} metric={metric} lang={props.lang} settings={settings} copy={copy} now={now} />
            ))}
          </div>

          <div class="saved-table-actions" onClick={stopFlip}>
            <button
              class={`saved-control saved-queue-priority-toggle ${account.queuePriority ? "is-prioritized" : ""}`}
              type="button"
              title={queuePriorityLabel}
              aria-label={queuePriorityLabel}
              aria-pressed={account.queuePriority}
              disabled={props.busy}
              onClick={() => onAction("setAccountQueuePriority", account.id, { queuePriority: !account.queuePriority })}
            >
              {props.queuePriorityPending ? (
                <span class="saved-toggle-spinner" aria-hidden="true"></span>
              ) : (
                <span aria-hidden="true">{account.queuePriority ? "★" : "☆"}</span>
              )}
            </button>
            {renderPrimaryAccountControl()}
            <ActionButton
              icon={renderSwitchIcon()}
              iconOnly
              label={copy.switchBtn}
              pending={props.switchPending}
              disabled={!canRunAccountOnThisPc(account, props.busy, registryOverrideEnabled)}
              onClick={() => onAction("switch", account.id)}
            />
            <ActionButton
              icon={renderRefreshIcon()}
              iconOnly
              label={copy.refreshBtn}
              pending={props.refreshPending}
              disabled={props.busy}
              onClick={() => onAction("refresh", account.id)}
            />
            <div class="saved-overflow-wrap" ref={actionsMenuRef}>
              <button
                class={`saved-overflow-trigger ${actionsOpen ? "active" : ""}`}
                type="button"
                aria-label={moreLabel}
                aria-expanded={actionsOpen}
                onClick={() => setActionsOpen((open) => !open)}
              >
                •••
              </button>
              {actionsOpen ? (
                <div class="saved-overflow-menu saved-table-overflow-menu">
                  <button
                    type="button"
                    disabled={props.busy || props.exportPending}
                    onClick={() => {
                      setActionsOpen(false);
                      props.onExportAuth();
                    }}
                  >
                    <DownloadIcon /> <span>{exportLabel}</span>
                  </button>
                  <button
                    type="button"
                    disabled={props.busy}
                    onClick={() => {
                      setActionsOpen(false);
                      props.onEditTags();
                    }}
                  >
                    <EditTagsIcon /> <span>{copy.editTagsBtn}</span>
                  </button>
                  {showResyncButton ? (
                    <button
                      type="button"
                      disabled={props.busy}
                      onClick={() => {
                        setActionsOpen(false);
                        onAction("resyncProfile", account.id);
                      }}
                    >
                      {renderResyncProfileIcon()} <span>{resyncButtonLabel}</span>
                    </button>
                  ) : null}
                  {account.canRefreshToken ? (
                    <button
                      type="button"
                      disabled={props.busy}
                      onClick={() => {
                        setActionsOpen(false);
                        onAction("refreshToken", account.id);
                      }}
                    >
                      {props.manualTokenRefreshPending ? (
                        <span class="saved-toggle-spinner" aria-hidden="true"></span>
                      ) : (
                        renderRefreshIcon()
                      )}
                      <span>{manualTokenRefreshLabel}</span>
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={props.busy}
                    onClick={() => {
                      setActionsOpen(false);
                      onAction("setAccountTokenRefreshEnabled", account.id, {
                        tokenRefreshEnabled: !account.tokenRefreshEnabled
                      });
                    }}
                  >
                    {props.tokenRefreshPending ? (
                      <span class="saved-toggle-spinner" aria-hidden="true"></span>
                    ) : (
                      <span
                        class={`saved-menu-check ${account.tokenRefreshEnabled ? "is-checked" : ""}`}
                        aria-hidden="true"
                      >
                        {account.tokenRefreshEnabled ? "✓" : "○"}
                      </span>
                    )}
                    <span>{tokenRefreshLabel}</span>
                  </button>
                  <button
                    type="button"
                    disabled={props.busy || props.detailsPending}
                    onClick={() => {
                      setActionsOpen(false);
                      onAction("details", account.id, { privacyMode });
                    }}
                  >
                    {props.detailsPending ? <span class="saved-toggle-spinner" aria-hidden="true"></span> : renderDetailsIcon()} <span>{infoLabel}</span>
                  </button>
                  <button
                    class="danger"
                    type="button"
                    disabled={props.busy}
                    onClick={() => {
                      setActionsOpen(false);
                      onAction("remove", account.id);
                    }}
                  >
                    {renderRemoveIcon()} <span>{copy.removeBtn}</span>
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </article>
      </>
    );
  }

  return (
    <>
      <article
        class={`saved-card-container ${cardStateClass} ${lowQuota ? "low-quota" : ""} ${actionsOpen ? "has-open-menu" : ""}`}
      >
        <div class={`saved-card-inner ${flipped ? "flipped" : ""}`}>
          <section class={`saved-card saved-card-front ${cardStateClass}`} aria-label={emailDisplay}>
            <div class="saved-head">
              <div class="saved-title">
                <div class="saved-identity-line">
                  <h3>
                    <button
                      class={`saved-select-toggle ${props.selected ? "selected" : ""}`}
                      type="button"
                      aria-pressed={props.selected}
                      aria-label={selectionLabel}
                      title={selectionLabel}
                      onClick={(event) => {
                        stopFlip(event);
                        props.onToggleSelected();
                      }}
                    >
                      <span class="saved-select-toggle-mark" aria-hidden="true"></span>
                    </button>
                    <span class="saved-title-text">{emailDisplay}</span>
                  </h3>
                  <div class="saved-meta">
                    <span class="pill plan">{account.planTypeLabel}</span>
                    {runningDeviceLabel ? (
                      <span class="pill saved-running-device" title={runningDeviceLabel}>
                        {runningDeviceLabel}
                      </span>
                    ) : null}
                    {account.switchQueued ? (
                      <button
                        class="pill warning saved-queued-badge"
                        type="button"
                        title={copy.reloadBtn}
                        aria-label={`${queuedLabel}: ${copy.reloadBtn}`}
                        disabled={props.busy}
                        onClick={(event) => {
                          stopFlip(event);
                          onAction("reloadPrompt", account.id);
                        }}
                      >
                        {props.reloadPromptPending ? (
                          <span class="saved-toggle-spinner" aria-hidden="true"></span>
                        ) : null}
                        {queuedLabel}
                      </button>
                    ) : account.isActive ? (
                      <span class="pill active">{copy.current}</span>
                    ) : null}
                    {renderHealthPill(account)}
                    {renderTagList(account.tags)}
                  </div>
                </div>
                {hasErrorHealth ? (
                  <div class={`saved-health-reason is-${account.healthKind}`} role="status" title={healthReason}>
                    {healthReason}
                  </div>
                ) : null}
              </div>
              <div class="saved-top-actions" onClick={stopFlip}>
                <button
                  class={`saved-control saved-queue-priority-toggle ${account.queuePriority ? "is-prioritized" : ""}`}
                  type="button"
                  title={queuePriorityLabel}
                  aria-label={queuePriorityLabel}
                  aria-pressed={account.queuePriority}
                  disabled={props.busy}
                  onClick={() =>
                    onAction("setAccountQueuePriority", account.id, { queuePriority: !account.queuePriority })
                  }
                >
                  {props.queuePriorityPending ? (
                    <span class="saved-toggle-spinner" aria-hidden="true"></span>
                  ) : (
                    <span aria-hidden="true">{account.queuePriority ? "★" : "☆"}</span>
                  )}
                </button>
                {renderPrimaryAccountControl()}
                <button
                  class="saved-control saved-edit-tags-btn"
                  type="button"
                  aria-label={copy.editTagsBtn}
                  title={copy.editTagsBtn}
                  disabled={props.busy}
                  onClick={props.onEditTags}
                >
                  {props.updateTagsPending ? (
                    <span class="saved-toggle-spinner" aria-hidden="true"></span>
                  ) : (
                    <EditTagsIcon />
                  )}
                </button>
              </div>
            </div>

            <div class="saved-progress">
              {visibleMetrics.length > 0 ? (
                visibleMetrics.map((metric) => (
                  <MetricRow
                    key={metric.key}
                    metric={metric}
                    lang={props.lang}
                    settings={settings}
                    copy={copy}
                    now={now}
                  />
                ))
              ) : (
                <div class="quota-empty-placeholder">{copy.resetUnknown}</div>
              )}
            </div>
            <div class="saved-card-footer">
              <div class="saved-credit-summary">
                <>
                  {subscriptionRemaining ? (
                    <span
                      class={`saved-credits-line saved-subscription-remaining ${subscriptionRemaining.expiring ? "is-expiring" : ""}`}
                      title={account.subscriptionTitle}
                    >
                      {subscriptionRemaining.label}
                    </span>
                  ) : null}
                  {account.creditsText ? <span class="saved-credits-line">{account.creditsText}</span> : null}
                  {hasResetCredit ? (
                    <button
                      class={`saved-credits-line saved-reset-credits-line saved-reset-badge ${props.consumeResetCreditPending ? "is-pending" : ""}`}
                      type="button"
                      title={formatResetCreditsTitle(
                        account.resetCreditsAvailable,
                        account.resetCreditsNextExpiresAt,
                        props.lang
                      )}
                      aria-label={`${resetLabel}: ${account.resetCreditsAvailable}`}
                      disabled={props.busy}
                      onClick={() => onAction("consumeResetCredit", account.id)}
                    >
                      {props.consumeResetCreditPending ? (
                        <span class="saved-toggle-spinner" aria-hidden="true"></span>
                      ) : null}
                      <span>
                        {resolveCompactResetLabel(props.lang)} {account.resetCreditsAvailable}
                      </span>
                    </button>
                  ) : null}
                </>
              </div>
              <div class="saved-actions" onClick={stopFlip}>
                {account.isActive && !account.isCurrentWindowAccount ? (
                  <ActionButton
                    icon={renderReloadIcon()}
                    iconOnly
                    label={copy.reloadBtn}
                    pending={props.reloadPromptPending}
                    disabled={props.busy}
                    onClick={() => onAction("reloadPrompt", account.id)}
                  />
                ) : null}
                <ActionButton
                  icon={renderSwitchIcon()}
                  iconOnly
                  label={copy.switchBtn}
                  pending={props.switchPending}
                  disabled={!canRunAccountOnThisPc(account, props.busy, registryOverrideEnabled)}
                  onClick={() => onAction("switch", account.id)}
                />
                <ActionButton
                  icon={renderRefreshIcon()}
                  iconOnly
                  label={copy.refreshBtn}
                  pending={props.refreshPending}
                  disabled={props.busy}
                  onClick={() => onAction("refresh", account.id)}
                />
                <div class="saved-overflow-wrap" ref={actionsMenuRef}>
                  <button
                    class={`saved-overflow-trigger ${actionsOpen ? "active" : ""}`}
                    type="button"
                    aria-label={moreLabel}
                    aria-expanded={actionsOpen}
                    onClick={() => setActionsOpen((open) => !open)}
                  >
                    •••
                  </button>
                  {actionsOpen ? (
                    <div class="saved-overflow-menu">
                      <button
                        type="button"
                        disabled={props.busy || props.exportPending}
                        onClick={() => {
                          setActionsOpen(false);
                          props.onExportAuth();
                        }}
                      >
                        <DownloadIcon /> <span>{exportLabel}</span>
                      </button>
                      {showResyncButton ? (
                        <button
                          type="button"
                          disabled={props.busy}
                          onClick={() => {
                            setActionsOpen(false);
                            onAction("resyncProfile", account.id);
                          }}
                        >
                          {renderResyncProfileIcon()} <span>{resyncButtonLabel}</span>
                        </button>
                      ) : null}
                      {account.canRefreshToken ? (
                        <button
                          type="button"
                          disabled={props.busy}
                          onClick={() => {
                            setActionsOpen(false);
                            onAction("refreshToken", account.id);
                          }}
                        >
                          {props.manualTokenRefreshPending ? (
                            <span class="saved-toggle-spinner" aria-hidden="true"></span>
                          ) : (
                            renderRefreshIcon()
                          )}
                          <span>{manualTokenRefreshLabel}</span>
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={props.busy}
                        onClick={() => {
                          setActionsOpen(false);
                          onAction("setAccountTokenRefreshEnabled", account.id, {
                            tokenRefreshEnabled: !account.tokenRefreshEnabled
                          });
                        }}
                      >
                        {props.tokenRefreshPending ? (
                          <span class="saved-toggle-spinner" aria-hidden="true"></span>
                        ) : (
                          <span
                            class={`saved-menu-check ${account.tokenRefreshEnabled ? "is-checked" : ""}`}
                            aria-hidden="true"
                          >
                            {account.tokenRefreshEnabled ? "✓" : "○"}
                          </span>
                        )}
                        <span>{tokenRefreshLabel}</span>
                      </button>
                      <button
                        type="button"
                        disabled={props.busy || props.detailsPending}
                        onClick={() => {
                          setActionsOpen(false);
                          onAction("details", account.id, { privacyMode: props.privacyMode });
                        }}
                      >
                        {props.detailsPending ? <span class="saved-toggle-spinner" aria-hidden="true"></span> : renderDetailsIcon()} <span>{infoLabel}</span>
                      </button>
                      <button
                        class="danger"
                        type="button"
                        disabled={props.busy}
                        onClick={() => {
                          setActionsOpen(false);
                          onAction("remove", account.id);
                        }}
                      >
                        {renderRemoveIcon()} <span>{copy.removeBtn}</span>
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </section>

          <section
            class={`saved-card saved-card-back ${cardStateClass}`}
            role="button"
            tabIndex={0}
            aria-label={copy.detailsBtn}
            onClick={() => setFlipped(false)}
            onKeyDown={(event) => handleFlipKey(event, false)}
          >
            <div class="saved-back-body">
              <div class="saved-back-header">
                <div class="saved-back-icon" aria-hidden="true"></div>
                <span class="saved-back-email">{backEmailDisplay}</span>
              </div>
              <div class="saved-detail-list">
                <CardDetailRow label={resolveBackLabel("workspace", props.lang)} value={account.workspaceLabel} />
                <CardDetailRow
                  label={resolveBackLabel("subscription", props.lang)}
                  value={account.subscriptionText}
                  title={account.subscriptionTitle}
                  color={account.subscriptionColor}
                />
                <CardDetailRow label={resolveBackLabel("addMethod", props.lang)} value={account.addMethodLabel} />
                <CardDetailRow label={resolveBackLabel("createdAt", props.lang)} value={account.addedAtLabel} />
                <CardDetailRow
                  label={resolveBackLabel("status", props.lang)}
                  value={resolveBackStatus(account, props.lang)}
                  color={account.statusColor}
                />
                <CardDetailRow label={copy.userId} value={userIdDisplay} />
              </div>
              <div class="saved-back-tags">
                <div class="account-tag-row">
                  {renderTagList(account.tags) ?? <span class="tag-pill muted">{resolveNoTags(props.lang)}</span>}
                </div>
              </div>
              <div class="saved-back-hint">{resolveBackHint(props.lang)}</div>
            </div>
          </section>
        </div>
      </article>
    </>
  );
}

function resolveClaimPopoverText(
  key: "title" | "body" | "close" | "rescue" | "disableRescue" | "sync",
  deviceName: string,
  lang: DashboardState["lang"],
  overrideEnabled: boolean
): string {
  const values = {
    en: {
      title: overrideEnabled ? "Rescue override is active" : `Enabled on ${deviceName}`,
      body: overrideEnabled
        ? `The claim by ${deviceName} is warning-only on this PC. Disable rescue to enforce the shared registry again.`
        : "Sync after disabling this account on that PC, or use rescue to unlock it only on this PC.",
      disableRescue: "Disable rescue",
      close: "Close",
      rescue: "Rescue override",
      sync: "Sync & check"
    },
    zh: {
      title: overrideEnabled ? "救援覆盖已启用" : `已在 ${deviceName} 启用`,
      body: overrideEnabled
        ? `${deviceName} 的占用在本机仅作警告。关闭救援覆盖即可再次强制执行共享注册表。`
        : "请在该电脑停用账号后同步，或使用救援覆盖仅在本机解锁。",
      disableRescue: "关闭救援覆盖",
      close: "关闭",
      rescue: "救援覆盖",
      sync: "同步并检查"
    },
    "zh-hant": {
      title: overrideEnabled ? "救援覆寫已啟用" : `已在 ${deviceName} 啟用`,
      body: overrideEnabled
        ? `${deviceName} 的佔用在本機僅作警告。關閉救援覆寫即可再次強制執行共享登錄。`
        : "請在該電腦停用帳號後同步，或使用救援覆寫僅在本機解鎖。",
      disableRescue: "關閉救援覆寫",
      close: "關閉",
      rescue: "救援覆寫",
      sync: "同步並檢查"
    }
  } as const;
  const locale = lang === "zh" || lang === "zh-hant" ? lang : "en";
  return values[locale][key];
}

function resolveBackLabel(
  key: "workspace" | "subscription" | "addMethod" | "createdAt" | "status",
  lang: DashboardState["lang"]
): string {
  const zh = lang === "zh" || lang === "zh-hant";
  const labels = {
    workspace: zh ? "工作空间" : "Workspace",
    subscription: zh ? "订阅到期" : "Subscription",
    addMethod: zh ? "添加方式" : "Added by",
    createdAt: zh ? "创建时间" : "Created at",
    status: zh ? "状态" : "Status"
  };
  return labels[key];
}

function resolveBackStatus(account: DashboardAccountViewModel, lang: DashboardState["lang"]): string {
  if (account.isActive) {
    return lang === "zh" ? "当前激活" : lang === "zh-hant" ? "目前啟用" : "Current active";
  }
  return account.healthLabel;
}

function resolveNoTags(lang: DashboardState["lang"]): string {
  return lang === "zh" ? "暂无标签" : lang === "zh-hant" ? "暫無標籤" : "No tags";
}

function resolveBackHint(lang: DashboardState["lang"]): string {
  switch (lang) {
    case "zh":
      return "点击卡片任意区域返回配额监控";
    case "zh-hant":
      return "點擊卡片任意區域返回配額監控";
    default:
      return "Click anywhere to return to quota monitor";
  }
}

function formatSubscriptionRemaining(
  expiresAt: number | undefined,
  now: number,
  lang: DashboardState["lang"]
): { label: string; expiring: boolean } | undefined {
  if (expiresAt == null || !Number.isFinite(expiresAt)) {
    return undefined;
  }
  const remainingMs = expiresAt - now;
  if (remainingMs <= 0) {
    // This entitlement timestamp can be stale while the account remains usable.
    // Show it as neutral information and never as an account error.
    return {
      label: lang === "zh" || lang === "zh-hant" ? "剩 0天" : "0d left",
      expiring: false
    };
  }
  const days = Math.max(1, Math.ceil(remainingMs / 86_400_000));
  return {
    label: lang === "zh" || lang === "zh-hant" ? `剩 ${days}天` : `${days}d left`,
    expiring: days <= 7
  };
}

function CardDetailRow(props: { label: string; value: string; title?: string; color?: string }) {
  return (
    <div class="saved-detail-row">
      <span class="saved-detail-label">{props.label}:</span>
      <span
        class="saved-detail-value"
        title={props.title ?? props.value}
        style={props.color ? { color: props.color } : undefined}
      >
        {props.value}
      </span>
    </div>
  );
}

function formatResetCreditsExpiry(epochSeconds: number, lang: DashboardState["lang"]): string {
  const d = new Date(epochSeconds * 1000);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  const label = lang === "zh" ? "最近到期" : lang === "zh-hant" ? "最近到期" : "Expires";
  return `${label}: ${y}/${mo}/${day} ${h}:${mi}:${s}`;
}

function resolveCompactResetLabel(lang: DashboardState["lang"]): string {
  return lang === "zh" ? "重置" : lang === "zh-hant" ? "重設" : "Reset";
}

function resolveRunningDeviceLabel(deviceName: string, lang: DashboardState["lang"]): string {
  if (lang === "zh") {
    return `由 ${deviceName}`;
  }
  if (lang === "zh-hant") {
    return `由 ${deviceName}`;
  }
  return `With ${deviceName}`;
}

function resolveClaimedToggleLabel(deviceName: string, lang: DashboardState["lang"]): string {
  if (lang === "zh") return `已由 ${deviceName} 启用；请先在该电脑上停用`;
  if (lang === "zh-hant") return `已由 ${deviceName} 啟用；請先在該電腦上停用`;
  return `Enabled on ${deviceName}; sync the registry after it is disabled there`;
}

function resolveOverrideToggleLabel(deviceName: string, lang: DashboardState["lang"]): string {
  if (lang === "zh") return `紧急绕过已启用；${deviceName} 的占用仅作警告`;
  if (lang === "zh-hant") return `緊急略過已啟用；${deviceName} 的佔用僅作警告`;
  return `Rescue override active; the claim by ${deviceName} is warning-only`;
}

function formatResetCreditsTitle(
  available: number | undefined,
  expiresAt: number | undefined,
  lang: DashboardState["lang"]
): string {
  const count = available ?? "—";
  const expiry = expiresAt != null && expiresAt > 0 ? ` · ${formatResetCreditsExpiry(expiresAt, lang)}` : "";
  return `${resolveCompactResetLabel(lang)}: ${count}${expiry}`;
}
