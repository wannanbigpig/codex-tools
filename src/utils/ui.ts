/**
 * UI 工具模块
 *
 * 提供通用的 UI 渲染工具函数
 */

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
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "#7ddc7a";
  }
  if (value >= 60) {
    return "#7ddc7a";
  }
  if (value >= 20) {
    return "#fbbf24";
  }
  return "#ef4444";
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
