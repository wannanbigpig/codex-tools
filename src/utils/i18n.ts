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
import type { DashboardLanguage } from "../localization/languages";
import { resolveDashboardLanguage } from "../localization/languages";
import { messageResources } from "../localization/resources/messages";

/**
 * 支持的语言
 */
export type SupportedLanguage = DashboardLanguage;

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
  // Codex App restart
  | "codexApp.restart.preference.auto"
  | "codexApp.restart.preference.manual"
  | "codexApp.restart.preference.message"
  | "codexApp.restart.manual.message"
  | "codexApp.restart.manual.action"
  | "codexApp.restart.manual.later"
  // Quota warning
  | "quotaWarning.hourlyLabel"
  | "quotaWarning.weeklyLabel"
  | "quotaWarning.reviewLabel"
  | "quotaWarning.message"
  | "quotaWarning.dismiss"
  | "quotaWarning.switchNow"
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
type TranslationData = Record<SupportedLanguage, Record<TranslationKey, string>>;

/**
 * 翻译定义
 *
 * 按功能模块组织翻译字符串
 */
const translations: TranslationData = messageResources;

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
  const configured = vscode.workspace.getConfiguration("codexAccounts").get<string>("displayLanguage", "auto");
  return resolveDashboardLanguage(configured, vscode.env.language);
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
    const text = dict[key] ?? translations["en"][key] ?? key;
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
  return {
    progressAddAccount: _t("action.addAccount.progress"),
    progressImportCurrent: _t("action.importAccount.progress"),
    progressSwitch: (email: string) => _t("action.switchAccount.progress", { email }),
    progressRefreshAll: _t("action.refreshAll.progress"),
    refreshingStep: (index: number, total: number, email: string) => `${index}/${total} ${email}`,
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

export function getCodexAppRestartCopy(): {
  preferenceMessage: string;
  auto: string;
  manual: string;
  manualMessage: string;
  restartNow: string;
  later: string;
} {
  const _t = t();

  return {
    preferenceMessage: _t("codexApp.restart.preference.message"),
    auto: _t("codexApp.restart.preference.auto"),
    manual: _t("codexApp.restart.preference.manual"),
    manualMessage: _t("codexApp.restart.manual.message"),
    restartNow: _t("codexApp.restart.manual.action"),
    later: _t("codexApp.restart.manual.later")
  };
}

export function getQuotaWarningCopy(): {
  hourlyLabel: string;
  weeklyLabel: string;
  reviewLabel: string;
  message: (account: string, quota: string, value: number, threshold: number) => string;
  dismiss: string;
  switchNow: string;
} {
  const _t = t();

  return {
    hourlyLabel: _t("quotaWarning.hourlyLabel"),
    weeklyLabel: _t("quotaWarning.weeklyLabel"),
    reviewLabel: _t("quotaWarning.reviewLabel"),
    dismiss: _t("quotaWarning.dismiss"),
    switchNow: _t("quotaWarning.switchNow"),
    message: (account: string, quota: string, value: number, threshold: number) =>
      _t("quotaWarning.message", { account, quota, value, threshold })
  };
}
