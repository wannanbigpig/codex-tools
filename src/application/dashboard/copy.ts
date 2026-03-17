import { DashboardCopy, DashboardLanguage } from "../../domain/dashboard/types";

const zh: DashboardCopy = {
  panelTitle: "codex-tools 配额总览",
  brandSub: "多账号切换与配额监控主面板",
  refreshPage: "刷新页面",
  addAccount: "添加账号",
  importCurrent: "导入当前账号",
  refreshAll: "刷新配额",
  dashboardTitle: "codex-tools · 配额总览",
  dashboardSub: "主面板视图，适合停留查看和截图",
  empty: "还没有保存账号",
  current: "当前",
  hourlyLabel: "5小时",
  weeklyLabel: "每周",
  reviewLabel: "代码审查",
  userId: "用户 ID",
  lastRefresh: "最近刷新",
  accountId: "账号 ID",
  organization: "组织",
  savedAccounts: "已保存账号",
  savedAccountsSub: "集中管理已保存账号，支持切换、刷新、查看详情和删除。",
  teamName: "团队空间",
  login: "登录方式",
  switchBtn: "切换",
  refreshBtn: "刷新",
  detailsBtn: "详情",
  removeBtn: "删除",
  settingsTitle: "设置",
  codexAppRestartTitle: "Codex App 重启策略",
  codexAppRestartSub: "控制切换账号时，如何处理本机已在运行中的 Codex App。",
  restartModeAuto: "帮我自动重启",
  restartModeAutoDesc: "如果 Codex App 当前正在运行，切换账号后直接重启它。",
  restartModeManual: "每次手动点击重启",
  restartModeManualDesc: "保留最终确认权。切换账号后由你决定是否立即重启。",
  restartModeNote: "只有当 Codex App 当前已经在运行时，才会执行重启。若应用未启动，扩展不会强行拉起。",
  autoRefreshTitle: "配额自动刷新",
  autoRefreshSub: "定时刷新当前已保存账号的配额数据。",
  autoRefreshOn: "开启自动刷新",
  autoRefreshOnDesc: "按固定时间间隔自动刷新全部账号配额。",
  autoRefreshOff: "关闭",
  autoRefreshOffDesc: "不自动刷新，由你手动控制。",
  autoRefreshValueTemplate: "{value} 分钟",
  autoRefreshValueDescTemplate: "每 {value} 分钟自动刷新一次全部账号配额。",
  appPathTitle: "Codex App 启动路径",
  appPathSub: "可选。你可以指定本机 Codex App 的自定义路径；留空则使用自动检测。",
  appPathEmpty: "当前使用自动检测路径",
  pickPath: "选择路径",
  clearPath: "恢复自动检测",
  dashboardSettingsTitle: "仪表盘显示",
  dashboardSettingsSub: "控制总览面板中显示哪些信息。",
  showReviewOn: "显示 Code Review 配额",
  showReviewOnDesc: "在总览和账号卡片中展示 Code Review 配额。",
  showReviewOff: "隐藏 Code Review 配额",
  showReviewOffDesc: "精简仪表盘，只显示 5 小时和每周配额。",
  warningTitle: "超额预警",
  warningSub: "当当前账号配额低于阈值时弹出提醒。",
  warningOn: "开启预警",
  warningOnDesc: "刷新后如果低于阈值，会弹出通知提醒。",
  warningOff: "关闭预警",
  warningOffDesc: "不做额度阈值提醒。",
  warningValueDescTemplate: "当可用配额低于 {value}% 时提醒。",
  colorThresholdTitle: "配额颜色阈值",
  colorThresholdSub: "控制绿色、黄色和红色的显示区间。",
  colorThresholdGreenTitle: "绿色起点",
  colorThresholdYellowTitle: "黄色起点",
  colorThresholdGreenDescTemplate: "剩余配额大于等于 {value}% 时显示绿色。",
  colorThresholdYellowDescTemplate: "剩余配额大于等于 {value}% 且低于绿色阈值时显示黄色。",
  colorThresholdRedNoteTemplate: "低于 {value}% 的配额会显示为红色。",
  debugTitle: "网络调试日志",
  debugSub: "控制是否将接口请求摘要写入输出面板。",
  debugOn: "开启调试日志",
  debugOnDesc: "记录脱敏后的请求结果，便于排查接口异常。",
  debugOff: "关闭调试日志",
  debugOffDesc: "默认关闭，避免无关调试输出。",
  debugNote: "日志会写入 `Codex Accounts Network` 输出通道，并对敏感字段做截断和脱敏处理。",
  languageTitle: "语言",
  languageSub: "覆盖总览面板和提示文案的语言，仅对本扩展生效。",
  languageAuto: "自动（跟随 VS Code）",
  languageZh: "简体中文",
  languageEn: "English",
  languageNote: "修改后会立即应用到本扩展的面板和提示文案，不影响 VS Code 其他界面语言。",
  statusShort: "状态栏",
  statusToggleTip: "控制该账号是否显示在底部状态栏弹窗中",
  statusToggleTipChecked: "已显示在底部状态栏弹窗中，点击可取消",
  statusLimitTip: "状态栏最多显示 2 个额外账号，请先取消一个已勾选账号",
  unknown: "未知",
  never: "从未",
  resetUnknown: "重置时间未知"
};

