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

export type CodexAuthMode = "chatgpt" | "oauth";

/**
 * 配额摘要信息
 */
export interface CodexQuotaSummary {
  /** 小时配额剩余百分比 (0-100) */
  hourlyPercentage: number;
  /** 小时配额重置时间戳 (秒) */
  hourlyResetTime?: number;
  /** 小时配额剩余请求数 */
  hourlyRequestsLeft?: number;
  /** 小时配额总请求数 */
  hourlyRequestsLimit?: number;
  /** 小时配额窗口长度 (分钟) */
  hourlyWindowMinutes?: number;
  /** 是否存在小时配额窗口 */
  hourlyWindowPresent?: boolean;
  /** 周配额剩余百分比 (0-100) */
  weeklyPercentage: number;
  /** 周配额重置时间戳 (秒) */
  weeklyResetTime?: number;
  /** 周配额剩余请求数 */
  weeklyRequestsLeft?: number;
  /** 周配额总请求数 */
  weeklyRequestsLimit?: number;
  /** 周配额窗口长度 (分钟) */
  weeklyWindowMinutes?: number;
  /** 是否存在周配额窗口 */
  weeklyWindowPresent?: boolean;
  /** 代码审查配额剩余百分比 (0-100) */
  codeReviewPercentage: number;
  /** 代码审查配额重置时间戳 (秒) */
  codeReviewResetTime?: number;
  /** 代码审查配额剩余请求数 */
  codeReviewRequestsLeft?: number;
  /** 代码审查配额总请求数 */
  codeReviewRequestsLimit?: number;
  /** 代码审查配额窗口长度 (分钟) */
  codeReviewWindowMinutes?: number;
  /** 是否存在代码审查配额窗口 */
  codeReviewWindowPresent?: boolean;
  /** 额外模型配额（如 GPT-5.3-Codex-Spark） */
  additionalRateLimits?: CodexAdditionalQuotaLimit[];
  /** 账号剩余额度/credits */
  credits?: CodexCreditsSummary;
  /** 主动重置次数可用数 */
  resetCreditsAvailable?: number;
  /** 最近一张可用重置次数的到期时间戳 (秒) */
  resetCreditsNextExpiresAt?: number;
  /** 原始接口返回 */
  rawData?: unknown;
}

/** Codex 主动重置次数明细 */
export interface CodexResetCredit {
  id?: string;
  status?: string;
  reset_type?: string;
  granted_at?: number;
  expires_at?: number;
  redeemed_at?: number;
  raw_status?: string;
}

/** Codex 主动重置次数快照 */
export interface CodexResetCreditsSnapshot {
  availableCount: number;
  credits: CodexResetCredit[];
  nextExpiresAt?: number;
}

export interface CodexAdditionalQuotaLimit {
  limitName: string;
  meteredFeature?: string;
  hourlyPercentage?: number;
  hourlyResetTime?: number;
  hourlyRequestsLeft?: number;
  hourlyRequestsLimit?: number;
  hourlyWindowMinutes?: number;
  hourlyWindowPresent?: boolean;
  weeklyPercentage?: number;
  weeklyResetTime?: number;
  weeklyRequestsLeft?: number;
  weeklyRequestsLimit?: number;
  weeklyWindowMinutes?: number;
  weeklyWindowPresent?: boolean;
}

