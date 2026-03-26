import { render } from "preact";
import type { ComponentChildren } from "preact";
import { useEffect, useReducer, useRef, useState } from "preact/hooks";
import type {
  DashboardAccountViewModel,
  DashboardActionName,
  DashboardClientMessage,
  DashboardCopy,
  DashboardHostMessage,
  DashboardMetricViewModel,
  DashboardOAuthSessionDescriptor,
  DashboardSettingKey,
  DashboardSettings,
  DashboardState
} from "../../src/domain/dashboard/types";
import type { CodexImportPreviewSummary, CodexImportResultSummary } from "../../src/core/types";
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
const AUTO_SWITCH_LOCK_VALUES = [0, 5, 10, 15, 30, 60, 120];
const WARNING_VALUES = Array.from({ length: 18 }, (_, index) => 5 + index * 5);
const WARNING_SCALE_VALUES = [5, 20, 35, 50, 65, 80, 90];
const GITHUB_PROJECT_URL = "https://github.com/wannanbigpig/codex-accounts-manager";
type PendingActionRequest = {
  requestId: string;
  action: DashboardActionName;
  accountId?: string;
  requestedAt: number;
};

type AppState = {
  snapshot?: DashboardState;
  settingsOpen: boolean;
  privacyMode: boolean;
  lastEnabledAutoRefreshMinutes: number;
  now: number;
  selectedAccountIds: string[];
  pendingActions: PendingActionRequest[];
};

type AppAction =
  | { type: "snapshot"; snapshot: DashboardState }
  | { type: "open-settings" }
  | { type: "close-settings" }
  | { type: "toggle-privacy" }
  | { type: "settings-patch"; patch: Partial<DashboardSettings> }
  | { type: "tick"; now: number }
  | { type: "toggle-select"; accountId: string }
  | { type: "request-action"; request: PendingActionRequest }
  | { type: "resolve-action"; requestId: string };

const vscodeApi =
  typeof acquireVsCodeApi === "function"
    ? acquireVsCodeApi()
    : {
        postMessage(message: DashboardClientMessage): void {
          console.debug("[codex-accounts-manager] dashboard message", message);
        }
      };

const BLOCKING_GLOBAL_ACTIONS = new Set<DashboardActionName>([
  "addAccount",
  "importCurrent",
  "refreshAll",
  "batchRefresh",
  "batchResyncProfile",
  "batchRemove",
  "restoreFromBackup",
  "restoreFromAuthJson",
  "importSharedJson",
  "downloadJsonFile"
]);

