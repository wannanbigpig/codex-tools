import { render } from "preact";
import type { ComponentChildren } from "preact";
import { useEffect, useReducer } from "preact/hooks";
import type {
  DashboardAccountViewModel,
  DashboardClientMessage,
  DashboardCopy,
  DashboardHostMessage,
  DashboardMetricViewModel,
  DashboardSettingKey,
  DashboardSettings,
  DashboardState
} from "../../src/domain/dashboard/types";

declare function acquireVsCodeApi(): {
  postMessage(message: DashboardClientMessage): void;
};

const AUTO_REFRESH_VALUES = [5, 10, 15, 30, 60];
const WARNING_VALUES = [10, 20, 30, 40, 50];
type DashboardActionName = Extract<DashboardClientMessage, { type: "dashboard:action" }>["action"];

type AppState = {
  snapshot?: DashboardState;
  settingsOpen: boolean;
  lastEnabledAutoRefreshMinutes: number;
  now: number;
};

type AppAction =
  | { type: "snapshot"; snapshot: DashboardState }
  | { type: "open-settings" }
  | { type: "close-settings" }
  | { type: "settings-patch"; patch: Partial<DashboardSettings> }
  | { type: "tick"; now: number };

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
    lastEnabledAutoRefreshMinutes: 15,
    now: Date.now()
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
    default:
      return state;
  }
}

