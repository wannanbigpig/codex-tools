import { render } from "preact";
import { useEffect, useReducer, useState } from "preact/hooks";
import type { DashboardAccountViewModel } from "../../src/domain/dashboard/types";
import { AnnouncementCenter } from "./announcementCenter";
import { BatchSelectionBar, OverviewSection, RecoveryPanel, SavedAccountCard } from "./components";
import { postMessageToHost } from "./host";
import { formatSavedAccountsSummary, normalizeThresholds, resolveLockMinutes } from "./helpers";
import { useDashboardActions, useDashboardHostSync, useDashboardModals } from "./hooks";
import { BellIcon, EyeIcon, EyeOffIcon, GitHubIcon } from "./icons";
import { AddAccountModal, ConfirmCancelOauthModal, SettingsOverlay, ShareTokenModal } from "./panels";
import { createInitialState, reducer } from "./state";
import { resolveDashboardThemeFromMedia } from "./theme";

const GITHUB_PROJECT_URL = "https://github.com/wannanbigpig/codex-tools";

function App() {
  const [state, dispatch] = useReducer(reducer, undefined, createInitialState);
  const [announcementsOpen, setAnnouncementsOpen] = useState(false);
  const { patchSettings, sendAction, sendSetting, isActionPending, hasGlobalPendingAction } = useDashboardActions(
    state,
    dispatch
  );
  const snapshot = state.snapshot;
  const modals = useDashboardModals({
    dispatch,
    sendAction,
    importJsonFileReadError: snapshot?.copy.importJsonFileReadError ?? "Failed to read JSON file."
  });
  useDashboardHostSync({
    handleHostMessage: modals.handleHostMessage,
    handleEscape: () => modals.handleEscape(isActionPending("completeOAuthSession"))
  });
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
  const invalidAccountCount = snapshot.accounts.filter(
    (account) =>
      !account.dismissedHealth &&
      (account.healthKind === "reauthorize" ||
        account.healthKind === "refresh_failed" ||
        account.healthKind === "disabled" ||
        account.healthKind === "quota")
  ).length;
  const validAccountCount = snapshot.accounts.length - invalidAccountCount;

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
              restoreJsonPending={importSharedPending && modals.importRecoveryMode}
              onRestoreBackup={() => sendAction("restoreFromBackup")}
              onRestoreAuth={() => sendAction("restoreFromAuthJson")}
              onImportJson={modals.openRecoveryImportModal}
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
                id="announcementsButton"
                class={`settings-btn announcement-btn ${announcementUnreadCount > 0 ? "has-unread" : ""}`}
                type="button"
                title={snapshot.copy.announcementsTooltip}
                aria-label={snapshot.copy.announcementsTooltip}
                onClick={() => setAnnouncementsOpen(true)}
              >
                <BellIcon />
                {announcementUnreadCount > 0 ? (
                  <span class="announcement-button-badge" aria-label={`${announcementUnreadCount} unread`}>
                    {announcementUnreadCount > 9 ? "9+" : announcementUnreadCount}
                  </span>
                ) : null}
              </button>
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
            onAddAccount={modals.openAddAccountModal}
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

      <SettingsOverlay
        open={state.settingsOpen}
        copy={snapshot.copy}
        lang={snapshot.lang}
        settings={snapshot.settings}
        tokenAutomation={snapshot.tokenAutomation}
        onClose={() => dispatch({ type: "close-settings" })}
        onPatchSettings={patchSettings}
        onSendSetting={sendSetting}
        onAutoRefreshToggle={handleAutoRefreshToggle}
        onAutoRefreshValue={handleAutoRefreshValue}
        onThresholdPreview={handleThresholdPreview}
        onThresholdCommit={handleThresholdCommit}
        onPickCodexAppPath={() => postMessageToHost({ type: "dashboard:pickCodexAppPath" })}
        onClearCodexAppPath={() => postMessageToHost({ type: "dashboard:clearCodexAppPath" })}
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
        startOAuthAutoPending={startOAuthAutoPending}
        completeOAuthPending={completeOAuthPending}
        previewImportPending={previewImportPending}
        importSharedPending={importSharedPending}
        onClose={() => modals.closeAddAccountModal(completeOAuthPending)}
        onSelectTab={modals.handleAddAccountTabChange}
        onCopyOauthLink={modals.handleCopyOauthLink}
        onOpenInBrowser={modals.handleStartOAuthAutoFlow}
        onOauthCallbackChange={modals.setOauthCallbackUrl}
        onCompleteOAuth={modals.handleCompleteOAuth}
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
        selectedCount={selectedCount}
        shareModalJson={modals.shareModalJson}
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


render(<App />, document.getElementById("app")!);
