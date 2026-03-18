import { render } from "preact";
import type { ComponentChildren } from "preact";
import { useEffect, useReducer } from "preact/hooks";
import type {
  DashboardAccountViewModel,
  DashboardActionName,
  DashboardClientMessage,
  DashboardCopy,
  DashboardHostMessage,
  DashboardMetricViewModel,
  DashboardSettingKey,
  DashboardSettings,
  DashboardState
} from "../../src/domain/dashboard/types";
import {
  DASHBOARD_LANGUAGE_OPTIONS,
  DASHBOARD_LANGUAGE_OPTION_LABELS,
  getIntlLocale,
  isDashboardLanguageOption
} from "../../src/localization/languages";

declare function acquireVsCodeApi(): {
  postMessage(message: DashboardClientMessage): void;
};

const AUTO_REFRESH_VALUES = [5, 10, 15, 30, 60];
const AUTO_SWITCH_VALUES = Array.from({ length: 20 }, (_, index) => index + 1);
const WARNING_VALUES = Array.from({ length: 18 }, (_, index) => 5 + index * 5);
const WARNING_SCALE_VALUES = [5, 20, 35, 50, 65, 80, 90];
type PendingActionRequest = {
  requestId: string;
  action: DashboardActionName;
  accountId?: string;
};

type AppState = {
  snapshot?: DashboardState;
  settingsOpen: boolean;
  privacyMode: boolean;
  lastEnabledAutoRefreshMinutes: number;
  now: number;
  pendingActions: PendingActionRequest[];
};

type AppAction =
  | { type: "snapshot"; snapshot: DashboardState }
  | { type: "open-settings" }
  | { type: "close-settings" }
  | { type: "toggle-privacy" }
  | { type: "settings-patch"; patch: Partial<DashboardSettings> }
  | { type: "tick"; now: number }
  | { type: "request-action"; request: PendingActionRequest }
  | { type: "resolve-action"; requestId: string };

const vscodeApi =
  typeof acquireVsCodeApi === "function"
    ? acquireVsCodeApi()
    : {
        postMessage(message: DashboardClientMessage): void {
          console.debug("[codex-tools] dashboard message", message);
        }
      };

function createInitialState(): AppState {
  return {
    settingsOpen: false,
    privacyMode: false,
    lastEnabledAutoRefreshMinutes: 15,
    now: Date.now(),
    pendingActions: []
  };
}

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "snapshot":
      return {
        ...state,
        snapshot: action.snapshot,
        lastEnabledAutoRefreshMinutes:
          action.snapshot.settings.autoRefreshMinutes > 0
            ? action.snapshot.settings.autoRefreshMinutes
            : state.lastEnabledAutoRefreshMinutes
      };
    case "open-settings":
      return {
        ...state,
        settingsOpen: true
      };
    case "close-settings":
      return {
        ...state,
        settingsOpen: false
      };
    case "toggle-privacy":
      return {
        ...state,
        privacyMode: !state.privacyMode
      };
    case "settings-patch":
      if (!state.snapshot) {
        return state;
      }

      return {
        ...state,
        snapshot: {
          ...state.snapshot,
          settings: {
            ...state.snapshot.settings,
            ...action.patch
          }
        },
        lastEnabledAutoRefreshMinutes:
          typeof action.patch.autoRefreshMinutes === "number" && action.patch.autoRefreshMinutes > 0
            ? action.patch.autoRefreshMinutes
            : state.lastEnabledAutoRefreshMinutes
      };
    case "tick":
      return {
        ...state,
        now: action.now
      };
    case "request-action":
      if (state.pendingActions.some((request) => request.requestId === action.request.requestId)) {
        return state;
      }

      return {
        ...state,
        pendingActions: [...state.pendingActions, action.request]
      };
    case "resolve-action":
      return {
        ...state,
        pendingActions: state.pendingActions.filter((request) => request.requestId !== action.requestId)
      };
    default:
      return state;
  }
}