function App() {
  const [state, dispatch] = useReducer(reducer, undefined, createInitialState);

  useEffect(() => {
    const onMessage = (event: MessageEvent<DashboardHostMessage>) => {
      if (event.data?.type === "dashboard:snapshot") {
        dispatch({ type: "snapshot", snapshot: event.data.state });
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
    postMessageToHost({
      type: "dashboard:action",
      action,
      accountId
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

  return (
    <>
      <div class="panel">
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
                id="refreshViewButton"
                class="settings-btn refresh-view-btn"
                type="button"
                title={snapshot.copy.refreshPage}
                aria-label={snapshot.copy.refreshPage}
                onClick={() => sendAction("refreshView")}
              >
                ↻
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
          {activeAccount ? (
            <OverviewSection
              account={activeAccount}
              lang={snapshot.lang}
              copy={snapshot.copy}
              settings={snapshot.settings}
              now={state.now}
              onAddAccount={() => sendAction("addAccount")}
              onImportCurrent={() => sendAction("importCurrent")}
              onRefreshAll={() => sendAction("refreshAll")}
            />
          ) : (
            <div class="identity">{snapshot.copy.empty}</div>
          )}
        </section>
        {snapshot.accounts.length > 0 ? (
          <section class="section">
            <div class="header" style={{ marginBottom: "12px" }}>
              <div>
                <div class="header-title" style={{ fontSize: "14px" }}>
                  {snapshot.copy.savedAccounts}
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
                  onAction={sendAction}
                />
              ))}
            </div>
          </section>
        ) : null}
      </div>

      <div
        class={`overlay ${state.settingsOpen ? "open" : ""}`}
        onClick={() => dispatch({ type: "close-settings" })}
      >
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
            <SettingsSegmentBlock
              title={snapshot.copy.codexAppRestartTitle}
              sub={snapshot.copy.codexAppRestartSub}
              note={snapshot.copy.restartModeNote}
              options={[
                {
                  key: "auto",
                  title: snapshot.copy.restartModeAuto,
                  description: snapshot.copy.restartModeAutoDesc,
                  active: snapshot.settings.codexAppRestartMode === "auto",
                  onClick: () => {
                    patchSettings({ codexAppRestartMode: "auto" });
                    sendSetting("codexAppRestartMode", "auto");
                  }
                },
                {
                  key: "manual",
                  title: snapshot.copy.restartModeManual,
                  description: snapshot.copy.restartModeManualDesc,
                  active: snapshot.settings.codexAppRestartMode === "manual",
                  onClick: () => {
                    patchSettings({ codexAppRestartMode: "manual" });
                    sendSetting("codexAppRestartMode", "manual");
                  }
                }
              ]}
            />
            <SettingsSegmentBlock
              title={snapshot.copy.autoRefreshTitle}
              sub={snapshot.copy.autoRefreshSub}
              options={[
                {
                  key: "on",
                  title: snapshot.copy.autoRefreshOn,
                  description: snapshot.copy.autoRefreshOnDesc,
                  active: snapshot.settings.autoRefreshMinutes > 0,
                  onClick: () => handleAutoRefreshToggle(true)
                },
                {
                  key: "off",
                  title: snapshot.copy.autoRefreshOff,
                  description: snapshot.copy.autoRefreshOffDesc,
                  active: snapshot.settings.autoRefreshMinutes === 0,
                  onClick: () => handleAutoRefreshToggle(false)
                }
              ]}
            >
              <div class={`settings-segment ${snapshot.settings.autoRefreshMinutes > 0 ? "" : "is-hidden"}`}>
                {AUTO_REFRESH_VALUES.map((minutes) => (
                  <button
                    key={minutes}
                    class={`segment-btn ${snapshot.settings.autoRefreshMinutes === minutes ? "active" : ""}`}
                    type="button"
                    onClick={() => handleAutoRefreshValue(minutes)}
                  >
                    <span class="segment-title">{formatTemplate(snapshot.copy.autoRefreshValueTemplate, minutes)}</span>
                    <span class="segment-copy">
                      {formatTemplate(snapshot.copy.autoRefreshValueDescTemplate, minutes)}
                    </span>
                  </button>
                ))}
              </div>
            </SettingsSegmentBlock>
            <SettingsPathBlock
              copy={snapshot.copy}
              pathValue={snapshot.settings.codexAppPath}
              onPick={() => postMessageToHost({ type: "dashboard:pickCodexAppPath" })}
              onClear={() => postMessageToHost({ type: "dashboard:clearCodexAppPath" })}
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
              title={snapshot.copy.warningTitle}
              sub={snapshot.copy.warningSub}
              options={[
                {
                  key: "warning-on",
                  title: snapshot.copy.warningOn,
                  description: snapshot.copy.warningOnDesc,
                  active: snapshot.settings.quotaWarningEnabled,
                  onClick: () => {
                    patchSettings({ quotaWarningEnabled: true });
                    sendSetting("quotaWarningEnabled", true);
                  }
                },
                {
                  key: "warning-off",
                  title: snapshot.copy.warningOff,
                  description: snapshot.copy.warningOffDesc,
                  active: !snapshot.settings.quotaWarningEnabled,
                  onClick: () => {
                    patchSettings({ quotaWarningEnabled: false });
                    sendSetting("quotaWarningEnabled", false);
                  }
                }
              ]}
            >
              <div class={`settings-segment ${snapshot.settings.quotaWarningEnabled ? "" : "is-hidden"}`}>
                {WARNING_VALUES.map((value) => (
                  <button
                    key={value}
                    class={`segment-btn ${snapshot.settings.quotaWarningThreshold === value ? "active" : ""}`}
                    type="button"
                    onClick={() => {
                      patchSettings({ quotaWarningThreshold: value });
                      sendSetting("quotaWarningThreshold", value);
                    }}
                  >
                    <span class="segment-title">{value}%</span>
                    <span class="segment-copy">{formatTemplate(snapshot.copy.warningValueDescTemplate, value)}</span>
                  </button>
                ))}
              </div>
            </SettingsSegmentBlock>
            <SettingsThresholdBlock
              copy={snapshot.copy}
              settings={snapshot.settings}
              onPreview={handleThresholdPreview}
              onCommit={handleThresholdCommit}
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
  account: DashboardAccountViewModel;
  lang: DashboardState["lang"];
  copy: DashboardCopy;
  settings: DashboardSettings;
  now: number;
  onAddAccount: () => void;
  onImportCurrent: () => void;
  onRefreshAll: () => void;
}) {
  const { account, copy, settings, now } = props;

  return (
    <div class="overview-shell">
      <div class="overview-account">
        <div class="overview-account-top">
          <div class="overview-account-name">{account.displayName}</div>
          <div class="pill active">{copy.current}</div>
          <div class="pill plan">{account.planTypeLabel}</div>
          {account.hasQuota402 ? <div class="pill error">402</div> : null}
        </div>
        <div class="overview-account-email">{account.email}</div>
        <div class="overview-account-meta">
          {account.authProviderLabel} · {account.accountStructureLabel}
        </div>
        <div class="overview-meta">
          <div class="overview-meta-item">
            <span class="grid-label">{copy.userId}</span>
            <span class="meta-value">{account.userId ?? copy.unknown}</span>
          </div>
          <div class="overview-meta-item">
            <span class="grid-label">{copy.accountId}</span>
            <span class="meta-value">{account.accountId ?? copy.unknown}</span>
          </div>
          <div class="overview-meta-item">
            <span class="grid-label">{copy.lastRefresh}</span>
            <span class="meta-value">{formatTimestamp(account.lastQuotaAt, copy.never)}</span>
          </div>
          <div class="overview-meta-item">
            <span class="grid-label">{copy.organization}</span>
            <span class="meta-value">{account.organizationId ?? copy.unknown}</span>
          </div>
        </div>
      </div>
      <div class="overview-main">
        <div class="overview-head">
          <div class="overview-head-title">{copy.dashboardTitle}</div>
          <div class="overview-head-sub">{copy.dashboardSub}</div>
        </div>
        <div class="overview-metrics">
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
        </div>
      </div>
      <div class="overview-actions">
        <div class="toolbar">
          <button class="toolbar-btn primary-btn" type="button" onClick={props.onAddAccount}>
            {copy.addAccount}
          </button>
          <button class="toolbar-btn" type="button" onClick={props.onImportCurrent}>
            {copy.importCurrent}
          </button>
          <button class="toolbar-btn" type="button" onClick={props.onRefreshAll}>
            {copy.refreshAll}
          </button>
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
  onAction: (action: "details" | "switch" | "refresh" | "remove" | "toggleStatusBar", accountId?: string) => void;
}) {
  const { account, copy, settings, now, onAction } = props;

  return (
    <article class={`saved-card ${account.isActive ? "active" : ""}`}>
      <div class="saved-head">
        {!account.isActive ? (
          <label
            class={`saved-toggle ${account.canToggleStatusBar ? "" : "disabled"}`}
            title={account.statusToggleTitle}
            aria-label={account.statusToggleTitle}
          >
            <input
              type="checkbox"
              checked={account.showInStatusBar}
              disabled={!account.canToggleStatusBar}
              onChange={() => onAction("toggleStatusBar", account.id)}
            />
            <span class="saved-toggle-mark"></span>
            <span class="saved-toggle-text">{copy.statusShort}</span>
          </label>
        ) : null}
        <div class="saved-title">
          <h3>{account.displayName}</h3>
          <div class="saved-sub">{account.email}</div>
          <div class="saved-sub">
            {copy.teamName}: {account.accountName ?? copy.unknown}
          </div>
          <div class="saved-sub">
            {copy.login}: {account.authProviderLabel}
          </div>
          <div class="saved-sub truncate" title={`${copy.userId}: ${account.userId ?? account.accountId ?? "-"}`}>
            {copy.userId}: {account.userId ?? account.accountId ?? "-"}
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
            <MetricRow
              key={metric.key}
              metric={metric}
              lang={props.lang}
              settings={settings}
              copy={copy}
              now={now}
            />
          ))}
      </div>
      <div class="saved-refresh">
        {copy.lastRefresh}: {formatTimestamp(account.lastQuotaAt, copy.never)}
      </div>
      <div class="saved-actions">
        <button type="button" onClick={() => onAction("switch", account.id)}>
          {copy.switchBtn}
        </button>
        <button type="button" onClick={() => onAction("refresh", account.id)}>
          {copy.refreshBtn}
        </button>
        <button type="button" onClick={() => onAction("details", account.id)}>
          {copy.detailsBtn}
        </button>
        <button type="button" onClick={() => onAction("remove", account.id)}>
          {copy.removeBtn}
        </button>
      </div>
    </article>
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
        onChange={(event) => props.onChange((event.currentTarget as HTMLSelectElement).value as DashboardSettings["displayLanguage"])}
      >
        <option value="auto">{props.copy.languageAuto}</option>
        <option value="zh">{props.copy.languageZh}</option>
        <option value="en">{props.copy.languageEn}</option>
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

function SettingsPathBlock(props: {
  copy: DashboardCopy;
  pathValue: string;
  onPick: () => void;
  onClear: () => void;
}) {
  return (
    <div class="settings-block">
      <div class="settings-block-head">
        <div class="settings-block-title">{props.copy.appPathTitle}</div>
        <div class="settings-block-sub">{props.copy.appPathSub}</div>
      </div>
      <div class="settings-note">{props.pathValue || props.copy.appPathEmpty}</div>
      <div class="saved-actions" style={{ padding: "0", borderTop: "0", justifyContent: "flex-start" }}>
        <button type="button" onClick={props.onPick}>
          {props.copy.pickPath}
        </button>
        <button type="button" disabled={!props.pathValue} onClick={props.onClear}>
          {props.copy.clearPath}
        </button>
      </div>
    </div>
  );
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
            onInput={(event) => props.onPreview("yellow", Number((event.currentTarget as HTMLInputElement).value))}
            onChange={(event) => props.onCommit("yellow", Number((event.currentTarget as HTMLInputElement).value))}
          />
          <input
            class="threshold-range threshold-range-green"
            type="range"
            min="0"
            max="100"
            step="1"
            value={green}
            onInput={(event) => props.onPreview("green", Number((event.currentTarget as HTMLInputElement).value))}
            onChange={(event) => props.onCommit("green", Number((event.currentTarget as HTMLInputElement).value))}
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
  if (lang === "zh") {
    if (unit === "m") {
      return future ? `剩余${value}分钟` : `${value}分钟前`;
    }
    if (unit === "h") {
      return future ? `剩余${value}小时` : `${value}小时前`;
    }
    return future ? `剩余${value}天` : `${value}天前`;
  }

  if (unit === "m") {
    return future ? `${value}m left` : `${value}m ago`;
  }
  if (unit === "h") {
    return future ? `${value}h left` : `${value}h ago`;
  }
  return future ? `${value}d left` : `${value}d ago`;
}

function formatTemplate(template: string, value: number): string {
  return template.replace("{value}", String(value));
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

function postMessageToHost(message: DashboardClientMessage): void {
  vscodeApi.postMessage(message);
}

render(<App />, document.getElementById("app")!);
