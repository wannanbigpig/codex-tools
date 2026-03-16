/**
 * 国际化 (i18n) 工具模块
 *
 * 优化内容:
 * - 统一的翻译管理
 * - 类型安全的翻译键
 * - 支持参数插值
 * - 懒加载翻译
 *
 * 使用示例:
 * ```typescript
 * const t = i18n.t();
 * vscode.window.showInformationMessage(t('quota.refreshed', { email: account.email }));
 * ```
 */

import * as vscode from "vscode";

/**
 * 支持的语言
 */
export type SupportedLanguage = "zh" | "en";

/**
 * 翻译键类型 - 确保类型安全
 * 使用字面量联合类型避免循环引用
 */
export type TranslationKey =
  // Common
  | "common.loading"
  | "common.success"
  | "common.error"
  | "common.cancel"
  | "common.confirm"
  | "common.retry"
  | "common.unknown"
  | "common.never"
  // Account
  | "account.current"
  | "account.saved"
  | "account.active"
  | "account.switch"
  | "account.add"
  | "account.remove"
  | "account.import"
  | "account.refresh"
  | "account.details"
  | "account.teamName"
  | "account.login"
  | "account.userId"
  | "account.accountId"
  | "account.organization"
  | "account.lastRefresh"
  // Quota
  | "quota.title"
  | "quota.hourly"
  | "quota.weekly"
  | "quota.review"
  | "quota.refreshed"
  | "quota.refreshFailed"
  | "quota.refreshAll"
  | "quota.refreshing"
  | "quota.refreshedCount"
  | "quota.resetUnknown"
  // Time
  | "time.minutesLeft"
  | "time.hoursLeft"
  | "time.daysLeft"
  | "time.minutesAgo"
  | "time.hoursAgo"
  | "time.daysAgo"
  // Action prompts
  | "action.addAccount.progress"
  | "action.importAccount.progress"
  | "action.switchAccount.progress"
  | "action.refreshAll.progress"
  // Messages
  | "message.addedAndRefreshed"
  | "message.importedAndRefreshed"
  | "message.switchedAndAskReload"
  | "message.alreadyActive"
  | "message.addedButQuotaFailed"
  | "message.importedButQuotaFailed"
  | "message.addAccountFailed"
  | "message.removeAccountFailed"
  | "message.switchAccountFailed"
  | "message.refreshQuotaFailed"
  | "message.tokenExpired"
  | "message.tokenMissing"
  | "message.accountNotFound"
  | "message.networkError"
  | "message.apiError"
  // Confirm
  | "confirm.removeAccount"
  | "confirm.removeButton"
  // Status
  | "status.title"
  | "status.noAccounts"
  | "status.tooltip"
  | "status.inStatus"
  | "status.addToStatus"
  | "status.limitTip"
  // Picker
  | "picker.pickActivateAccount"
  | "picker.pickRefreshAccount"
  | "picker.pickRemoveAccount"
  | "picker.pickInspectAccount"
  | "picker.pickStatusAccount"
  | "picker.noAccounts"
  // Button
  | "button.reloadNow"
  | "button.later"
  | "button.remove"
  | "button.switch"
  | "button.refresh"
  | "button.details"
  | "button.cancel"
  // Panel
  | "panel.quotaSummary.title"
  | "panel.details.title"
  | "panel.dashboard.title"
  // Local Account
  | "localAccount.detected.title"
  | "localAccount.detected.message"
  | "localAccount.detected.action"
  | "localAccount.bound.success"
  | "localAccount.bound.partial"
  | "localAccount.bound.failed"
  | "externalAuth.changed.message"
  | "externalAuth.changed.reload"
  | "externalAuth.changed.later"
  // Status Toggle
  | "statusToggle.alwaysShown"
  | "statusToggle.added"
  | "statusToggle.removed"
  | "statusToggle.limitReached";

/**
 * 翻译参数类型
 */
export type TranslationParams = Record<string, string | number | boolean>;

/**
 * 翻译数据结构
 */
interface TranslationData {
  /** 中文翻译 */
  zh: Record<TranslationKey, string>;
  /** 英文翻译 */
  en: Record<TranslationKey, string>;
}

/**
 * 翻译定义
 *
 * 按功能模块组织翻译字符串
 */