function App() {
  const [state, dispatch] = useReducer(reducer, undefined, createInitialState);

  useEffect(() => {
    const onMessage = (event: MessageEvent<DashboardHostMessage>) => {
      if (!event.data) {
        return;
      }

      switch (event.data.type) {
        case "dashboard:snapshot":
          dispatch({ type: "snapshot", snapshot: event.data.state });
          return;
        case "dashboard:action-result":
          dispatch({ type: "resolve-action", requestId: event.data.requestId });
          return;
        default:
          return;
      }
    };

    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        dispatch({ type: "close-settings" });
      }
    };

    window.addEventListener("message", onMessage);
    window.addEventListener("keydown", onKeydown);
    postMessageToHost({ type: "dashboard:ready" });

    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("keydown", onKeydown);
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      dispatch({ type: "tick", now: Date.now() });
    }, 30_000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const snapshot = state.snapshot;
  if (!snapshot) {
    return (
      <div class="panel">
        <section class="section">
          <div class="identity">Loading...</div>
        </section>
      </div>
    );
  }

  const activeAccount = snapshot.accounts.find((account) => account.isActive);

  const patchSettings = (patch: Partial<DashboardSettings>): void => {
    dispatch({ type: "settings-patch", patch });
  };

  const sendAction = (action: DashboardActionName, accountId?: string): void => {
    const requestId = createActionRequestId();
    dispatch({
      type: "request-action",
      request: {
        requestId,
        action,
        accountId
      }
    });
    postMessageToHost({
      type: "dashboard:action",
      action,
      accountId,
      requestId
    });
  };

  const sendSetting = (key: DashboardSettingKey, value: string | number | boolean): void => {
    postMessageToHost({
      type: "dashboard:setting",
      key,
      value
    });
  };

  const handleAutoRefreshToggle = (enabled: boolean): void => {
    const nextMinutes = enabled ? state.lastEnabledAutoRefreshMinutes || 15 : 0;
    patchSettings({ autoRefreshMinutes: nextMinutes });
    sendSetting("autoRefreshMinutes", nextMinutes);
  };

  const handleAutoRefreshValue = (minutes: number): void => {
    patchSettings({ autoRefreshMinutes: minutes });
    sendSetting("autoRefreshMinutes", minutes);
  };

  const handleThresholdPreview = (key: "yellow" | "green", value: number): void => {
    const thresholds =
      key === "yellow"
        ? normalizeThresholds(snapshot.settings.quotaGreenThreshold, value)
        : normalizeThresholds(value, snapshot.settings.quotaYellowThreshold);

    patchSettings({
      quotaGreenThreshold: thresholds.green,
      quotaYellowThreshold: thresholds.yellow
    });
  };

  const handleThresholdCommit = (key: "yellow" | "green", value: number): void => {
    const thresholds =
      key === "yellow"
        ? normalizeThresholds(snapshot.settings.quotaGreenThreshold, value)
        : normalizeThresholds(value, snapshot.settings.quotaYellowThreshold);

    patchSettings({
      quotaGreenThreshold: thresholds.green,
      quotaYellowThreshold: thresholds.yellow
    });
    sendSetting("quotaYellowThreshold", thresholds.yellow);
    sendSetting("quotaGreenThreshold", thresholds.green);
  };

  const isActionPending = (action: DashboardActionName, accountId?: string): boolean =>
    state.pendingActions.some((request) => request.action === action && request.accountId === accountId);

  const hasGlobalPendingAction = state.pendingActions.some((request) => request.accountId == null);
  const isAccountBusy = (accountId: string): boolean =>
    hasGlobalPendingAction || state.pendingActions.some((request) => request.accountId === accountId);
  const privacyToggleLabel = state.privacyMode ? snapshot.copy.showSensitive : snapshot.copy.hideSensitive;

  return (
    <>
      <div class={`panel ${state.privacyMode ? "privacy-hidden" : ""}`}>
        <section class="section">
          <div class="hero">
            <div class="brand">
              <img class="logo" src={snapshot.logoUri} alt="Codex Tools logo" />
              <div>
                <h1>codex-tools</h1>
                <p>{snapshot.brandSub}</p>
              </div>
            </div>
            <div class="hero-settings">
              <button
                id="privacyToggleButton"
                class={`settings-btn ${state.privacyMode ? "is-active" : ""}`}
                type="button"
                title={privacyToggleLabel}
                aria-label={privacyToggleLabel}
                aria-pressed={state.privacyMode}
                onClick={() => dispatch({ type: "toggle-privacy" })}
              >
                {state.privacyMode ? <EyeOffIcon /> : <EyeIcon />}
              </button>
              <button
                id="refreshViewButton"
                class="settings-btn refresh-view-btn action-btn"
                type="button"
                title={snapshot.copy.refreshPage}
                aria-label={snapshot.copy.refreshPage}
                disabled={hasGlobalPendingAction}
                aria-busy={isActionPending("refreshView")}
                onClick={() => sendAction("refreshView")}
              >
                <span class="button-face">
                  {isActionPending("refreshView") ? <span class="button-spinner" aria-hidden="true"></span> : null}
                  <span class="button-label">↻</span>
                </span>
              </button>
              <button
                id="settingsOpenButton"
                class="settings-btn"
                type="button"
                title={snapshot.copy.settingsTitle}
                aria-label={snapshot.copy.settingsTitle}
                onClick={() => dispatch({ type: "open-settings" })}
              >
                ⚙
              </button>
            </div>
          </div>
          <OverviewSection
            account={activeAccount}
            hasAccounts={snapshot.accounts.length > 0}
            lang={snapshot.lang}
            copy={snapshot.copy}
            settings={snapshot.settings}
            now={state.now}
            privacyMode={state.privacyMode}
            disabled={hasGlobalPendingAction}
            addPending={isActionPending("addAccount")}
            importPending={isActionPending("importCurrent")}
            refreshAllPending={isActionPending("refreshAll")}
            onAddAccount={() => sendAction("addAccount")}
            onImportCurrent={() => sendAction("importCurrent")}
            onRefreshAll={() => sendAction("refreshAll")}
          />
        </section>
        {snapshot.accounts.length > 0 ? (
          <section class="section">
            <div class="header" style={{ marginBottom: "12px" }}>
              <div>
                <div class="header-title header-title-with-meta" style={{ fontSize: "14px" }}>
                  {snapshot.copy.savedAccounts}
                  <span class="header-count-badge">{formatSavedAccountsSummary(snapshot.lang, snapshot.accounts.length)}</span>
                </div>
                <div class="header-sub">{snapshot.copy.savedAccountsSub}</div>
              </div>
            </div>
            <div class="accounts-grid">
              {snapshot.accounts.map((account) => (
                <SavedAccountCard
                  key={account.id}
                  account={account}
                  lang={snapshot.lang}
                  copy={snapshot.copy}
                  settings={snapshot.settings}
                  now={state.now}
                  privacyMode={state.privacyMode}
                  busy={isAccountBusy(account.id)}
                  switchPending={isActionPending("switch", account.id)}
                  refreshPending={isActionPending("refresh", account.id)}
                  detailsPending={isActionPending("details", account.id)}
                  removePending={isActionPending("remove", account.id)}
                  togglePending={isActionPending("toggleStatusBar", account.id)}
                  onAction={sendAction}
                />
              ))}
            </div>
          </section>
        ) : null}
      </div>

      <div class={`overlay ${state.settingsOpen ? "open" : ""}`} onClick={() => dispatch({ type: "close-settings" })}>
        <div class="settings-modal" onClick={(event) => event.stopPropagation()}>
          <div class="settings-modal-head">
            <div class="settings-modal-title">{snapshot.copy.settingsTitle}</div>
            <button class="settings-close" type="button" onClick={() => dispatch({ type: "close-settings" })}>
              ×
            </button>
          </div>
          <div class="settings-modal-body">
            <SettingsLanguageBlock
              copy={snapshot.copy}
              settings={snapshot.settings}
              onChange={(value) => {
                patchSettings({ displayLanguage: value });
                sendSetting("displayLanguage", value);
              }}
            />
            <SettingsToggleBlock
              title={snapshot.copy.codexAppRestartTitle}
              sub={snapshot.copy.codexAppRestartSub}
              enabled={snapshot.settings.codexAppRestartEnabled}
              onToggle={(enabled) => {
                patchSettings({ codexAppRestartEnabled: enabled });
                sendSetting("codexAppRestartEnabled", enabled);
              }}
            >
              <div class={`settings-stack ${snapshot.settings.codexAppRestartEnabled ? "" : "is-hidden"}`}>
                <div class="settings-segment">
                  <button
                    class={`segment-btn ${snapshot.settings.codexAppRestartMode === "auto" ? "active" : ""}`}
                    type="button"
                    onClick={() => {
                      patchSettings({ codexAppRestartMode: "auto" });
                      sendSetting("codexAppRestartMode", "auto");
                    }}
                  >
                    <span class="segment-title">{snapshot.copy.restartModeAuto}</span>
                    <span class="segment-copy">{snapshot.copy.restartModeAutoDesc}</span>
                  </button>
                  <button
                    class={`segment-btn ${snapshot.settings.codexAppRestartMode === "manual" ? "active" : ""}`}
                    type="button"
                    onClick={() => {
                      patchSettings({ codexAppRestartMode: "manual" });
                      sendSetting("codexAppRestartMode", "manual");
                    }}
                  >
                    <span class="segment-title">{snapshot.copy.restartModeManual}</span>
                    <span class="segment-copy">{snapshot.copy.restartModeManualDesc}</span>
                  </button>
                </div>
                <div class="settings-note">{snapshot.copy.restartModeNote}</div>
                <SettingsPathBlock
                  copy={snapshot.copy}
                  pathValue={snapshot.settings.resolvedCodexAppPath}
                  hasCustomPath={Boolean(snapshot.settings.codexAppPath)}
                  compact
                  onPick={() => postMessageToHost({ type: "dashboard:pickCodexAppPath" })}
                  onClear={() => postMessageToHost({ type: "dashboard:clearCodexAppPath" })}
                />
              </div>
            </SettingsToggleBlock>
            <SettingsToggleBlock
              title={snapshot.copy.autoRefreshTitle}
              sub={snapshot.copy.autoRefreshSub}
              enabled={snapshot.settings.autoRefreshMinutes > 0}
              onToggle={handleAutoRefreshToggle}
            >
              <div class={`settings-stack ${snapshot.settings.autoRefreshMinutes > 0 ? "" : "is-hidden"}`}>
                <SettingsDiscreteSlider
                  value={snapshot.settings.autoRefreshMinutes}
                  values={AUTO_REFRESH_VALUES}
                  accent="violet"
                  valueLabel={(value) => formatTemplate(snapshot.copy.autoRefreshValueTemplate, value)}
                  description={(value) => formatTemplate(snapshot.copy.autoRefreshValueDescTemplate, value)}
                  onPreview={(value) => patchSettings({ autoRefreshMinutes: value })}
                  onCommit={handleAutoRefreshValue}
                />
              </div>
            </SettingsToggleBlock>
            <SettingsToggleBlock
              title={snapshot.copy.autoSwitchTitle}
              sub={snapshot.copy.autoSwitchSub}
              enabled={snapshot.settings.autoSwitchEnabled}
              onToggle={(enabled) => {
                patchSettings({ autoSwitchEnabled: enabled });
                sendSetting("autoSwitchEnabled", enabled);
              }}
            >
              <div class={`settings-stack ${snapshot.settings.autoSwitchEnabled ? "" : "is-hidden"}`}>
                <SettingsDiscreteSlider
                  value={snapshot.settings.autoSwitchHourlyThreshold}
                  values={AUTO_SWITCH_VALUES}
                  accent="violet"
                  sparseScale
                  valueLabel={(value) => `${value}%`}
                  description={(value) =>
                    formatTemplate(snapshot.copy.autoSwitchThresholdDescTemplate, {
                      label: snapshot.copy.hourlyLabel,
                      value
                    })
                  }
                  onPreview={(value) => patchSettings({ autoSwitchHourlyThreshold: value })}
                  onCommit={(value) => {
                    patchSettings({ autoSwitchHourlyThreshold: value });
                    sendSetting("autoSwitchHourlyThreshold", value);
                  }}
                />
                <SettingsDiscreteSlider
                  value={snapshot.settings.autoSwitchWeeklyThreshold}
                  values={AUTO_SWITCH_VALUES}
                  accent="sky"
                  sparseScale
                  valueLabel={(value) => `${value}%`}
                  description={(value) =>
                    formatTemplate(snapshot.copy.autoSwitchThresholdDescTemplate, {
                      label: snapshot.copy.weeklyLabel,
                      value
                    })
                  }
                  onPreview={(value) => patchSettings({ autoSwitchWeeklyThreshold: value })}
                  onCommit={(value) => {
                    patchSettings({ autoSwitchWeeklyThreshold: value });
                    sendSetting("autoSwitchWeeklyThreshold", value);
                  }}
                />
                <div class="settings-note">{snapshot.copy.autoSwitchAnyNote}</div>
              </div>
            </SettingsToggleBlock>
            <SettingsToggleBlock
              title={snapshot.copy.warningTitle}
              sub={snapshot.copy.warningSub}
              enabled={snapshot.settings.quotaWarningEnabled}
              onToggle={(enabled) => {
                patchSettings({ quotaWarningEnabled: enabled });
                sendSetting("quotaWarningEnabled", enabled);
              }}
            >
              <div class={`settings-stack ${snapshot.settings.quotaWarningEnabled ? "" : "is-hidden"}`}>
                <SettingsDiscreteSlider
                  value={snapshot.settings.quotaWarningThreshold}
                  values={WARNING_VALUES}
                  accent="amber"
                  scaleValues={WARNING_SCALE_VALUES}
                  valueLabel={(value) => `${value}%`}
                  description={(value) => formatTemplate(snapshot.copy.warningValueDescTemplate, value)}
                  onPreview={(value) => patchSettings({ quotaWarningThreshold: value })}
                  onCommit={(value) => {
                    patchSettings({ quotaWarningThreshold: value });
                    sendSetting("quotaWarningThreshold", value);
                  }}
                />
              </div>
            </SettingsToggleBlock>
            <SettingsThresholdBlock
              copy={snapshot.copy}
              settings={snapshot.settings}
              onPreview={handleThresholdPreview}
              onCommit={handleThresholdCommit}
            />
            <SettingsSegmentBlock
              title={snapshot.copy.dashboardSettingsTitle}
              sub={snapshot.copy.dashboardSettingsSub}
              options={[
                {
                  key: "show-review",
                  title: snapshot.copy.showReviewOn,
                  description: snapshot.copy.showReviewOnDesc,
                  active: snapshot.settings.showCodeReviewQuota,
                  onClick: () => {
                    patchSettings({ showCodeReviewQuota: true });
                    sendSetting("showCodeReviewQuota", true);
                  }
                },
                {
                  key: "hide-review",
                  title: snapshot.copy.showReviewOff,
                  description: snapshot.copy.showReviewOffDesc,
                  active: !snapshot.settings.showCodeReviewQuota,
                  onClick: () => {
                    patchSettings({ showCodeReviewQuota: false });
                    sendSetting("showCodeReviewQuota", false);
                  }
                }
              ]}
            />
            <SettingsSegmentBlock
              title={snapshot.copy.debugTitle}
              sub={snapshot.copy.debugSub}
              note={snapshot.copy.debugNote}
              options={[
                {
                  key: "debug-on",
                  title: snapshot.copy.debugOn,
                  description: snapshot.copy.debugOnDesc,
                  active: snapshot.settings.debugNetwork,
                  onClick: () => {
                    patchSettings({ debugNetwork: true });
                    sendSetting("debugNetwork", true);
                  }
                },
                {
                  key: "debug-off",
                  title: snapshot.copy.debugOff,
                  description: snapshot.copy.debugOffDesc,
                  active: !snapshot.settings.debugNetwork,
                  onClick: () => {
                    patchSettings({ debugNetwork: false });
                    sendSetting("debugNetwork", false);
                  }
                }
              ]}
            />
          </div>
        </div>
      </div>
    </>
  );
}

