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
        account.accountId ?? "",
        account.organizationId ?? "",
        account.userId ?? "",
        account.tags.join(","),
        account.isActive ? "1" : "0",
        account.showInStatusBar ? "1" : "0",
        account.lastQuotaAt ?? 0,
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
              `${metric.key}:${metric.percentage ?? ""}:${metric.requestsLeft ?? ""}:${metric.requestsLimit ?? ""}:${metric.resetAt ?? ""}`
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

  return [
    state.lang,
    state.panelTitle,
    state.brandSub,
    state.settings.dashboardTheme,
    state.settings.displayLanguage,
    state.settings.autoRefreshMinutes,
    state.settings.autoSwitchEnabled ? "1" : "0",
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
    announcementSignature,
    accountSignature
  ].join("||");
}
