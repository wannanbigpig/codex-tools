import { useState } from "preact/hooks";
import type {
  DashboardAccountViewModel,
  DashboardCopy,
  DashboardSettings,
  DashboardState
} from "../../src/domain/dashboard/types";
import { getSensitiveDisplayValue, renderTagList } from "./helpers";
import {
  EditTagsIcon,
  renderRefreshIcon,
  renderReauthorizeIcon,
  renderReloadIcon,
  renderRemoveIcon,
  renderResyncProfileIcon,
  renderSwitchIcon
} from "./icons";
import { ActionButton } from "./primitives";
import { MetricRow, renderHealthPill } from "./accountMetricPrimitives";

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
  togglePending: boolean;
  updateTagsPending: boolean;
  selected: boolean;
  onToggleSelected: () => void;
  onEditTags: () => void;
  onAction: (
    action: "details" | "switch" | "reloadPrompt" | "reauthorize" | "resyncProfile" | "refresh" | "remove" | "toggleStatusBar",
    accountId?: string
  ) => void;
}) {
  const { account, copy, settings, now, onAction, privacyMode } = props;
  const userIdDisplay = getSensitiveDisplayValue(account.userId, privacyMode, "id", "-");
  const emailDisplay = getSensitiveDisplayValue(account.email, privacyMode, "email");
  const backEmailDisplay = getSensitiveDisplayValue(account.email, privacyMode, "email");
  const selectionLabel = props.selected ? copy.deselectAccount : copy.selectAccount;
  const showReauthorizeButton = account.healthKind === "reauthorize" && !account.dismissedHealth;
  const showResyncButton = account.healthKind !== "reauthorize";
  const [flipped, setFlipped] = useState(false);
  const resyncButtonLabel =
    (account.healthKind === "disabled" || account.healthKind === "quota") && !account.dismissedHealth
      ? copy.resyncProfileBtn
      : copy.syncProfileBtn;
  const cardStateClass = `${account.isActive ? "active" : ""} ${props.busy ? "is-busy" : ""} ${props.selected ? "selected" : ""}`;
  const visibleMetrics = account.metrics.filter((metric) => metric.visible);
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

  return (
    <article class={`saved-card-container ${cardStateClass}`}>
      <div class={`saved-card-inner ${flipped ? "flipped" : ""}`}>
        <section
          class={`saved-card saved-card-front ${cardStateClass}`}
          role="button"
          tabIndex={0}
          aria-label={copy.detailsBtn}
          onClick={() => setFlipped(true)}
          onKeyDown={(event) => handleFlipKey(event, true)}
        >
          <div class="saved-head">
            <div class="saved-top-actions" onClick={stopFlip}>
              {!account.isActive ? (
                <button
                  class={`saved-control saved-status-toggle ${account.canToggleStatusBar ? "" : "disabled"} ${account.showInStatusBar ? "is-checked" : ""}`}
                  type="button"
                  aria-label={account.statusToggleTitle}
                  aria-pressed={account.showInStatusBar}
                  aria-disabled={!account.canToggleStatusBar || props.busy}
                  onClick={() => {
                    if (!account.canToggleStatusBar || props.busy) {
                      return;
                    }
                    onAction("toggleStatusBar", account.id);
                  }}
                >
                  <span class="saved-status-toggle-indicator" aria-hidden="true">
                    <span></span>
                  </span>
                  <span class="saved-control-tip align-right" aria-hidden="true">
                    {account.statusToggleTitle}
                  </span>
                </button>
              ) : null}
              <button class="saved-control saved-edit-tags-btn" type="button" aria-label={copy.editTagsBtn} disabled={props.busy} onClick={props.onEditTags}>
                {props.updateTagsPending ? <span class="saved-toggle-spinner" aria-hidden="true"></span> : <EditTagsIcon />}
                <span class="saved-control-tip align-right" aria-hidden="true">
                  {copy.editTagsBtn}
                </span>
              </button>
            </div>
            <div class="saved-title">
              <h3>
                <button
                  class={`saved-select-toggle ${props.selected ? "selected" : ""}`}
                  type="button"
                  aria-pressed={props.selected}
                  aria-label={selectionLabel}
                  onClick={(event) => {
                    stopFlip(event);
                    props.onToggleSelected();
                  }}
                >
                  <span class="saved-select-toggle-mark" aria-hidden="true"></span>
                  <span class="saved-control-tip align-left below" aria-hidden="true">
                    {selectionLabel}
                  </span>
                </button>
                <span class="saved-title-text">{emailDisplay}</span>
              </h3>
              <div class="saved-meta">
                <span class="pill plan">{account.planTypeLabel}</span>
                {account.isActive ? <span class="pill active">{copy.primaryAccount}</span> : null}
                {account.isCurrentWindowAccount ? <span class="pill active">{copy.current}</span> : null}
                {renderHealthPill(account)}
              </div>
            </div>
          </div>

          <div class="saved-progress">
            {visibleMetrics.length > 0 ? (
              visibleMetrics.map((metric) => (
                <MetricRow key={metric.key} metric={metric} lang={props.lang} settings={settings} copy={copy} now={now} />
              ))
            ) : (
              <div class="quota-empty-placeholder">{copy.resetUnknown}</div>
            )}
          </div>
          {account.creditsText ? <div class="saved-credits-line">{account.creditsText}</div> : null}
          <div class="saved-card-divider"></div>
          <div class="saved-actions" onClick={stopFlip}>
            {account.isActive && !account.isCurrentWindowAccount ? (
              <ActionButton icon={renderReloadIcon()} iconOnly label={copy.reloadBtn} pending={props.reloadPromptPending} disabled={props.busy} onClick={() => onAction("reloadPrompt", account.id)} />
            ) : null}
            {showReauthorizeButton ? (
              <ActionButton icon={renderReauthorizeIcon()} iconOnly label={copy.reauthorizeBtn} pending={props.reauthorizePending} disabled={props.busy} onClick={() => onAction("reauthorize", account.id)} />
            ) : null}
            {showResyncButton ? (
              <ActionButton icon={renderResyncProfileIcon()} iconOnly label={resyncButtonLabel} pending={props.resyncProfilePending} disabled={props.busy} onClick={() => onAction("resyncProfile", account.id)} />
            ) : null}
            <ActionButton icon={renderSwitchIcon()} iconOnly label={copy.switchBtn} pending={props.switchPending} disabled={props.busy} onClick={() => onAction("switch", account.id)} />
            <ActionButton icon={renderRefreshIcon()} iconOnly label={copy.refreshBtn} pending={props.refreshPending} disabled={props.busy} onClick={() => onAction("refresh", account.id)} />
            <ActionButton icon={renderRemoveIcon()} iconOnly label={copy.removeBtn} pending={props.removePending} disabled={props.busy} onClick={() => onAction("remove", account.id)} />
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
              <CardDetailRow label={resolveBackLabel("addedAt", props.lang)} value={account.addedAtLabel} />
              <CardDetailRow
                label={resolveBackLabel("status", props.lang)}
                value={resolveBackStatus(account, props.lang)}
                color={account.statusColor}
              />
              <CardDetailRow label={copy.userId} value={userIdDisplay} />
            </div>
            <div class="saved-back-tags">
              <div class="account-tag-row">{renderTagList(account.tags) ?? <span class="tag-pill muted">{resolveNoTags(props.lang)}</span>}</div>
            </div>
            <div class="saved-back-hint">{resolveBackHint(props.lang)}</div>
          </div>
        </section>
      </div>
    </article>
  );
}

function resolveBackLabel(
  key: "workspace" | "subscription" | "addMethod" | "addedAt" | "status",
  lang: DashboardState["lang"]
): string {
  const zh = lang === "zh" || lang === "zh-hant";
  const labels = {
    workspace: zh ? "工作空间" : "Workspace",
    subscription: zh ? "订阅到期" : "Subscription",
    addMethod: zh ? "添加方式" : "Added by",
    addedAt: zh ? "添加时间" : "Added at",
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

function CardDetailRow(props: { label: string; value: string; title?: string; color?: string }) {
  return (
    <div class="saved-detail-row">
      <span class="saved-detail-label">{props.label}:</span>
      <span class="saved-detail-value" title={props.title ?? props.value} style={props.color ? { color: props.color } : undefined}>
        {props.value}
      </span>
    </div>
  );
}