function OverviewSection(props: {
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
  onAddAccount: () => void;
  onImportCurrent: () => void;
  onRefreshAll: () => void;
}) {
  const { account, copy, settings, now, hasAccounts, privacyMode } = props;
  const emptyTitle = hasAccounts ? copy.noActiveAccountTitle : copy.empty;
  const emptySub = hasAccounts ? copy.noActiveAccountSub : copy.savedAccountsSub;

  return (
    <div class="overview-shell">
      {account ? (
        <div class="overview-account">
          <div class="overview-account-top">
            <div class="overview-account-name">{getSensitiveDisplayValue(account.displayName, privacyMode, "name")}</div>
            <div class="pill active">{copy.current}</div>
            <div class="pill plan">{account.planTypeLabel}</div>
            {account.hasQuota402 ? <div class="pill error">402</div> : null}
          </div>
          <div class="overview-account-email">{getSensitiveDisplayValue(account.email, privacyMode, "email")}</div>
          <div class="overview-account-meta">
            {account.authProviderLabel} · {account.accountStructureLabel}
          </div>
          <div class="overview-meta">
            <div class="overview-meta-item">
              <span class="grid-label">{copy.userId}</span>
              <span class="meta-value">{getSensitiveDisplayValue(account.userId, privacyMode, "id", copy.unknown)}</span>
            </div>
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
              <div class="overview-empty-copy-title">{emptyTitle}</div>
              <div class="overview-empty-copy-sub">{emptySub}</div>
            </div>
          )}
        </div>
      </div>
      <div class="overview-actions">
        <div class="toolbar">
          <ActionButton
            class="toolbar-btn primary-btn"
            pending={props.addPending}
            disabled={props.disabled}
            onClick={props.onAddAccount}
          >
            {copy.addAccount}
          </ActionButton>
          <ActionButton
            class="toolbar-btn"
            pending={props.importPending}
            disabled={props.disabled}
            onClick={props.onImportCurrent}
          >
            {copy.importCurrent}
          </ActionButton>
          <ActionButton
            class="toolbar-btn"
            pending={props.refreshAllPending}
            disabled={props.disabled}
            onClick={props.onRefreshAll}
          >
            {copy.refreshAll}
          </ActionButton>
        </div>
      </div>
    </div>
  );
}

