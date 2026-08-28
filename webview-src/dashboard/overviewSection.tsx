import { createPortal } from "preact/compat";
import { useEffect, useRef, useState } from "preact/hooks";
import type {
  DashboardAccountViewModel,
  DashboardCopy,
  DashboardSettings,
  DashboardState
} from "../../src/domain/dashboard/types";
import type { DashboardUsageSample } from "../../src/domain/dashboard/types";
import {
  formatRelativeTimestamp,
  formatTimestamp,
  formatPercent,
  getSensitiveDisplayValue,
  renderTagList,
  resolveLockMinutes
} from "./helpers";
import { formatAccountUsageDuration } from "../../src/utils/accountUsage";
import { ActionButton } from "./primitives";
import { MetricGauge } from "./accountMetricPrimitives";
import { AccountAccessIcon, renderRefreshIcon, ResetCreditIcon } from "./icons";

export type { DashboardUsageSample } from "../../src/domain/dashboard/types";

export function OverviewSection(props: {
  account?: DashboardAccountViewModel;
  accounts?: DashboardAccountViewModel[];
  hasAccounts: boolean;
  lang: DashboardState["lang"];
  copy: DashboardCopy;
  settings: DashboardSettings;
  now: number;
  privacyMode: boolean;
  disabled: boolean;
  addPending: boolean;
  refreshAllPending: boolean;
  consumeResetCreditPending: boolean;
  metricPriority?: "weekly" | "hourly" | "review";
  usageHistory?: DashboardUsageSample[];
  onSetAutoSwitchLock: (minutes: number) => void;
  onAddAccount: () => void;
  onRefreshAll: () => void;
  onConfigureSync: () => void;
  onSyncNow: () => void;
  syncPending: boolean;
  registryOverridePending: boolean;
  onSetRegistryOverride: (enabled: boolean) => void;
  onConsumeResetCredit: () => void;
  onSwitchAccount: () => void;
  onReloadAccount: () => void;
  onRefreshQuota: () => void;
}) {
  const { account, copy, settings, now, hasAccounts, privacyMode } = props;
  const emptyTitle = hasAccounts ? copy.noActiveAccountTitle : copy.empty;
  const emptySub = hasAccounts ? copy.noActiveAccountSub : copy.savedAccountsSub;
  const teamNameDisplay =
    account?.isTeamWorkspace && account.accountName?.trim()
      ? getSensitiveDisplayValue(account.accountName, privacyMode, "name", account.accountName)
      : undefined;
  const hasResetCredit = (account?.resetCreditsAvailable ?? 0) > 0;
  const weeklyMetric = account?.metrics.find((metric) => metric.key === "weekly" && metric.visible);
  const showResetQuotaNotice = hasResetCredit && typeof weeklyMetric?.percentage === "number";
  const refreshMode = resolveOverviewRefreshMode(settings.encryptedSyncEnabled);
  const toolbarActionCount = resolveOverviewToolbarActionCount(
    hasAccounts,
    Boolean(account),
    settings.encryptedSyncRegistryOverrideEnabled
  );
  const [lockDialogOpen, setLockDialogOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [lockMinutes, setLockMinutes] = useState(() => resolveLockMinutes(settings.autoSwitchLockMinutes));
  const lockPopoverRef = useRef<HTMLDivElement>(null);
  const lockPopoverContentRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const [lockPopoverPosition, setLockPopoverPosition] = useState({ top: 0, right: 0 });
  useEffect(() => {
    if (!lockDialogOpen) return;
    const updatePosition = () => {
      const rect = lockPopoverRef.current?.getBoundingClientRect();
      if (rect) setLockPopoverPosition({ top: rect.bottom + 5, right: Math.max(8, window.innerWidth - rect.right) });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [lockDialogOpen]);
  useEffect(() => {
    if (!moreOpen) return;
    const close = (event: PointerEvent) => {
      if (!moreRef.current?.contains(event.target as Node)) setMoreOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", key);
    };
  }, [moreOpen]);
  useEffect(() => {
    if (!lockDialogOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!lockPopoverRef.current?.contains(target) && !lockPopoverContentRef.current?.contains(target))
        setLockDialogOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLockDialogOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [lockDialogOpen]);
  const overviewMetrics = account
    ? account.metrics
        .filter((metric) => metric.visible && (metric.key.includes("hourly") || metric.key.includes("weekly")))
        .sort((left, right) => {
          const priority = (key: string): number =>
            props.metricPriority && key.includes(props.metricPriority) ? 0 : key.includes("weekly") ? 1 : 2;
          return priority(left.key) - priority(right.key);
        })
        .slice(0, 2)
    : [];

  return (
    <div class="overview-shell">
      {account ? (
        <div class="overview-account">
          <div class="overview-account-main">
            <div class="overview-account-header">
              <div class="overview-account-identity-line">
                <div class="overview-account-email">
                  {getSensitiveDisplayValue(account.email, privacyMode, "email")}
                </div>
                <div class="overview-account-tags">
                  <span class="pill plan">{account.planTypeLabel}</span>
                  {hasResetCredit ? (
                    <button
                      class="overview-reset-credit"
                      type="button"
                      title={formatResetCreditsTitle(account, copy)}
                      aria-label={formatResetCreditsTitle(account, copy)}
                      disabled={props.disabled || props.consumeResetCreditPending}
                      onClick={props.onConsumeResetCredit}
                    >
                      {props.consumeResetCreditPending ? (
                        <span class="saved-toggle-spinner" aria-hidden="true"></span>
                      ) : (
                        <ResetCreditIcon />
                      )}
                      <span>{account.resetCreditsAvailable}</span>
                    </button>
                  ) : null}
                </div>
              </div>
              {teamNameDisplay ? <div class="overview-account-workspace">{teamNameDisplay}</div> : null}
              {account.tags.length ? <div class="account-tag-row">{renderTagList(account.tags)}</div> : null}
              {showResetQuotaNotice ? (
                <div class="overview-quota-notice" role="status">
                  <div class="overview-quota-notice-copy">
                    <span class="overview-quota-notice-icon" aria-hidden="true">!</span>
                    <div>
                      <div class="overview-quota-notice-title">
                        {resolveResetQuotaNoticeTitle(props.lang, formatPercent(weeklyMetric?.percentage))}
                      </div>
                      <div class="overview-quota-notice-sub">
                        {resolveResetQuotaNoticeSub(props.lang, settings.autoSwitchEnabled)}
                      </div>
                    </div>
                  </div>
                  <div class="overview-quota-notice-actions">
                    <button
                      class="overview-quota-notice-btn is-reset"
                      type="button"
                      disabled={props.disabled || props.consumeResetCreditPending}
                      onClick={props.onConsumeResetCredit}
                    >
                      {props.consumeResetCreditPending ? "…" : copy.resetCreditsLabel}
                    </button>
                    <button
                      class="overview-quota-notice-btn is-switch"
                      type="button"
                      disabled={props.disabled}
                      onClick={props.onSwitchAccount}
                    >
                      {resolveResetQuotaSwitchLabel(props.lang)}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
            <div class="overview-meta">
              <div class="overview-meta-item overview-meta-item-subscription">
                <span class="grid-label">{resolveOverviewLabel("subscription", props.lang)}</span>
                <span
                  class="meta-value"
                  title={account.subscriptionTitle}
                  style={account.subscriptionColor ? { color: account.subscriptionColor } : undefined}
                >
                  {account.subscriptionText}
                </span>
              </div>
              <div class="overview-meta-item">
                <span class="grid-label">{resolveOverviewLabel("workspace", props.lang)}</span>
                <span class="meta-value">{account.workspaceLabel}</span>
              </div>
              <div class="overview-meta-item">
                <span class="grid-label">{resolveOverviewLabel("login", props.lang)}</span>
                <span class="meta-value" title={formatTimestamp(account.loginAt, account.addedAtLabel)}>
                  {formatCompactDate(account.loginAt, props.lang, account.addedAtLabel)}
                </span>
              </div>
              <div class="overview-meta-item overview-meta-item-wide">
                <span class="grid-label">{copy.accountId}</span>
                <span class="meta-value" title={account.accountId}>
                  {getSensitiveDisplayValue(account.accountId, privacyMode, "id", copy.unknown)}
                </span>
              </div>
              <div class="overview-session-meta overview-meta-item overview-meta-item-wide">
                <OverviewSessionValue
                  label={resolveOverviewLabel("session", props.lang)}
                  value={formatAccountUsageDuration(account, now, props.lang)}
                  title={resolveUsageDurationTitle(props.lang)}
                />
                <OverviewSessionValue
                  label={copy.lastRefresh}
                  value={formatRelativeTimestamp(account.lastQuotaAt, now, copy.never, props.lang)}
                  title={formatTimestamp(account.lastQuotaAt, copy.never)}
                />
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div class="overview-account overview-empty-panel">
          <div class="overview-empty-icon" aria-hidden="true">
            ↻
          </div>
          <div class="overview-empty-badge">{copy.dashboardTitle}</div>
          <div class="overview-empty-title">{emptyTitle}</div>
          <div class="overview-empty-sub">{emptySub}</div>
        </div>
      )}
      <div class="overview-main">
        {account ? (
          <UsageGraph
            history={props.usageHistory ?? []}
            accounts={props.accounts ?? []}
            now={now}
            privacyMode={privacyMode}
            lang={props.lang}
          />
        ) : null}
        <div class="overview-bottom-row">
          <div class="overview-metrics">
            {account ? (
              <div class="metrics">
                {overviewMetrics.map((metric) => (
                  <MetricGauge
                    key={metric.key}
                    metric={metric}
                    lang={props.lang}
                    settings={settings}
                    copy={copy}
                    now={now}
                  />
                ))}
              </div>
            ) : (
              <div class="overview-empty-copy">
                <div class="overview-empty-copy-title">
                  {!hasAccounts && settings.encryptedSyncEnabled
                    ? props.lang === "zh"
                      ? "正在等待同步账号"
                      : props.lang === "zh-hant"
                        ? "正在等待同步帳號"
                        : "Waiting for synced accounts"
                    : emptyTitle}
                </div>
                <div class="overview-empty-copy-sub">
                  {!hasAccounts && settings.encryptedSyncEnabled
                    ? props.lang === "zh"
                      ? "新电脑会自动加载其他电脑的账号；也可以立即同步。"
                      : props.lang === "zh-hant"
                        ? "新電腦會自動載入其他電腦的帳號；也可以立即同步。"
                        : "This new PC will load accounts from your other PCs automatically, or sync now."
                    : !hasAccounts
                      ? props.lang === "zh"
                        ? "设置加密同步后，可在其他电脑安全加载账号。"
                        : props.lang === "zh-hant"
                          ? "設定加密同步後，可在其他電腦安全載入帳號。"
                          : "Set up encrypted sync to load your accounts securely on another PC."
                      : emptySub}
                </div>
              </div>
            )}
          </div>
          <div class={`overview-actions ${!hasAccounts ? "overview-empty-actions" : ""}`}>
            <div
              class="toolbar"
              style={{ gridTemplateColumns: `repeat(${toolbarActionCount}, minmax(0, 1fr))` }}
            >
              {!hasAccounts ? (
                <ActionButton
                  class="toolbar-btn primary-btn"
                  icon={<span class="overview-action-symbol">↻</span>}
                  label={
                    settings.encryptedSyncEnabled
                      ? resolveSyncNowLabel(props.lang)
                      : resolveConfigureSyncLabel(props.lang)
                  }
                  pending={props.syncPending}
                  disabled={props.disabled}
                  onClick={settings.encryptedSyncEnabled ? props.onSyncNow : props.onConfigureSync}
                >
                  {settings.encryptedSyncEnabled
                    ? resolveOverviewToolbarLabel("sync", props.lang)
                    : resolveOverviewToolbarLabel("setup", props.lang)}
                </ActionButton>
              ) : null}
              <ActionButton
                class="toolbar-btn add-account-btn"
                icon={<AccountAccessIcon />}
                label={copy.addAccount}
                pending={props.addPending}
                disabled={props.disabled}
                onClick={props.onAddAccount}
              >
                {resolveOverviewToolbarLabel("add", props.lang)}
              </ActionButton>
              {hasAccounts ? (
                <>
                  <ActionButton
                    class="toolbar-btn"
                    icon={renderRefreshIcon()}
                    label={refreshMode === "sync" ? resolveSyncNowLabel(props.lang) : resolveQuotaRefreshLabel(props.lang)}
                    pending={refreshMode === "sync" ? props.syncPending : props.refreshAllPending}
                    onClick={refreshMode === "sync" ? props.onSyncNow : props.onRefreshAll}
                    disabled={props.disabled}
                  >
                    {resolveOverviewToolbarLabel(refreshMode === "sync" ? "sync" : "refresh", props.lang)}
                  </ActionButton>
                </>
              ) : null}
              {account ? (
                <div class="saved-enabled-control-wrap" ref={lockPopoverRef}>
                  <ActionButton
                    class="toolbar-btn"
                    icon={<span class="overview-action-symbol">{account.autoSwitchLockedUntil ? "🔓" : "🔒"}</span>}
                    label={
                      account.autoSwitchLockedUntil
                        ? resolveAutoSwitchLockLabel(account.autoSwitchLockedUntil, now, props.lang)
                        : copy.lockAutoSwitchBtn
                    }
                    aria-haspopup={account.autoSwitchLockedUntil ? undefined : "dialog"}
                    aria-expanded={account.autoSwitchLockedUntil ? undefined : lockDialogOpen}
                    onClick={() => {
                      if (account.autoSwitchLockedUntil) {
                        props.onSetAutoSwitchLock(0);
                        return;
                      }
                      setLockMinutes(resolveLockMinutes(settings.autoSwitchLockMinutes));
                      setLockDialogOpen(true);
                    }}
                  >
                    {resolveAutoSwitchLockLabel(account.autoSwitchLockedUntil, now, props.lang)}
                  </ActionButton>
                  {!account.autoSwitchLockedUntil && lockDialogOpen
                    ? createPortal(
                        <div
                          ref={lockPopoverContentRef}
                          class="claim-popover claim-popover-portal auto-switch-lock-popover"
                          role="dialog"
                          aria-label={resolveLockDialogText("title", props.lang)}
                          style={{ top: `${lockPopoverPosition.top}px`, right: `${lockPopoverPosition.right}px` }}
                        >
                          <div class="claim-popover-head">
                            <div class="claim-popover-title">{resolveLockDialogText("title", props.lang)}</div>
                            <button
                              class="claim-popover-close"
                              type="button"
                              aria-label={resolveLockDialogText("cancel", props.lang)}
                              onClick={() => setLockDialogOpen(false)}
                            >
                              ×
                            </button>
                          </div>
                          <form
                            class="auto-switch-lock-form"
                            onSubmit={(event) => {
                              event.preventDefault();
                              const minutes = Math.max(1, Math.min(120, Math.round(lockMinutes)));
                              props.onSetAutoSwitchLock(minutes);
                              setLockDialogOpen(false);
                            }}
                          >
                            <label class="auto-switch-lock-field">
                              <span>{resolveLockDialogText("minutes", props.lang)}</span>
                              <input
                                class="modal-input"
                                type="number"
                                min="1"
                                max="120"
                                step="1"
                                value={lockMinutes}
                                onInput={(event) => setLockMinutes(event.currentTarget.valueAsNumber || 1)}
                              />
                            </label>
                            <div class="claim-popover-actions">
                              <button
                                class="claim-popover-action is-secondary"
                                type="button"
                                onClick={() => setLockDialogOpen(false)}
                              >
                                {resolveLockDialogText("cancel", props.lang)}
                              </button>
                              <button class="claim-popover-action is-primary" type="submit">
                                {resolveLockDialogText("apply", props.lang)}
                              </button>
                            </div>
                          </form>
                        </div>,
                        document.body
                      )
                    : null}
                </div>
              ) : null}
              {hasAccounts ? (
                <div class="overview-more-wrap" ref={moreRef}>
                  <ActionButton
                    class="toolbar-btn"
                    icon={<span class="overview-action-symbol">⋯</span>}
                    label={resolveOverviewToolbarLabel("more", props.lang)}
                    disabled={props.disabled}
                    onClick={() => setMoreOpen((open) => !open)}
                  >
                    {resolveOverviewToolbarLabel("more", props.lang)}
                  </ActionButton>
                  {moreOpen ? (
                    <div class="claim-popover overview-more-menu" role="menu">
                      <div class="claim-popover-title">{resolveOverviewToolbarLabel("more", props.lang)}</div>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMoreOpen(false);
                          props.onSwitchAccount();
                        }}
                      >
                        ⇄ {resolveOverviewMenuLabel("switch", props.lang)}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMoreOpen(false);
                          props.onReloadAccount();
                        }}
                      >
                        ↻ {resolveOverviewMenuLabel("reload", props.lang)}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMoreOpen(false);
                          props.onRefreshQuota();
                        }}
                      >
                        ◌ {resolveOverviewMenuLabel("quota", props.lang)}
                      </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setMoreOpen(false);
                              props.onSetRegistryOverride(!settings.encryptedSyncRegistryOverrideEnabled);
                            }}
                          >
                        🛟 {resolveOverviewMenuLabel(settings.encryptedSyncRegistryOverrideEnabled ? "rescueOff" : "rescue", props.lang)}
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function resolveLockDialogText(key: "title" | "minutes" | "apply" | "cancel", lang: DashboardState["lang"]): string {
  const zh = lang === "zh";
  const hant = lang === "zh-hant";
  const copy = {
    title: zh ? "锁定自动切换" : hant ? "鎖定自動切換" : "Lock Auto Switch",
    minutes: zh ? "锁定分钟数" : hant ? "鎖定分鐘數" : "Minutes",
    apply: zh ? "应用" : hant ? "套用" : "Apply",
    cancel: zh ? "取消" : hant ? "取消" : "Cancel"
  };
  return copy[key];
}

function resolveAutoSwitchLockLabel(
  lockedUntil: number | undefined,
  now: number,
  lang: DashboardState["lang"]
): string {
  if (!lockedUntil) return resolveOverviewToolbarLabel("lock", lang);
  const minutes = Math.max(1, Math.ceil((lockedUntil - now) / 60_000));
  const remaining = minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  const unlock = lang === "zh" ? "解锁" : lang === "zh-hant" ? "解鎖" : "Unlock";
  return `${unlock} · ${remaining}`;
}

export type UsageEvent = { at: number; accountId: string; used: number };
type UsageGraphRange = "1h" | "3h" | "6h" | "24h" | "7d";
const USAGE_GRAPH_COLORS = ["#58a6ff", "#3fb950", "#d29922", "#bc8cff", "#f778ba", "#f0883e"];
const USAGE_DEVICE_COLORS = ["#79c0ff", "#56d364", "#e3b341", "#d2a8ff", "#ff7bce", "#ffa657"];
const USAGE_GRAPH_MAX_COLOR_KEYS = 6;
const USAGE_GRAPH_MINUTE_MS = 60_000;
const USAGE_GRAPH_MAX_DISTRIBUTION_MINUTES = 60;
const USAGE_GRAPH_RANGES: Array<{ key: UsageGraphRange; label: string; durationMs: number }> = [
  { key: "1h", label: "1H", durationMs: 60 * 60 * 1000 },
  { key: "3h", label: "3H", durationMs: 3 * 60 * 60 * 1000 },
  { key: "6h", label: "6H", durationMs: 6 * 60 * 60 * 1000 },
  { key: "24h", label: "24H", durationMs: 24 * 60 * 60 * 1000 },
  { key: "7d", label: "7D", durationMs: 7 * 24 * 60 * 60 * 1000 }
];
const USAGE_GRAPH_VIEWBOX_HEIGHT = 56;
const USAGE_GRAPH_BASELINE = 52;
const USAGE_GRAPH_MAX_BAR_HEIGHT = 42;

function UsageGraph(props: {
  history: DashboardUsageSample[];
  accounts: DashboardAccountViewModel[];
  now: number;
  privacyMode: boolean;
  lang: DashboardState["lang"];
}) {
  const [range, setRange] = useState<UsageGraphRange>("1h");
  const [windowOffset, setWindowOffset] = useState(0);
  const accountMap = new Map(
    props.accounts.map((account, index) => [
      account.id,
      {
        label: getSensitiveDisplayValue(account.email, props.privacyMode, "email"),
        color: USAGE_GRAPH_COLORS[index % USAGE_GRAPH_COLORS.length],
        device: account.runningDeviceName,
        deviceColor: account.runningDeviceName ? colorForUsageDevice(account.runningDeviceName) : undefined
      }
    ])
  );
  const rangeDuration = USAGE_GRAPH_RANGES.find((candidate) => candidate.key === range)?.durationMs ?? 60 * 60 * 1000;
  const oldestHistoryAt = props.history.reduce(
    (oldest, sample) => Math.min(oldest, sample.at),
    Number.POSITIVE_INFINITY
  );
  const graphEndAt = props.now - windowOffset * rangeDuration;
  const graphStartAt = graphEndAt - rangeDuration;
  const graphAxisMode: "time" | "date" = range.endsWith("h") ? "time" : "date";
  const visibleHistory = selectUsageHistoryWindow(props.history, graphStartAt, graphEndAt);
  const bucketCount = resolveUsageGraphBucketCount(range);
  const events = aggregateUsageEvents(
    buildUsageEvents(visibleHistory).filter((event) => event.at >= graphStartAt && event.at <= graphEndAt),
    graphStartAt,
    rangeDuration,
    bucketCount
  );
  const eventAccountIds = new Set(events.map((event) => event.accountId));
  const legendSource = props.accounts.filter((account) => !eventAccountIds.size || eventAccountIds.has(account.id));
  const legendAccounts = legendSource
    .slice(0, USAGE_GRAPH_MAX_COLOR_KEYS)
    .map((account) => ({ id: account.id, ...accountMap.get(account.id)! }));
  const hiddenLegendAccountCount = Math.max(0, legendSource.length - legendAccounts.length);
  const maxUsage = Math.max(1, ...events.map((event) => event.used));
  const timeSpan = rangeDuration;
  const graphWidth = 100;
  // Purely proportional sizing: the SVG stretches to its container, and bar
  // width follows the selected range density without fixed min/max values.
  const barWidth = events.length ? (graphWidth / Math.max(bucketCount, events.length)) * 0.58 : 0;
  const eventOffsets = buildUsageEventOffsets(events, barWidth);
  const canGoOlder = Number.isFinite(oldestHistoryAt) && oldestHistoryAt < graphStartAt;
  const canGoNewer = windowOffset > 0;
  const axisTop = `${formatUsageValue(maxUsage)}`;
  // A few large drops can otherwise flatten all of the smaller changes. Use a
  // gentle square-root lift for bar heights while retaining the real values in
  // the axis labels and hover details.
  const axisMid = `${formatUsageValue(maxUsage / 4)}`;
  return (
    <div class="usage-graph-card">
      <div class="usage-graph-head">
        <div class="usage-graph-title">
          <span>{props.lang === "zh" ? "配额" : "Qouta"}</span>
          {legendAccounts.length ? (
            <span
              class="usage-graph-color-key"
              aria-label={props.lang === "zh" ? "账号和电脑颜色标识" : "Account and computer color key"}
            >
              {legendAccounts.map((account) => {
                const title = account.device ? `${account.label} · ${account.device}` : account.label;
                return (
                  <i
                    key={account.id}
                    class="usage-graph-color-chip"
                    style={{
                      background: account.deviceColor
                        ? `linear-gradient(90deg, ${account.color} 0 50%, ${account.deviceColor} 50% 100%)`
                        : account.color,
                      borderColor: account.deviceColor ?? account.color
                    }}
                    role="img"
                    aria-label={title}
                    title={title}
                  ></i>
                );
              })}
              {hiddenLegendAccountCount ? <small>+{hiddenLegendAccountCount}</small> : null}
            </span>
          ) : null}
        </div>
        <div class="usage-graph-controls">
          <div class="usage-graph-ranges" aria-label={props.lang === "zh" ? "图表时间范围" : "Graph time range"}>
            {USAGE_GRAPH_RANGES.map((candidate) => (
              <button
                key={candidate.key}
                class={candidate.key === range ? "active" : ""}
                type="button"
                aria-pressed={candidate.key === range}
                onClick={() => {
                  setRange(candidate.key);
                  setWindowOffset(0);
                }}
              >
                {candidate.label}
              </button>
            ))}
          </div>
          <div class="usage-graph-navigation">
            <button
              type="button"
              disabled={!canGoOlder}
              title={props.lang === "zh" ? "较早时间" : "Older period"}
              aria-label={props.lang === "zh" ? "较早时间" : "Older period"}
              onClick={() => {
                setWindowOffset((current) => current + 1);
              }}
            >
              ‹
            </button>
            <button
              type="button"
              disabled={!canGoNewer}
              title={props.lang === "zh" ? "较新时间" : "Newer period"}
              aria-label={props.lang === "zh" ? "较新时间" : "Newer period"}
              onClick={() => {
                setWindowOffset((current) => Math.max(0, current - 1));
              }}
            >
              ›
            </button>
          </div>
        </div>
      </div>
      <div class="usage-graph-stage">
        <div class="usage-graph-axis" aria-hidden="true">
          <span>{axisTop}</span>
          <span>{axisMid}</span>
          <span>0</span>
        </div>
        <div class="usage-graph-scroll">
          <div class="usage-graph-scroll-content">
            <svg
              class="usage-graph"
              viewBox={`0 0 ${graphWidth} ${USAGE_GRAPH_VIEWBOX_HEIGHT}`}
              preserveAspectRatio="none"
              role="img"
              aria-label={props.lang === "zh" ? "配额使用" : "Quota usage"}
            >
              {[10, 31, 52].map((y) => (
                <line key={y} x1="0" y1={y} x2={graphWidth} y2={y} class="usage-graph-gridline" />
              ))}
              {events.map((event, index) => {
                const account = accountMap.get(event.accountId) ?? {
                  label: props.lang === "zh" ? "未知账号" : "Unknown account",
                  color: "#8b949e",
                  device: undefined,
                  deviceColor: undefined
                };
                const timePosition =
                  timeSpan > 0 ? (event.at - graphStartAt) / timeSpan : index / Math.max(events.length, 1);
                const offset = eventOffsets.get(`${event.accountId}-${event.at}-${index}`) ?? 0;
                const x = Math.max(
                  0,
                  Math.min(graphWidth - barWidth, timePosition * graphWidth + offset - barWidth / 2)
                );
                const normalizedUsage = Math.max(0, Math.min(1, event.used / maxUsage));
                const height = Math.max(3, Math.sqrt(normalizedUsage) * USAGE_GRAPH_MAX_BAR_HEIGHT);
                const y = USAGE_GRAPH_BASELINE - height;
                const ariaLabel = `${account.label}: ${formatUsageValue(event.used)} ${props.lang === "zh" ? "配额使用" : "quota used"}, ${formatGraphTime(event.at, props.lang, graphAxisMode)}`;
                return (
                  <rect
                    key={`${event.accountId}-${event.at}`}
                    class="usage-graph-bar"
                    x={x}
                    y={y}
                    width={barWidth}
                    height={height}
                    rx={barWidth * 0.28}
                    fill={account.color}
                    style={{ animationDelay: `${(index % 10) * 110}ms` }}
                    tabIndex={0}
                    aria-label={ariaLabel}
                    title={ariaLabel}
                  >
                    <title>{ariaLabel}</title>
                  </rect>
                );
              })}
            </svg>
            <div class="usage-graph-time-axis" aria-hidden="true">
              {[0, 0.5, 1].map((position) => (
                <span
                  key={position}
                  class={`${position === 0 ? "is-start" : position === 1 ? "is-end" : ""}`}
                  style={{ left: `${position * 100}%` }}
                >
                  {formatGraphTime(graphStartAt + timeSpan * position, props.lang, graphAxisMode)}
                </span>
              ))}
            </div>
          </div>
        </div>
        {!events.length ? (
          <div class="usage-graph-empty">
            {props.lang === "zh" ? "尚未检测到配额下降" : "No quota decrease detected yet"}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function selectUsageHistoryWindow(
  history: DashboardUsageSample[],
  startAt: number,
  endAt: number
): DashboardUsageSample[] {
  const baselineByAccount = new Map<string, DashboardUsageSample>();
  const selected: DashboardUsageSample[] = [];
  for (const sample of [...history].sort((left, right) => left.at - right.at)) {
    if (sample.at < startAt) {
      baselineByAccount.set(sample.accountId, sample);
    } else if (sample.at <= endAt) {
      selected.push(sample);
    }
  }
  return [...baselineByAccount.values(), ...selected].sort((left, right) => left.at - right.at);
}

export function buildUsageEvents(history: DashboardUsageSample[]): UsageEvent[] {
  const previousByAccount = new Map<string, DashboardUsageSample>();
  const events: UsageEvent[] = [];
  for (const sample of [...history].sort((left, right) => left.at - right.at)) {
    const previous = previousByAccount.get(sample.accountId);
    previousByAccount.set(sample.accountId, sample);
    if (!previous) continue;
    const drops = (["hourly", "weekly", "review"] as const).map((key) =>
      typeof previous[key] === "number" && typeof sample[key] === "number"
        ? Math.max(0, previous[key] - sample[key])
        : 0
    );
    const used = Math.max(...drops);
    if (used <= 0) {
      continue;
    }

    const elapsedMinutes = Math.max(1, Math.round((sample.at - previous.at) / USAGE_GRAPH_MINUTE_MS));
    if (elapsedMinutes > USAGE_GRAPH_MAX_DISTRIBUTION_MINUTES) {
      events.push({ at: sample.at, accountId: sample.accountId, used });
      continue;
    }

    // A quota API snapshot only tells us the total change since the previous
    // refresh. Interpolate ordinary refresh intervals so the one-hour chart
    // communicates an estimated per-minute rate instead of a false end spike.
    const usedPerMinute = used / elapsedMinutes;
    const elapsedMs = sample.at - previous.at;
    for (let minute = 1; minute <= elapsedMinutes; minute += 1) {
      events.push({
        at: previous.at + (elapsedMs * minute) / elapsedMinutes,
        accountId: sample.accountId,
        used: usedPerMinute
      });
    }
  }
  return events;
}

function aggregateUsageEvents(
  events: UsageEvent[],
  graphStartAt: number,
  rangeDuration: number,
  bucketCount: number
): UsageEvent[] {
  if (events.length < 2 || rangeDuration <= 0) {
    return events;
  }

  const bucketDuration = rangeDuration / bucketCount;
  const grouped = new Map<string, UsageEvent>();
  for (const event of events) {
    const bucket = Math.max(0, Math.min(bucketCount - 1, Math.floor((event.at - graphStartAt) / bucketDuration)));
    const key = `${event.accountId}:${bucket}`;
    const current = grouped.get(key);
    grouped.set(key, {
      at: current ? Math.max(current.at, event.at) : event.at,
      accountId: event.accountId,
      used: (current?.used ?? 0) + event.used
    });
  }
  return [...grouped.values()].sort((left, right) => left.at - right.at);
}

export function resolveUsageGraphBucketCount(range: UsageGraphRange): number {
  switch (range) {
    case "1h":
      return 60;
    case "3h":
      return 30;
    case "6h":
      return 36;
    case "24h":
      return 48;
    case "7d":
      return 56;
  }
}

/**
 * Keep events with the same sample timestamp individually visible. Without
 * this small deterministic spread, multiple accounts changing in one snapshot
 * render as a single opaque block at exactly the same x coordinate.
 */
function buildUsageEventOffsets(events: UsageEvent[], barWidth: number): Map<string, number> {
  const grouped = new Map<number, number[]>();
  events.forEach((event, index) => {
    const indexes = grouped.get(event.at) ?? [];
    indexes.push(index);
    grouped.set(event.at, indexes);
  });

  const offsets = new Map<string, number>();
  for (const indexes of grouped.values()) {
    if (indexes.length < 2) {
      continue;
    }
    indexes.forEach((index, position) => {
      offsets.set(
        `${events[index]!.accountId}-${events[index]!.at}-${index}`,
        (position - (indexes.length - 1) / 2) * barWidth * 0.82
      );
    });
  }
  return offsets;
}

function formatUsageValue(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded}%`;
}

function colorForUsageDevice(deviceName: string): string {
  let hash = 0;
  for (let index = 0; index < deviceName.length; index += 1) {
    hash = (hash * 31 + deviceName.charCodeAt(index)) >>> 0;
  }
  return USAGE_DEVICE_COLORS[hash % USAGE_DEVICE_COLORS.length]!;
}

function formatGraphTime(timestamp: number, lang: DashboardState["lang"], mode: "time" | "date" = "time"): string {
  return new Date(timestamp).toLocaleString(lang === "zh" ? "zh-CN" : lang === "zh-hant" ? "zh-TW" : undefined, {
    ...(mode === "date" ? { month: "2-digit", day: "2-digit" } : { hour: "2-digit", minute: "2-digit" }),
    hour12: mode === "time"
  });
}

function OverviewSessionValue(props: { label: string; value: string; title: string }) {
  return (
    <div class="overview-session-value">
      <span class="grid-label">{props.label}</span>
      <span class="meta-value" title={props.title}>
        {props.value}
      </span>
    </div>
  );
}

function resolveUsageDurationTitle(lang: DashboardState["lang"]): string {
  if (lang === "zh") {
    return "当前会话 / 此账号累计使用时长";
  }
  if (lang === "zh-hant") {
    return "目前工作階段 / 此帳號累計使用時長";
  }
  return "Current session / total usage for this account";
}

function resolveSyncNowLabel(lang: DashboardState["lang"]): string {
  return lang === "zh" ? "立即同步账号" : lang === "zh-hant" ? "立即同步帳號" : "Sync accounts now";
}

export function resolveOverviewRefreshMode(encryptedSyncEnabled: boolean): "sync" | "quota" {
  return encryptedSyncEnabled ? "sync" : "quota";
}

export function resolveOverviewToolbarActionCount(
  hasAccounts: boolean,
  _hasActiveAccount: boolean,
  _rescueOverrideEnabled: boolean
): number {
  if (hasAccounts) return 4;
  return 2;
}

export function resolveOverviewToolbarLabel(
  action: "add" | "import" | "sync" | "setup" | "refresh" | "lock" | "more" | "disableRescue",
  lang: DashboardState["lang"]
): string {
  const values = {
    en: {
      add: "Add",
      import: "Import",
      sync: "Sync",
      setup: "Set Up",
      refresh: "Refresh",
      lock: "Lock",
      more: "More",
      disableRescue: "Rescue"
    },
    zh: {
      add: "添加",
      import: "导入",
      sync: "同步",
      setup: "设置",
      refresh: "刷新",
      lock: "锁定",
      more: "更多",
      disableRescue: "关闭救援"
    },
    "zh-hant": {
      add: "新增",
      import: "匯入",
      sync: "同步",
      setup: "設定",
      refresh: "重新整理",
      lock: "鎖定",
      more: "更多",
      disableRescue: "關閉救援"
    }
  } as const;
  const locale = lang === "zh" || lang === "zh-hant" ? lang : "en";
  return values[locale][action];
}

export function resolveResetQuotaNoticeTitle(lang: DashboardState["lang"], weeklyPercent: string): string {
  if (lang === "zh") return `每周配额剩余：${weeklyPercent} · 可用重置次数`;
  if (lang === "zh-hant") return `每週配額剩餘：${weeklyPercent} · 可用重置次數`;
  return `Weekly quota remaining: ${weeklyPercent} · reset available`;
}

function resolveResetQuotaNoticeSub(lang: DashboardState["lang"], autoSwitchEnabled: boolean): string {
  if (lang === "zh") return autoSwitchEnabled ? "自动切号已启用，也可以立即重置使用量。" : "切换账号继续，或立即重置使用量。";
  if (lang === "zh-hant") return autoSwitchEnabled ? "自動切換已啟用，也可以立即重置使用量。" : "切換帳號繼續，或立即重置使用量。";
  return autoSwitchEnabled
    ? "Auto-switch is enabled; you can also reset usage now."
    : "Switch accounts to continue, or reset usage now.";
}

function resolveResetQuotaSwitchLabel(lang: DashboardState["lang"]): string {
  if (lang === "zh") return "切换账号";
  if (lang === "zh-hant") return "切換帳號";
  return "Switch";
}

function resolveOverviewMenuLabel(action: "switch" | "reload" | "quota" | "rescue" | "rescueOff", lang: DashboardState["lang"]): string {
  const values = {
    en: { switch: "Switch account", reload: "Reload window", quota: "Refresh quota", rescue: "Enable rescue", rescueOff: "Disable rescue" },
    zh: { switch: "切换账号", reload: "重新加载窗口", quota: "刷新配额", rescue: "开启救援", rescueOff: "关闭救援" },
    "zh-hant": { switch: "切換帳號", reload: "重新載入視窗", quota: "重新整理配額", rescue: "開啟救援", rescueOff: "關閉救援" }
  } as const;
  return values[lang === "zh" || lang === "zh-hant" ? lang : "en"][action];
}

function resolveQuotaRefreshLabel(lang: DashboardState["lang"]): string {
  if (lang === "zh") return "刷新配额";
  if (lang === "zh-hant") return "重新整理配額";
  return "Quota Refresh";
}

function resolveConfigureSyncLabel(lang: DashboardState["lang"]): string {
  return lang === "zh" ? "设置加密同步" : lang === "zh-hant" ? "設定加密同步" : "Set up encrypted sync";
}

function formatCompactDate(timestamp: number | undefined, lang: DashboardState["lang"], fallback: string): string {
  if (timestamp == null) return fallback;
  return new Date(timestamp).toLocaleDateString(lang === "zh" ? "zh-CN" : lang === "zh-hant" ? "zh-TW" : undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function formatResetCreditsTitle(account: DashboardAccountViewModel, copy: DashboardCopy): string {
  const count = account.resetCreditsAvailable ?? 0;
  const base = `${copy.resetCreditsBtn}: ${count}`;
  return account.resetCreditsNextExpiresAt
    ? `${base} · ${formatTimestamp(account.resetCreditsNextExpiresAt * 1000, copy.never)}`
    : base;
}

function resolveOverviewLabel(
  key: "subscription" | "workspace" | "session" | "login",
  lang: DashboardState["lang"]
): string {
  if (key === "session") return lang === "zh" ? "时长" : lang === "zh-hant" ? "時長" : "Duration";
  if (key === "login") return lang === "zh" ? "登录日期" : lang === "zh-hant" ? "登入日期" : "Login date";
  if (key === "subscription") {
    if (lang === "zh") {
      return "订阅到期";
    }
    if (lang === "zh-hant") {
      return "訂閱到期";
    }
    return "Subscription";
  }

  if (lang === "zh") {
    return "工作空间";
  }
  if (lang === "zh-hant") {
    return "工作空間";
  }
  return "Workspace";
}