const en: DashboardCopy = {
  panelTitle: "codex-tools quota summary",
  brandSub: "Main dashboard for multi-account switching and quota tracking",
  refreshPage: "Refresh Page",
  addAccount: "Add Account",
  importCurrent: "Import Current",
  refreshAll: "Refresh Quotas",
  dashboardTitle: "codex-tools · Quota Dashboard",
  dashboardSub: "Primary dashboard for monitoring, management, and screenshots",
  empty: "No saved accounts yet",
  current: "Current",
  hourlyLabel: "5h",
  weeklyLabel: "Weekly",
  reviewLabel: "Review",
  userId: "User ID",
  lastRefresh: "Last Refresh",
  accountId: "Account ID",
  organization: "Organization",
  savedAccounts: "Saved Accounts",
  savedAccountsSub: "Manage saved accounts here, including switching, refresh, details, and removal.",
  teamName: "Team Name",
  login: "Login",
  switchBtn: "Switch",
  refreshBtn: "Refresh",
  detailsBtn: "Details",
  removeBtn: "Remove",
  settingsTitle: "Settings",
  codexAppRestartTitle: "Codex App Restart Policy",
  codexAppRestartSub: "Control how the extension handles a currently running Codex App when switching accounts.",
  restartModeAuto: "Restart automatically",
  restartModeAutoDesc: "If Codex App is already running, restart it immediately after switching accounts.",
  restartModeManual: "Ask every time",
  restartModeManualDesc: "Keep the final decision in your hands and confirm each restart manually.",
  restartModeNote: "The extension only restarts Codex App when it is already running. It will not launch the desktop app from a stopped state.",
  autoRefreshTitle: "Automatic Quota Refresh",
  autoRefreshSub: "Refresh saved account quotas on a timer.",
  autoRefreshOn: "Enable auto refresh",
  autoRefreshOnDesc: "Refresh all saved account quotas on a fixed schedule.",
  autoRefreshOff: "Off",
  autoRefreshOffDesc: "Disable timed refresh and refresh manually when needed.",
  autoRefreshValueTemplate: "{value} min",
  autoRefreshValueDescTemplate: "Refresh quotas for all saved accounts every {value} minutes.",
  appPathTitle: "Codex App Launch Path",
  appPathSub: "Optional. Set a custom desktop app path or leave it empty for auto-detection.",
  appPathEmpty: "Using auto-detected app path",
  pickPath: "Choose Path",
  clearPath: "Use Auto Detect",
  dashboardSettingsTitle: "Dashboard Display",
  dashboardSettingsSub: "Control what the quota dashboard shows.",
  showReviewOn: "Show Code Review quota",
  showReviewOnDesc: "Display Code Review quota in the dashboard and account cards.",
  showReviewOff: "Hide Code Review quota",
  showReviewOffDesc: "Keep the dashboard simpler with only 5-hour and weekly quotas.",
  warningTitle: "Quota Warning",
  warningSub: "Show a warning when the active account quota drops below a threshold.",
  warningOn: "Enable warning",
  warningOnDesc: "Show notifications after refresh when quota is below the threshold.",
  warningOff: "Disable warning",
  warningOffDesc: "Do not show quota threshold notifications.",
  warningValueDescTemplate: "Warn when available quota drops below {value}%.",
  colorThresholdTitle: "Quota Color Thresholds",
  colorThresholdSub: "Control when quotas appear green, yellow, or red.",
  colorThresholdGreenTitle: "Green starts at",
  colorThresholdYellowTitle: "Yellow starts at",
  colorThresholdGreenDescTemplate: "Show green when available quota is at least {value}%.",
  colorThresholdYellowDescTemplate: "Show yellow when available quota is at least {value}% and below the green threshold.",
  colorThresholdRedNoteTemplate: "Show red when available quota falls below {value}%.",
  debugTitle: "Network Debug Logs",
  debugSub: "Control whether request summaries are written to the output panel.",
  debugOn: "Enable debug logs",
  debugOnDesc: "Record sanitized request results to help troubleshoot API issues.",
  debugOff: "Disable debug logs",
  debugOffDesc: "Default off to avoid noisy debugging output.",
  debugNote: "Logs are written to the `Codex Accounts Network` output channel with truncation and redaction applied.",
  languageTitle: "Language",
  languageSub: "Override the dashboard and prompt language for this extension only.",
  languageAuto: "Auto (follow VS Code)",
  languageZh: "Simplified Chinese",
  languageEn: "English",
  languageNote: "Changes apply immediately to this extension only and do not affect the rest of the VS Code UI.",
  statusShort: "Status",
  statusToggleTip: "Control whether this account appears in the bottom status popup",
  statusToggleTipChecked: "This account is already shown in the bottom status popup. Click to remove it",
  statusLimitTip: "You can show at most 2 extra accounts in the status popup. Uncheck one first",
  unknown: "unknown",
  never: "never",
  resetUnknown: "reset unknown"
};

