/**
 * 类型定义模块
 *
 * 优化内容:
 * - 添加更详细的 JSDoc 注释
 * - 使用更精确的类型约束
 * - 添加辅助类型用于类型安全
 */

import type { ErrorCode } from "./errors";

/**
 * Codex 认证令牌
 */
export interface CodexTokens {
  /** 身份令牌 (ID Token) */
  idToken: string;
  /** 访问令牌 */
  accessToken: string;
  /** 刷新令牌 (可选) */
  refreshToken?: string;
  /** 账号 ID (可选) */
  accountId?: string;
}

/**
 * 配额摘要信息
 */
export interface CodexQuotaSummary {
  /** 小时配额剩余百分比 (0-100) */
  hourlyPercentage: number;
  /** 小时配额重置时间戳 (秒) */
  hourlyResetTime?: number;
  /** 小时配额窗口长度 (分钟) */
  hourlyWindowMinutes?: number;
  /** 是否存在小时配额窗口 */
  hourlyWindowPresent?: boolean;
  /** 周配额剩余百分比 (0-100) */
  weeklyPercentage: number;
  /** 周配额重置时间戳 (秒) */
  weeklyResetTime?: number;
  /** 周配额窗口长度 (分钟) */
  weeklyWindowMinutes?: number;
  /** 是否存在周配额窗口 */
  weeklyWindowPresent?: boolean;
  /** 代码审查配额剩余百分比 (0-100) */
  codeReviewPercentage: number;
  /** 代码审查配额重置时间戳 (秒) */
  codeReviewResetTime?: number;
  /** 代码审查配额窗口长度 (分钟) */
  codeReviewWindowMinutes?: number;
  /** 是否存在代码审查配额窗口 */
  codeReviewWindowPresent?: boolean;
}

/**
 * 配额错误信息
 */
export interface CodexQuotaErrorInfo {
  /** 错误码 */
  code?: ErrorCode | string;
  /** 错误消息 */
  message: string;
  /** 错误发生时间戳 (秒) */
  timestamp: number;
}

/**
 * 账号记录
 */
export interface CodexAccountRecord {
  /** 内部存储 ID */
  id: string;
  /** 登录时间戳 (毫秒) */
  loginAt?: number;
  /** 用户邮箱 */
  email: string;
  /** 用户 ID */
  userId?: string;
  /** 认证提供者 (如 google, microsoft 等) */
  authProvider?: string;
  /** 计划类型 (如 free, plus, team 等) */
  planType?: string;
  /** 账号 ID */
  accountId?: string;
  /** 组织 ID */
  organizationId?: string;
  /** 账号名称 (团队/工作空间名称) */
  accountName?: string;
  /** 账号结构类型 (personal/team/organization) */
  accountStructure?: string;
  /** 是否为当前激活账号 */
  isActive: boolean;
  /** 是否在状态栏显示 */
  showInStatusBar?: boolean;
  /** 最后刷新配额的时间戳 (毫秒) */
  lastQuotaAt?: number;
  /** 配额摘要 */
  quotaSummary?: CodexQuotaSummary;
  /** 配额错误信息 */
  quotaError?: CodexQuotaErrorInfo;
  /** 创建时间戳 (毫秒) */
  createdAt: number;
  /** 更新时间戳 (毫秒) */
  updatedAt: number;
}

/**
 * 账号索引数据结构
 */
export interface CodexAccountsIndex {
  /** 当前激活账号 ID */
  currentAccountId?: string;
  /** 账号列表 */
  accounts: CodexAccountRecord[];
}

/**
 * Codex auth.json 文件格式
 */
export interface CodexAuthFile {
  /** OpenAI API Key (已废弃，始终为 null) */
  OPENAI_API_KEY: null;
  /** 认证令牌 */
  tokens: {
    /** 身份令牌 */
    id_token: string;
    /** 访问令牌 */
    access_token: string;
    /** 刷新令牌 */
    refresh_token?: string;
    /** 账号 ID */
    account_id?: string;
  };
  /** 最后刷新时间 (ISO 8601 格式) */
  last_refresh?: string;
}

/**
 * 解码后的认证声明
 */
export interface DecodedAuthClaims {
  /** 用户邮箱 */
  email?: string;
  /** 用户 ID */
  userId?: string;
  /** 认证提供者 */
  authProvider?: string;
  /** 计划类型 */
  planType?: string;
  /** 账号 ID */
  accountId?: string;
  /** 组织 ID */
  organizationId?: string;
  /** 组织列表 */
  organizations?: Array<{
    /** 组织 ID */
    id?: string;
    /** 组织名称 */
    title?: string;
  }>;
  /** 登录时间戳 (毫秒) */
  loginAt?: number;
}

/**
 * 使用量窗口信息
 */
export interface UsageWindowInfo {
  /** 已使用百分比 */
  used_percent?: number;
  /** 窗口长度 (秒) */
  limit_window_seconds?: number;
  /** 距离重置的秒数 */
  reset_after_seconds?: number;
  /** 重置时间戳 */
  reset_at?: number;
}

/**
 * Codex 使用量 API 响应
 */
export interface CodexUsageResponse {
  /** 计划类型 */
  plan_type?: string;
  /** 速率限制 (主窗口) */
  rate_limit?: {
    /** 主窗口 */
    primary_window?: UsageWindowInfo;
    /** 次窗口 */
    secondary_window?: UsageWindowInfo;
  };
  /** 代码审查速率限制 */
  code_review_rate_limit?: {
    /** 主窗口 */
    primary_window?: UsageWindowInfo;
    /** 次窗口 */
    secondary_window?: UsageWindowInfo;
  };
}

/**
 * 每日 token 使用量
 */
export interface CodexDailyUsagePoint {
  /** 日期标识，优先 YYYY-MM-DD */
  date: string;
  /** 当日总 token 数 */
  totalTokens: number;
  /** VS Code / Extension token 数 */
  extensionTokens?: number;
  /** 其他 surface 总和 */
  otherTokens?: number;
  /** 各 surface 原始数值 */
  surfaceValues?: Record<string, number>;
  /** 输入 token 数 */
  inputTokens?: number;
  /** 输出 token 数 */
  outputTokens?: number;
  /** 缓存 token 数 */
  cachedTokens?: number;
}

/**
 * 每日 token 使用量明细
 */
export interface CodexDailyUsageBreakdown {
  /** 天数范围 */
  days: number;
  /** 明细点 */
  points: CodexDailyUsagePoint[];
}