const translations: TranslationData = {
  zh: {
    // 通用
    "common.loading": "加载中...",
    "common.success": "成功",
    "common.error": "错误",
    "common.cancel": "取消",
    "common.confirm": "确认",
    "common.retry": "重试",
    "common.unknown": "未知",
    "common.never": "从未",

    // 账号相关
    "account.current": "当前",
    "account.saved": "已保存",
    "account.active": "激活",
    "account.switch": "切换",
    "account.add": "添加账号",
    "account.remove": "移除账号",
    "account.import": "导入当前账号",
    "account.refresh": "刷新配额",
    "account.details": "查看详情",
    "account.teamName": "团队空间",
    "account.login": "登录方式",
    "account.userId": "用户 ID",
    "account.accountId": "账号 ID",
    "account.organization": "组织",
    "account.lastRefresh": "最后刷新",

    // 配额相关
    "quota.title": "配额",
    "quota.hourly": "5 小时",
    "quota.weekly": "每周",
    "quota.review": "代码审查",
    "quota.refreshed": "已刷新 {email} 的配额",
    "quota.refreshFailed": "刷新 {email} 的配额失败：{message}",
    "quota.refreshAll": "刷新所有配额",
    "quota.refreshing": "正在刷新配额 ({current}/{total})",
    "quota.refreshedCount": "已刷新 {count} 个账号的配额",
    "quota.resetUnknown": "重置时间未知",

    // 时间相关
    "time.minutesLeft": "剩余{value}分钟",
    "time.hoursLeft": "剩余{value}小时",
    "time.daysLeft": "剩余{value}天",
    "time.minutesAgo": "{value}分钟前",
    "time.hoursAgo": "{value}小时前",
    "time.daysAgo": "{value}天前",

    // 操作提示
    "action.addAccount.progress": "添加 Codex 账号",
    "action.importAccount.progress": "导入当前 auth.json",
    "action.switchAccount.progress": "正在切换到 {email}",
    "action.refreshAll.progress": "刷新所有配额",

    // 成功消息
    "message.addedAndRefreshed": "已添加 Codex 账号 {email}，并已刷新配额",
    "message.importedAndRefreshed": "已导入当前 auth.json 为 {email}，并已刷新配额",
    "message.switchedAndAskReload": "已切换当前 Codex 账号到 {email}。是否立即重载 VS Code 以同步内置 Codex 面板？",
    "message.alreadyActive": "{label} 已是当前激活账号",

    // 错误消息
    "message.addedButQuotaFailed": "已添加 Codex 账号 {email}，但刷新配额失败：{message}",
    "message.importedButQuotaFailed": "已导入当前 auth.json 为 {email}，但刷新配额失败：{message}",
    "message.addAccountFailed": "添加账号失败：{message}",
    "message.removeAccountFailed": "移除账号失败：{message}",
    "message.switchAccountFailed": "切换账号失败：{message}",
    "message.refreshQuotaFailed": "刷新配额失败：{message}",
    "message.tokenExpired": "认证令牌已过期，请重新登录",
    "message.tokenMissing": "认证令牌缺失",
    "message.accountNotFound": "账号不存在：{accountId}",
    "message.networkError": "网络错误：{message}",
    "message.apiError": "API 错误：{message}",

    // 确认对话框
    "confirm.removeAccount": "确认移除已保存账号 {email}？这不会删除全局 auth.json。",
    "confirm.removeButton": "删除",

    // 状态栏
    "status.title": "Codex 配额监控",
    "status.noAccounts": "还没有保存 Codex 账号",
    "status.tooltip": "点击打开配额面板",
    "status.inStatus": "状态栏已显示",
    "status.addToStatus": "加入状态栏",
    "status.limitTip": "状态栏最多显示 2 个额外账号",

    // 选择提示
    "picker.pickActivateAccount": "选择要切换到的账号",
    "picker.pickRefreshAccount": "选择要刷新的账号",
    "picker.pickRemoveAccount": "选择要移除的账号",
    "picker.pickInspectAccount": "选择要查看详情的账号",
    "picker.pickStatusAccount": "选择要显示在状态栏弹窗中的账号",
    "picker.noAccounts": "还没有保存 Codex 账号。",

    // 按钮文本
    "button.reloadNow": "立即重载",
    "button.later": "稍后",
    "button.remove": "删除",
    "button.switch": "切换",
    "button.refresh": "刷新",
    "button.details": "详情",
    "button.cancel": "取消",

    // 面板标题
    "panel.quotaSummary.title": "codex-tools 配额总览",
    "panel.details.title": "Codex 账号详情",
    "panel.dashboard.title": "codex-tools · 配额总览",

    // 本地账号检测
    "localAccount.detected.title": "检测到本地 Codex 账号",
    "localAccount.detected.message": "检测到当前机器已有本地 auth.json，是否立即绑定到扩展并刷新最新配额？",
    "localAccount.detected.action": "立即绑定",
    "localAccount.bound.success": "已绑定本地账号 {email}，并已刷新配额",
    "localAccount.bound.partial": "已绑定本地账号 {email}，但刷新配额失败：{message}",
    "localAccount.bound.failed": "绑定本地账号失败：{message}",
    "externalAuth.changed.message": "检测到其他窗口已切换 Codex 账号到 {email}。是否立即重载当前窗口以同步内置 Codex 会话？",
    "externalAuth.changed.reload": "立即重载",
    "externalAuth.changed.later": "稍后",

    // 状态提示
    "statusToggle.alwaysShown": "当前激活账号会始终显示在状态栏弹窗顶部。",
    "statusToggle.added": "已将 {email} 加入状态栏弹窗",
    "statusToggle.removed": "已将 {email} 从状态栏弹窗移除",
    "statusToggle.limitReached": "已达到状态栏显示上限（最多 2 个额外账号）"
  },

  en: {
    // General
    "common.loading": "Loading...",
    "common.success": "Success",
    "common.error": "Error",
    "common.cancel": "Cancel",
    "common.confirm": "Confirm",
    "common.retry": "Retry",
    "common.unknown": "unknown",
    "common.never": "never",

    // Account
    "account.current": "Current",
    "account.saved": "Saved",
    "account.active": "Active",
    "account.switch": "Switch",
    "account.add": "Add Account",
    "account.remove": "Remove Account",
    "account.import": "Import Current Account",
    "account.refresh": "Refresh Quota",
    "account.details": "View Details",
    "account.teamName": "Team Name",
    "account.login": "Login",
    "account.userId": "User ID",
    "account.accountId": "Account ID",
    "account.organization": "Organization",
    "account.lastRefresh": "Last Refresh",

    // Quota
    "quota.title": "Quota",
    "quota.hourly": "5h",
    "quota.weekly": "Weekly",
    "quota.review": "Review",
    "quota.refreshed": "Quota refreshed for {email}",
    "quota.refreshFailed": "Failed to refresh quota for {email}: {message}",
    "quota.refreshAll": "Refresh All Quotas",
    "quota.refreshing": "Refreshing quota ({current}/{total})",
    "quota.refreshedCount": "Refreshed quota for {count} account(s)",
    "quota.resetUnknown": "reset unknown",

    // Time
    "time.minutesLeft": "{value}m left",
    "time.hoursLeft": "{value}h left",
    "time.daysLeft": "{value}d left",
    "time.minutesAgo": "{value}m ago",
    "time.hoursAgo": "{value}h ago",
    "time.daysAgo": "{value}d ago",

    // Action prompts
    "action.addAccount.progress": "Adding Codex account",
    "action.importAccount.progress": "Importing current auth.json",
    "action.switchAccount.progress": "Switching to {email}",
    "action.refreshAll.progress": "Refreshing all quotas",

    // Success messages
    "message.addedAndRefreshed": "Added Codex account {email} and refreshed quota",
    "message.importedAndRefreshed": "Imported current auth.json as {email} and refreshed quota",
    "message.switchedAndAskReload":
      "Active Codex account switched to {email}. Reload VS Code now to sync the built-in Codex panel?",
    "message.alreadyActive": "{label} is already the active account",

    // Error messages
    "message.addedButQuotaFailed": "Added Codex account {email}, but quota refresh failed: {message}",
    "message.importedButQuotaFailed": "Imported current auth.json as {email}, but quota refresh failed: {message}",
    "message.addAccountFailed": "Add account failed: {message}",
    "message.removeAccountFailed": "Remove account failed: {message}",
    "message.switchAccountFailed": "Switch account failed: {message}",
    "message.refreshQuotaFailed": "Refresh quota failed: {message}",
    "message.tokenExpired": "Authentication token has expired, please sign in again",
    "message.tokenMissing": "Authentication token is missing",
    "message.accountNotFound": "Account not found: {accountId}",
    "message.networkError": "Network error: {message}",
    "message.apiError": "API error: {message}",

    // Confirmations
    "confirm.removeAccount": "Remove saved account {email}? This does not delete the global auth.json.",
    "confirm.removeButton": "Remove",

    // Status bar
    "status.title": "Codex Quota Monitor",
    "status.noAccounts": "No Codex accounts saved yet",
    "status.tooltip": "Click to open quota panel",
    "status.inStatus": "In Status",
    "status.addToStatus": "Add To Status",
    "status.limitTip": "You can show at most 2 extra accounts in the status popup",

    // Picker placeholders
    "picker.pickActivateAccount": "Select account to activate",
    "picker.pickRefreshAccount": "Select account to refresh",
    "picker.pickRemoveAccount": "Select account to remove",
    "picker.pickInspectAccount": "Select account to inspect",
    "picker.pickStatusAccount": "Select account to show in the status popup",
    "picker.noAccounts": "No Codex accounts saved yet.",

    // Button labels
    "button.reloadNow": "Reload Now",
    "button.later": "Later",
    "button.remove": "Remove",
    "button.switch": "Switch",
    "button.refresh": "Refresh",
    "button.details": "Details",
    "button.cancel": "Cancel",

    // Panel titles
    "panel.quotaSummary.title": "codex-tools quota summary",
    "panel.details.title": "Codex Account Details",
    "panel.dashboard.title": "codex-tools · Quota Dashboard",

    // Local account detection
    "localAccount.detected.title": "Local Codex account detected",
    "localAccount.detected.message":
      "A local Codex auth.json was found. Bind it to the extension and refresh the latest quota now?",
    "localAccount.detected.action": "Bind Now",
    "localAccount.bound.success": "Bound local account {email} and refreshed quota",
    "localAccount.bound.partial": "Bound local account {email}, but quota refresh failed: {message}",
    "localAccount.bound.failed": "Failed to bind local account: {message}",
    "externalAuth.changed.message":
      "Detected that another window switched the active Codex account to {email}. Reload this window now to sync the built-in Codex session?",
    "externalAuth.changed.reload": "Reload Now",
    "externalAuth.changed.later": "Later",

    // Status toggle
    "statusToggle.alwaysShown": "The active account is always shown at the top of the status popup.",
    "statusToggle.added": "Added {email} to the status popup",
    "statusToggle.removed": "Removed {email} from the status popup",
    "statusToggle.limitReached": "Status bar display limit reached (max 2 extra accounts)"
  }
};

