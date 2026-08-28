import { createPortal } from "preact/compat";
import { useEffect, useRef, useState } from "preact/hooks";
import type {
  DashboardAccountViewModel,
  DashboardCopy,
  DashboardSettings,
  DashboardState
} from "../../src/domain/dashboard/types";
import type { CodexDailyUsageBreakdown } from "../../src/core/types";
import type { DashboardUsageSample } from "../../src/domain/dashboard/types";
import {
  formatRelativeTimestamp,
  formatTimestamp,
  getSensitiveDisplayValue,
  renderTagList,
  resolveLockMinutes
} from "./helpers";
import { formatAccountUsageDuration } from "../../src/utils/accountUsage";
import { ActionButton } from "./primitives";
import { MetricGauge } from "./accountMetricPrimitives";
import { AccountAccessIcon, renderRefreshIcon, renderReloadIcon, renderSwitchIcon, ResetCreditIcon } from "./icons";
import { compareDashboardAutoQueueAccounts, hasDashboardAutoQueueCapability } from "./accountSorting";
import { canRunAccountOnThisPc } from "./accountRunPolicy";

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
  metricPriority?: string;
  usageHistory?: DashboardUsageSample[];
  dailyUsage?: CodexDailyUsageBreakdown;
  dailyUsagePending?: boolean;
  dailyUsageError?: string;
  onLoadDailyUsage?: () => void;
  onSetAutoSwitchLock: (minutes: number) => void;
  onAddAccount: () => void;
  onRefreshAll: () => void;
  onConfigureSync: () => void;
  onSyncNow: () => void;
  syncPending: boolean;
  registryOverridePending: boolean;
  onSetRegistryOverride: (enabled: boolean) => void;
  onConsumeResetCredit: () => void;
  onSwitchAccount: (accountId?: string) => void;
  onReloadAccount: () => void;
  onRefreshQuota: () => void;
  showCliSessions?: boolean;
  onOpenCliSessions?: () => void;
}) {
  const { account, copy, settings, now, hasAccounts, privacyMode } = props;
  const emptyTitle = hasAccounts ? copy.noActiveAccountTitle : copy.empty;
  const emptySub = hasAccounts ? copy.noActiveAccountSub : copy.savedAccountsSub;
  const teamNameDisplay =
    account?.isTeamWorkspace && account.accountName?.trim()
      ? getSensitiveDisplayValue(account.accountName, privacyMode, "name", account.accountName)
      : undefined;
  const hasResetCredit = (account?.resetCreditsAvailable ?? 0) > 0;
  const refreshMode = resolveOverviewRefreshMode(settings.encryptedSyncEnabled);
  const toolbarActionCount = resolveOverviewToolbarActionCount(
    hasAccounts,
    Boolean(account),
    settings.encryptedSyncRegistryOverrideEnabled
  );
  const [lockDialogOpen, setLockDialogOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [lockMinutes, setLockMinutes] = useState(() => resolveLockMinutes(settings.autoSwitchLockMinutes));
  const lockPopoverContentRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const morePopoverContentRef = useRef<HTMLDivElement>(null);
  const [lockPopoverPosition] = useState({ top: 0, right: 0 });
  const [morePopoverPosition, setMorePopoverPosition] = useState({ top: 0, right: 0 });
  const switchTarget = account && props.accounts
    ? props.accounts
        .filter(
          (candidate) =>
            !candidate.isActive &&
            hasDashboardAutoQueueCapability(candidate) &&
            canRunAccountOnThisPc(candidate, props.disabled, settings.encryptedSyncRegistryOverrideEnabled)
        )
        .sort(compareDashboardAutoQueueAccounts)[0]
    : undefined;
  const contextAction = account
    ? resolveOverviewContextAction(account, settings.encryptedSyncRegistryOverrideEnabled)
    : "switch";
  const toggleMoreMenu = (): void => {
    if (!moreOpen) {
      const rect = moreRef.current?.getBoundingClientRect();
      if (rect) setMorePopoverPosition(resolveOverviewPopoverPosition(rect, window.innerWidth));
    }
    setMoreOpen((open) => !open);
  };
  useEffect(() => {
    if (!moreOpen) return;
    const updatePosition = (): void => {
      const rect = moreRef.current?.getBoundingClientRect();
      if (rect) setMorePopoverPosition(resolveOverviewPopoverPosition(rect, window.innerWidth));
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [moreOpen]);
  useEffect(() => {
    if (!moreOpen) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!moreRef.current?.contains(target) && !morePopoverContentRef.current?.contains(target)) setMoreOpen(false);
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
      if (!lockPopoverContentRef.current?.contains(target)) setLockDialogOpen(false);
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
        .filter((metric) => metric.visible && typeof metric.percentage === "number")
        .sort((left, right) => {
          const priority = (key: string): number =>
            props.metricPriority && key.includes(props.metricPriority) ? 0 : key.includes("weekly") ? 1 : 2;
          return priority(left.key) - priority(right.key);
        })
    : [];

  return (
    <>
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
                      <span>{resolveResetCreditBadgeLabel(props.lang)} {account.resetCreditsAvailable}</span>
                    </button>
                  ) : null}
                </div>
              </div>
              {teamNameDisplay ? <div class="overview-account-workspace">{teamNameDisplay}</div> : null}
              {account.tags.length ? <div class="account-tag-row">{renderTagList(account.tags)}</div> : null}
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
            dailyUsage={props.dailyUsage}
            dailyUsagePending={props.dailyUsagePending}
            dailyUsageError={props.dailyUsageError}
            onLoadDailyUsage={props.onLoadDailyUsage}
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
                <ActionButton
                  class="toolbar-btn"
                  icon={
                    contextAction === "reload" ? renderReloadIcon() : contextAction === "switch" ? renderSwitchIcon() : <span class="overview-action-symbol">🛟</span>
                  }
                  label={resolveOverviewContextLabel(contextAction, props.lang)}
                  disabled={props.disabled || (contextAction === "switch" && !switchTarget)}
                  pending={contextAction === "reload" ? false : contextAction === "rescue" ? props.registryOverridePending : false}
                  onClick={() => {
                    if (contextAction === "reload") props.onReloadAccount();
                    else if (contextAction === "rescue") props.onSetRegistryOverride(true);
                    else if (switchTarget) props.onSwitchAccount(switchTarget.id);
                  }}
                >
                  {resolveOverviewContextLabel(contextAction, props.lang)}
                </ActionButton>
              ) : null}
              {account ? (
                <div class="overview-more-wrap" ref={moreRef}>
                  <ActionButton
                    class="toolbar-btn"
                    icon={<span class="overview-action-symbol">⋯</span>}
                    label={resolveOverviewToolbarLabel("more", props.lang)}
                    disabled={props.disabled}
                    aria-haspopup="menu"
                    aria-expanded={moreOpen}
                    onClick={toggleMoreMenu}
                  >
                    {resolveOverviewToolbarLabel("more", props.lang)}
                  </ActionButton>
                  {moreOpen
                    ? createPortal(
                        <div
                          ref={morePopoverContentRef}
                          class="claim-popover claim-popover-portal overview-more-menu"
                          role="menu"
                          aria-label={resolveOverviewToolbarLabel("more", props.lang)}
                          style={{ top: `${morePopoverPosition.top}px`, right: `${morePopoverPosition.right}px` }}
                        >
                          <div class="claim-popover-title">{resolveOverviewToolbarLabel("more", props.lang)}</div>
                          {contextAction !== "switch" ? (
                            <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); props.onSwitchAccount(switchTarget?.id); }} disabled={!switchTarget}>
                              ⇄ {resolveOverviewMenuLabel("switch", props.lang)}
                            </button>
                          ) : null}
                          {contextAction !== "reload" ? (
                            <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); props.onReloadAccount(); }}>
                              ↻ {resolveOverviewMenuLabel("reload", props.lang)}
                            </button>
                          ) : null}
                          <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); props.onRefreshQuota(); }}>
                            ◌ {resolveOverviewMenuLabel("quota", props.lang)}
                          </button>
                          {contextAction !== "rescue" ? (
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
                          ) : null}
                          {props.showCliSessions && props.onOpenCliSessions ? (
                            <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); props.onOpenCliSessions!(); }}>
                              ◉ Sessions
                            </button>
                          ) : null}
                        </div>,
                        document.body
                      )
                    : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
    {account ? (
      <LockDialog
        account={account}
        open={lockDialogOpen}
        position={lockPopoverPosition}
        lang={props.lang}
        lockMinutes={lockMinutes}
        setLockMinutes={setLockMinutes}
        onSetAutoSwitchLock={props.onSetAutoSwitchLock}
        onClose={() => setLockDialogOpen(false)}
        contentRef={lockPopoverContentRef}
      />
    ) : null}
    </>
  );
}