function SavedAccountCard(props: {
  account: DashboardAccountViewModel;
  lang: DashboardState["lang"];
  copy: DashboardCopy;
  settings: DashboardSettings;
  now: number;
  privacyMode: boolean;
  busy: boolean;
  switchPending: boolean;
  refreshPending: boolean;
  detailsPending: boolean;
  removePending: boolean;
  togglePending: boolean;
  onAction: (action: "details" | "switch" | "refresh" | "remove" | "toggleStatusBar", accountId?: string) => void;
}) {
  const { account, copy, settings, now, onAction, privacyMode } = props;
  const userIdDisplay = getSensitiveDisplayValue(account.userId ?? account.accountId, privacyMode, "id", "-");

  return (
    <article class={`saved-card ${account.isActive ? "active" : ""} ${props.busy ? "is-busy" : ""}`}>
      <div class="saved-head">
        {!account.isActive ? (
          <label
            class={`saved-toggle ${account.canToggleStatusBar ? "" : "disabled"} ${props.togglePending ? "is-pending" : ""}`}
            title={account.statusToggleTitle}
            aria-label={account.statusToggleTitle}
          >
            <input
              type="checkbox"
              checked={account.showInStatusBar}
              disabled={!account.canToggleStatusBar || props.busy}
              onChange={() => onAction("toggleStatusBar", account.id)}
            />
            <span class="saved-toggle-mark"></span>
            <span class="saved-toggle-text">{copy.statusShort}</span>
            {props.togglePending ? <span class="saved-toggle-spinner" aria-hidden="true"></span> : null}
          </label>
        ) : null}
        <div class="saved-title">
          <h3>{getSensitiveDisplayValue(account.displayName, privacyMode, "name")}</h3>
          <div class="saved-sub">{getSensitiveDisplayValue(account.email, privacyMode, "email")}</div>
          <div class="saved-sub">
            {copy.teamName}: {getSensitiveDisplayValue(account.accountName, privacyMode, "name", copy.unknown)}
          </div>
          <div class="saved-sub">
            {copy.login}: {account.authProviderLabel}
          </div>
          <div class="saved-sub truncate" title={`${copy.userId}: ${userIdDisplay}`}>
            {copy.userId}: {userIdDisplay}
          </div>
          <div class="saved-meta">
            {account.isActive ? <span class="pill active">{copy.current}</span> : null}
            <span class="pill plan">{account.planTypeLabel}</span>
            {account.hasQuota402 ? <span class="pill error">402</span> : null}
            <span class="pill">{account.accountStructureLabel}</span>
          </div>
        </div>
      </div>
      <div class="saved-progress">
        {account.metrics
          .filter((metric) => metric.visible)
          .map((metric) => (
            <MetricRow key={metric.key} metric={metric} lang={props.lang} settings={settings} copy={copy} now={now} />
          ))}
      </div>
      <div class="saved-refresh">
        {copy.lastRefresh}: {formatTimestamp(account.lastQuotaAt, copy.never)}
      </div>
      <div class="saved-actions">
        <ActionButton
          pending={props.switchPending}
          disabled={props.busy}
          onClick={() => onAction("switch", account.id)}
        >
          {copy.switchBtn}
        </ActionButton>
        <ActionButton
          pending={props.refreshPending}
          disabled={props.busy}
          onClick={() => onAction("refresh", account.id)}
        >
          {copy.refreshBtn}
        </ActionButton>
        <ActionButton
          pending={props.detailsPending}
          disabled={props.busy}
          onClick={() => onAction("details", account.id)}
        >
          {copy.detailsBtn}
        </ActionButton>
        <ActionButton
          pending={props.removePending}
          disabled={props.busy}
          onClick={() => onAction("remove", account.id)}
        >
          {copy.removeBtn}
        </ActionButton>
      </div>
    </article>
  );
}

