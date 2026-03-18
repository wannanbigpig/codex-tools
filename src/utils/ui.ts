import * as vscode from "vscode";

/**
 * UI 工具模块
 *
 * 提供通用的 UI 渲染工具函数
 */

export interface QuotaColorThresholds {
  green: number;
  yellow: number;
}

/**
 * HTML 转义 - 用于 Webview 内容安全
 *
 * @param value - 需要转义的字符串
 * @returns 转义后的字符串
 */
export function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/**
 * HTML 属性转义 - 用于 HTML 属性值安全
 *
 * @param value - 需要转义的字符串
 * @returns 转义后的字符串
 */
export function escapeHtmlAttr(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/**
 * 根据百分比返回颜色代码
 *
 * @param value - 百分比值 (0-100)
 * @returns 十六进制颜色代码
 */
export function colorForPercentage(value?: number): string {
  const thresholds = getQuotaColorThresholds();
  return colorForPercentageWithThresholds(value, thresholds);
}

function colorForPercentageWithThresholds(value: number | undefined, thresholds: QuotaColorThresholds): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "#7ddc7a";
  }
  if (value >= thresholds.green) {
    return "#7ddc7a";
  }
  if (value >= thresholds.yellow) {
    return "#fbbf24";
  }
  return "#ef4444";
}

export function quotaMarkerForPercentage(value?: number): string {
  const thresholds = getQuotaColorThresholds();
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "⚪";
  }
  if (value >= thresholds.green) {
    return "🟢";
  }
  if (value >= thresholds.yellow) {
    return "🟡";
  }
  return "🔴";
}

export function getQuotaColorThresholds(): QuotaColorThresholds {
  const config = vscode.workspace.getConfiguration("codexAccounts");
  const green = config.get<number>("quotaGreenThreshold", 60);
  const yellow = config.get<number>("quotaYellowThreshold", 20);
  return normalizeQuotaColorThresholds(green, yellow);
}

export function normalizeQuotaColorThresholds(green: number, yellow: number): QuotaColorThresholds {
  const safeYellowBase = Number.isFinite(yellow) ? Math.max(0, Math.min(99, yellow)) : 20;
  const safeGreenBase = Number.isFinite(green) ? Math.max(1, Math.min(100, green)) : 60;
  const safeYellow = Math.min(safeYellowBase, safeGreenBase - 10);
  const safeGreen = Math.max(safeGreenBase, safeYellow + 10);
  return {
    green: safeGreen,
    yellow: safeYellow
  };
}

/**
 * 格式化认证提供者名称
 *
 * @param value - 认证提供者标识
 * @returns 格式化的提供者名称
 */
export function prettyAuthProvider(value?: string): string {
  if (!value) {
    return "OpenAI";
  }
  if (value.toLowerCase() === "google") {
    return "Google";
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Markdown 转义 - 用于 Markdown 字符串安全
 *
 * @param value - 需要转义的字符串
 * @returns 转义后的字符串
 */
export function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_{}[\]()#+\-.!|>])/g, "\\$1");
}
