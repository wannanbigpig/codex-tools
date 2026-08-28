import { render } from "preact";
import { createPortal } from "preact/compat";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "preact/hooks";
import packageJson from "../../package.json";
import type {
  DashboardAccountViewModel,
  DashboardActionName,
  DashboardActionPayload,
  DashboardCliSessionMessage,
  DashboardCliSessionSummary,
  DashboardNotice,
  DashboardUsageSample
} from "../../src/domain/dashboard/types";
import type { CodexDailyUsageBreakdown } from "../../src/core/types";
import { AnnouncementCenter } from "./announcementCenter";
import { BatchSelectionBar, OverviewSection, RecoveryPanel } from "./components";
import { postMessageToHost } from "./host";
import {
  compareDashboardAutoQueueAccounts,
  hasDashboardAutoQueueCapability,
  sortWithQueuedAccount
} from "./accountSorting";
import {
  countAccountEnablement,
  isAccountAttention,
  normalizeThresholds,
  resolveBrandSubtitle,
  resolveOverviewAccount
} from "./helpers";
import { useDashboardActions, useDashboardHostSync, useDashboardModals } from "./hooks";
import {
  BellIcon,
  DropdownChevronIcon,
  EyeIcon,
  EyeOffIcon,
  GitHubIcon,
  GridViewIcon,
  InfoIcon,
  TableViewIcon
} from "./icons";
import {
  AboutModal,
  AccountInfoModal,
  AddAccountModal,
  CliSessionsModal,
  ConfirmCancelOauthModal,
  SettingsOverlay,
  ShareTokenModal
} from "./panels";
import { SavedAccountCard } from "./savedAccountCard";
import { createInitialState, reducer } from "./state";
import { resolveDashboardThemeFromMedia } from "./theme";
import { scheduleDashboardToastDismiss } from "./toast";

const GITHUB_PROJECT_URL = "https://github.com/wannanbigpig/codex-tools";
const ACCOUNT_SORT_STORAGE_KEY = "codexAccounts.dashboardAccountSort.v2";
const UI_PREFERENCES_STORAGE_KEY = "codexAccounts.dashboardUiPreferences.v2";
const LEGACY_UI_PREFERENCES_STORAGE_KEY = "codexAccounts.dashboardUiPreferences.v1";
const USAGE_HISTORY_STORAGE_KEY = "codexAccounts.dashboardUsageHistory.v1";
const DAY_MS = 24 * 60 * 60 * 1000;
type AccountSort =
  | "auto-queue"
  | "quota"
  | "time-left"
  | "login-date"
  | "account-type"
  | "subscription-expiry"
  | "name"
  | "last-refresh"
  | "status";
type AccountFilter = "all" | "healthy" | "attention" | "low" | "active" | "enabled" | "disabled";
type DashboardView = "cards" | "list";
type MetricPriority = string;
type UiPreferences = {
  filter: AccountFilter;
  view: DashboardView;
  metricPriority: MetricPriority;
};

const DEFAULT_UI_PREFERENCES: UiPreferences = {
  filter: "all",
  view: "cards",
  metricPriority: "hourly"
};

function isAccountSort(value: string | null): value is AccountSort {
  return (
    value === "auto-queue" ||
    value === "quota" ||
    value === "time-left" ||
    value === "login-date" ||
    value === "account-type" ||
    value === "subscription-expiry" ||
    value === "name" ||
    value === "last-refresh" ||
    value === "status"
  );
}

