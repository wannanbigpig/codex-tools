/**
 * 时间工具模块
 *
 * 优化内容:
 * - 添加更详细的 JSDoc 注释
 * - 使用统一的 i18n 工具
 * - 改进代码组织
 */

import { getIntlLocale } from "../localization/languages";
import { getLanguage, translate } from "./i18n";
import { formatResetRelativeTime } from "./resetTime";

/**
 * 格式化相对重置时间
 *
 * @param epochSeconds - Unix 时间戳 (秒)
 * @returns 格式化的相对时间字符串
 *
 * @example
 * formatRelativeReset(1234567890) // "剩余 2 小时" or "2h left"
 */
export function formatRelativeReset(epochSeconds?: number): string {
  if (!epochSeconds) {
    return translate("quota.resetUnknown");
  }

  return formatResetRelativeTime(epochSeconds, Date.now(), getLanguage());
}

/**
 * 格式化时间戳
 *
 * @param epochMs - Unix 时间戳 (毫秒)
 * @returns 格式化的本地时间字符串
 *
 * @example
 * formatTimestamp(1234567890000) // "2009/2/14 07:31:30"
 */
export function formatTimestamp(epochMs?: number): string {
  if (!epochMs) {
    return translate("common.never");
  }
  return new Date(epochMs).toLocaleString(getIntlLocale(getLanguage()));
}