function ActionButton(props: {
  class?: string;
  pending?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ComponentChildren;
}) {
  const className = [props.class, "action-btn", props.pending ? "is-pending" : ""].filter(Boolean).join(" ");

  return (
    <button class={className} type="button" disabled={props.disabled} aria-busy={props.pending} onClick={props.onClick}>
      <span class="button-face">
        {props.pending ? <span class="button-spinner" aria-hidden="true"></span> : null}
        <span class="button-label">{props.children}</span>
      </span>
    </button>
  );
}

function MetricGauge(props: {
  metric: DashboardMetricViewModel;
  lang: DashboardState["lang"];
  settings: DashboardSettings;
  copy: DashboardCopy;
  now: number;
}) {
  const clamped = clampPercent(props.metric.percentage);
  const color = colorForPercentage(props.metric.percentage, props.settings);
  const style = {
    "--pct": String(clamped),
    "--gauge-color": color
  } as Record<string, string>;

  return (
    <div class="metric-gauge">
      <div class="metric-gauge-ring" style={style}>
        <div class="metric-gauge-value">{formatPercent(props.metric.percentage)}</div>
      </div>
      <div class="metric-gauge-label">{props.metric.label}</div>
      <div class="metric-gauge-foot">
        {formatResetLabel(props.metric.resetAt, props.copy.resetUnknown, props.now, props.lang)}
      </div>
    </div>
  );
}