function App() {
  const isBrowserDashboard = document.documentElement.dataset["dashboardHost"] === "browser";
  const [state, dispatch] = useReducer(reducer, undefined, createInitialState);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [announcementsOpen, setAnnouncementsOpen] = useState(false);
  const [accountSort, setAccountSort] = useState<AccountSort>(() => {
    try {
      const stored = window.localStorage.getItem(ACCOUNT_SORT_STORAGE_KEY);
      if (stored === "balance-desc") return "quota";
      if (stored === "next-reset") return "time-left";
      return isAccountSort(stored) ? stored : "auto-queue";
    } catch {
      return "auto-queue";
    }
  });
  const [uiPreferences, setUiPreferences] = useState<UiPreferences>(loadUiPreferences);
  const [accountSearch, setAccountSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [tagFilterOpen, setTagFilterOpen] = useState(false);
  const [shareExportCount, setShareExportCount] = useState(0);
  const [usageHistory, setUsageHistory] = useState<DashboardUsageSample[]>(loadUsageHistory);
  const [accountInfoAccountId, setAccountInfoAccountId] = useState<string>();
  const [cliSessionsOpen, setCliSessionsOpen] = useState(false);
  const [cliSessions, setCliSessions] = useState<DashboardCliSessionSummary[]>([]);
  const [cliSessionMessages, setCliSessionMessages] = useState<DashboardCliSessionMessage[]>([]);
  const [selectedCliSession, setSelectedCliSession] = useState<DashboardCliSessionSummary>();
  const [cliSessionsError, setCliSessionsError] = useState<string>();
  const [cliSessionMessagesError, setCliSessionMessagesError] = useState<string>();
  const [dailyUsageByAccount, setDailyUsageByAccount] = useState<Record<string, CodexDailyUsageBreakdown>>({});
  const [dailyUsageErrorByAccount, setDailyUsageErrorByAccount] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<DashboardNotice>();
  const showNotice = useCallback((next: DashboardNotice) => setNotice(next), []);
  const lastTerminalNoticeAtRef = useRef<number>();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { patchSettings, sendAction, sendSetting, isActionPending, hasGlobalPendingAction } = useDashboardActions(
    state,
    dispatch,
    showNotice
  );
  const snapshot = state.snapshot;
  const modals = useDashboardModals({
    dispatch,
    sendAction,
    importJsonFileReadError: snapshot?.copy.importJsonFileReadError ?? "Failed to read JSON file.",
    onNotice: showNotice,
    isBrowserDashboard
  });
  useDashboardHostSync({
    handleHostMessage: (message) => {
      modals.handleHostMessage(message);
      if (message.type === "dashboard:action-result" && message.action === "getDailyUsage" && message.accountId) {
        if (message.status === "completed" && message.payload?.dailyUsage) {
          setDailyUsageByAccount((current) => ({ ...current, [message.accountId!]: message.payload!.dailyUsage! }));
          setDailyUsageErrorByAccount((current) => {
            const next = { ...current };
            delete next[message.accountId!];
            return next;
          });
        } else if (message.status === "failed") {
          setDailyUsageErrorByAccount((current) => ({
            ...current,
            [message.accountId!]: message.error ?? "Daily usage could not be loaded."
          }));
        }
      }
      if (message.type === "dashboard:action-result" && message.action === "listCodexCliSessions") {
        if (message.status === "completed") {
          setCliSessions(message.payload?.cliSessions ?? []);
          setCliSessionsError(undefined);
        } else {
          setCliSessionsError(message.error ?? "CLI sessions could not be loaded.");
        }
      }
      if (message.type === "dashboard:action-result" && message.action === "getCodexCliSessionMessages") {
        if (message.status === "completed") {
          setCliSessionMessages(message.payload?.cliSessionMessages ?? []);
          setSelectedCliSession(message.payload?.cliSession ?? selectedCliSession);
          setCliSessionMessagesError(undefined);
        } else {
          setCliSessionMessagesError(message.error ?? "Session messages could not be loaded.");
        }
      }
    },
    handleEscape: () => modals.handleEscape(isActionPending("completeOAuthSession"))
  });
  useEffect(() => {
    if (!snapshot?.dailyUsageCache?.length) return;
    setDailyUsageByAccount((current) => {
      const next = { ...current };
      for (const entry of snapshot.dailyUsageCache ?? []) next[entry.accountId] = entry.usage;
      return next;
    });
  }, [snapshot?.dailyUsageCache]);

  useEffect(() => {
    const terminalNotice = snapshot?.terminalNotice;
    if (!terminalNotice || lastTerminalNoticeAtRef.current === terminalNotice.createdAt) {
      return;
    }
    lastTerminalNoticeAtRef.current = terminalNotice.createdAt;
    showNotice(terminalNotice);
  }, [showNotice, snapshot?.terminalNotice]);
  useEffect(() => {
    if (!notice) {
      return;
    }
    return scheduleDashboardToastDismiss(() => setNotice(undefined));
  }, [notice]);
  useEffect(() => {
    const preference = snapshot?.settings.dashboardTheme ?? "auto";
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const applyResolvedTheme = () => {
      root.dataset["themePreference"] = preference;
      root.dataset["theme"] = resolveDashboardThemeFromMedia(preference, media);
    };

    applyResolvedTheme();
    media.addEventListener("change", applyResolvedTheme);
    const observer = new MutationObserver(applyResolvedTheme);
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });

    return () => {
      media.removeEventListener("change", applyResolvedTheme);
      observer.disconnect();
    };
  }, [snapshot?.settings.dashboardTheme]);

  useEffect(() => {
    try {
      window.localStorage.setItem(ACCOUNT_SORT_STORAGE_KEY, accountSort);
    } catch {
      // Local storage may be unavailable in restricted webviews; sorting still works for this session.
    }
  }, [accountSort]);

  useEffect(() => {
    try {
      window.localStorage.setItem(UI_PREFERENCES_STORAGE_KEY, JSON.stringify(uiPreferences));
    } catch {
      // UI preferences are optional when storage is unavailable.
    }
  }, [uiPreferences]);

  useEffect(() => {
    if (!snapshot?.usageHistory?.length) return;
    setUsageHistory((current) => {
      const next = isBrowserDashboard
        ? [...(snapshot.usageHistory ?? [])]
        : mergeUsageHistory(snapshot.usageHistory ?? [], current);
      return sameUsageHistory(current, next) ? current : next;
    });
  }, [snapshot?.usageHistory]);

  useEffect(() => {
    if (isBrowserDashboard || !usageHistory.length) return;
    postMessageToHost({ type: "dashboard:usage-history", samples: usageHistory.slice(-10_000) });
  }, [usageHistory]);

  useEffect(() => {
    if (!snapshot?.accounts.length) return;
    const at = Date.now();
    const samples: DashboardUsageSample[] = snapshot.accounts.map((account) => ({
      at,
      accountId: account.id,
      hourly: account.metrics.find((metric) => metric.key.includes("hourly"))?.percentage,
      weekly: account.metrics.find((metric) => metric.key.includes("weekly"))?.percentage,
      review: account.metrics.find((metric) => metric.key.includes("review"))?.percentage
    }));
    setUsageHistory((current) => {
      const retentionDays = snapshot.settings.usageHistoryRetentionDays;
      const cutoff = retentionDays > 0 ? at - retentionDays * DAY_MS : Number.NEGATIVE_INFINITY;
      const next = current.filter((sample) => sample.at >= cutoff);
      let changed = false;
      for (const sample of samples) {
        const previous = [...next].reverse().find((item) => item.accountId === sample.accountId);
        const valuesChanged =
          !previous ||
          previous.hourly !== sample.hourly ||
          previous.weekly !== sample.weekly ||
          previous.review !== sample.review;
        if (previous && !valuesChanged) continue;
        next.push(sample);
        changed = true;
      }
      if (!changed && next.length === current.length) return current;
      try {
        window.localStorage.setItem(USAGE_HISTORY_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* optional */
      }
      return next;
    });
  }, [snapshot?.accounts, snapshot?.settings.usageHistoryRetentionDays]);

  useEffect(() => {
    const handleKeyboardShortcut = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable;
      if (event.key === "/" && !typing) {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (typing || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      if (event.key.toLowerCase() === "r" && snapshot && !hasGlobalPendingAction) {
        event.preventDefault();
        sendAction("refreshAll");
      } else if (event.key.toLowerCase() === "a" && snapshot) {
        event.preventDefault();
        modals.openAddAccountModal();
      } else if (event.key.toLowerCase() === "v") {
        event.preventDefault();
        setUiPreferences((current) => ({ ...current, view: current.view === "cards" ? "list" : "cards" }));
      }
    };
    window.addEventListener("keydown", handleKeyboardShortcut);
    return () => window.removeEventListener("keydown", handleKeyboardShortcut);
  }, [snapshot, hasGlobalPendingAction, sendAction, modals]);

  if (!snapshot) {
    return (
      <div class="panel">
        <section class="section">
          <div class="identity">Loading...</div>
        </section>
      </div>
    );
  }

  const overviewAccount = resolveOverviewAccount(snapshot.accounts);
  const accountInfoAccount = accountInfoAccountId
    ? snapshot.accounts.find((account) => account.id === accountInfoAccountId)
    : undefined;
  const openCliSessions = (): void => {
    setCliSessionsOpen(true);
    setSelectedCliSession(undefined);
    setCliSessionMessages([]);
    setCliSessionsError(undefined);
    setCliSessionMessagesError(undefined);
    sendAction("listCodexCliSessions");
  };
  const selectCliSession = (session: DashboardCliSessionSummary): void => {
    setSelectedCliSession(session);
    setCliSessionMessages([]);
    setCliSessionMessagesError(undefined);
    sendAction("getCodexCliSessionMessages", undefined, { sessionId: session.id });
  };
  const availableTags = useMemo(
    () =>
      [...new Set(snapshot.accounts.flatMap((account) => account.tags))].sort((left, right) =>
        left.localeCompare(right)
      ),
    [snapshot.accounts]
  );
  useEffect(() => {
    setTagFilter((current) => current.filter((tag) => availableTags.includes(tag)));
    if (!availableTags.length) setTagFilterOpen(false);
  }, [availableTags]);
  const sortedAccounts = useMemo(
    () =>
      sortAccounts(
        filterAccounts(
          snapshot.accounts,
          accountSearch,
          uiPreferences.filter,
          snapshot.settings.quotaYellowThreshold,
          tagFilter
        ),
        accountSort,
        uiPreferences.metricPriority
      ),
    [
      snapshot.accounts,
      snapshot.settings.quotaYellowThreshold,
      accountSearch,
      uiPreferences.filter,
      tagFilter,
      accountSort,
      uiPreferences.metricPriority
    ]
  );
  const handleAutoRefreshToggle = (enabled: boolean): void => {
    const nextMinutes = enabled ? state.lastEnabledAutoRefreshMinutes || 15 : 0;
    patchSettings({ autoRefreshMinutes: nextMinutes });
    sendSetting("autoRefreshMinutes", nextMinutes);
  };

  const handleAutoRefreshCurrentToggle = (enabled: boolean): void => {
    const nextMinutes = enabled ? state.lastEnabledAutoRefreshCurrentMinutes || 1 : 0;
    patchSettings({ autoRefreshCurrentMinutes: nextMinutes });
    sendSetting("autoRefreshCurrentMinutes", nextMinutes);
  };

  const handleAutoRefreshCurrentValue = (minutes: number): void => {
    patchSettings({ autoRefreshCurrentMinutes: minutes });
    sendSetting("autoRefreshCurrentMinutes", minutes);
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

  const selectedAccountIds = new Set(state.selectedAccountIds);
  const selectedCount = state.selectedAccountIds.length;
  const isAccountBusy = (accountId: string): boolean =>
    hasGlobalPendingAction || state.pendingActions.some((request) => request.accountId === accountId);
  const privacyToggleLabel = state.privacyMode ? snapshot.copy.showSensitive : snapshot.copy.hideSensitive;
  const announcementUnreadCount = snapshot.announcements.unreadIds.length;
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
  const syncPending = isActionPending("syncNow") || isActionPending("configureEncryptedSync");
  const brandSubtitle = resolveBrandSubtitle(
    snapshot.brandSub,
    snapshot.settings.encryptedSyncEnabled,
    snapshot.encryptedSyncLastCompletedAt,
    snapshot.encryptedSyncEnabledSessionCount,
    snapshot.encryptedSyncSessionCount,
    snapshot.accounts.length
  );
  const invalidAccountCount = snapshot.accounts.filter(isAccountAttention).length;
  const validAccountCount = snapshot.accounts.length - invalidAccountCount;
  const accountEnablement = countAccountEnablement(snapshot.accounts);
  const weeklyPercentages = snapshot.accounts
    .map(
      (account) =>
        account.metrics.find(
          (metric) =>
            metric.visible &&
            metric.key.includes("weekly") &&
            typeof metric.percentage === "number" &&
            Number.isFinite(metric.percentage)
        )?.percentage
    )
    .filter((value): value is number => typeof value === "number");
  const weeklyQuotaPercent = weeklyPercentages.length
    ? Math.round(weeklyPercentages.reduce((sum, value) => sum + value, 0) / weeklyPercentages.length)
    : undefined;
  const availableMetrics = Array.from(
    new Map(
      snapshot.accounts
        .flatMap((account) => account.metrics)
        .filter((metric) => metric.visible)
        .map((metric) => [metric.key, metric])
    ).values()
  );

  const handleShareTokens = (): void => {
    if (!selectedCount) {
      return;
    }
    setShareExportCount(selectedCount);
    sendAction("shareTokens", undefined, { accountIds: state.selectedAccountIds });
  };

  const handleExportAccount = (accountId: string): void => {
    setShareExportCount(1);
    sendAction("exportAuthFile", accountId);
  };

  const handleAccountAction = (
    action: DashboardActionName,
    accountId?: string,
    payload?: DashboardActionPayload
  ): void => {
    if (action === "details" && isBrowserDashboard && accountId) {
      setAccountInfoAccountId(accountId);
      return;
    }
    if (action === "reauthorize" && accountId) {
      modals.openReauthorizeModal(accountId);
      return;
    }
    sendAction(action, accountId, payload);
  };

  const handleExportBackup = (): void => {
    setShareExportCount(snapshot.accounts.length);
    sendAction("exportBackup");
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

  const handleAutoSwitchLock = (lockMinutes: number): void => {
    if (!overviewAccount) {
      return;
    }
    sendAction("setAutoSwitchLock", overviewAccount.id, {
      lockMinutes
    });
  };

  return (
    <>
      <div
        class={`panel dashboard-density-compact dashboard-view-${uiPreferences.view} ${state.privacyMode ? "privacy-hidden" : ""}`}
      >
        {snapshot.indexHealth.status !== "healthy" ? (
          <section class="section">
            <RecoveryPanel
              copy={snapshot.copy}
              health={snapshot.indexHealth}
              restoreBackupPending={restoreBackupPending}
              restoreAuthPending={restoreAuthPending}
              restoreJsonPending={importSharedPending && modals.importRecoveryMode}
              onRestoreBackup={() => sendAction("restoreFromBackup")}
              onRestoreAuth={() => sendAction("restoreFromAuthJson")}
              onImportJson={modals.openRecoveryImportModal}
            />
          </section>
        ) : null}
        <section class="section">
          {notice ? (
            <div class={`dashboard-notice is-${notice.level}`} role={notice.level === "error" ? "alert" : "status"}>
              <span>{notice.message}</span>
              <button type="button" aria-label="Dismiss notification" onClick={() => setNotice(undefined)}>
                ×
              </button>
            </div>
          ) : null}
          <div class="hero">
            <div class="brand">
              <img class="brand-logo" src={snapshot.logoUri} alt="" aria-hidden="true" />
              <div class="brand-copy">
                <h1>Codex Manager</h1>
                <p>{brandSubtitle}</p>
              </div>
            </div>
            <div class="hero-settings">
              {!isBrowserDashboard ? (
                <button
                  id="codexDashboardButton"
                  class="settings-btn action-btn"
                  type="button"
                  title={snapshot.lang === "zh" ? "在浏览器中打开面板" : "Open dashboard in browser"}
                  aria-label={snapshot.lang === "zh" ? "在浏览器中打开面板" : "Open dashboard in browser"}
                  onClick={() => sendAction("openWebDashboard")}
                >
                  <span class="button-face">
                    <span class="button-icon">
                      <GridViewIcon />
                    </span>
                  </span>
                </button>
              ) : null}
              <button
                id="announcementsButton"
                class={`settings-btn action-btn icon-only announcement-btn ${announcementUnreadCount > 0 ? "has-unread" : ""}`}
                type="button"
                title={snapshot.copy.announcementsTooltip}
                aria-label={snapshot.copy.announcementsTooltip}
                onClick={() => setAnnouncementsOpen(true)}
              >
                <span class="button-face">
                  <span class="button-icon">
                    <BellIcon />
                  </span>
                </span>
                {announcementUnreadCount > 0 ? (
                  <span class="announcement-button-badge" aria-label={`${announcementUnreadCount} unread`}>
                    {announcementUnreadCount > 9 ? "9+" : announcementUnreadCount}
                  </span>
                ) : null}
              </button>
              {isBrowserDashboard && snapshot.settings.cliIntegrationEnabled === true ? (
                <button
                  id="cliSessionsButton"
                  class="settings-btn action-btn icon-only"
                  type="button"
                  title="CLI Sessions"
                  aria-label="CLI Sessions"
                  onClick={openCliSessions}
                >
                  <span class="button-face"><span class="button-icon">◉</span></span>
                </button>
              ) : null}
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
              </button>
              <button
                id="privacyToggleButton"
                class={`settings-btn action-btn icon-only ${state.privacyMode ? "is-active" : ""}`}
                type="button"
                title={privacyToggleLabel}
                aria-label={privacyToggleLabel}
                aria-pressed={state.privacyMode}
                onClick={() => dispatch({ type: "toggle-privacy" })}
              >
                <span class="button-face">
                  <span class="button-icon">{state.privacyMode ? <EyeOffIcon /> : <EyeIcon />}</span>
                </span>
              </button>
              <button
                id="syncNowButton"
                class="settings-btn refresh-view-btn action-btn icon-only"
                type="button"
                title="Sync now"
                aria-label="Sync now"
                disabled={hasGlobalPendingAction || syncPending}
                aria-busy={syncPending}
                onClick={() => sendAction("syncNow")}
              >
                <span class="button-face">
                  {syncPending ? <span class="button-spinner" aria-hidden="true"></span> : null}
                  <span class="button-label">↻</span>
                </span>
              </button>
              <button
                id="settingsOpenButton"
                class="settings-btn action-btn icon-only"
                type="button"
                title={snapshot.copy.settingsTitle}
                aria-label={snapshot.copy.settingsTitle}
                onClick={() => dispatch({ type: "open-settings" })}
              >
                <span class="button-face">
                  <span class="button-icon">⚙</span>
                </span>
              </button>
              <button
                id="aboutOpenButton"
                class="settings-btn action-btn about-btn"
                type="button"
                title={resolveAboutTitle(snapshot.lang)}
                aria-label={resolveAboutTitle(snapshot.lang)}
                onClick={() => setAboutOpen(true)}
              >
                <span class="button-face">
                  <span class="button-icon">
                    <InfoIcon />
                  </span>
                </span>
              </button>
            </div>
          </div>
          <OverviewSection
            account={overviewAccount}
            accounts={snapshot.accounts}
            hasAccounts={snapshot.accounts.length > 0}
            lang={snapshot.lang}
            copy={snapshot.copy}
            settings={snapshot.settings}
            now={state.now}
            privacyMode={state.privacyMode}
            disabled={hasGlobalPendingAction || snapshot.indexHealth.status === "corrupted_unrecoverable"}
            addPending={prepareOAuthPending}
            refreshAllPending={isActionPending("refreshAll")}
            consumeResetCreditPending={Boolean(
              overviewAccount && isActionPending("consumeResetCredit", overviewAccount.id)
            )}
            metricPriority={uiPreferences.metricPriority}
            dailyUsage={overviewAccount ? dailyUsageByAccount[overviewAccount.id] : undefined}
            dailyUsagePending={Boolean(overviewAccount && isActionPending("getDailyUsage", overviewAccount.id))}
            dailyUsageError={overviewAccount ? dailyUsageErrorByAccount[overviewAccount.id] : undefined}
            onLoadDailyUsage={() => {
              if (overviewAccount) sendAction("getDailyUsage", overviewAccount.id, { days: 30 });
            }}
            usageHistory={usageHistory}
            onSetAutoSwitchLock={handleAutoSwitchLock}
            onAddAccount={modals.openAddAccountModal}
            onRefreshAll={() => sendAction("refreshAll")}
            onConfigureSync={() => sendAction("configureEncryptedSync")}
            onSyncNow={() => sendAction("syncNow")}
            syncPending={syncPending}
            registryOverridePending={isActionPending("setEncryptedSyncRegistryOverride")}
            onSetRegistryOverride={(enabled) =>
              sendAction("setEncryptedSyncRegistryOverride", undefined, { enabled })
            }
            onConsumeResetCredit={() => {
              if (overviewAccount) sendAction("consumeResetCredit", overviewAccount.id);
            }}
            onSwitchAccount={(accountId) => {
              if (accountId) sendAction("switch", accountId);
            }}
            onReloadAccount={() => {
              if (overviewAccount) sendAction("reloadPrompt", overviewAccount.id);
            }}
            onRefreshQuota={() => {
              if (overviewAccount) sendAction("refresh", overviewAccount.id);
            }}
            showCliSessions={isBrowserDashboard && snapshot.settings.cliIntegrationEnabled === true}
            onOpenCliSessions={openCliSessions}
          />
        </section>
        {snapshot.accounts.length > 0 ? (
          <section class="section">
            <div class="header accounts-section-header">
              <div>
                <div class="header-title header-title-with-meta">
                  {snapshot.copy.savedAccounts}
                  <span class="account-count-badges">
                    <button
                      class="header-count-badge header-count-link"
                      type="button"
                      onClick={() => setUiPreferences((current) => ({ ...current, filter: "all" }))}
                    >
                      {resolveUiText("total", snapshot.lang)} {snapshot.accounts.length}
                    </button>
                    <button
                      class="header-count-badge is-enabled header-count-link"
                      type="button"
                      onClick={() => setUiPreferences((current) => ({ ...current, filter: "enabled" }))}
                    >
                      {resolveUiText("enabled", snapshot.lang)} {accountEnablement.enabled}
                    </button>
                    <button
                      class="header-count-badge is-disabled header-count-link"
                      type="button"
                      onClick={() => setUiPreferences((current) => ({ ...current, filter: "disabled" }))}
                    >
                      {resolveUiText("disabled", snapshot.lang)} {accountEnablement.disabled}
                    </button>
                    <button
                      class="header-count-badge is-valid header-count-link"
                      type="button"
                      onClick={() => setUiPreferences((current) => ({ ...current, filter: "healthy" }))}
                    >
                      {resolveUiText("valid", snapshot.lang)} {validAccountCount}
                    </button>
                    <button
                      class={`header-count-badge header-count-link ${invalidAccountCount ? "is-invalid" : ""}`}
                      type="button"
                      onClick={() => setUiPreferences((current) => ({ ...current, filter: "attention" }))}
                    >
                      {resolveUiText("invalid", snapshot.lang)} {invalidAccountCount}
                    </button>
                    <button
                      class="header-count-badge is-quota"
                      type="button"
                      title={resolveWeeklyQuotaTitle(weeklyQuotaPercent, weeklyPercentages.length, snapshot.lang)}
                      onClick={() => setUiPreferences((current) => ({ ...current, metricPriority: "weekly" }))}
                    >
                      {resolveUiText("weeklyShort", snapshot.lang)}{" "}
                      {weeklyQuotaPercent == null ? "—" : `${weeklyQuotaPercent}%`}
                    </button>
                  </span>
                </div>
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
            <div class="dashboard-account-toolbar">
              <label class="account-search-control">
                <span aria-hidden="true">⌕</span>
                <input
                  ref={searchInputRef}
                  value={accountSearch}
                  onInput={(event) => setAccountSearch(event.currentTarget.value)}
                  placeholder={resolveUiText("search", snapshot.lang)}
                  aria-label={resolveUiText("search", snapshot.lang)}
                />
                {accountSearch ? (
                  <button
                    type="button"
                    aria-label={resolveUiText("clear", snapshot.lang)}
                    onClick={() => setAccountSearch("")}
                  >
                    ×
                  </button>
                ) : null}
              </label>
              <label class="dashboard-select-control">
                <select
                  value={accountSort}
                  onChange={(event) => setAccountSort(event.currentTarget.value as AccountSort)}
                  aria-label={resolveSortAriaLabel(snapshot.lang)}
                >
                  {(
                    ["auto-queue", "quota", "time-left", "login-date", "last-refresh", "subscription-expiry", "account-type", "name", "status"] as AccountSort[]
                  ).map((sort) => (
                    <option key={sort} value={sort}>
                      {resolveSortOptionLabel(sort, snapshot.lang)}
                    </option>
                  ))}
                </select>
              </label>
              <label class="dashboard-select-control metric-priority-control">
                <select
                  value={uiPreferences.metricPriority}
                  aria-label={resolveUiText("metric", snapshot.lang)}
                  onChange={(event) =>
                    setUiPreferences((current) => ({
                      ...current,
                      metricPriority: event.currentTarget.value as MetricPriority
                    }))
                  }
                >
                  {availableMetrics.map((metric) => (
                    <option key={metric.key} value={metric.key}>
                      {metric.label}
                    </option>
                  ))}
                </select>
              </label>
              {availableTags.length > 0 ? (
                <TagFilterControl
                  availableTags={availableTags}
                  selectedTags={tagFilter}
                  open={tagFilterOpen}
                  lang={snapshot.lang}
                  onToggleOpen={() => setTagFilterOpen((current) => !current)}
                  onToggleTag={(tag) =>
                    setTagFilter((current) =>
                      current.includes(tag) ? current.filter((value) => value !== tag) : [...current, tag]
                    )
                  }
                  onClear={() => setTagFilter([])}
                  onClose={() => setTagFilterOpen(false)}
                />
              ) : null}
              <div class="dashboard-view-controls">
                <button
                  type="button"
                  class="dashboard-view-toggle active"
                  title={resolveUiText(uiPreferences.view === "cards" ? "tableView" : "gridView", snapshot.lang)}
                  aria-label={resolveUiText(uiPreferences.view === "cards" ? "tableView" : "gridView", snapshot.lang)}
                  onClick={() =>
                    setUiPreferences((current) => ({
                      ...current,
                      view: current.view === "cards" ? "list" : "cards"
                    }))
                  }
                >
                  {uiPreferences.view === "cards" ? <GridViewIcon /> : <TableViewIcon />}
                </button>
              </div>
            </div>
            <div class="accounts-grid">
              {sortedAccounts.map((account) => (
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
                  enabledPending={isActionPending("toggleAccountEnabled", account.id)}
                  queuePriorityPending={isActionPending("setAccountQueuePriority", account.id)}
                  tokenRefreshPending={isActionPending("setAccountTokenRefreshEnabled", account.id)}
                  manualTokenRefreshPending={isActionPending("refreshToken", account.id)}
                  updateTagsPending={isActionPending("updateTags", account.id)}
                  consumeResetCreditPending={isActionPending("consumeResetCredit", account.id)}
                  exportPending={isActionPending("shareTokens") || isActionPending("exportAuthFile")}
                  selected={selectedAccountIds.has(account.id)}
                  metricPriority={uiPreferences.metricPriority}
                  compactRow={uiPreferences.view === "list"}
                  onToggleSelected={() => dispatch({ type: "toggle-select", accountId: account.id })}
                  onExportAuth={() => handleExportAccount(account.id)}
                  onEditTags={() => handleEditAccountTags(account)}
                  onAction={handleAccountAction}
                />
              ))}
              {sortedAccounts.length === 0 ? (
                <div class="accounts-empty-filter">{resolveUiText("noResults", snapshot.lang)}</div>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>

      <SettingsOverlay
        open={state.settingsOpen}
        copy={snapshot.copy}
        lang={snapshot.lang}
        settings={snapshot.settings}
        tokenAutomation={snapshot.tokenAutomation}
        encryptedSyncNeedsConfiguration={Boolean(snapshot.encryptedSyncNeedsConfiguration)}
        encryptedSyncNeedsSettingsSync={Boolean(snapshot.encryptedSyncNeedsSettingsSync)}
        usageHistoryCount={usageHistory.length}
        onClose={() => dispatch({ type: "close-settings" })}
        onPatchSettings={patchSettings}
        onSendSetting={sendSetting}
        onAutoRefreshToggle={handleAutoRefreshToggle}
        onAutoRefreshValue={handleAutoRefreshValue}
        onAutoRefreshCurrentToggle={handleAutoRefreshCurrentToggle}
        onAutoRefreshCurrentValue={handleAutoRefreshCurrentValue}
        onThresholdPreview={handleThresholdPreview}
        onThresholdCommit={handleThresholdCommit}
        onPickCodexAppPath={() => postMessageToHost({ type: "dashboard:pickCodexAppPath" })}
        onClearCodexAppPath={() => postMessageToHost({ type: "dashboard:clearCodexAppPath" })}
        onClearUsageHistory={() => {
          setUsageHistory([]);
          try {
            window.localStorage.removeItem(USAGE_HISTORY_STORAGE_KEY);
          } catch {
            /* optional */
          }
        }}
        onOpenNetworkLogs={() => sendAction("openNetworkLogs")}
        onExportBackup={handleExportBackup}
        onImportBackup={modals.openImportModal}
        onConfigureSync={() => sendAction("configureEncryptedSync")}
        onSyncNow={() => sendAction("syncNow")}
        onSetRegistryOverride={(enabled) => sendAction("setEncryptedSyncRegistryOverride", undefined, { enabled })}
        registryOverridePending={isActionPending("setEncryptedSyncRegistryOverride")}
        onSetWebDashboardPassword={() => sendAction("setWebDashboardPassword")}
      />

      <AnnouncementCenter
        open={announcementsOpen}
        copy={snapshot.copy}
        state={snapshot.announcements}
        refreshPending={isActionPending("refreshAnnouncements")}
        markAllPending={isActionPending("markAllAnnouncementsRead")}
        onClose={() => setAnnouncementsOpen(false)}
        onAction={sendAction}
      />

      <AboutModal
        open={aboutOpen}
        lang={snapshot.lang}
        logoUri={snapshot.logoUri}
        version={packageJson.version}
        onClose={() => setAboutOpen(false)}
        onOpenExternal={(url) => sendAction("openExternalUrl", undefined, { url })}
      />

      <AccountInfoModal
        account={isBrowserDashboard ? accountInfoAccount : undefined}
        lang={snapshot.lang}
        closeLabel={snapshot.copy.closeModal}
        onClose={() => setAccountInfoAccountId(undefined)}
      />

      {isBrowserDashboard ? (
        <CliSessionsModal
          open={cliSessionsOpen}
          lang={snapshot.lang}
          closeLabel={snapshot.copy.closeModal}
          sessions={cliSessions}
          selectedSession={selectedCliSession}
          messages={cliSessionMessages}
          loading={isActionPending("listCodexCliSessions")}
          messagesLoading={isActionPending("getCodexCliSessionMessages")}
          error={cliSessionsError}
          messagesError={cliSessionMessagesError}
          onClose={() => setCliSessionsOpen(false)}
          onSelect={selectCliSession}
          onBack={() => { setSelectedCliSession(undefined); setCliSessionMessages([]); setCliSessionMessagesError(undefined); }}
        />
      ) : null}

      <AddAccountModal
        open={modals.addAccountModalOpen}
        tab={modals.addAccountTab}
        copy={snapshot.copy}
        oauthSession={modals.oauthSession}
        oauthCallbackUrl={modals.oauthCallbackUrl}
        oauthError={modals.oauthError}
        importJsonText={modals.importJsonText}
        importJsonError={modals.importJsonError}
        importPreview={modals.importPreview}
        importResult={modals.importResult}
        copyFeedbackKey={modals.copyFeedbackKey}
        lang={snapshot.lang}
        prepareOAuthPending={prepareOAuthPending}
        startOAuthAutoPending={startOAuthAutoPending}
         completeOAuthPending={completeOAuthPending}
         importCurrentPending={isActionPending("importCurrent")}
        previewImportPending={previewImportPending}
        importSharedPending={importSharedPending}
        onClose={() => modals.closeAddAccountModal(completeOAuthPending)}
        onSelectTab={modals.handleAddAccountTabChange}
        onCreateOauthLink={modals.handlePrepareOauthLink}
        onCopyOauthLink={modals.handleCopyOauthLink}
        onOpenInBrowser={modals.handleStartOAuthAutoFlow}
        onOauthCallbackChange={modals.setOauthCallbackUrl}
         onCompleteOAuth={modals.handleCompleteOAuth}
         onImportCurrent={() => sendAction("importCurrent")}
        onImportFileSelected={modals.handleImportFileSelected}
        onImportTextChange={modals.handleImportTextChange}
        onPreviewImport={modals.handlePreviewImport}
        onSubmitImport={modals.handleSubmitImport}
      />

      <ConfirmCancelOauthModal
        open={modals.confirmCancelOauthOpen}
        copy={snapshot.copy}
        onClose={modals.closeConfirmCancelOauth}
        onConfirm={modals.confirmCancelOauth}
      />

      <ShareTokenModal
        open={modals.shareModalOpen}
        copy={snapshot.copy}
        selectedCount={shareExportCount || selectedCount}
        shareModalJson={modals.shareModalJson}
        shareModalFilename={modals.shareModalFilename}
        sharePreviewExpanded={modals.sharePreviewExpanded}
        copyFeedbackKey={modals.copyFeedbackKey}
        downloadSharePending={downloadSharePending}
        onClose={modals.closeShareModal}
        onTogglePreview={modals.toggleSharePreview}
        onCopyJson={modals.handleCopyShareJson}
        onDownloadJson={modals.handleDownloadShareJson}
      />
    </>
  );
}

function sortAccounts(
  accounts: DashboardAccountViewModel[],
  sort: AccountSort,
  metricPriority: MetricPriority
): DashboardAccountViewModel[] {
  const metricFor = (account: DashboardAccountViewModel, priority: MetricPriority) =>
    account.metrics.find(
      (metric) =>
        metric.visible &&
        metric.key.includes(priority) &&
        typeof metric.percentage === "number" &&
        Number.isFinite(metric.percentage)
    ) ??
    account.metrics.find(
      (metric) => metric.visible && typeof metric.percentage === "number" && Number.isFinite(metric.percentage)
    );
  const compareDefinedNumbers = (left: number | undefined, right: number | undefined, direction: 1 | -1): number => {
    if (left === undefined && right === undefined) return 0;
    if (left === undefined) return 1;
    if (right === undefined) return -1;
    return direction * (left - right);
  };
  const compareAutoQueue = (left: DashboardAccountViewModel, right: DashboardAccountViewModel): number => {
    if (left.isActive !== right.isActive) return left.isActive ? -1 : 1;
    if (left.enabled !== right.enabled) return left.enabled ? -1 : 1;
    const leftPriority = left.queuePriority && hasDashboardAutoQueueCapability(left);
    const rightPriority = right.queuePriority && hasDashboardAutoQueueCapability(right);
    if (leftPriority !== rightPriority) {
      return leftPriority ? -1 : 1;
    }

    const healthRank = { healthy: 0, expiring: 1, quota: 2, refresh_failed: 3, disabled: 4, reauthorize: 5 } as const;
    const healthDifference = healthRank[left.healthKind] - healthRank[right.healthKind];
    if (healthDifference !== 0) return healthDifference;

    return compareDashboardAutoQueueAccounts(left, right) || left.email.localeCompare(right.email);
  };

  if (sort === "auto-queue") {
    return sortWithQueuedAccount(accounts, compareAutoQueue);
  }

  const compareQuotaBalance = (
    left: DashboardAccountViewModel,
    right: DashboardAccountViewModel,
    quotaSort: "balance-desc" | "balance-asc"
  ): number => {
    const quotaValue = (account: DashboardAccountViewModel, priority: MetricPriority): number | undefined =>
      metricFor(account, priority)?.percentage;
    const valuesFor = (account: DashboardAccountViewModel): Array<number | undefined> => {
      const metrics = account.metrics
        .filter((metric) => metric.visible && typeof metric.percentage === "number" && Number.isFinite(metric.percentage))
        .map((metric) => metric.percentage as number);
      if (!metrics.length) return [undefined];
      const preferred = quotaValue(account, metricPriority);
      return [Math.min(...metrics), preferred, ...metrics];
    };
    const leftValues = valuesFor(left);
    const rightValues = valuesFor(right);
    const direction: 1 | -1 = quotaSort === "balance-asc" ? 1 : -1;
    for (let index = 0; index < leftValues.length; index += 1) {
      const difference = compareDefinedNumbers(leftValues[index], rightValues[index], direction);
      if (difference !== 0) return difference;
    }
    return left.email.localeCompare(right.email);
  };

  const valueFor = (account: DashboardAccountViewModel): number | string | undefined => {
    if (sort === "name") {
      return (account.displayName || account.email).toLocaleLowerCase();
    }
    if (sort === "last-refresh") {
      return account.lastQuotaAt;
    }
    if (sort === "login-date") {
      return account.loginAt;
    }
    if (sort === "account-type") {
      return account.accountStructureLabel.toLocaleLowerCase();
    }
    if (sort === "status") {
      return ({ healthy: 0, expiring: 1, quota: 2, refresh_failed: 3, disabled: 4, reauthorize: 5 } as const)[
        account.healthKind
      ];
    }
    if (sort === "time-left") {
      const resetTimes = account.metrics
        .filter((metric) => metric.visible)
        .map((metric) => metric.resetAt)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
      return resetTimes.length ? Math.min(...resetTimes) : undefined;
    }
    if (sort === "subscription-expiry") {
      return account.subscriptionExpiresAt;
    }
    return metricFor(account, metricPriority)?.percentage;
  };

  return sortWithQueuedAccount(accounts, (left, right) => {
    if (sort === "quota") {
      return compareQuotaBalance(left, right, "balance-desc");
    }
    const leftValue = valueFor(left);
    const rightValue = valueFor(right);
    if (leftValue === undefined && rightValue === undefined) {
      return left.email.localeCompare(right.email);
    }
    if (leftValue === undefined) {
      return 1;
    }
    if (rightValue === undefined) {
      return -1;
    }
    const direction =
      sort === "time-left" || sort === "login-date" || sort === "subscription-expiry" || sort === "status" || sort === "name" || sort === "account-type" ? 1 : -1;
    if (typeof leftValue === "string" && typeof rightValue === "string") {
      return direction * leftValue.localeCompare(rightValue);
    }
    return direction * ((leftValue as number) - (rightValue as number));
  });
}

function loadUiPreferences(): UiPreferences {
  try {
    const currentRaw = window.localStorage.getItem(UI_PREFERENCES_STORAGE_KEY);
    const raw = currentRaw ?? window.localStorage.getItem(LEGACY_UI_PREFERENCES_STORAGE_KEY);
    if (!raw) return DEFAULT_UI_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<UiPreferences>;
    return {
      filter: (parsed.filter as string) === "pinned" ? "all" : (parsed.filter ?? DEFAULT_UI_PREFERENCES.filter),
      view: currentRaw ? (parsed.view ?? "cards") : "cards",
      metricPriority: parsed.metricPriority ?? DEFAULT_UI_PREFERENCES.metricPriority
    };
  } catch {
    return DEFAULT_UI_PREFERENCES;
  }
}

function loadUsageHistory(): DashboardUsageSample[] {
  try {
    const raw = window.localStorage.getItem(USAGE_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is DashboardUsageSample =>
          Boolean(
            item &&
            typeof item === "object" &&
            typeof (item as DashboardUsageSample).at === "number" &&
            typeof (item as DashboardUsageSample).accountId === "string"
          )
        )
      : [];
  } catch {
    return [];
  }
}

function mergeUsageHistory(
  authoritative: readonly DashboardUsageSample[],
  local: readonly DashboardUsageSample[]
): DashboardUsageSample[] {
  const merged = new Map<string, DashboardUsageSample>();
  for (const sample of [...authoritative, ...local]) {
    merged.set(`${sample.accountId}:${sample.at}`, sample);
  }
  return [...merged.values()].sort((left, right) => left.at - right.at).slice(-10_000);
}

function sameUsageHistory(left: readonly DashboardUsageSample[], right: readonly DashboardUsageSample[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((sample, index) => {
    const other = right[index];
    return Boolean(
      other &&
      sample.at === other.at &&
      sample.accountId === other.accountId &&
      sample.hourly === other.hourly &&
      sample.weekly === other.weekly &&
      sample.review === other.review
    );
  });
}

function filterAccounts(
  accounts: DashboardAccountViewModel[],
  query: string,
  filter: AccountFilter,
  threshold: number,
  selectedTags: string[]
): DashboardAccountViewModel[] {
  const normalized = query.trim().toLocaleLowerCase();
  return accounts.filter((account) => {
    const matchesQuery =
      !normalized ||
      [account.email, account.displayName, account.accountName, account.workspaceLabel, ...account.tags]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase().includes(normalized));
    const percentages = account.metrics
      .filter((metric) => metric.visible && typeof metric.percentage === "number")
      .map((metric) => metric.percentage as number);
    const low = percentages.some((value) => value <= threshold);
    const attention = isAccountAttention(account);
    const matchesFilter =
      filter === "all" ||
      (filter === "healthy" && !attention) ||
      (filter === "attention" && attention) ||
      (filter === "low" && low) ||
      (filter === "active" && account.isActive) ||
      (filter === "enabled" && account.enabled) ||
      (filter === "disabled" && !account.enabled);
    const matchesTags = selectedTags.length === 0 || selectedTags.some((tag) => account.tags.includes(tag));
    return matchesQuery && matchesFilter && matchesTags;
  });
}

function TagFilterControl(props: {
  availableTags: string[];
  selectedTags: string[];
  open: boolean;
  lang: string;
  onToggleOpen: () => void;
  onToggleTag: (tag: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverPosition, setPopoverPosition] = useState({ top: 0, right: 0 });
  useEffect(() => {
    if (!props.open) return;
    const updatePosition = (): void => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPopoverPosition({ top: rect.bottom + 5, right: Math.max(8, window.innerWidth - rect.right) });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [props.open]);
  useEffect(() => {
    if (!props.open) return;
    const closeOutside = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !popoverRef.current?.contains(target)) props.onClose();
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [props.open, props.onClose]);

  const label = resolveUiText("tags", props.lang);
  const triggerLabel = props.selectedTags.length ? `${label} (${props.selectedTags.length})` : label;
  return (
    <div class="dashboard-tag-filter" ref={rootRef}>
      <button
        type="button"
        class={`dashboard-tag-filter-trigger ${props.open ? "active" : ""}`}
        aria-haspopup="menu"
        aria-expanded={props.open}
        aria-label={label}
        onClick={props.onToggleOpen}
      >
        <span>{triggerLabel}</span>
        <DropdownChevronIcon open={props.open} />
      </button>
      {props.open
        ? createPortal(
            <div
              ref={popoverRef}
              class="dashboard-tag-filter-popover"
              role="menu"
              style={{ top: `${popoverPosition.top}px`, right: `${popoverPosition.right}px` }}
            >
              {props.availableTags.map((tag) => (
                <label class="dashboard-tag-filter-option" key={tag}>
                  <input
                    type="checkbox"
                    checked={props.selectedTags.includes(tag)}
                    onChange={() => props.onToggleTag(tag)}
                  />
                  <span>{tag}</span>
                </label>
              ))}
              {props.selectedTags.length ? (
                <button type="button" class="dashboard-tag-filter-clear" onClick={props.onClear}>
                  {resolveUiText("clearTagsFilter", props.lang)}
                </button>
              ) : null}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

function resolveUiText(key: string, lang: string): string {
  const zh = lang === "zh";
  const hant = lang === "zh-hant";
  const labels: Record<string, string> = {
    summary: zh ? "账号摘要" : hant ? "帳號摘要" : "Account summary",
    total: zh ? "总数" : hant ? "總數" : "Total",
    healthy: zh ? "正常" : hant ? "正常" : "Healthy",
    attention: zh ? "需关注" : hant ? "需注意" : "Attention",
    lowest: zh ? "最低余额" : hant ? "最低餘額" : "Lowest",
    average: zh ? "平均余额" : hant ? "平均餘額" : "Average",
    search: zh ? "搜索账号…" : hant ? "搜尋帳號…" : "Search accounts…",
    clear: zh ? "清除搜索" : hant ? "清除搜尋" : "Clear search",
    filter: zh ? "筛选" : hant ? "篩選" : "Filter",
    all: zh ? "全部" : hant ? "全部" : "All accounts",
    healthyFilter: zh ? "正常" : "Healthy",
    attentionFilter: zh ? "需关注" : "Attention",
    low: zh ? "低配额" : hant ? "低配額" : "Low quota",
    active: zh ? "当前" : hant ? "目前" : "Current",
    valid: zh ? "有效" : hant ? "有效" : "Valid",
    invalid: zh ? "无效" : hant ? "無效" : "Invalid",
    enabled: zh ? "已启用" : hant ? "已啟用" : "Enabled",
    disabled: zh ? "已禁用" : hant ? "已停用" : "Disabled",
    weeklyShort: zh ? "周配额" : hant ? "週配額" : "Weekly",
    metric: zh ? "主指标" : hant ? "主指標" : "Metric",
    tags: zh ? "标签" : hant ? "標籤" : "Tags",
    clearTagsFilter: zh ? "清除标签筛选" : hant ? "清除標籤篩選" : "Clear tag filter",
    weekly: zh ? "每周配额" : hant ? "每週配額" : "Weekly quota",
    hourly: zh ? "5小时配额" : hant ? "5小時配額" : "5-hour quota",
    review: zh ? "代码审查" : hant ? "程式碼審查" : "Code review",
    view: zh ? "切换视图" : hant ? "切換檢視" : "Toggle view",
    gridView: zh ? "网格视图" : hant ? "網格檢視" : "Grid view",
    tableView: zh ? "表格视图" : hant ? "表格檢視" : "Table view",
    noResults: zh ? "没有匹配的账号" : hant ? "沒有符合的帳號" : "No accounts match your filters"
  };
  if (key === "healthy") return labels["healthy"] ?? "Healthy";
  if (key === "attention") return labels["attention"] ?? "Attention";
  return labels[key] ?? key;
}

function resolveWeeklyQuotaTitle(percent: number | undefined, accountCount: number, lang: string): string {
  if (percent == null) {
    return lang === "zh"
      ? "没有可用的每周配额数据"
      : lang === "zh-hant"
        ? "沒有可用的每週配額資料"
        : "No weekly quota data available";
  }
  if (lang === "zh") return `${accountCount} 个账号的平均每周剩余配额：${percent}%`;
  if (lang === "zh-hant") return `${accountCount} 個帳號的平均每週剩餘配額：${percent}%`;
  return `Average weekly quota remaining across ${accountCount} accounts: ${percent}%`;
}

function resolveSortAriaLabel(lang: string): string {
  return lang === "zh" ? "排序账号" : lang === "zh-hant" ? "排序帳號" : "Sort accounts";
}

function resolveSortOptionLabel(sort: AccountSort, lang: string): string {
  const zh = lang === "zh";
  const hant = lang === "zh-hant";
  if (sort === "auto-queue") return zh ? "自动队列" : hant ? "自動佇列" : "Auto queue";
  if (sort === "quota") return zh ? "配额" : hant ? "配額" : "Quota";
  if (sort === "time-left") return zh ? "剩余时间" : hant ? "剩餘時間" : "Time left";
  if (sort === "login-date") return zh ? "登录日期" : hant ? "登入日期" : "Login date";
  if (sort === "account-type") return zh ? "账号类型" : hant ? "帳號類型" : "Account type";
  if (sort === "subscription-expiry") return zh ? "订阅即将到期" : hant ? "訂閱即將到期" : "Expiring soon";
  if (sort === "name") return zh ? "名称" : hant ? "名稱" : "Name";
  if (sort === "last-refresh") return zh ? "最近刷新" : hant ? "最近重新整理" : "Last refreshed";
  return zh ? "状态" : hant ? "狀態" : "Status";
}

function resolveAboutTitle(lang: string): string {
  if (lang === "zh") {
    return "关于";
  }
  if (lang === "zh-hant") {
    return "關於";
  }
  return "About";
}

render(<App />, document.getElementById("app")!);
