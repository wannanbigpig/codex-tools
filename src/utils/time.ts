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

  const deltaMs = epochSeconds * 1000 - Date.now();
  const abs = Math.abs(deltaMs);
  const minutes = Math.round(abs / 60000);
  const future = deltaMs >= 0;

  if (minutes < 60) {
    return formatRelative(minutes, "m", future);
  }

  const hours = Math.round(minutes / 60);
  if (hours < 48) {
    return formatRelative(hours, "h", future);
  }

  const days = Math.round(hours / 24);
  return formatRelative(days, "d", future);
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

/**
 * 格式化相对时间
 */
function formatRelative(value: number, unit: "m" | "h" | "d", future: boolean): string {
  if (unit === "m") {
    return translate(future ? "time.minutesLeft" : "time.minutesAgo", { value });
  }

  if (unit === "h") {
    return translate(future ? "time.hoursLeft" : "time.hoursAgo", { value });
  }

  // unit === "d"
  return translate(future ? "time.daysLeft" : "time.daysAgo", { value });
}