function MetricRow(props: {
  metric: DashboardMetricViewModel;
  lang: DashboardState["lang"];
  settings: DashboardSettings;
  copy: DashboardCopy;
  now: number;
}) {
  const clamped = clampPercent(props.metric.percentage);
  const color = colorForPercentage(props.metric.percentage, props.settings);
  const percentStyle = {
    "--metric-color": color
  } as Record<string, string>;
  const barStyle = {
    width: `${clamped}%`,
    "--metric-color": color
  } as Record<string, string>;

  return (
    <div class="row">
      <div class="row-head">
        <div class="label-wrap">
          <span class="metric-label">{props.metric.label}</span>
        </div>
        <span class="percent" style={percentStyle}>
          {formatPercent(props.metric.percentage)}
        </span>
      </div>
      <div class="bar">
        <span style={barStyle}></span>
      </div>
      <div class="foot">{formatResetLabel(props.metric.resetAt, props.copy.resetUnknown, props.now, props.lang)}</div>
    </div>
  );
}

function SettingsLanguageBlock(props: {
  copy: DashboardCopy;
  settings: DashboardSettings;
  onChange: (value: DashboardSettings["displayLanguage"]) => void;
}) {
  return (
    <div class="settings-block">
      <div class="settings-block-head">
        <div class="settings-block-title">{props.copy.languageTitle}</div>
        <div class="settings-block-sub">{props.copy.languageSub}</div>
      </div>
      <select
        class="settings-select"
        value={props.settings.displayLanguage}
        onChange={(event) => {
          const nextValue = event.currentTarget.value;
          if (isDashboardLanguageOption(nextValue)) {
            props.onChange(nextValue);
          }
        }}
      >
        {DASHBOARD_LANGUAGE_OPTIONS.map((option) => (
          <option key={option} value={option}>
            {option === "auto" ? props.copy.languageAuto : DASHBOARD_LANGUAGE_OPTION_LABELS[option]}
          </option>
        ))}
      </select>
      <div class="settings-note">{props.copy.languageNote}</div>
    </div>
  );
}

function SettingsSegmentBlock(props: {
  title: string;
  sub: string;
  note?: string;
  options: Array<{
    key: string;
    title: string;
    description: string;
    active: boolean;
    onClick: () => void;
  }>;
  children?: ComponentChildren;
}) {
  return (
    <div class="settings-block">
      <div class="settings-block-head">
        <div class="settings-block-title">{props.title}</div>
        <div class="settings-block-sub">{props.sub}</div>
      </div>
      <div class="settings-segment">
        {props.options.map((option) => (
          <button
            key={option.key}
            class={`segment-btn ${option.active ? "active" : ""}`}
            type="button"
            onClick={option.onClick}
          >
            <span class="segment-title">{option.title}</span>
            <span class="segment-copy">{option.description}</span>
          </button>
        ))}
      </div>
      {props.children}
      {props.note ? <div class="settings-note">{props.note}</div> : null}
    </div>
  );
}

function SettingsToggleBlock(props: {
  title: string;
  sub: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  children?: ComponentChildren;
}) {
  return (
    <div class="settings-block">
      <div class="settings-toggle-head">
        <div class="settings-block-head">
          <div class="settings-block-title">{props.title}</div>
          <div class="settings-block-sub">{props.sub}</div>
        </div>
        <button
          class={`settings-inline-toggle ${props.enabled ? "active" : ""}`}
          type="button"
          aria-pressed={props.enabled}
          onClick={() => props.onToggle(!props.enabled)}
        >
          <span class="settings-inline-toggle-track">
            <span class="settings-inline-toggle-thumb"></span>
          </span>
        </button>
      </div>
      {props.children}
    </div>
  );
}

function SettingsPathBlock(props: {
  copy: DashboardCopy;
  pathValue: string;
  hasCustomPath: boolean;
  compact?: boolean;
  onPick: () => void;
  onClear: () => void;
}) {
  const content = (
    <>
      <div class="settings-block-head">
        <div class="settings-block-title">{props.copy.appPathTitle}</div>
        <div class="settings-block-sub">{props.copy.appPathSub}</div>
      </div>
      <div class="settings-note">{props.pathValue || props.copy.appPathEmpty}</div>
      <div class="saved-actions settings-inline-actions">
        <button type="button" onClick={props.onPick}>
          {props.copy.pickPath}
        </button>
        <button type="button" disabled={!props.hasCustomPath} onClick={props.onClear}>
          {props.copy.clearPath}
        </button>
      </div>
    </>
  );

  if (props.compact) {
    return <div class="settings-stack settings-path-inline">{content}</div>;
  }

  return <div class="settings-block">{content}</div>;
}