function createInitialState(): AppState {
  return {
    settingsOpen: false,
    privacyMode: false,
    lastEnabledAutoRefreshMinutes: 15,
    now: Date.now(),
    selectedAccountIds: [],
    pendingActions: []
  };
}

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "snapshot":
      {
        const nextAccountIds = new Set(action.snapshot.accounts.map((account) => account.id));
        const selectedAccountIds = state.selectedAccountIds.filter((accountId) => nextAccountIds.has(accountId));

        return {
          ...state,
          snapshot: action.snapshot,
          selectedAccountIds,
          lastEnabledAutoRefreshMinutes:
            action.snapshot.settings.autoRefreshMinutes > 0
              ? action.snapshot.settings.autoRefreshMinutes
              : state.lastEnabledAutoRefreshMinutes
        };
      }
    case "toggle-select":
      return {
        ...state,
        selectedAccountIds: state.selectedAccountIds.includes(action.accountId)
          ? state.selectedAccountIds.filter((accountId) => accountId !== action.accountId)
          : [...state.selectedAccountIds, action.accountId]
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
  const actionTimeoutsRef = useRef<Map<string, number>>(new Map());
  const copyFeedbackTimeoutRef = useRef<number | undefined>(undefined);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);
  const [addAccountModalOpen, setAddAccountModalOpen] = useState(false);
  const [addAccountTab, setAddAccountTab] = useState<"oauth" | "import">("oauth");
  const [oauthSession, setOauthSession] = useState<DashboardOAuthSessionDescriptor | undefined>();
  const [oauthFlowStarted, setOauthFlowStarted] = useState(false);
  const [confirmCancelOauthOpen, setConfirmCancelOauthOpen] = useState(false);
  const [oauthCallbackUrl, setOauthCallbackUrl] = useState("");
  const [oauthError, setOauthError] = useState<string | undefined>();
  const [importJsonText, setImportJsonText] = useState("");
  const [importJsonError, setImportJsonError] = useState<string | undefined>();
  const [importPreview, setImportPreview] = useState<CodexImportPreviewSummary | undefined>();
  const [importResult, setImportResult] = useState<CodexImportResultSummary | undefined>();
  const [importRecoveryMode, setImportRecoveryMode] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareModalJson, setShareModalJson] = useState("");
  const [sharePreviewExpanded, setSharePreviewExpanded] = useState(false);
  const [copyFeedbackKey, setCopyFeedbackKey] = useState<string | null>(null);

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
          if (event.data.status === "failed") {
            if (event.data.action === "importSharedJson" || event.data.action === "previewImportSharedJson") {
              setImportJsonError(event.data.error);
            }
            if (
              event.data.action === "prepareOAuthSession" ||
              event.data.action === "completeOAuthSession" ||
              event.data.action === "startOAuthAutoFlow"
            ) {
              if (event.data.action === "completeOAuthSession" || event.data.action === "startOAuthAutoFlow") {
                setOauthFlowStarted(false);
              }
              setOauthError(event.data.error);
            }
            return;
          }
          if (event.data.action === "previewImportSharedJson" && event.data.payload?.importPreview) {
            setImportPreview(event.data.payload.importPreview);
            setImportResult(undefined);
            setImportJsonError(undefined);
            return;
          }

          if (event.data.action === "shareTokens" && event.data.payload?.sharedJson) {
            setShareModalJson(event.data.payload.sharedJson);
            setSharePreviewExpanded(false);
            setShareModalOpen(true);
            return;
          }

          if (event.data.action === "prepareOAuthSession" && event.data.payload?.oauthSession) {
            setOauthSession(event.data.payload.oauthSession);
            setOauthFlowStarted(false);
            setOauthError(undefined);
            return;
          }

          if (event.data.action === "completeOAuthSession" || event.data.action === "startOAuthAutoFlow") {
            setOauthFlowStarted(false);
            setOauthCallbackUrl("");
            setOauthSession(undefined);
            setOauthError(undefined);
            setAddAccountModalOpen(false);
            setAddAccountTab("oauth");
            setImportRecoveryMode(false);
            return;
          }

          if (
            event.data.action === "importSharedJson" ||
            event.data.action === "restoreFromBackup" ||
            event.data.action === "restoreFromAuthJson"
          ) {
            setImportJsonError(undefined);
            if (event.data.action === "importSharedJson") {
              setImportResult(event.data.payload?.importResult);
            }
          }
          return;
        default:
          return;
      }
    };

    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (shareModalOpen) {
          setShareModalOpen(false);
          return;
        }
        if (confirmCancelOauthOpen) {
          setConfirmCancelOauthOpen(false);
          return;
        }
        if (addAccountModalOpen) {
          closeAddAccountModal();
          return;
        }
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
  }, [addAccountModalOpen, confirmCancelOauthOpen, shareModalOpen]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      dispatch({ type: "tick", now: Date.now() });
    }, 30_000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const activeRequestIds = new Set(state.pendingActions.map((request) => request.requestId));

    state.pendingActions.forEach((request) => {
      if (actionTimeoutsRef.current.has(request.requestId)) {
        return;
      }

      const timeoutId = window.setTimeout(() => {
        dispatch({ type: "resolve-action", requestId: request.requestId });
      }, getActionTimeoutMs(request.action));

      actionTimeoutsRef.current.set(request.requestId, timeoutId);
    });

    actionTimeoutsRef.current.forEach((timeoutId, requestId) => {
      if (activeRequestIds.has(requestId)) {
        return;
      }

      window.clearTimeout(timeoutId);
      actionTimeoutsRef.current.delete(requestId);
    });
  }, [state.pendingActions]);

  useEffect(() => {
    return () => {
      actionTimeoutsRef.current.forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
      actionTimeoutsRef.current.clear();
      if (copyFeedbackTimeoutRef.current !== undefined) {
        window.clearTimeout(copyFeedbackTimeoutRef.current);
      }
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
  const showCopyFeedback = (key: string) => {
    setCopyFeedbackKey(key);
    if (copyFeedbackTimeoutRef.current !== undefined) {
      window.clearTimeout(copyFeedbackTimeoutRef.current);
    }
    copyFeedbackTimeoutRef.current = window.setTimeout(() => {
      setCopyFeedbackKey((current) => (current === key ? null : current));
      copyFeedbackTimeoutRef.current = undefined;
    }, 2000);
  };

  const patchSettings = (patch: Partial<DashboardSettings>): void => {
    dispatch({ type: "settings-patch", patch });
  };

  const sendAction = (
    action: DashboardActionName,
    accountId?: string,
    payload?: Extract<DashboardClientMessage, { type: "dashboard:action" }>["payload"]
  ): void => {
    const requestId = createActionRequestId();
    dispatch({
      type: "request-action",
      request: {
        requestId,
        action,
        accountId,
        requestedAt: Date.now()
      }
    });
    postMessageToHost({
      type: "dashboard:action",
      action,
      accountId,
      requestId,
      payload
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

  const hasGlobalPendingAction = state.pendingActions.some(
    (request) => request.accountId == null && BLOCKING_GLOBAL_ACTIONS.has(request.action)
  );
  const selectedAccountIds = new Set(state.selectedAccountIds);
  const selectedCount = state.selectedAccountIds.length;
  const isAccountBusy = (accountId: string): boolean =>
    hasGlobalPendingAction || state.pendingActions.some((request) => request.accountId === accountId);
  const privacyToggleLabel = state.privacyMode ? snapshot.copy.showSensitive : snapshot.copy.hideSensitive;
  const prepareOAuthPending = isActionPending("prepareOAuthSession");
  const startOAuthAutoPending = isActionPending("startOAuthAutoFlow");
  const completeOAuthPending = isActionPending("completeOAuthSession");
  const importSharedPending = isActionPending("importSharedJson");
  const previewImportPending = isActionPending("previewImportSharedJson");
  const restoreBackupPending = isActionPending("restoreFromBackup");
  const restoreAuthPending = isActionPending("restoreFromAuthJson");
  const sharePending = isActionPending("shareTokens");
  const downloadSharePending = isActionPending("downloadJsonFile");
  const batchRefreshPending = isActionPending("batchRefresh");
  const batchResyncPending = isActionPending("batchResyncProfile");
  const batchRemovePending = isActionPending("batchRemove");
  const batchTagsPending = state.pendingActions.some(
    (request) => request.action === "updateTags" && request.accountId == null
  );
  const maskedShareModalJson = maskSharedJson(shareModalJson);
  const sharePreviewValue = sharePreviewExpanded ? shareModalJson : maskedShareModalJson;
  const invalidAccountCount = snapshot.accounts.filter(
    (account) =>
      !account.dismissedHealth &&
      (account.healthKind === "reauthorize" ||
        account.healthKind === "refresh_failed" ||
        account.healthKind === "disabled" ||
        account.healthKind === "quota")
  ).length;
  const validAccountCount = snapshot.accounts.length - invalidAccountCount;
  const importSingleExample = `{
  "tokens": {
    "id_token": "eyJ...",
    "access_token": "eyJ...",
    "refresh_token": "rt_..."
  }
}`;
  const importBatchExample = `[
  {
    "id": "codex_demo_1",
    "email": "user@example.com",
    "tokens": {
      "id_token": "eyJ...",
      "access_token": "eyJ...",
      "refresh_token": "rt_..."
    },
    "created_at": 1730000000,
    "last_used": 1730000000
  }
]`;

  const openAddAccountModal = (): void => {
    setAddAccountModalOpen(true);
    setAddAccountTab("oauth");
    setImportRecoveryMode(false);
    setOauthSession(undefined);
    setOauthFlowStarted(false);
    setOauthCallbackUrl("");
    setOauthError(undefined);
    setImportJsonError(undefined);
    setImportPreview(undefined);
    setImportResult(undefined);
    sendAction("prepareOAuthSession");
  };

  const performCloseAddAccountModal = (): void => {
    if (oauthSession) {
      sendAction("cancelOAuthSession", undefined, {
        oauthSessionId: oauthSession.sessionId
      });
    }
    setAddAccountModalOpen(false);
    setImportRecoveryMode(false);
    setOauthCallbackUrl("");
    setOauthError(undefined);
    setOauthSession(undefined);
    setOauthFlowStarted(false);
    setImportJsonError(undefined);
    setImportPreview(undefined);
    setImportResult(undefined);
  };

  const closeAddAccountModal = (): void => {
    if (oauthFlowStarted || completeOAuthPending) {
      setConfirmCancelOauthOpen(true);
      return;
    }
    performCloseAddAccountModal();
  };

  const openRecoveryImportModal = (): void => {
    setAddAccountModalOpen(true);
    setAddAccountTab("import");
    setImportRecoveryMode(true);
    setImportJsonError(undefined);
    setImportPreview(undefined);
    setImportResult(undefined);
  };

  const handleShareTokens = (): void => {
    if (!selectedCount) {
      return;
    }
    sendAction("shareTokens", undefined, { accountIds: state.selectedAccountIds });
  };

  const handleEditAccountTags = (account: DashboardAccountViewModel): void => {
    sendAction("updateTags", account.id, {
      mode: "set"
    });
  };

  const handleBatchTagMutation = (mode: "add" | "remove"): void => {
    if (!selectedCount) {
      return;
    }
    sendAction("updateTags", undefined, {
      accountIds: state.selectedAccountIds,
      mode
    });
  };

  const handleAutoSwitchLock = (): void => {
    if (!activeAccount) {
      return;
    }
    sendAction("setAutoSwitchLock", activeAccount.id, {
      lockMinutes: activeAccount.autoSwitchLockedUntil ? 0 : resolveLockMinutes(snapshot.settings.autoSwitchLockMinutes)
    });
  };

  return (
    <>
      <div class={`panel ${state.privacyMode ? "privacy-hidden" : ""}`}>
        {snapshot.indexHealth.status !== "healthy" ? (
          <section class="section">
            <RecoveryPanel
              copy={snapshot.copy}
              health={snapshot.indexHealth}
              restoreBackupPending={restoreBackupPending}
              restoreAuthPending={restoreAuthPending}
              restoreJsonPending={importSharedPending && importRecoveryMode}
              onRestoreBackup={() => sendAction("restoreFromBackup")}
              onRestoreAuth={() => sendAction("restoreFromAuthJson")}
              onImportJson={openRecoveryImportModal}
            />
          </section>
        ) : null}
        <section class="section">
          <div class="hero">
            <div class="brand">
              <img class="logo" src={snapshot.logoUri} alt="Codex Accounts Manager logo" />
              <div>
                <h1>Codex Accounts Manager</h1>
                <p>{snapshot.brandSub}</p>
              </div>
            </div>
            <div class="hero-settings">
              <button
                id="githubProjectButton"
                class="settings-btn action-btn github-project-btn"
                type="button"
                title={snapshot.copy.githubProject}
                aria-label={snapshot.copy.githubProject}
                onClick={() => sendAction("openExternalUrl", undefined, { url: GITHUB_PROJECT_URL })}
              >
                <span class="button-face">
                  <span class="button-icon">
                    <GitHubIcon />
                  </span>
                </span>
                <span class="button-tip" aria-hidden="true">
                  {snapshot.copy.githubProjectTip}
                </span>
              </button>
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
                disabled={hasGlobalPendingAction || isActionPending("refreshView")}
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
            disabled={hasGlobalPendingAction || snapshot.indexHealth.status === "corrupted_unrecoverable"}
            addPending={prepareOAuthPending}
            importPending={isActionPending("importCurrent")}
            refreshAllPending={isActionPending("refreshAll")}
            onToggleAutoSwitchLock={handleAutoSwitchLock}
            onAddAccount={openAddAccountModal}
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
                  <span class="header-count-badge">
                    {formatSavedAccountsSummary(
                      snapshot.lang,
                      snapshot.accounts.length,
                      validAccountCount,
                      invalidAccountCount
                    )}
                  </span>
                </div>
                <div class="header-sub">{snapshot.copy.savedAccountsSub}</div>
              </div>
              {selectedCount > 0 ? (
                <BatchSelectionBar
                  copy={snapshot.copy}
                  selectedCount={selectedCount}
                  refreshPending={batchRefreshPending}
                  resyncPending={batchResyncPending}
                  removePending={batchRemovePending}
                  sharePending={sharePending}
                  tagsPending={batchTagsPending}
                  onRefresh={() => sendAction("batchRefresh", undefined, { accountIds: state.selectedAccountIds })}
                  onResync={() => sendAction("batchResyncProfile", undefined, { accountIds: state.selectedAccountIds })}
                  onRemove={() => sendAction("batchRemove", undefined, { accountIds: state.selectedAccountIds })}
                  onShare={handleShareTokens}
                  onAddTags={() => handleBatchTagMutation("add")}
                  onRemoveTags={() => handleBatchTagMutation("remove")}
                />
              ) : null}
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
                  reloadPromptPending={isActionPending("reloadPrompt", account.id)}
                  switchPending={isActionPending("switch", account.id)}
                  reauthorizePending={isActionPending("reauthorize", account.id)}
                  resyncProfilePending={isActionPending("resyncProfile", account.id)}
                  refreshPending={isActionPending("refresh", account.id)}
                  detailsPending={isActionPending("details", account.id)}
                  removePending={isActionPending("remove", account.id)}
                  togglePending={isActionPending("toggleStatusBar", account.id)}
                  updateTagsPending={isActionPending("updateTags", account.id)}
                  selected={selectedAccountIds.has(account.id)}
                  onToggleSelected={() => dispatch({ type: "toggle-select", accountId: account.id })}
                  onEditTags={() => handleEditAccountTags(account)}
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
                <div class="settings-toggle-list">
                  <SettingsPreferenceRow
                    title={snapshot.copy.autoSwitchPreferSameEmailTitle}
                    sub={snapshot.copy.autoSwitchPreferSameEmailSub}
                    enabled={snapshot.settings.autoSwitchPreferSameEmail}
                    onToggle={(enabled) => {
                      patchSettings({ autoSwitchPreferSameEmail: enabled });
                      sendSetting("autoSwitchPreferSameEmail", enabled);
                    }}
                  />
                  <SettingsPreferenceRow
                    title={snapshot.copy.autoSwitchPreferSameTagTitle}
                    sub={snapshot.copy.autoSwitchPreferSameTagSub}
                    enabled={snapshot.settings.autoSwitchPreferSameTag}
                    onToggle={(enabled) => {
                      patchSettings({ autoSwitchPreferSameTag: enabled });
                      sendSetting("autoSwitchPreferSameTag", enabled);
                    }}
                  />
                </div>
                <div class="settings-block-head">
                  <div class="settings-block-title">{snapshot.copy.autoSwitchLockMinutesTitle}</div>
                  <div class="settings-block-sub">{snapshot.copy.autoSwitchLockMinutesSub}</div>
                </div>
                <SettingsDiscreteSlider
                  value={snapshot.settings.autoSwitchLockMinutes}
                  values={AUTO_SWITCH_LOCK_VALUES}
                  accent="violet"
                  valueLabel={(value) =>
                    value === 0 ? snapshot.copy.autoSwitchLockOff : formatTemplate(snapshot.copy.autoSwitchLockValueTemplate, value)
                  }
                  description={(value) =>
                    value === 0
                      ? snapshot.copy.autoSwitchLockMinutesSub
                      : formatTemplate(snapshot.copy.autoSwitchLockValueDescTemplate, value)
                  }
                  scaleValues={AUTO_SWITCH_LOCK_VALUES}
                  onPreview={(value) => patchSettings({ autoSwitchLockMinutes: value })}
                  onCommit={(value) => {
                    patchSettings({ autoSwitchLockMinutes: value });
                    sendSetting("autoSwitchLockMinutes", value);
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
            <SettingsToggleBlock
              title={snapshot.copy.tokenAutomationTitle}
              sub={snapshot.copy.tokenAutomationSub}
              enabled={snapshot.settings.backgroundTokenRefreshEnabled}
              onToggle={(enabled) => {
                patchSettings({ backgroundTokenRefreshEnabled: enabled });
                sendSetting("backgroundTokenRefreshEnabled", enabled);
              }}
            >
              <div class={`settings-stack ${snapshot.settings.backgroundTokenRefreshEnabled ? "" : "is-hidden"}`}>
                <div class="settings-note-list">
                  <div class="settings-note-item">
                    <span>{snapshot.copy.tokenAutomationLastCheck}</span>
                    <strong>{formatTimestamp(snapshot.tokenAutomation.lastCheckAt, snapshot.copy.never)}</strong>
                  </div>
                  <div class="settings-note-item">
                    <span>{snapshot.copy.tokenAutomationLastRefresh}</span>
                    <strong>{formatTimestamp(snapshot.tokenAutomation.lastRefreshAt, snapshot.copy.never)}</strong>
                  </div>
                  <div class="settings-note-item">
                    <span>{snapshot.copy.tokenAutomationNextCheck}</span>
                    <strong>{formatTimestamp(snapshot.tokenAutomation.nextCheckAt, snapshot.copy.never)}</strong>
                  </div>
                  <div class="settings-note-item">
                    <span>{snapshot.copy.tokenAutomationLastFailure}</span>
                    <strong>{snapshot.tokenAutomation.lastFailureMessage ?? snapshot.copy.never}</strong>
                  </div>
                </div>
              </div>
            </SettingsToggleBlock>
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

      <ModalShell
        open={addAccountModalOpen}
        title={snapshot.copy.addAccountModalTitle}
        closeLabel={snapshot.copy.closeModal}
        className="dashboard-modal-compact"
        onClose={closeAddAccountModal}
      >
        <div class="modal-tabs" role="tablist" aria-label={snapshot.copy.addAccountModalTitle}>
          <button
            class={`modal-tab ${addAccountTab === "oauth" ? "active" : ""}`}
            type="button"
            onClick={() => {
              setAddAccountTab("oauth");
              setImportRecoveryMode(false);
              setImportJsonError(undefined);
              setImportPreview(undefined);
              setImportResult(undefined);
            }}
          >
            <span class="modal-tab-icon" aria-hidden="true">
              <GlobeIcon />
            </span>
            {snapshot.copy.oauthTab}
          </button>
          <button
            class={`modal-tab ${addAccountTab === "import" ? "active" : ""}`}
            type="button"
            onClick={() => {
              setAddAccountTab("import");
              setOauthError(undefined);
            }}
          >
            <span class="modal-tab-icon" aria-hidden="true">
              <ImportIcon />
            </span>
            {snapshot.copy.importJsonTab}
          </button>
        </div>
        {addAccountTab === "oauth" ? (
          <div class="modal-stack">
            <div class="modal-field">
              <div class="modal-label">{snapshot.copy.authorizationLink}</div>
              <div class="modal-input-row">
                <input
                  class="modal-input"
                  type="text"
                  readOnly
                  value={oauthSession?.authUrl ?? ""}
                  placeholder={snapshot.copy.authorizationLink}
                />
                <button
                  class={`modal-mini-btn modal-icon-btn ${copyFeedbackKey === "oauth-link" ? "is-success" : ""}`}
                  type="button"
                  disabled={!oauthSession?.authUrl}
                  aria-label={copyFeedbackKey === "oauth-link" ? snapshot.copy.copySuccess : snapshot.copy.copyLink}
                  onClick={() => {
                    if (!oauthSession?.authUrl) {
                      return;
                    }
                    setOauthFlowStarted(true);
                    sendAction("copyText", undefined, { text: oauthSession.authUrl });
                    showCopyFeedback("oauth-link");
                  }}
                >
                  {copyFeedbackKey === "oauth-link" ? <SuccessIcon /> : <CopyIcon />}
                </button>
              </div>
            </div>
            <button
              class="modal-primary-btn"
              type="button"
              disabled={!oauthSession?.authUrl || startOAuthAutoPending}
              onClick={() => {
                if (!oauthSession?.authUrl) {
                  return;
                }
                setOauthFlowStarted(true);
                setOauthError(undefined);
                sendAction("startOAuthAutoFlow", undefined, {
                  oauthSessionId: oauthSession.sessionId
                });
              }}
            >
              <span class="modal-btn-icon" aria-hidden="true">
                <GlobeIcon />
              </span>
              {startOAuthAutoPending ? "..." : snapshot.copy.openInBrowser}
            </button>
            <div class="modal-field">
              <div class="modal-label">{snapshot.copy.manualCallbackLabel}</div>
              <div class="modal-input-row">
                <input
                  class="modal-input"
                  type="text"
                  value={oauthCallbackUrl}
                  placeholder={snapshot.copy.manualCallbackPlaceholder}
                  onInput={(event) => setOauthCallbackUrl(event.currentTarget.value)}
                />
                <button
                  class="modal-secondary-btn"
                  type="button"
                  disabled={!oauthSession || !oauthCallbackUrl.trim() || completeOAuthPending}
                  onClick={() => {
                    if (!oauthSession) {
                      return;
                    }
                    setOauthFlowStarted(true);
                    setOauthError(undefined);
                    sendAction("completeOAuthSession", undefined, {
                      oauthSessionId: oauthSession.sessionId,
                      callbackUrl: oauthCallbackUrl
                    });
                  }}
                >
                  {completeOAuthPending ? "..." : snapshot.copy.authorizedContinue}
                </button>
              </div>
            </div>
            <div class="modal-note">{snapshot.copy.oauthReadyHint}</div>
            {oauthError ? <div class="modal-error">{oauthError}</div> : null}
          </div>
        ) : (
          <div class="modal-stack">
            <div class="modal-note">{snapshot.copy.importJsonHint}</div>
            <details class="modal-disclosure">
              <summary>{snapshot.copy.importJsonExamplesSummary}</summary>
              <div class="modal-disclosure-body">
                <div class="modal-note">{snapshot.copy.importJsonExamplesHint}</div>
                <div class="modal-example-block">
                  <div class="modal-example-label">{snapshot.copy.importJsonSingleExampleLabel}</div>
                  <pre class="modal-example-code">{importSingleExample}</pre>
                </div>
                <div class="modal-example-block">
                  <div class="modal-example-label">{snapshot.copy.importJsonBatchExampleLabel}</div>
                  <pre class="modal-example-code">{importBatchExample}</pre>
                </div>
              </div>
            </details>
            <input
              ref={importFileInputRef}
              class="modal-file-input"
              type="file"
              accept=".json,application/json"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (!file) {
                  return;
                }

                const reader = new FileReader();
                reader.onload = () => {
                  setImportJsonError(undefined);
                  setImportPreview(undefined);
                  setImportResult(undefined);
                  setImportJsonText(typeof reader.result === "string" ? reader.result : "");
                };
                reader.onerror = () => {
                  setImportJsonError(snapshot.copy.importJsonFileReadError);
                };
                reader.readAsText(file);
                event.currentTarget.value = "";
              }}
            />
            <textarea
              class="modal-textarea"
              value={importJsonText}
              placeholder={snapshot.copy.importJsonPlaceholder}
              onInput={(event) => {
                setImportJsonText(event.currentTarget.value);
                setImportJsonError(undefined);
                setImportPreview(undefined);
                setImportResult(undefined);
              }}
            />
            {importPreview ? (
              <ImportPreviewPanel copy={snapshot.copy} summary={importPreview} />
            ) : null}
            {importResult ? <ImportResultPanel copy={snapshot.copy} summary={importResult} /> : null}
            {importJsonError ? <div class="modal-error">{importJsonError}</div> : null}
            <div class="modal-actions">
              <button
                class="modal-secondary-btn"
                type="button"
                onClick={() => importFileInputRef.current?.click()}
              >
                <span class="modal-btn-icon" aria-hidden="true">
                  <ImportIcon />
                </span>
                {snapshot.copy.importJsonChooseFile}
              </button>
              <button
                class="modal-secondary-btn"
                type="button"
                disabled={!importJsonText.trim() || previewImportPending}
                onClick={() => {
                  setImportJsonError(undefined);
                  sendAction("previewImportSharedJson", undefined, {
                    jsonText: importJsonText
                  });
                }}
              >
                {previewImportPending ? "..." : snapshot.copy.importJsonValidate}
              </button>
              <button
                class="modal-primary-btn"
                type="button"
                disabled={!importJsonText.trim() || !importPreview || importPreview.valid <= 0 || importSharedPending}
                onClick={() => {
                  setImportJsonError(undefined);
                  sendAction("importSharedJson", undefined, {
                    jsonText: importJsonText,
                    recoveryMode: importRecoveryMode
                  });
                }}
                >
                  {!importSharedPending ? (
                    <span class="modal-btn-icon" aria-hidden="true">
                      <ImportIcon />
                    </span>
                  ) : null}
                  {importSharedPending ? "..." : snapshot.copy.importJsonSubmit}
                </button>
            </div>
          </div>
        )}
      </ModalShell>

      <ModalShell
        open={confirmCancelOauthOpen}
        title={snapshot.copy.addAccountModalTitle}
        closeLabel={snapshot.copy.closeModal}
        className="dashboard-modal-compact dashboard-confirm-modal"
        onClose={() => setConfirmCancelOauthOpen(false)}
      >
        <div class="modal-stack">
          <div class="modal-note">{snapshot.copy.cancelOauthConfirm}</div>
          <div class="modal-actions">
            <button
              class="modal-secondary-btn"
              type="button"
              onClick={() => setConfirmCancelOauthOpen(false)}
            >
              {snapshot.copy.continueOauthBtn}
            </button>
            <button
              class="modal-primary-btn"
              type="button"
              onClick={() => {
                setConfirmCancelOauthOpen(false);
                performCloseAddAccountModal();
              }}
            >
              {snapshot.copy.cancelOauthBtn}
            </button>
          </div>
        </div>
      </ModalShell>

      <ModalShell
        open={shareModalOpen}
        title={snapshot.copy.shareTokenModalTitle}
        closeLabel={snapshot.copy.closeModal}
        className="dashboard-modal-wide"
        onClose={() => setShareModalOpen(false)}
      >
        <div class="modal-stack">
          <div class="modal-toolbar">
            <button
              class={`modal-toolbar-btn ${sharePreviewExpanded ? "active" : ""}`}
              type="button"
              onClick={() => setSharePreviewExpanded((current) => !current)}
            >
              <span class="modal-btn-icon" aria-hidden="true">
                {sharePreviewExpanded ? <EyeOffIcon /> : <EyeIcon />}
              </span>
              {snapshot.copy.jsonPreview}
            </button>
            <button
              class={`modal-toolbar-btn ${copyFeedbackKey === "share-json" ? "is-success" : ""}`}
              type="button"
              onClick={() => {
                sendAction("copyText", undefined, { text: shareModalJson });
                showCopyFeedback("share-json");
              }}
            >
              <span class="modal-btn-icon" aria-hidden="true">
                {copyFeedbackKey === "share-json" ? <SuccessIcon /> : <CopyIcon />}
              </span>
              {copyFeedbackKey === "share-json" ? snapshot.copy.copySuccess : snapshot.copy.copyJson}
            </button>
            <button
              class="modal-toolbar-btn"
              type="button"
              disabled={downloadSharePending}
              onClick={() =>
                sendAction("downloadJsonFile", undefined, {
                  filename: createShareFileName(),
                  text: shareModalJson
                })
              }
            >
              <span class="modal-btn-icon" aria-hidden="true">
                <DownloadIcon />
              </span>
              {snapshot.copy.downloadJson}
            </button>
          </div>
          <div class="modal-note">
            {formatTemplate(snapshot.copy.shareSelectedCount, {
              count: selectedCount
            })}
          </div>
          <div class="modal-note">{snapshot.copy.shareTokenModeHint}</div>
          <textarea class="modal-textarea share-preview" readOnly value={sharePreviewValue} />
        </div>
      </ModalShell>
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
  onToggleAutoSwitchLock: () => void;
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
          <div class="overview-account-email">{getSensitiveDisplayValue(account.email, privacyMode, "email")}</div>
          <div class="overview-account-workspace">
            {getSensitiveDisplayValue(account.accountName, privacyMode, "name", copy.unknown)}
          </div>
          {account.tags.length ? (
            <div class="account-tag-row">{renderTagList(account.tags)}</div>
          ) : null}
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

function RecoveryPanel(props: {
  copy: DashboardCopy;
  health: DashboardState["indexHealth"];
  restoreBackupPending: boolean;
  restoreAuthPending: boolean;
  restoreJsonPending: boolean;
  onRestoreBackup: () => void;
  onRestoreAuth: () => void;
  onImportJson: () => void;
}) {
  const description =
    props.health.status === "restored_from_backup" ? props.copy.recoveryRestored : props.copy.recoveryCorrupted;

  return (
    <div class={`recovery-banner ${props.health.status === "corrupted_unrecoverable" ? "is-danger" : ""}`}>
      <div class="recovery-banner-body">
        <div class="recovery-banner-title">{props.copy.recoveryTitle}</div>
        <div class="recovery-banner-desc">{description}</div>
        <div class="recovery-banner-meta">
          <span>
            {props.copy.recoveryBackups}: {props.health.availableBackups}
          </span>
          {props.health.lastErrorMessage ? (
            <span>
              {props.copy.recoveryLastError}: {props.health.lastErrorMessage}
            </span>
          ) : null}
        </div>
      </div>
      <div class="recovery-banner-actions">
        <ActionButton
          class="toolbar-btn"
          pending={props.restoreBackupPending}
          onClick={props.onRestoreBackup}
          disabled={props.restoreAuthPending || props.restoreJsonPending}
        >
          {props.copy.recoveryRestoreBackupBtn}
        </ActionButton>
        <ActionButton
          class="toolbar-btn"
          pending={props.restoreAuthPending}
          onClick={props.onRestoreAuth}
          disabled={props.restoreBackupPending || props.restoreJsonPending}
        >
          {props.copy.recoveryRestoreAuthBtn}
        </ActionButton>
        <ActionButton
          class="toolbar-btn"
          pending={props.restoreJsonPending}
          onClick={props.onImportJson}
          disabled={props.restoreBackupPending || props.restoreAuthPending}
        >
          {props.copy.recoveryImportJsonBtn}
        </ActionButton>
      </div>
    </div>
  );
}

function BatchSelectionBar(props: {
  copy: DashboardCopy;
  selectedCount: number;
  tagsPending: boolean;
  refreshPending: boolean;
  resyncPending: boolean;
  removePending: boolean;
  sharePending: boolean;
  onRefresh: () => void;
  onResync: () => void;
  onRemove: () => void;
  onShare: () => void;
  onAddTags: () => void;
  onRemoveTags: () => void;
}) {
  return (
    <div class="batch-bar">
      <div class="batch-bar-actions">
        <ActionButton class="toolbar-btn" pending={props.tagsPending} onClick={props.onAddTags}>
          {props.copy.addTagsBtn}
        </ActionButton>
        <ActionButton class="toolbar-btn" pending={props.tagsPending} onClick={props.onRemoveTags}>
          {props.copy.removeTagsBtn}
        </ActionButton>
        <ActionButton class="toolbar-btn" pending={props.refreshPending} onClick={props.onRefresh}>
          {props.copy.batchRefreshBtn}
        </ActionButton>
        <ActionButton class="toolbar-btn" pending={props.resyncPending} onClick={props.onResync}>
          {props.copy.batchResyncBtn}
        </ActionButton>
        <ActionButton class="toolbar-btn" pending={props.sharePending} onClick={props.onShare}>
          {props.copy.batchExportBtn}
        </ActionButton>
        <ActionButton class="toolbar-btn" pending={props.removePending} onClick={props.onRemove}>
          {props.copy.batchRemoveBtn}
        </ActionButton>
      </div>
      <div class="batch-bar-count">{formatTemplate(props.copy.batchSelectedCount, { count: props.selectedCount })}</div>
    </div>
  );
}

function ImportPreviewPanel(props: { copy: DashboardCopy; summary: CodexImportPreviewSummary }) {
  return (
    <div class="modal-summary-card">
      <div class="modal-summary-title">{props.copy.importJsonSummaryTitle}</div>
      <div class="modal-summary-grid">
        <span>{props.copy.importJsonSummaryTotal}: {props.summary.total}</span>
        <span>{props.copy.importJsonSummaryValid}: {props.summary.valid}</span>
        <span>{props.copy.importJsonSummaryOverwrite}: {props.summary.overwriteCount}</span>
        <span>{props.copy.importJsonSummaryInvalid}: {props.summary.invalidCount}</span>
      </div>
      {props.summary.invalidEntries.length ? (
        <div class="modal-summary-list">
          <div class="modal-summary-list-title">{props.copy.importJsonSummaryFailures}</div>
          {props.summary.invalidEntries.map((entry) => (
            <div key={`${entry.index}-${entry.email ?? entry.accountId ?? entry.message}`} class="modal-summary-item">
              #{entry.index + 1} {entry.email ?? entry.accountId ?? "unknown"} · {entry.message}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ImportResultPanel(props: { copy: DashboardCopy; summary: CodexImportResultSummary }) {
  return (
    <div class="modal-summary-card is-success">
      <div class="modal-summary-title">{props.copy.importJsonResultsTitle}</div>
      <div class="modal-summary-grid">
        <span>{props.copy.importJsonResultsSuccess}: {props.summary.successCount}</span>
        <span>{props.copy.importJsonResultsOverwrite}: {props.summary.overwriteCount}</span>
        <span>{props.copy.importJsonResultsFailed}: {props.summary.failedCount}</span>
      </div>
      {props.summary.failures.length ? (
        <div class="modal-summary-list">
          {props.summary.failures.map((entry) => (
            <div key={`${entry.index}-${entry.email ?? entry.accountId ?? entry.message}`} class="modal-summary-item">
              #{entry.index + 1} {entry.email ?? entry.accountId ?? "unknown"} · {entry.message}
            </div>
          ))}
        </div>
      ) : null}
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
    action:
      | "details"
      | "switch"
      | "reloadPrompt"
      | "reauthorize"
      | "resyncProfile"
      | "refresh"
      | "remove"
      | "toggleStatusBar",
    accountId?: string
  ) => void;
}) {
  const { account, copy, settings, now, onAction, privacyMode } = props;
  const accountIdDisplay = getSensitiveDisplayValue(account.accountId ?? account.userId, privacyMode, "id", "-");
  const selectionLabel = props.selected ? copy.deselectAccount : copy.selectAccount;

  return (
    <article
      class={`saved-card ${account.isActive ? "active" : ""} ${props.busy ? "is-busy" : ""} ${props.selected ? "selected" : ""}`}
    >
      <div class="saved-head">
        <div class="saved-top-actions">
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
          <button
            class="saved-control saved-edit-tags-btn"
            type="button"
            aria-label={copy.editTagsBtn}
            disabled={props.busy}
            onClick={props.onEditTags}
          >
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
              onClick={props.onToggleSelected}
            >
              <span class="saved-select-toggle-mark" aria-hidden="true"></span>
              <span class="saved-control-tip align-left below" aria-hidden="true">
                {selectionLabel}
              </span>
            </button>
            <span class="saved-title-text">{getSensitiveDisplayValue(account.email, privacyMode, "email")}</span>
          </h3>
          <div class="saved-sub">{getSensitiveDisplayValue(account.accountName, privacyMode, "name", copy.unknown)}</div>
          <div class="saved-sub">
            {copy.login}: {account.authProviderLabel}
          </div>
          <div class="saved-sub truncate" title={`${copy.accountId}: ${accountIdDisplay}`}>
            {copy.accountId}: {accountIdDisplay}
          </div>
          <div class="saved-meta">
            {account.isActive ? <span class="pill active">{copy.primaryAccount}</span> : null}
            {account.isCurrentWindowAccount ? <span class="pill active">{copy.current}</span> : null}
            <span class="pill plan">{account.planTypeLabel}</span>
            {renderHealthPill(account)}
          </div>
          <div class="saved-tags-row">
            <div class="account-tag-row">{renderTagList(account.tags)}</div>
          </div>
          {account.lastAutoSwitchReason ? (
            <div class="saved-switch-reason">
              <strong>{copy.autoSwitchReasonTitle}:</strong> {formatAutoSwitchReasonSummary(account.lastAutoSwitchReason, copy)}
            </div>
          ) : null}
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
        {account.healthKind === "reauthorize" && !account.dismissedHealth ? (
          <ActionButton
            icon={renderReauthorizeIcon()}
            iconOnly
            label={copy.reauthorizeBtn}
            pending={props.reauthorizePending}
            disabled={props.busy}
            onClick={() => onAction("reauthorize", account.id)}
          />
        ) : null}
        {(account.healthKind === "disabled" || account.healthKind === "quota") && !account.dismissedHealth ? (
          <ActionButton
            icon={renderRefreshIcon()}
            iconOnly
            label={copy.resyncProfileBtn}
            pending={props.resyncProfilePending}
            disabled={props.busy}
            onClick={() => onAction("resyncProfile", account.id)}
          />
        ) : null}
        <ActionButton
          icon={renderSwitchIcon()}
          iconOnly
          label={copy.switchBtn}
          pending={props.switchPending}
          disabled={props.busy}
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
        <ActionButton
          icon={renderDetailsIcon()}
          iconOnly
          label={copy.detailsBtn}
          pending={props.detailsPending}
          disabled={props.busy}
          onClick={() => onAction("details", account.id)}
        />
        <ActionButton
          icon={renderRemoveIcon()}
          iconOnly
          label={copy.removeBtn}
          pending={props.removePending}
          disabled={props.busy}
          onClick={() => onAction("remove", account.id)}
        />
      </div>
    </article>
  );
}

function ActionButton(props: {
  class?: string;
  pending?: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon?: ComponentChildren;
  iconOnly?: boolean;
  label?: string;
  tooltip?: string;
  children?: ComponentChildren;
}) {
  const className = [props.class, "action-btn", props.pending ? "is-pending" : "", props.iconOnly ? "icon-only" : ""]
    .filter(Boolean)
    .join(" ");
  const accessibleLabel =
    props.label ?? (typeof props.children === "string" ? props.children : typeof props.children === "number" ? String(props.children) : undefined);

  return (
    <button
      class={className}
      type="button"
      disabled={props.disabled}
      aria-busy={props.pending}
      aria-label={accessibleLabel}
      onClick={props.onClick}
    >
      <span class="button-face">
        {props.pending ? <span class="button-spinner" aria-hidden="true"></span> : null}
        {!props.pending && props.icon ? <span class="button-icon">{props.icon}</span> : null}
        {!props.iconOnly ? <span class="button-label">{props.children}</span> : null}
      </span>
      {props.iconOnly && accessibleLabel ? (
        <span class="button-tip" aria-hidden="true">
          {accessibleLabel}
        </span>
      ) : null}
      {!props.iconOnly && props.tooltip ? (
        <span class="button-tip button-tip-inline" aria-hidden="true">
          {props.tooltip}
        </span>
      ) : null}
    </button>
  );
}

function ModalShell(props: {
  open: boolean;
  title: string;
  closeLabel: string;
  className?: string;
  onClose: () => void;
  children: ComponentChildren;
}) {
  return (
    <div class={`overlay ${props.open ? "open" : ""}`} onClick={props.onClose}>
      <div class={`settings-modal dashboard-modal ${props.className ?? ""}`.trim()} onClick={(event) => event.stopPropagation()}>
        <div class="settings-modal-head">
          <div class="settings-modal-title">{props.title}</div>
          <button class="settings-close" type="button" aria-label={props.closeLabel} onClick={props.onClose}>
            ×
          </button>
        </div>
        <div class="settings-modal-body dashboard-modal-body">{props.children}</div>
      </div>
    </div>
  );
}

function createShareFileName(): string {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");
  const second = String(now.getSeconds()).padStart(2, "0");
  return `codex-accounts-share-${year}${month}${day}-${hour}${minute}${second}.json`;
}

function maskSharedJson(raw: string): string {
  if (!raw.trim()) {
    return raw;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return JSON.stringify(maskSharedValue(parsed), null, 2);
  } catch {
    return raw;
  }
}

function maskSharedValue(value: unknown, parentKey?: string): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => maskSharedValue(item, parentKey));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, maskSharedValue(item, key)])
    );
  }

  if (typeof value !== "string" || !value) {
    return value;
  }

  const sensitiveKeys = new Set([
    "email",
    "user_id",
    "account_id",
    "organization_id",
    "account_name",
    "id_token",
    "access_token",
    "refresh_token",
    "id"
  ]);

  if (parentKey && sensitiveKeys.has(parentKey)) {
    return maskSensitiveString(value);
  }

  return value;
}

function maskSensitiveString(value: string): string {
  if (value.length <= 8) {
    return `${value.slice(0, 1)}***${value.slice(-1)}`;
  }

  return `${value.slice(0, 3)}***${value.slice(-3)}`;
}

function renderSwitchIcon() {
  return (
    <svg viewBox="0 0 1024 1024" aria-hidden="true">
      <path
        d="M575.914667 725.333333a21.397333 21.397333 0 0 1-21.248-21.162666V319.829333A21.184 21.184 0 0 1 576 298.666667c11.776 0 21.333333 9.706667 21.333333 21.162666v333.909334l85.568-85.568a21.226667 21.226667 0 0 1 30.101334 0.064c8.32 8.32 8.213333 21.973333 0.085333 30.101333l-120.832 120.810667a21.141333 21.141333 0 0 1-16.341333 6.186666z m-152.789334-426.325333a21.418667 21.418667 0 0 1 24.896 20.864V704.213333a21.205333 21.205333 0 0 1-21.333333 21.162667c-11.797333 0-21.354667-9.706667-21.354667-21.162667V364.266667l-91.669333 91.605333a21.248 21.248 0 0 1-30.122667-0.064 21.418667 21.418667 0 0 1-0.064-30.101333l120.896-120.810667a21.184 21.184 0 0 1 18.752-5.888z m252.202667-181.290667A425.429333 425.429333 0 0 0 512 85.333333C276.352 85.333333 85.333333 276.352 85.333333 512s191.018667 426.666667 426.666667 426.666667 426.666667-191.018667 426.666667-426.666667c0-56.746667-11.093333-112-32.384-163.328a21.333333 21.333333 0 0 0-39.402667 16.341333A382.762667 382.762667 0 0 1 896 512c0 212.074667-171.925333 384-384 384S128 724.074667 128 512 299.925333 128 512 128c51.114667 0 100.8 9.984 146.986667 29.12a21.333333 21.333333 0 0 0 16.341333-39.402667z"
        fill="currentColor"
      />
    </svg>
  );
}

function renderRefreshIcon() {
  return (
    <svg viewBox="0 0 1024 1024" aria-hidden="true">
      <path
        d="M989.311588 512.085547a36.053318 36.053318 0 0 0-38.613317 33.194652 438.570484 438.570484 0 0 1-138.794609 288.63988A438.186484 438.186484 0 0 1 511.999787 951.978697c-87.039964 0-171.093262-25.258656-243.199899-73.258636a439.63715 439.63715 0 0 1-148.778605-166.698598h99.967959a35.967985 35.967985 0 1 0 0-72.021303H36.010652a35.967985 35.967985 0 0 0-36.010652 36.010652v183.97859a35.967985 35.967985 0 1 0 72.021303 0v-85.973298A513.066453 513.066453 0 0 0 228.863905 938.666702C312.917203 994.517346 410.666496 1024 511.999787 1024c130.005279 0 253.994561-48.810646 349.013188-137.386609a509.653121 509.653121 0 0 0 161.493266-335.914527 35.967985 35.967985 0 0 0-33.194653-38.613317zM988.031588 128.000373a35.967985 35.967985 0 0 0-36.053318 36.010652v85.973298A512.298453 512.298453 0 0 0 795.007669 85.333724 509.439788 509.439788 0 0 0 511.999787 0.000427a510.122454 510.122454 0 0 0-349.013188 137.386609 510.207787 510.207787 0 0 0-161.5786 335.914527 36.053318 36.053318 0 0 0 33.194653 38.613317 36.053318 36.053318 0 0 0 38.613317-33.194653 438.570484 438.570484 0 0 1 138.794609-288.63988A438.613151 438.613151 0 0 1 511.999787 71.979063c87.039964 0 171.093262 25.301323 243.199898 73.301303a439.63715 439.63715 0 0 1 148.821272 166.741264h-100.010625a35.967985 35.967985 0 1 0 0 71.978637h183.97859A35.967985 35.967985 0 0 0 1023.999573 347.989615V164.011025A35.967985 35.967985 0 0 0 987.988922 128.000373z"
        fill="currentColor"
        opacity="0.65"
      />
    </svg>
  );
}

function renderDetailsIcon() {
  return (
    <svg viewBox="0 0 1024 1024" aria-hidden="true">
      <path
        d="M451.53430187 887.898112h-281.509888c-17.51668053 0-31.28142507-14.39061333-31.28142507-31.28142507V168.47557973c0-17.51668053 13.76474453-31.28142507 31.28142507-31.28142506H795.60704c16.89081173 0 31.27596373 13.76474453 31.27596373 31.28142506v281.509888c0 17.2785664 14.00832 31.28142507 31.28142507 31.28142507s31.28142507-14.00395093 31.28142507-31.28142507v-312.79240533c0-34.40749227-28.15535787-62.5573888-62.56285014-62.5573888H138.74189653c-34.40749227 0-62.5573888 28.14989653-62.5573888 62.5573888v750.70395733c0 34.40749227 28.14989653 62.5573888 62.5573888 62.5573888h312.79240534c17.2785664 0 31.28142507-14.00395093 31.28142506-31.28142506 0-17.27092053-14.00395093-31.27487147-31.28142506-31.27487147z m485.95490133 5.6885248l-81.32471467-81.32471467c-6.25759573-6.25759573-12.5140992-6.25759573-18.77169493-6.25759573-18.7662336 0-31.277056 12.5140992-31.277056 31.28142507 0 6.25759573 0 12.50973013 6.25759573 18.7662336l81.32471467 81.32471466c6.25650347 6.25759573 12.50973013 12.5140992 25.02382933 12.5140992 18.76732587 0 31.277056-12.5140992 31.277056-31.28142506-0.00109227-6.25104213-6.25322667-18.76514133-12.50973013-25.02273707z"
        fill="currentColor"
      />
      <path
        d="M693.05849173 511.16878507c-103.6517376 0-187.6721664 84.02589013-187.6721664 187.67762773 0 103.64627627 84.02152107 187.6721664 187.6721664 187.6721664 103.6517376 0 187.67653547-84.02589013 187.67653547-187.6721664 0-103.6517376-84.02479787-187.67762773-187.67653547-187.67762773z m0 312.79131306c-45.35637333 1.02673067-87.7101056-22.57933653-110.6968576-61.69340586-22.98565973-39.1118848-22.9998592-87.605248-0.032768-126.7269632 22.9670912-39.12389973 65.31099307-62.7539968 110.6673664-61.75238827 67.99469227 1.5040512 122.33168213 57.0458112 122.35134294 125.05797973 0.01529173 68.00889173-54.29548373 123.57905067-122.28908374 125.1147776z m31.72051627-499.71418453H223.3073664c-16.98146987-0.032768-30.74184533-13.79314347-30.7789824-30.7789824v-1.0027008c0-16.95307093 13.82591147-30.77461333 30.7789824-30.77461333h501.4716416c16.95307093 0 30.77461333 13.8215424 30.77461333 30.77461333v1.0027008c0 16.89081173-13.88926293 30.7789824-30.77461333 30.7789824z m-2.0054016 125.11586987H221.36968533c-16.98583893-0.03386027-30.7462144-13.79423573-30.7789824-30.78116694v-0.99723946c0-16.95307093 13.82591147-30.78116693 30.7789824-30.78116694h501.46618027c16.95307093 0 30.78007467 13.828096 30.78007467 30.78116694v0.99723946c0 16.89081173-13.88926293 30.78116693-30.84233387 30.78116694zM411.60977067 574.16526507H222.99716267c-16.98583893-0.032768-30.7462144-13.79314347-30.7789824-30.7789824v-0.99833174c0-16.95853227 13.82591147-30.7789824 30.7789824-30.7789824h188.612608c16.95307093 0 30.78116693 13.8215424 30.78116693 30.7789824v0.99833174c-0.04041387 16.98583893-13.79969707 30.7462144-30.78116693 30.7789824z"
        fill="currentColor"
      />
    </svg>
  );
}

function renderRemoveIcon() {
  return (
    <svg viewBox="0 0 1024 1024" aria-hidden="true">
      <path
        d="M92.748283 203.507071h838.503434v44.140606H92.748283zM644.402424 115.238788v44.127677h44.127677V115.238788c0-24.384646-19.75596-44.127677-43.998384-44.127677h-265.050505a43.97899 43.97899 0 0 0-31.172525 12.916364 43.918222 43.918222 0 0 0-12.825859 31.211313v44.127677h44.127677V115.238788h264.791919z"
        fill="currentColor"
      />
      <path
        d="M203.073939 909.614545v-661.979798H158.946263V909.575758c0 24.410505 19.639596 44.179394 44.179394 44.179394h617.761616c24.410505 0 44.179394-19.639596 44.179394-44.179394V247.634747H820.926061v661.979798H203.073939z"
        fill="currentColor"
      />
      <path
        d="M313.412525 335.90303h44.127677V733.090909h-44.127677V335.90303z m176.523637 0h44.127676V733.090909H489.936162V335.90303z m176.523636 0h44.127677V733.090909h-44.127677V335.90303z"
        fill="currentColor"
      />
    </svg>
  );
}

function renderReloadIcon() {
  return (
    <svg viewBox="0 0 1024 1024" aria-hidden="true">
      <path
        d="M512 0c281.6 0 509.44 227.84 512 512 0 284.16-230.4 512-512 512C227.84 1024 0 793.6 0 512 0 227.84 230.4 0 512 0z m168.96 468.48c5.12-7.68 5.12-17.92 0-25.6-5.12-7.68-12.8-12.8-23.04-12.8h-84.48l97.28-153.6c5.12-7.68 5.12-17.92 0-28.16-5.12-7.68-12.8-12.8-23.04-12.8h-204.8c-12.8 0-25.6 10.24-25.6 23.04l-53.76 286.72c-2.56 7.68 0 15.36 5.12 23.04 5.12 5.12 12.8 10.24 20.48 10.24h76.8l-25.6 220.16c-2.56 12.8 5.12 25.6 17.92 28.16 12.8 5.12 25.6-2.56 33.28-12.8l189.44-345.6z"
        fill="currentColor"
      />
    </svg>
  );
}

function renderReauthorizeIcon() {
  return (
    <svg viewBox="0 0 1024 1024" aria-hidden="true">
      <path
        d="M512 4.096l-440.832 184.32v276.48c0 256 202.752 495.104 440.832 552.96 237.568-57.856 440.832-296.96 440.832-552.96v-276.48L512 4.096z m135.168 664.064h-88.064v64.512c0 25.6-20.992 46.592-46.592 46.592s-46.592-20.992-46.592-46.592v-202.752-1.024c-23.04-7.68-44.032-20.48-61.952-37.888-29.184-29.184-45.568-68.608-45.568-110.08s16.384-80.384 45.568-110.08c58.88-58.88 161.28-58.88 220.16 0 29.184 29.184 45.568 68.608 45.568 110.08s-16.384 80.384-45.568 110.08c-18.432 18.432-40.448 31.744-65.024 38.912v45.056h88.064c25.6 0 46.592 20.992 46.592 46.592s-20.992 46.592-46.592 46.592z"
        fill="currentColor"
      />
      <path
        d="M557.568 336.896c-11.776-11.776-27.136-18.432-44.032-18.432s-32.256 6.656-44.032 18.432-18.432 27.136-18.432 44.032 6.656 32.256 18.432 44.032c23.552 23.552 64.512 23.552 88.064 0 11.776-11.776 18.432-27.136 18.432-44.032s-6.656-32.256-18.432-44.032z"
        fill="currentColor"
      />
    </svg>
  );
}

function EditTagsIcon() {
  return (
    <svg viewBox="0 0 1024 1024" aria-hidden="true">
      <path
        d="M642.62656 458.05056a119.808 119.808 0 0 1-82.06848-32.68608l-0.12288-0.11776a110.9248 110.9248 0 0 1-33.1776-79.55456 117.92896 117.92896 0 0 1 33.03424-81.408l0.128-0.13312a113.1008 113.1008 0 0 1 80.30208-32.81408 120.25856 120.25856 0 0 1 82.18112 32.67584l0.14336 0.13312 0.13824 0.14336c44.11392 46.43328 44.032 117.13536-0.13824 160.96768a113.51552 113.51552 0 0 1-80.41984 32.7936z m-34.0736-146.20672a46.08 46.08 0 0 0 1.31584 64.47616 47.00672 47.00672 0 0 0 64.9472 1.024 45.78304 45.78304 0 0 0 13.62944-32.68608 46.92992 46.92992 0 0 0-79.89248-32.81408z m109.89568-43.14112c-44.2112-41.23136-111.91808-41.23136-153.43104 0-41.6768 43.81184-41.6768 110.84288 0 151.9616 44.032 41.23648 111.76448 41.23648 153.43104 0s41.6256-108.14976 0-151.9616z m-39.12704 113.31072a53.54496 53.54496 0 0 1-74.04544-1.12128 52.66944 52.66944 0 0 1-1.39776-73.54368 53.69856 53.69856 0 0 1 75.4432 0 52.44416 52.44416 0 0 1 0 74.66496zM431.99488 931.84a120.26368 120.26368 0 0 1-82.18112-32.67584l-0.16384-0.15872-265.30304-265.27232A110.87872 110.87872 0 0 1 51.2 554.20928a117.76 117.76 0 0 1 33.03936-81.37728l343.424-340.13696c3.03104-3.00032 5.90848-5.95968 8.704-8.82176C452.87936 106.85952 467.15904 92.16 492.11392 92.16h348.83072l0.3328 0.03072c29.94688 3.072 55.2448 29.66016 55.2448 58.0352v344.99584c0 25.64096-10.30144 35.17952-27.36128 50.97984-4.00896 3.712-8.5504 7.91552-13.52192 12.83584l-23.5008 23.27552-47.88736-47.55968 23.33696-23.33184c17.66912-17.63328 26.624-31.70816 26.624-41.84064V173.39392a19.16416 19.16416 0 0 0-5.70368-13.68064 19.456 19.456 0 0 0-13.7728-5.66272h-290.08384v2.62144H518.144c-10.03008 0-28.99968 10.752-42.27072 23.9104L212.5824 441.30816l334.2848 330.8032 34.69312-34.69312 46.89408 46.592-116.16256 115.02592A113.08544 113.08544 0 0 1 431.99488 931.84z m-299.52-411.3152l-0.0768 0.0768a46.40768 46.40768 0 0 0-13.69088 32.768 45.7728 45.7728 0 0 0 13.69088 32.768l265.38496 265.30816a47.18592 47.18592 0 0 0 66.24768-0.0256l34.34496-34.0224L164.4544 486.656z m622.84288 344.61184L918.0672 703.488 972.8 761.04192l-162.56512 158.63808z m-228.77696-227.24096V476.37504h162.6112l213.76 212.31616-162.61632 161.52064z m213.75488 116.51584l66.16576-65.72032-146.91328-145.92h-66.176v65.72032z"
        fill="currentColor"
      />
    </svg>
  );
}

function renderHealthPill(account: DashboardAccountViewModel) {
  if (account.dismissedHealth) {
    return null;
  }

  switch (account.healthKind) {
    case "healthy":
      return <span class="pill ok">{account.healthLabel}</span>;
    case "expiring":
      return <span class="pill warning">{account.healthLabel}</span>;
    case "reauthorize":
    case "disabled":
    case "refresh_failed":
      return <span class="pill error">{account.healthLabel}</span>;
    case "quota":
      return <span class="pill warning">{account.healthLabel}</span>;
    default:
      return null;
  }
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

function SettingsPreferenceRow(props: {
  title: string;
  sub: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <div class="settings-preference-row">
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

function formatSavedAccountsSummary(
  lang: DashboardState["lang"],
  count: number,
  validCount: number,
  invalidCount: number
): string {
  switch (lang) {
    case "zh":
      return `共 ${count} 个，有效 ${validCount}，失效 ${invalidCount}`;
    case "zh-hant":
      return `共 ${count} 個，有效 ${validCount}，失效 ${invalidCount}`;
    case "ja":
      return `合計 ${count} 件・有効 ${validCount}・無効 ${invalidCount}`;
    default:
      return `${count} total · ${validCount} valid · ${invalidCount} invalid`;
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

function renderTagList(tags: string[]): ComponentChildren {
  if (!tags.length) {
    return null;
  }

  const visible = tags.slice(0, 2);
  const remaining = tags.length - visible.length;
  return (
    <>
      {visible.map((tag) => (
        <span key={tag} class="tag-pill">
          {tag}
        </span>
      ))}
      {remaining > 0 ? <span class="tag-pill muted">+{remaining}</span> : null}
    </>
  );
}

function resolveLockMinutes(value: number): number {
  return value > 0 ? value : 15;
}

function formatAutoSwitchReasonSummary(
  reason: NonNullable<DashboardAccountViewModel["lastAutoSwitchReason"]>,
  copy: DashboardCopy
): string {
  const trigger =
    reason.trigger === "hourly"
      ? copy.hourlyLabel
      : reason.trigger === "weekly"
        ? copy.weeklyLabel
        : `${copy.hourlyLabel} + ${copy.weeklyLabel}`;
  const rules = reason.matchedRules.map((rule) => {
    switch (rule) {
      case "same_email":
        return copy.autoSwitchRuleSameEmail;
      case "same_tag":
        return copy.autoSwitchRuleSameTag;
      case "workspace":
        return copy.autoSwitchRuleWorkspace;
      default:
        return copy.autoSwitchRuleQuota;
    }
  });

  return `${copy.autoSwitchReasonTrigger}: ${trigger} · ${copy.autoSwitchReasonMatchedRules}: ${rules.join(" / ")}`;
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
    case "name":
    case "id":
      return maskSensitiveString(value);
    default:
      return maskSensitiveString(value);
  }
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

function GitHubIcon() {
  return (
    <svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 2.2a9.8 9.8 0 0 0-3.1 19.1c.5.1.7-.2.7-.5v-1.9c-2.8.6-3.4-1.2-3.4-1.2-.5-1.1-1.1-1.4-1.1-1.4-.9-.6.1-.6.1-.6 1 .1 1.6 1 1.6 1 .9 1.6 2.3 1.1 2.9.8.1-.6.3-1.1.6-1.3-2.2-.2-4.6-1.1-4.6-5a3.9 3.9 0 0 1 1-2.7c-.1-.3-.5-1.3.1-2.6 0 0 .8-.3 2.7 1a9.1 9.1 0 0 1 4.9 0c1.9-1.3 2.7-1 2.7-1 .6 1.3.2 2.3.1 2.6a3.9 3.9 0 0 1 1 2.7c0 3.9-2.4 4.8-4.7 5 .4.3.7 1 .7 2.1v3.1c0 .3.2.6.7.5A9.8 9.8 0 0 0 12 2.2Z"
        fill="currentColor"
      />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8" />
      <path
        d="M3.5 12h17"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
      />
      <path
        d="M12 3c2.3 2.5 3.7 5.7 3.7 9s-1.4 6.5-3.7 9c-2.3-2.5-3.7-5.7-3.7-9S9.7 5.5 12 3Z"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect
        x="9"
        y="9"
        width="10"
        height="10"
        rx="2.2"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
      />
      <path
        d="M6.2 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1.2"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 4v10"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
      />
      <path
        d="m8.5 10.8 3.5 3.7 3.5-3.7"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M4 18.5h16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
      />
    </svg>
  );
}

function SuccessIcon() {
  return (
    <svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="m5.5 12.5 4.1 4.1L18.5 7.8"
        fill="none"
        stroke="currentColor"
        stroke-width="1.9"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function ImportIcon() {
  return (
    <svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linejoin="round"
      />
      <path
        d="M14 3v5h5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linejoin="round"
      />
      <path
        d="m12 10.5-3 3 3 3"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M9 13.5h7"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
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

function getActionTimeoutMs(action: DashboardActionName): number {
  switch (action) {
    case "refreshView":
      return 8_000;
    case "details":
    case "reloadPrompt":
    case "reauthorize":
    case "resyncProfile":
    case "dismissHealthIssue":
    case "switch":
    case "refresh":
    case "remove":
    case "toggleStatusBar":
      return 30_000;
    case "refreshAll":
      return 120_000;
    case "restoreFromBackup":
    case "restoreFromAuthJson":
      return 60_000;
    case "shareTokens":
    case "prepareOAuthSession":
    case "cancelOAuthSession":
      return 30_000;
    case "importSharedJson":
    case "completeOAuthSession":
      return 120_000;
    case "addAccount":
    case "importCurrent":
    case "startOAuthAutoFlow":
      return 300_000;
    default:
      return 30_000;
  }
}

function createActionRequestId(): string {
  actionRequestSequence += 1;
  return `dashboard-action-${actionRequestSequence}`;
}

function postMessageToHost(message: DashboardClientMessage): void {
  vscodeApi.postMessage(message);
}

render(<App />, document.getElementById("app")!);