export function resolveOverviewContextAction(
  account: Pick<DashboardAccountViewModel, "isActive" | "isCurrentWindowAccount" | "runningDeviceName" | "runningOnThisDevice">,
  registryOverrideEnabled: boolean
): "switch" | "reload" | "rescue" {
  if (account.isActive && !account.isCurrentWindowAccount) return "reload";
  if (account.runningDeviceName && !account.runningOnThisDevice && !registryOverrideEnabled) return "rescue";
  return "switch";
}

export function resolveOverviewContextLabel(action: "switch" | "reload" | "rescue", lang: DashboardState["lang"]): string {
  if (lang === "zh") return action === "switch" ? "切换" : action === "reload" ? "重载" : "救援";
  if (lang === "zh-hant") return action === "switch" ? "切換" : action === "reload" ? "重載" : "救援";
  return action === "switch" ? "Switch" : action === "reload" ? "Reload" : "Rescue";
}

/*
 * The lock dialog is rendered below the toolbar markup. Keep it separate from
 * the compact contextual action row so Lock remains available through More.
 */
function LockDialog(props: {
  account: DashboardAccountViewModel;
  open: boolean;
  position: { top: number; right: number };
  lang: DashboardState["lang"];
  lockMinutes: number;
  setLockMinutes: (minutes: number) => void;
  onSetAutoSwitchLock: (minutes: number) => void;
  onClose: () => void;
  contentRef: preact.RefObject<HTMLDivElement>;
}) {
  return props.open && !props.account.autoSwitchLockedUntil
    ? createPortal(
        <div
          ref={props.contentRef}
          class="claim-popover claim-popover-portal auto-switch-lock-popover"
          role="dialog"
          aria-label={resolveLockDialogText("title", props.lang)}
          style={{ top: `${props.position.top}px`, right: `${props.position.right}px` }}
        >
                          <div class="claim-popover-head">
                            <div class="claim-popover-title">{resolveLockDialogText("title", props.lang)}</div>
                            <button
                              class="claim-popover-close"
                              type="button"
                              aria-label={resolveLockDialogText("cancel", props.lang)}
                              onClick={props.onClose}
                            >
                              ×
                            </button>
                          </div>
                          <form
                            class="auto-switch-lock-form"
                            onSubmit={(event) => {
                              event.preventDefault();
                              const minutes = Math.max(1, Math.min(120, Math.round(props.lockMinutes)));
                              props.onSetAutoSwitchLock(minutes);
                              props.onClose();
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
                                value={props.lockMinutes}
                                onInput={(event) => props.setLockMinutes(event.currentTarget.valueAsNumber || 1)}
                              />
                            </label>
                            <div class="claim-popover-actions">
                              <button
                                class="claim-popover-action is-secondary"
                                type="button"
                                onClick={props.onClose}
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
                    : null;
}

export function resolveOverviewPopoverPosition(
  triggerRect: Pick<DOMRect, "bottom" | "right">,
  viewportWidth: number
): { top: number; right: number } {
  return {
    top: triggerRect.bottom + 5,
    right: Math.max(8, viewportWidth - triggerRect.right)
  };
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

export type UsageSegment = { key: string; used: number; color: string };
export type UsageEvent = { at: number; accountId: string; used: number; segments?: UsageSegment[] };
type UsageGraphRange = "1h" | "3h" | "6h" | "24h" | "7d" | "30d";
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
  { key: "7d", label: "7D", durationMs: 7 * 24 * 60 * 60 * 1000 },
  { key: "30d", label: "30D", durationMs: 30 * 24 * 60 * 60 * 1000 }
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
  dailyUsage?: CodexDailyUsageBreakdown;
  dailyUsagePending?: boolean;
  dailyUsageError?: string;
  onLoadDailyUsage?: () => void;
}) {
  const [range, setRange] = useState<UsageGraphRange>("1h");
  const [windowOffset, setWindowOffset] = useState(0);
  const [graphMode, setGraphMode] = useState<"quota" | "tokens">("quota");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hoveredEvent, setHoveredEvent] = useState<{ event: UsageEvent; label: string; left: number; top: number }>();
  useEffect(() => {
    if (graphMode === "tokens" && !props.dailyUsage && !props.dailyUsagePending && !props.dailyUsageError) {
      props.onLoadDailyUsage?.();
    }
  }, [graphMode, props.dailyUsage, props.dailyUsagePending, props.dailyUsageError, props.onLoadDailyUsage]);
  const graphStageRef = useRef<HTMLDivElement>(null);
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
  const availableRanges = USAGE_GRAPH_RANGES;
  const activeRange = availableRanges.some((candidate) => candidate.key === range) ? range : graphMode === "tokens" ? "30d" : "1h";
  const rangeDuration = USAGE_GRAPH_RANGES.find((candidate) => candidate.key === activeRange)?.durationMs ?? 60 * 60 * 1000;
  const tokenEvents: UsageEvent[] = (props.dailyUsage?.points ?? []).flatMap((point) => {
    const at = Date.parse(`${point.date}T12:00:00Z`);
    const accountId = props.accounts.find((account) => account.isActive)?.id ?? props.accounts[0]?.id;
    return Number.isFinite(at) && accountId && point.totalTokens >= 0
      ? [{ at, accountId, used: point.totalTokens, segments: buildDailyUsageSegments(point) }]
      : [];
  });
  const sourceEvents = graphMode === "tokens" ? tokenEvents : buildUsageEvents(props.history);
  const oldestHistoryAt = sourceEvents.reduce(
    (oldest, sample) => Math.min(oldest, sample.at),
    Number.POSITIVE_INFINITY
  );
  const graphEndAt = props.now - windowOffset * rangeDuration;
  const graphStartAt = graphEndAt - rangeDuration;
  const graphAxisMode: "time" | "date" = activeRange.endsWith("h") ? "time" : "date";
  const visibleHistory = selectUsageHistoryWindow(props.history, graphStartAt, graphEndAt);
  const bucketCount = resolveUsageGraphBucketCount(activeRange);
  const events = aggregateUsageEvents(
    (graphMode === "tokens" ? tokenEvents : buildUsageEvents(visibleHistory)).filter((event) => event.at >= graphStartAt && event.at <= graphEndAt),
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
           <span>{graphMode === "tokens" ? (props.lang === "zh" ? "每日用量" : "Daily usage") : props.lang === "zh" ? "配额" : "Quota"}</span>
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
            <select
              value={activeRange}
              aria-label={props.lang === "zh" ? "图表时间范围" : "Graph time range"}
              onChange={(event) => {
                setRange(event.currentTarget.value as UsageGraphRange);
                setWindowOffset(0);
              }}
            >
              {availableRanges.map((candidate) => <option key={candidate.key} value={candidate.key}>{candidate.label}</option>)}
            </select>
          </div>
          <div class="usage-graph-settings-wrap">
            <button type="button" class={settingsOpen ? "active" : ""} aria-label={props.lang === "zh" ? "图表设置" : "Graph settings"} title={props.lang === "zh" ? "图表设置" : "Graph settings"} onClick={() => setSettingsOpen((open) => !open)}>⚙</button>
            {settingsOpen ? (
              <div class="usage-graph-settings-popover" role="dialog">
                <strong>{props.lang === "zh" ? "数据" : "Data"}</strong>
                <button type="button" class={graphMode === "quota" ? "active" : ""} onClick={() => { setGraphMode("quota"); setRange("1h"); setWindowOffset(0); setSettingsOpen(false); }}>Quota changes</button>
                <button type="button" class={graphMode === "tokens" ? "active" : ""} onClick={() => { setGraphMode("tokens"); setRange("30d"); setWindowOffset(0); }}>Daily token usage</button>
                {props.dailyUsageError ? <span class="usage-graph-settings-error" role="alert">{props.dailyUsageError}</span> : null}
              </div>
            ) : null}
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
      <div class="usage-graph-stage" ref={graphStageRef} onMouseLeave={() => setHoveredEvent(undefined)}>
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
                const ariaLabel = graphMode === "tokens"
                  ? `${props.lang === "zh" ? "每日 token 用量" : "Daily token usage"}: ${formatUsageValue(event.used)} tokens, ${formatGraphTime(event.at, props.lang, graphAxisMode)}`
                  : `${account.label}: ${formatUsageValue(event.used)} ${props.lang === "zh" ? "配额使用" : "quota used"}, ${formatGraphTime(event.at, props.lang, graphAxisMode)}`;
                const segments = event.segments?.length ? event.segments : [{ key: "quota", used: event.used, color: account.color }];
                let segmentOffset = 0;
                return (
                  <g key={`${event.accountId}-${event.at}`}>
                    {segments.map((segment, segmentIndex) => {
                      const segmentHeight = height * (segment.used / Math.max(event.used, 1));
                      const segmentY = USAGE_GRAPH_BASELINE - segmentOffset - segmentHeight;
                      segmentOffset += segmentHeight;
                      return <rect key={`${segment.key}-${segmentIndex}`} class="usage-graph-bar" x={x} y={segmentY} width={barWidth} height={Math.max(1, segmentHeight)} rx={barWidth * 0.18} fill={segment.color} />;
                    })}
                    <rect
                      class="usage-graph-bar-hitarea"
                      x={x}
                      y={y}
                      width={barWidth}
                      height={height}
                      fill="transparent"
                      style={{ animationDelay: `${(index % 10) * 110}ms` }}
                      tabIndex={0}
                      aria-label={ariaLabel}
                      onMouseEnter={(pointerEvent) => {
                      const stage = graphStageRef.current?.getBoundingClientRect();
                      const bar = pointerEvent.currentTarget.getBoundingClientRect();
                      if (stage) {
                        setHoveredEvent({
                          event,
                          label: account.label,
                          left: ((bar.left + bar.width / 2 - stage.left) / stage.width) * 100,
                          top: Math.max(4, bar.top - stage.top - 8)
                        });
                      }
                    }}
                    onFocus={(focusEvent) => {
                      const stage = graphStageRef.current?.getBoundingClientRect();
                      const bar = focusEvent.currentTarget.getBoundingClientRect();
                      if (stage) {
                        setHoveredEvent({
                          event,
                          label: account.label,
                          left: ((bar.left + bar.width / 2 - stage.left) / stage.width) * 100,
                          top: Math.max(4, bar.top - stage.top - 8)
                        });
                      }
                    }}
                      onBlur={() => setHoveredEvent(undefined)}
                    />
                  </g>
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
        {hoveredEvent ? (
          <div
            class="usage-graph-tooltip"
            role="status"
            style={{ left: `${Math.min(96, Math.max(4, hoveredEvent.left))}%`, top: `${hoveredEvent.top}px` }}
          >
            <strong>{graphMode === "tokens" ? (props.lang === "zh" ? "每日 token 用量" : "Daily token usage") : hoveredEvent.label}</strong>
            <span>{formatUsageValue(hoveredEvent.event.used)} {graphMode === "tokens" ? "tokens" : props.lang === "zh" ? "配额使用" : "quota used"}</span>
            {graphMode === "tokens" && hoveredEvent.event.segments?.length ? (
              <div class="usage-graph-tooltip-breakdown">
                {hoveredEvent.event.segments.map((segment) => <span key={segment.key}><i style={{ background: segment.color }} />{segment.key}: {formatUsageValue(segment.used)}</span>)}
              </div>
            ) : null}
            <time>{formatGraphTime(hoveredEvent.event.at, props.lang, graphAxisMode)}</time>
          </div>
        ) : null}
        {!events.length ? (
          <div class="usage-graph-empty">
            {props.lang === "zh" ? "尚未检测到配额下降" : "No quota decrease detected yet"}
          </div>
        ) : null}
      </div>
      {graphMode === "tokens" && props.dailyUsage ? <DailyUsageBreakdown usage={props.dailyUsage} /> : null}
    </div>
  );
}

function DailyUsageBreakdown(props: { usage: CodexDailyUsageBreakdown }) {
  const points = props.usage.points;
  const sum = (key: keyof CodexDailyUsageBreakdown["points"][number]): number =>
    points.reduce((total, point) => total + (typeof point[key] === "number" ? (point[key] as number) : 0), 0);
  const items = ([
    ["Total", sum("totalTokens")],
    ["Extension", sum("extensionTokens")],
    ["Other", sum("otherTokens")],
    ["Input", sum("inputTokens")],
    ["Output", sum("outputTokens")],
    ["Cached", sum("cachedTokens")]
  ] as Array<[string, number]>).filter(([, value]) => value > 0);
  return items.length ? (
    <div class="usage-graph-breakdown" aria-label="Daily token usage breakdown">
      {items.map(([label, value]) => <span key={label}><strong>{label}</strong> {formatUsageValue(value)}</span>)}
    </div>
  ) : null;
}

function buildDailyUsageSegments(point: CodexDailyUsageBreakdown["points"][number]): UsageSegment[] {
  const surfaceEntries = Object.entries(point.surfaceValues ?? {})
    .filter(([, value]) => Number.isFinite(value) && value > 0)
    .map(([key, value], index) => ({ key: formatUsageSurfaceLabel(key), used: value, color: USAGE_GRAPH_COLORS[index % USAGE_GRAPH_COLORS.length] ?? "#58a6ff" }));
  if (surfaceEntries.length) return surfaceEntries;
  const fallback = [
    ["Input", point.inputTokens], ["Output", point.outputTokens], ["Cached", point.cachedTokens]
  ] as Array<[string, number | undefined]>;
  const segments = fallback.filter(([, value]) => typeof value === "number" && value > 0).map(([key, value], index) => ({ key, used: value as number, color: USAGE_GRAPH_COLORS[index % USAGE_GRAPH_COLORS.length] ?? "#58a6ff" }));
  return segments.length ? segments : [{ key: "Total", used: point.totalTokens, color: USAGE_GRAPH_COLORS[0] ?? "#58a6ff" }];
}

function formatUsageSurfaceLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "vscode" || normalized === "vs_code" || normalized === "visual_studio_code") return "Visual Studio Code";
  if (normalized === "work" || normalized === "chatgpt") return normalized === "work" ? "Work" : "ChatGPT";
  if (normalized === "codex" || normalized === "cli") return "Codex CLI";
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
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
    const mergedSegments = [...(current?.segments ?? []), ...(event.segments ?? [])];
    const segmentTotals = new Map<string, UsageSegment>();
    for (const segment of mergedSegments) {
      const previous = segmentTotals.get(segment.key);
      segmentTotals.set(segment.key, {
        key: segment.key,
        used: (previous?.used ?? 0) + segment.used,
        color: previous?.color ?? segment.color
      });
    }
    grouped.set(key, {
      at: current ? Math.max(current.at, event.at) : event.at,
      accountId: event.accountId,
      used: (current?.used ?? 0) + event.used,
      segments: segmentTotals.size ? [...segmentTotals.values()] : undefined
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
    case "30d":
      return 60;
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

export function resolveResetCreditBadgeLabel(lang: DashboardState["lang"]): string {
  if (lang === "zh") return "重置";
  if (lang === "zh-hant") return "重設";
  return "Reset";
}

function resolveOverviewMenuLabel(action: "switch" | "reload" | "quota" | "rescue" | "rescueOff" | "lock", lang: DashboardState["lang"]): string {
  const values = {
    en: { switch: "Switch", reload: "Reload", quota: "Quota", rescue: "Rescue", rescueOff: "Rescue off", lock: "Lock" },
    zh: { switch: "切换", reload: "重载", quota: "配额", rescue: "救援", rescueOff: "关闭救援", lock: "锁定" },
    "zh-hant": { switch: "切換", reload: "重載", quota: "配額", rescue: "救援", rescueOff: "關閉救援", lock: "鎖定" }
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