function SettingsThresholdBlock(props: {
  copy: DashboardCopy;
  settings: DashboardSettings;
  onPreview: (key: "yellow" | "green", value: number) => void;
  onCommit: (key: "yellow" | "green", value: number) => void;
}) {
  const yellow = props.settings.quotaYellowThreshold;
  const green = props.settings.quotaGreenThreshold;
  const fillRedStyle = {
    width: `${yellow}%`
  } as Record<string, string>;
  const fillYellowStyle = {
    left: `${yellow}%`,
    width: `${Math.max(0, green - yellow)}%`
  } as Record<string, string>;
  const fillGreenStyle = {
    left: `${green}%`,
    width: `${Math.max(0, 100 - green)}%`
  } as Record<string, string>;

  return (
    <div class="settings-block">
      <div class="settings-block-head">
        <div class="settings-block-title">{props.copy.colorThresholdTitle}</div>
        <div class="settings-block-sub">{props.copy.colorThresholdSub}</div>
      </div>
      <div class="settings-note">{formatTemplate(props.copy.colorThresholdRedNoteTemplate, yellow)}</div>
      <div class="threshold-dual">
        <div class="threshold-dual-head">
          <div class="threshold-marker threshold-marker-yellow">
            <span class="threshold-marker-label">{props.copy.colorThresholdYellowTitle}</span>
            <span class="threshold-slider-value">{yellow}%</span>
          </div>
          <div class="threshold-marker threshold-marker-green">
            <span class="threshold-marker-label">{props.copy.colorThresholdGreenTitle}</span>
            <span class="threshold-slider-value">{green}%</span>
          </div>
        </div>
        <div class="threshold-dual-copy">
          <div class="threshold-slider-copy">{formatTemplate(props.copy.colorThresholdYellowDescTemplate, yellow)}</div>
          <div class="threshold-slider-copy">{formatTemplate(props.copy.colorThresholdGreenDescTemplate, green)}</div>
        </div>
        <div class="threshold-range-stack">
          <div class="threshold-range-rail"></div>
          <div class="threshold-range-fill threshold-range-fill-red" style={fillRedStyle}></div>
          <div class="threshold-range-fill threshold-range-fill-yellow" style={fillYellowStyle}></div>
          <div class="threshold-range-fill threshold-range-fill-green" style={fillGreenStyle}></div>
          <input
            class="threshold-range threshold-range-yellow"
            type="range"
            min="0"
            max="100"
            step="1"
            value={yellow}
            onInput={(event) => props.onPreview("yellow", Number(event.currentTarget.value))}
            onChange={(event) => props.onCommit("yellow", Number(event.currentTarget.value))}
          />
          <input
            class="threshold-range threshold-range-green"
            type="range"
            min="0"
            max="100"
            step="1"
            value={green}
            onInput={(event) => props.onPreview("green", Number(event.currentTarget.value))}
            onChange={(event) => props.onCommit("green", Number(event.currentTarget.value))}
          />
        </div>
        <div class="threshold-slider-scale">
          <span>0%</span>
          <span>50%</span>
          <span>100%</span>
        </div>
      </div>
    </div>
  );
}

function SettingsDiscreteSlider(props: {
  value: number;
  values: number[];
  accent: "violet" | "amber" | "sky";
  valueLabel: (value: number) => string;
  description: (value: number) => string;
  sparseScale?: boolean;
  scaleValues?: number[];
  onPreview: (value: number) => void;
  onCommit: (value: number) => void;
}) {
  const currentIndex = resolveDiscreteIndex(props.values, props.value);
  const currentValue = props.values[currentIndex] ?? props.values[0] ?? 0;
  const progress = resolveDiscretePercent(props.values, currentValue);
  const minValue = props.values[0] ?? 0;
  const maxValue = props.values[props.values.length - 1] ?? minValue;
  const fillStyle = {
    width: `${progress}%`
  } as Record<string, string>;
  const thumbStyle = {
    left: `${progress}%`
  } as Record<string, string>;

  return (
    <div class={`step-slider step-slider-${props.accent}`}>
      <div class="step-slider-head">
        <div class="step-slider-copy">{props.description(currentValue)}</div>
        <div class="step-slider-value">{props.valueLabel(currentValue)}</div>
      </div>
      <div class="step-slider-stack">
        <div class="step-slider-rail"></div>
        <div class="step-slider-fill" style={fillStyle}></div>
        <div class="step-slider-thumb" style={thumbStyle}></div>
        <input
          class={`step-slider-range step-slider-range-${props.accent}`}
          type="range"
          min={String(minValue)}
          max={String(maxValue)}
          step="1"
          value={currentValue}
          onInput={(event) => {
            const nextRawValue = Number(event.currentTarget.value);
            props.onPreview(resolveNearestDiscreteValue(props.values, nextRawValue));
          }}
          onChange={(event) => {
            const nextRawValue = Number(event.currentTarget.value);
            props.onCommit(resolveNearestDiscreteValue(props.values, nextRawValue));
          }}
        />
      </div>
      <div class="step-slider-scale">
        {(props.scaleValues ?? (props.sparseScale ? pickSparseScaleValues(props.values) : props.values)).map(
          (value, index, scaleValues) => {
            const markerPercent = resolveDiscretePercent(props.values, value);
            const labelStyle = {
              left: `${markerPercent}%`
            } as Record<string, string>;

            return (
              <span
                key={value}
                class={`step-slider-scale-label ${
                  index === 0 ? "is-start" : index === scaleValues.length - 1 ? "is-end" : ""
                }`}
                style={labelStyle}
              >
                {props.valueLabel(value)}
              </span>
            );
          }
        )}
      </div>
    </div>
  );
}

function clampPercent(value?: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, value));
}

function colorForPercentage(value: number | undefined, settings: DashboardSettings): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "#7ddc7a";
  }
  if (value >= settings.quotaGreenThreshold) {
    return "#7ddc7a";
  }
  if (value >= settings.quotaYellowThreshold) {
    return "#fbbf24";
  }
  return "#ef4444";
}

function formatPercent(value?: number): string {
  return typeof value === "number" ? `${value}%` : "--";
}

function formatTimestamp(epochMs: number | undefined, fallback: string): string {
  if (!epochMs) {
    return fallback;
  }

  return new Date(epochMs).toLocaleString();
}

function formatResetLabel(
  resetAt: number | undefined,
  fallback: string,
  now: number,
  lang: DashboardState["lang"]
): string {
  if (!resetAt) {
    return fallback;
  }

  const target = new Date(resetAt * 1000);
  const month = String(target.getMonth() + 1).padStart(2, "0");
  const day = String(target.getDate()).padStart(2, "0");
  const hour = String(target.getHours()).padStart(2, "0");
  const minute = String(target.getMinutes()).padStart(2, "0");

  return `${formatRelativeReset(resetAt, now, lang)} (${month}/${day} ${hour}:${minute})`;
}