export interface CodexCreditsSummary {
  hasCredits: boolean;
  unlimited: boolean;
  overageLimitReached: boolean;
  balance: string;
  approxLocalMessages: unknown[];
  approxCloudMessages: unknown[];
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
  /** 最近一次开始使用此账号的时间戳 (毫秒) */
  sessionStartedAt?: number;
  /** 已完成会话的累计使用时长（毫秒）；当前运行会话在展示时动态加入 */
  totalUsageMs?: number;
  /** 用户邮箱 */
  email: string;
  /** 认证模式 */
  authMode?: CodexAuthMode;
  /** 用户 ID */
  userId?: string;
  /** 认证提供者 (如 google, microsoft 等) */
  authProvider?: string;
  /** 计划类型 (如 free, plus, team 等) */
  planType?: string;
  /** ChatGPT 订阅到期时间（原始字符串或时间戳字符串） */
  subscriptionActiveUntil?: string;
  /** 订阅查询最后尝试时间戳 (ms) */
  subscriptionQueryLastAttemptAt?: number;
  /** 订阅查询下次允许重试时间戳 (ms) — 对齐 cockpit 30min backoff */
  subscriptionQueryNextRetryAt?: number;
  /** 订阅查询最后错误信息 */
  subscriptionQueryLastError?: string;
  /** 账号 ID */
  accountId?: string;
  /** 组织 ID */
  organizationId?: string;
  /** 账号名称 (团队/工作空间名称) */
  accountName?: string;
  /** 账号标签 */
  tags?: string[];
  /** 添加来源（用于兼容 Aideck 卡片背面展示） */
  addedVia?: string;
  /** 账号结构类型 (personal/team/organization) */
  accountStructure?: string;
  /** 是否为当前激活账号 */
  isActive: boolean;
  /** Whether this PC may use the account for automation. PC-local and never synchronized; manual actions remain available. */
  enabled?: boolean;
  /** Whether this PC prioritizes the account in its automatic queue. PC-local and never synchronized. */
  queuePriority?: boolean;
  /** Whether this PC may refresh this account's token automatically. Missing values are treated as disabled. */
  tokenRefreshEnabled?: boolean;
  /** 是否在状态栏显示 */
  showInStatusBar?: boolean;
  /** 忽略中的健康问题键 */
  dismissedHealthIssueKey?: string;
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

export type CodexIndexHealthStatus = "healthy" | "restored_from_backup" | "corrupted_unrecoverable";

export interface CodexIndexHealthSummary {
  status: CodexIndexHealthStatus;
  lastRestoreSource?: "backup" | "auth_json" | "shared_json";
  availableBackups: number;
  lastErrorMessage?: string;
  lastRecoveredAt?: number;
}

export interface CodexAccountsRestoreResult {
  source: NonNullable<CodexIndexHealthSummary["lastRestoreSource"]>;
  restoredCount: number;
  restoredEmails: string[];
}

export type CodexAnnouncementType = string;

export interface CodexAnnouncementAction {
  type: string;
  target: string;
  label: string;
  arguments?: unknown[];
}

export interface CodexAnnouncementImage {
  url: string;
  label?: string;
  alt?: string;
}

export interface CodexAnnouncement {
  id: string;
  type: CodexAnnouncementType;
  priority: number;
  releaseVersion?: string;
  currentVersion?: string;
  restartRequired?: boolean;
  restartHint?: string;
  title: string;
  summary: string;
  content: string;
  action?: CodexAnnouncementAction;
  targetVersions: string;
  targetLanguages: string[];
  showOnce: boolean;
  popup: boolean;
  pinned: boolean;
  createdAt: string;
  expiresAt?: string | null;
  locales?: Record<string, unknown> | null;
  images: CodexAnnouncementImage[];
}

export interface CodexAnnouncementState {
  announcements: CodexAnnouncement[];
  unreadIds: string[];
  popupAnnouncement: CodexAnnouncement | null;
}

/**
 * Codex auth.json 文件格式
 */
export interface CodexAuthFile {
  /** 认证模式 */
  auth_mode?: string;
  /** OpenAI API Key */
  OPENAI_API_KEY: string | null;
  /** API Base URL */
  api_base_url?: string;
  base_url?: string;
  /** 认证令牌 */
  tokens?: {
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
  /** ChatGPT 订阅到期时间（原始字符串或时间戳字符串） */
  subscriptionActiveUntil?: string;
}

/**
 * 使用量窗口信息
 */
export interface UsageWindowInfo {
  /** 已使用百分比 */
  used_percent?: number;
  /** 已使用百分比（驼峰兼容字段） */
  usedPercent?: number;
  /** 剩余百分比 */
  remaining_percent?: number;
  /** 剩余百分比（驼峰兼容字段） */
  remainingPercent?: number;
  /** 剩余请求数 */
  remaining?: number;
  /** 窗口总请求数 */
  limit?: number;
  /** 剩余请求数（兼容字段） */
  requests_left?: number;
  /** 剩余请求数（驼峰兼容字段） */
  requestsLeft?: number;
  /** 窗口总请求数（兼容字段） */
  requests_limit?: number;
  /** 窗口总请求数（驼峰兼容字段） */
  requestsLimit?: number;
  /** 窗口长度 (秒) */
  limit_window_seconds?: number;
  /** 窗口长度 (秒，驼峰兼容字段) */
  limitWindowSeconds?: number;
  /** 距离重置的秒数 */
  reset_after_seconds?: number;
  /** 距离重置的秒数（驼峰兼容字段） */
  resetAfterSeconds?: number;
  /** 距离重置的秒数（历史兼容字段） */
  reset_after?: number;
  /** 距离重置的秒数（历史驼峰字段） */
  resetAfter?: number;
  /** 重置时间戳 */
  reset_at?: number;
  /** 重置时间戳（驼峰兼容字段） */
  resetAt?: number;
  /** 重置时间戳（历史兼容字段） */
  reset_time?: number;
  /** 重置时间戳（历史驼峰字段） */
  resetTime?: number;
}

export interface UsageRateLimitInfo extends UsageWindowInfo {
  primary_window?: UsageWindowInfo;
  primaryWindow?: UsageWindowInfo;
  secondary_window?: UsageWindowInfo;
  secondaryWindow?: UsageWindowInfo;
  windows?: UsageWindowInfo[];
}

/**
 * Codex 使用量 API 响应
 */
export interface CodexUsageResponse {
  /** 计划类型 */
  plan_type?: string;
  /** ChatGPT 订阅到期时间 */
  subscription_active_until?: string | number | Record<string, unknown>;
  /** ChatGPT 订阅到期时间（驼峰兼容） */
  subscriptionActiveUntil?: string | number | Record<string, unknown>;
  /** ChatGPT 订阅到期时间（认证字段兼容） */
  chatgpt_subscription_active_until?: string | number | Record<string, unknown>;
  /** 速率限制 (主窗口) */
  rate_limit?: {
    /** 主窗口 */
    primary_window?: UsageWindowInfo;
    /** 主窗口（驼峰兼容） */
    primaryWindow?: UsageWindowInfo;
    /** 次窗口 */
    secondary_window?: UsageWindowInfo;
    /** 次窗口（驼峰兼容） */
    secondaryWindow?: UsageWindowInfo;
    /** 代码审查速率限制（兼容嵌套字段） */
    code_review_rate_limit?: UsageRateLimitInfo;
    /** 代码审查速率限制（驼峰兼容） */
    codeReviewRateLimit?: UsageRateLimitInfo;
    /** 代码审查速率限制（历史兼容） */
    code_review?: UsageRateLimitInfo;
  };
  /** 代码审查速率限制 */
  code_review_rate_limit?: UsageRateLimitInfo;
  /** 代码审查速率限制（驼峰兼容） */
  codeReviewRateLimit?: UsageRateLimitInfo;
  /** 代码审查速率限制（历史兼容） */
  code_review?: UsageRateLimitInfo;
  /** 额外模型配额 */
  additional_rate_limits?: UsageAdditionalRateLimitInfo[] | null;
  /** 额外模型配额（驼峰兼容） */
  additionalRateLimits?: UsageAdditionalRateLimitInfo[] | null;
  /** 账号 credits */
  credits?: UsageCreditsInfo | null;
  /** 主动重置次数（rate-limit reset credits） */
  rate_limit_reset_credits?: {
    available_count?: number;
    availableCount?: number;
  } | null;
  rateLimitResetCredits?: {
    available_count?: number;
    availableCount?: number;
  } | null;
}

export interface UsageAdditionalRateLimitInfo {
  limit_name?: string;
  limitName?: string;
  name?: string;
  metered_feature?: string;
  meteredFeature?: string;
  rate_limit?: UsageRateLimitInfo;
  rateLimit?: UsageRateLimitInfo;
}

export interface UsageCreditsInfo {
  has_credits?: boolean;
  hasCredits?: boolean;
  unlimited?: boolean;
  overage_limit_reached?: boolean;
  overageLimitReached?: boolean;
  balance?: string | number;
  approx_local_messages?: unknown[];
  approxLocalMessages?: unknown[];
  approx_cloud_messages?: unknown[];
  approxCloudMessages?: unknown[];
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

export interface SharedCodexAccountJson {
  id?: string;
  email?: string;
  auth_mode?: string;
  OPENAI_API_KEY?: string | null;
  openai_api_key?: string | null;
  api_base_url?: string | null;
  base_url?: string | null;
  apiBaseUrl?: string | null;
  user_id?: string;
  plan_type?: string;
  account_id?: string | null;
  organization_id?: string | null;
  account_name?: string | null;
  account_structure?: string | null;
  added_via?: string | null;
  added_at?: number | null;
  subscription_active_until?: string | number | null;
  tokens?: {
    id_token?: string;
    access_token?: string;
    refresh_token?: string;
    account_id?: string | null;
  };
  quota?: {
    hourly_percentage?: number;
    hourly_reset_time?: number;
    hourly_requests_left?: number;
    hourly_requests_limit?: number;
    hourly_window_minutes?: number;
    hourly_window_present?: boolean;
    weekly_percentage?: number;
    weekly_reset_time?: number;
    weekly_requests_left?: number;
    weekly_requests_limit?: number;
    weekly_window_minutes?: number;
    weekly_window_present?: boolean;
    code_review_percentage?: number;
    code_review_reset_time?: number;
    code_review_requests_left?: number;
    code_review_requests_limit?: number;
    code_review_window_minutes?: number;
    code_review_window_present?: boolean;
    reset_credits_available?: number;
    additional_rate_limits?: Array<{
      limit_name?: string;
      metered_feature?: string;
      hourly_percentage?: number;
      hourly_reset_time?: number;
      hourly_requests_left?: number;
      hourly_requests_limit?: number;
      hourly_window_minutes?: number;
      hourly_window_present?: boolean;
      weekly_percentage?: number;
      weekly_reset_time?: number;
      weekly_requests_left?: number;
      weekly_requests_limit?: number;
      weekly_window_minutes?: number;
      weekly_window_present?: boolean;
    }>;
    credits?: {
      has_credits?: boolean;
      unlimited?: boolean;
      overage_limit_reached?: boolean;
      balance?: string;
      approx_local_messages?: unknown[];
      approx_cloud_messages?: unknown[];
    } | null;
    raw_data?: unknown;
  } | null;
  quota_error?: {
    code?: string;
    message?: string;
    timestamp?: number;
  } | null;
  tags?: string[] | null;
  /** Legacy input only. Current exports and sync payloads omit this PC-local preference. */
  queue_priority?: boolean;
  token_refresh_enabled?: boolean;
  created_at?: number;
  last_used?: number;
}

/** Manual transfer package containing saved accounts, extension settings, and diagnostics. */
export interface CodexAccountsBackup {
  format: "codex-accounts-manager-backup";
  version: 1;
  exportedAt: string;
  accounts: SharedCodexAccountJson[];
  activeAccountId?: string;
  /** Configuration values under the codexAccounts section. */
  settings: Record<string, string | number | boolean>;
  /** Sanitized network diagnostics captured during this extension run. */
  logs: string[];
}

export interface CodexImportPreviewIssue {
  index: number;
  accountId?: string;
  email?: string;
  message: string;
}

export interface CodexImportPreviewSummary {
  total: number;
  valid: number;
  overwriteCount: number;
  invalidCount: number;
  invalidEntries: CodexImportPreviewIssue[];
}

export interface CodexImportResultIssue {
  index: number;
  accountId?: string;
  email?: string;
  message: string;
}

export interface CodexImportResultSummary {
  total: number;
  successCount: number;
  overwriteCount: number;
  failedCount: number;
  importedEmails: string[];
  failures: CodexImportResultIssue[];
}

export interface CodexAutoSwitchReason {
  fromAccountId: string;
  fromEmail: string;
  toAccountId: string;
  toEmail: string;
  trigger: "hourly" | "weekly" | "hourly_and_weekly";
  matchedRules: string[];
  hourlyThreshold: number;
  weeklyThreshold: number;
  createdAt: number;
}
