import type { DashboardLanguage, DashboardLanguageOption } from "../../localization/languages";

export type DashboardSettingKey =
  | "codexAppRestartEnabled"
  | "codexAppRestartMode"
  | "autoRefreshMinutes"
  | "autoSwitchEnabled"
  | "autoSwitchHourlyThreshold"
  | "autoSwitchWeeklyThreshold"
  | "showCodeReviewQuota"
  | "quotaWarningEnabled"
  | "quotaWarningThreshold"
  | "quotaGreenThreshold"
  | "quotaYellowThreshold"
  | "debugNetwork"
  | "displayLanguage";

export interface DashboardSettings {
  codexAppRestartEnabled: boolean;
  codexAppRestartMode: "auto" | "manual";
  autoRefreshMinutes: number;
  autoSwitchEnabled: boolean;
  autoSwitchHourlyThreshold: number;
  autoSwitchWeeklyThreshold: number;
  codexAppPath: string;
  resolvedCodexAppPath: string;
  showCodeReviewQuota: boolean;
  quotaWarningEnabled: boolean;
  quotaWarningThreshold: number;
  quotaGreenThreshold: number;
  quotaYellowThreshold: number;
  debugNetwork: boolean;
  displayLanguage: DashboardLanguageOption;
}

export interface DashboardCopy {
  panelTitle: string;
  brandSub: string;
  refreshPage: string;
  addAccount: string;
  importCurrent: string;
  refreshAll: string;
  dashboardTitle: string;
  dashboardSub: string;
  empty: string;
  noActiveAccountTitle: string;
  noActiveAccountSub: string;
  current: string;
  hourlyLabel: string;
  weeklyLabel: string;
  reviewLabel: string;
  userId: string;
  lastRefresh: string;
  accountId: string;
  organization: string;
  savedAccounts: string;
  savedAccountsSub: string;
  teamName: string;
  login: string;
  switchBtn: string;
  refreshBtn: string;
  detailsBtn: string;
  removeBtn: string;
  settingsTitle: string;
  showSensitive: string;
  hideSensitive: string;
  codexAppRestartTitle: string;
  codexAppRestartSub: string;
  restartModeAuto: string;
  restartModeAutoDesc: string;
  restartModeManual: string;
  restartModeManualDesc: string;
  restartModeNote: string;
  autoRefreshTitle: string;
  autoRefreshSub: string;
  autoRefreshOn: string;
  autoRefreshOnDesc: string;
  autoRefreshOff: string;
  autoRefreshOffDesc: string;
  autoRefreshValueTemplate: string;
  autoRefreshValueDescTemplate: string;
  autoSwitchTitle: string;
  autoSwitchSub: string;
  autoSwitchOn: string;
  autoSwitchOnDesc: string;
  autoSwitchOff: string;
  autoSwitchOffDesc: string;
  autoSwitchThresholdSuffix: string;
  autoSwitchThresholdDescTemplate: string;
  autoSwitchAnyNote: string;
  autoSwitchToastSwitched: string;
  appPathTitle: string;
  appPathSub: string;
  appPathEmpty: string;
  pickPath: string;
  clearPath: string;
  dashboardSettingsTitle: string;
  dashboardSettingsSub: string;
  showReviewOn: string;
  showReviewOnDesc: string;
  showReviewOff: string;
  showReviewOffDesc: string;
  warningTitle: string;
  warningSub: string;
  warningOn: string;
  warningOnDesc: string;
  warningOff: string;
  warningOffDesc: string;
  warningValueDescTemplate: string;
  colorThresholdTitle: string;
  colorThresholdSub: string;
  colorThresholdGreenTitle: string;
  colorThresholdYellowTitle: string;
  colorThresholdGreenDescTemplate: string;
  colorThresholdYellowDescTemplate: string;
  colorThresholdRedNoteTemplate: string;
  debugTitle: string;
  debugSub: string;
  debugOn: string;
  debugOnDesc: string;
  debugOff: string;
  debugOffDesc: string;
  debugNote: string;
  languageTitle: string;
  languageSub: string;
  languageAuto: string;
  languageZh: string;
  languageEn: string;
  languageNote: string;
  statusShort: string;
  statusToggleTip: string;
  statusToggleTipChecked: string;
  statusLimitTip: string;
  unknown: string;
  never: string;
  resetUnknown: string;
}

type DashboardMetricKey = "hourly" | "weekly" | "review";

export interface DashboardMetricViewModel {
  key: DashboardMetricKey;
  label: string;
  percentage?: number;
  resetAt?: number;
  visible: boolean;
}

export interface DashboardAccountViewModel {
  id: string;
  displayName: string;
  email: string;
  accountName?: string;
  authProviderLabel: string;
  accountStructureLabel: string;
  planTypeLabel: string;
  userId?: string;
  accountId?: string;
  organizationId?: string;
  isActive: boolean;
  showInStatusBar: boolean;
  canToggleStatusBar: boolean;
  statusToggleTitle: string;
  hasQuota402: boolean;
  lastQuotaAt?: number;
  metrics: DashboardMetricViewModel[];
}

export interface DashboardState {
  lang: DashboardLanguage;
  panelTitle: string;
  brandSub: string;
  logoUri: string;
  settings: DashboardSettings;
  copy: DashboardCopy;
  accounts: DashboardAccountViewModel[];
}

export type DashboardActionName =
  | "addAccount"
  | "importCurrent"
  | "refreshAll"
  | "refreshView"
  | "details"
  | "switch"
  | "refresh"
  | "remove"
  | "toggleStatusBar";

export type DashboardHostMessage =
  | {
      type: "dashboard:snapshot";
      state: DashboardState;
    }
  | {
      type: "dashboard:action-result";
      requestId: string;
      action: DashboardActionName;
      accountId?: string;
      status: "completed" | "failed";
    };

export type DashboardClientMessage =
  | { type: "dashboard:ready" }
  | {
      type: "dashboard:action";
      requestId: string;
      action: DashboardActionName;
      accountId?: string;
    }
  | {
      type: "dashboard:setting";
      key: DashboardSettingKey;
      value: string | number | boolean;
    }
  | { type: "dashboard:pickCodexAppPath" }
  | { type: "dashboard:clearCodexAppPath" };