function formatRelativeReset(resetAt: number, now: number, lang: DashboardState["lang"]): string {
  const deltaMs = resetAt * 1000 - now;
  const abs = Math.abs(deltaMs);
  const minutes = Math.round(abs / 60_000);
  const future = deltaMs >= 0;

  if (minutes < 60) {
    return relativeTime(lang, minutes, "m", future);
  }

  const hours = Math.round(minutes / 60);
  if (hours < 48) {
    return relativeTime(lang, hours, "h", future);
  }

  const days = Math.round(hours / 24);
  return relativeTime(lang, days, "d", future);
}

function relativeTime(lang: DashboardState["lang"], value: number, unit: "m" | "h" | "d", future: boolean): string {
  const formatter = new Intl.RelativeTimeFormat(getIntlLocale(lang), {
    numeric: "always",
    style: "short"
  });
  const unitMap = {
    m: "minute",
    h: "hour",
    d: "day"
  } as const;

  return formatter.format(future ? value : -value, unitMap[unit]);
}

function formatTemplate(template: string, value: number | Record<string, string | number>): string {
  if (typeof value === "number") {
    return template.replace("{value}", String(value));
  }

  return Object.entries(value).reduce(
    (result, [key, item]) => result.replace(new RegExp(`\\{${key}\\}`, "g"), String(item)),
    template
  );
}

function formatSavedAccountsSummary(lang: DashboardState["lang"], count: number): string {
  switch (lang) {
    case "zh":
      return `现有 ${count} 个账号`;
    case "zh-hant":
      return `現有 ${count} 個帳號`;
    case "ja":
      return `保存中 ${count} 件`;
    default:
      return `${count} account${count === 1 ? "" : "s"} in list`;
  }
}

function normalizeThresholds(green: number, yellow: number): { green: number; yellow: number } {
  const safeYellowBase = Number.isFinite(yellow) ? Math.max(0, Math.min(99, yellow)) : 20;
  const safeGreenBase = Number.isFinite(green) ? Math.max(1, Math.min(100, green)) : 60;
  const safeYellow = Math.min(safeYellowBase, safeGreenBase - 10);
  const safeGreen = Math.max(safeGreenBase, safeYellow + 10);

  return {
    green: safeGreen,
    yellow: safeYellow
  };
}

function resolveDiscreteIndex(values: number[], currentValue: number): number {
  const matchedIndex = values.indexOf(currentValue);
  if (matchedIndex >= 0) {
    return matchedIndex;
  }

  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;

  values.forEach((value, index) => {
    const distance = Math.abs(value - currentValue);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });

  return nearestIndex;
}

function resolveNearestDiscreteValue(values: number[], rawValue: number): number {
  const nearestIndex = resolveDiscreteIndex(values, rawValue);
  return values[nearestIndex] ?? values[0] ?? 0;
}

type SensitiveKind = "email" | "id" | "name";

function getSensitiveDisplayValue(
  value: string | undefined,
  hidden: boolean,
  kind: SensitiveKind,
  fallback = "—"
): string {
  const normalized = value?.trim();
  if (!normalized) {
    return fallback;
  }

  return hidden ? maskSensitiveValue(normalized, kind) : normalized;
}

function maskSensitiveValue(value: string, kind: SensitiveKind): string {
  switch (kind) {
    case "email":
      return maskEmail(value);
    case "name":
      return maskSegmentedValue(value);
    case "id":
      return createMask(value.length, 10, 18);
    default:
      return createMask(value.length);
  }
}

function maskEmail(value: string): string {
  const [localPart, domainPart] = value.split("@");
  if (!localPart || !domainPart) {
    return createMask(value.length);
  }

  return `${createMask(localPart.length, 4, 10)}@${createMask(domainPart.length, 4, 10)}`;
}

function maskSegmentedValue(value: string): string {
  return value
    .split(/(\s+|[._\-\\/]+)/)
    .map((segment) => (/^(\s+|[._\-\\/]+)$/.test(segment) ? segment : createMask(segment.length, 3, 8)))
    .join("");
}

function createMask(length: number, min = 6, max = 12): string {
  return "*".repeat(Math.max(min, Math.min(max, Math.max(1, length))));
}

function EyeIcon() {
  return (
    <svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M1.5 12s3.8-6 10.5-6 10.5 6 10.5 6-3.8 6-10.5 6S1.5 12 1.5 12Z"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M3 3l18 18"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M10.6 5.7A12.6 12.6 0 0 1 12 5.6c6.7 0 10.5 6.4 10.5 6.4a18.4 18.4 0 0 1-4 4.5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M6.2 7.2A18.8 18.8 0 0 0 1.5 12s3.8 6 10.5 6c1.6 0 3-.3 4.3-.8"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M9.9 9.8A3.2 3.2 0 0 0 14.2 14"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function resolveDiscretePercent(values: number[], currentValue: number): number {
  const first = values[0];
  const last = values[values.length - 1];
  if (typeof first !== "number" || typeof last !== "number" || first === last) {
    return 0;
  }

  return ((currentValue - first) / (last - first)) * 100;
}

function pickSparseScaleValues(values: number[]): number[] {
  if (values.length <= 3) {
    return values;
  }

  const first = values[0];
  const middle = values[Math.floor((values.length - 1) / 2)];
  const last = values[values.length - 1];

  return [first, middle, last].filter(
    (value, index, array): value is number => typeof value === "number" && array.indexOf(value) === index
  );
}

let actionRequestSequence = 0;

function createActionRequestId(): string {
  actionRequestSequence += 1;
  return `dashboard-action-${actionRequestSequence}`;
}

function postMessageToHost(message: DashboardClientMessage): void {
  vscodeApi.postMessage(message);
}

render(<App />, document.getElementById("app")!);