/**
 * 插值函数 - 替换翻译中的占位符
 *
 * @param text 翻译文本
 * @param params 参数对象
 * @returns 插值后的文本
 */
function interpolate(text: string, params?: TranslationParams): string {
  if (!params) {
    return text;
  }

  return Object.entries(params).reduce((result, [key, value]) => {
    const placeholder = new RegExp(`\\{${key}\\}`, "g");
    return result.replace(placeholder, String(value));
  }, text);
}

/**
 * 获取当前语言
 *
 * @returns 支持的语言类型
 */
export function getLanguage(): SupportedLanguage {
  const language = vscode.env.language.toLowerCase();
  return language.startsWith("zh") ? "zh" : "en";
}

/**
 * 检查是否为中文环境
 */
export function isZh(): boolean {
  return getLanguage() === "zh";
}

/**
 * 检查是否为英文环境
 */
export function isEn(): boolean {
  return getLanguage() === "en";
}

/**
 * 获取翻译函数
 *
 * @param lang 可选的语言参数，默认使用当前 VS Code 语言
 * @returns 翻译函数
 *
 * @example
 * const t = i18n.t();
 * t('quota.refreshed', { email: 'user@example.com' })
 */
export function t(lang?: SupportedLanguage) {
  const language = lang ?? getLanguage();
  const dict = translations[language];

  return function translate(key: TranslationKey, params?: TranslationParams): string {
    const text = dict[key] ?? translations.en[key] ?? key;
    return interpolate(text, params);
  };
}