export function getDashboardCopy(language: DashboardLanguage): DashboardCopy {
  return language === "zh" ? zh : en;
}

export function formatAuthProvider(value: string | undefined, language: DashboardLanguage): string {
  const provider = value?.trim() ?? "OpenAI";
  return language === "zh" ? `${provider} 登录` : `${provider} login`;
}

export function formatAccountStructure(value: string | undefined, language: DashboardLanguage): string {
  const normalized = (value ?? "workspace").toLowerCase();
  if (language === "zh") {
    if (normalized === "organization") {
      return "组织空间";
    }
    if (normalized === "team") {
      return "团队空间";
    }
    if (normalized === "personal") {
      return "个人空间";
    }
    return "工作空间";
  }

  return normalized;
}

export function formatPlanType(value: string | undefined, language: DashboardLanguage): string {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) {
    return language === "zh" ? "未知" : "unknown";
  }

  const labels: Record<string, { zh: string; en: string }> = {
    free: { zh: "Free", en: "Free" },
    plus: { zh: "Plus", en: "Plus" },
    pro: { zh: "Pro", en: "Pro" },
    team: { zh: "Team", en: "Team" },
    business: { zh: "Business", en: "Business" },
    enterprise: { zh: "Enterprise", en: "Enterprise" }
  };

  const matched = labels[normalized];
  if (matched) {
    return language === "zh" ? matched.zh : matched.en;
  }

  return normalized;
}
