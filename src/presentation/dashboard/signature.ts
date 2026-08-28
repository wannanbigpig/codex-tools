import type { DashboardState } from "../../domain/dashboard/types";

export function buildDashboardStateSignature(state: DashboardState): string {
  const accountSignature = state.accounts
    .map((account) =>
      [
        account.id,
        account.email,
        account.displayName,
        account.accountName ?? "",
        account.planTypeLabel,
        account.creditsText ?? "",
        account.creditsBalance ?? "",
        account.creditsUnlimited ? "1" : "0",
        account.accountId ?? "",
        account.organizationId ?? "",
        account.userId ?? "",
        account.tags.join(","),
        account.isActive ? "1" : "0",
        account.switchQueued ? "1" : "0",
        account.sessionStartedAt ?? "",
        account.totalUsageMs ?? 0,
        account.runningDeviceName ?? "",
        account.runningOnThisDevice ? "1" : "0",
        account.enabled ? "1" : "0",
        account.queuePriority ? "1" : "0",
        account.tokenRefreshEnabled ? "1" : "0",
        account.showInStatusBar ? "1" : "0",
        account.lastQuotaAt ?? 0,
        account.resetCreditsAvailable ?? "",
        account.resetCreditsNextExpiresAt ?? "",
        account.healthKind,
        account.dismissedHealth ? "1" : "0",
        account.lastTokenCheckAt ?? "",
        account.lastTokenRefreshAt ?? "",
        account.lastTokenRefreshError ?? "",
        account.autoSwitchLockedUntil ?? "",
        account.metrics
          .filter((metric) => metric.visible)
          .map(
            (metric) =>
              `${metric.key}:${metric.period ?? ""}:${metric.label}:${metric.percentage ?? ""}:${metric.requestsLeft ?? ""}:${metric.requestsLimit ?? ""}:${metric.resetAt ?? ""}`
          )
          .join(",")
      ].join(":")
    )
    .join("|");
  const announcementSignature = [
    state.announcements.unreadIds.join(","),
    state.announcements.popupAnnouncement?.id ?? "",
    state.announcements.announcements
      .map(
        (item) =>
          `${item.id}:${item.title}:${item.summary}:${item.createdAt}:${item.releaseVersion ?? ""}:${item.restartRequired ? "1" : "0"}:${item.restartHint ?? ""}:${item.pinned ? "1" : "0"}`
      )
      .join("|")
  ].join(":");
  const dailyUsageSignature = (state.dailyUsageCache ?? [])
    .map((entry) => `${entry.accountId}:${entry.fetchedAt}:${entry.usage.days}:${entry.usage.points.map((point) => `${point.date}:${point.totalTokens}`).join(",")}`)
    .join("|");

  return [
    state.lang,
    state.panelTitle,
    state.brandSub,
    state.settings.dashboardTheme,
    state.settings.displayLanguage,
    state.settings.autoResumeCodexSessions ? "1" : "0",
    state.settings.autoRefreshMinutes,
    state.settings.autoRefreshCurrentMinutes,
    state.settings.usageHistoryRetentionDays,
    state.encryptedSyncNeedsConfiguration ? "1" : "0",
    state.encryptedSyncNeedsSettingsSync ? "1" : "0",
    state.encryptedSyncLastCompletedAt ?? "",
    state.encryptedSyncSessionCount ?? "",
    state.encryptedSyncEnabledSessionCount ?? "",
    state.settings.encryptedSyncRegistryOverrideEnabled ? "1" : "0",
    state.settings.autoSwitchEnabled ? "1" : "0",
    state.settings.hourlyQuotaControlEnabled ? "1" : "0",
    state.settings.autoSwitchReloadWindowEnabled ? "1" : "0",
    state.settings.autoSwitchHourlyThreshold,
    state.settings.autoSwitchWeeklyThreshold,
    state.settings.autoSwitchLockMinutes,
    state.settings.quotaWarningEnabled ? "1" : "0",
    state.settings.quotaWarningThreshold,
    state.settings.quotaGreenThreshold,
    state.settings.quotaYellowThreshold,
    state.tokenAutomation.enabled ? "1" : "0",
    state.tokenAutomation.lastCheckAt ?? "",
    state.tokenAutomation.nextCheckAt ?? "",
    state.tokenAutomation.lastRefreshAt ?? "",
    state.tokenAutomation.lastFailureMessage ?? "",
    state.indexHealth.status,
    state.indexHealth.availableBackups,
    state.indexHealth.lastRestoreSource ?? "",
    state.indexHealth.lastErrorMessage ?? "",
    state.indexHealth.lastRecoveredAt ?? "",
    state.terminalNotice?.level ?? "",
    state.terminalNotice?.message ?? "",
    state.terminalNotice?.createdAt ?? "",
    announcementSignature,
    dailyUsageSignature,
    accountSignature
  ].join("||");
}