/**
 * 直接获取翻译字符串
 *
 * @param key 翻译键
 * @param params 可选的参数
 * @param lang 可选的语言
 * @returns 翻译后的字符串
 */
export function translate(key: TranslationKey, params?: TranslationParams, lang?: SupportedLanguage): string {
  return t(lang)(key, params);
}

/**
 * 获取本地化副本 (command copy) - 用于命令中的本地化文本
 *
 * 这是一个辅助函数，返回包含所有常用翻译的对象
 * 适合在命令处理函数中使用
 */
export function getCommandCopy(): {
  progressAddAccount: string;
  progressImportCurrent: string;
  progressSwitch: (email: string) => string;
  progressRefreshAll: string;
  refreshingStep: (index: number, total: number, email: string) => string;
  pickActivateAccount: string;
  pickRefreshAccount: string;
  pickRemoveAccount: string;
  pickInspectAccount: string;
  pickStatusAccount: string;
  reloadNow: string;
  later: string;
  remove: string;
  activeAlwaysInStatus: string;
  alreadyActive: (label: string) => string;
  switchedAndAskReload: (email: string) => string;
  addedAndRefreshed: (email: string) => string;
  addedButQuotaFailed: (email: string, message: string) => string;
  addAccountFailed: (message: string) => string;
  importedAndRefreshed: (email: string) => string;
  importedButQuotaFailed: (email: string, message: string) => string;
  refreshedCount: (count: number) => string;
  confirmRemove: (email: string) => string;
  addedToStatus: (email: string) => string;
  removedFromStatus: (email: string) => string;
  failedToRefresh: (email: string, message: string) => string;
  quotaRefreshed: (email: string) => string;
  noAccounts: string;
} {
  const _t = t();
  const lang = getLanguage();

  return {
    progressAddAccount: _t("action.addAccount.progress"),
    progressImportCurrent: _t("action.importAccount.progress"),
    progressSwitch: (email: string) => _t("action.switchAccount.progress", { email }),
    progressRefreshAll: _t("action.refreshAll.progress"),
    refreshingStep: (index: number, total: number, email: string) =>
      lang === "zh" ? `${index}/${total} ${email}` : `${index}/${total} ${email}`,
    pickActivateAccount: _t("picker.pickActivateAccount"),
    pickRefreshAccount: _t("picker.pickRefreshAccount"),
    pickRemoveAccount: _t("picker.pickRemoveAccount"),
    pickInspectAccount: _t("picker.pickInspectAccount"),
    pickStatusAccount: _t("picker.pickStatusAccount"),
    reloadNow: _t("button.reloadNow"),
    later: _t("button.later"),
    remove: _t("button.remove"),
    activeAlwaysInStatus: _t("statusToggle.alwaysShown"),
    alreadyActive: (label: string) => _t("message.alreadyActive", { label }),
    switchedAndAskReload: (email: string) => _t("message.switchedAndAskReload", { email }),
    addedAndRefreshed: (email: string) => _t("message.addedAndRefreshed", { email }),
    addedButQuotaFailed: (email: string, message: string) => _t("message.addedButQuotaFailed", { email, message }),
    addAccountFailed: (message: string) => _t("message.addAccountFailed", { message }),
    importedAndRefreshed: (email: string) => _t("message.importedAndRefreshed", { email }),
    importedButQuotaFailed: (email: string, message: string) =>
      _t("message.importedButQuotaFailed", { email, message }),
    refreshedCount: (count: number) => _t("quota.refreshedCount", { count }),
    confirmRemove: (email: string) => _t("confirm.removeAccount", { email }),
    addedToStatus: (email: string) => _t("statusToggle.added", { email }),
    removedFromStatus: (email: string) => _t("statusToggle.removed", { email }),
    failedToRefresh: (email: string, message: string) => _t("quota.refreshFailed", { email, message }),
    quotaRefreshed: (email: string) => _t("quota.refreshed", { email }),
    noAccounts: _t("picker.noAccounts")
  };
}

/**
 * 本地账号检测文案
 */
export function getLocalAccountCopy(): {
  title: string;
  message: string;
  action: string;
  success: (email: string) => string;
  partial: (email: string, message: string) => string;
  failed: (message: string) => string;
} {
  const _t = t();

  return {
    title: _t("localAccount.detected.title"),
    message: _t("localAccount.detected.message"),
    action: _t("localAccount.detected.action"),
    success: (email: string) => _t("localAccount.bound.success", { email }),
    partial: (email: string, message: string) => _t("localAccount.bound.partial", { email, message }),
    failed: (message: string) => _t("localAccount.bound.failed", { message })
  };
}

export function getExternalAuthSyncCopy(): {
  message: (email: string) => string;
  reloadNow: string;
  later: string;
} {
  const _t = t();

  return {
    message: (email: string) => _t("externalAuth.changed.message", { email }),
    reloadNow: _t("externalAuth.changed.reload"),
    later: _t("externalAuth.changed.later")
  };
}
