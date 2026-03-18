/**
 * 错误处理模块 - 提供统一的错误类型和处理模式
 *
 * 优化内容:
 * - 使用 typed exceptions 替代裸 Error
 * - 定义明确的错误码便于程序化判断
 * - 支持错误链 (cause) 追踪根本原因
 * - 提供错误工厂函数简化使用
 */

/**
 * 错误码枚举 - 用于程序化错误处理
 */
export enum ErrorCode {
  // 通用错误
  UNKNOWN = "UNKNOWN",
  INVALID_ARGUMENT = "INVALID_ARGUMENT",
  NOT_FOUND = "NOT_FOUND",
  UNAUTHORIZED = "UNAUTHORIZED",

  // 认证相关错误
  AUTH_TOKEN_MISSING = "AUTH_TOKEN_MISSING",
  AUTH_TOKEN_EXPIRED = "AUTH_TOKEN_EXPIRED",
  AUTH_TOKEN_INVALID = "AUTH_TOKEN_INVALID",
  AUTH_REFRESH_FAILED = "AUTH_REFRESH_FAILED",
  AUTH_OAUTH_FAILED = "AUTH_OAUTH_FAILED",

  // 账号相关错误
  ACCOUNT_NOT_FOUND = "ACCOUNT_NOT_FOUND",
  ACCOUNT_ALREADY_EXISTS = "ACCOUNT_ALREADY_EXISTS",
  ACCOUNT_INVALID_DATA = "ACCOUNT_INVALID_DATA",

  // 配额相关错误
  QUOTA_FETCH_FAILED = "QUOTA_FETCH_FAILED",
  QUOTA_PARSE_FAILED = "QUOTA_PARSE_FAILED",

  // 存储相关错误
  STORAGE_READ_FAILED = "STORAGE_READ_FAILED",
  STORAGE_WRITE_FAILED = "STORAGE_WRITE_FAILED",
  STORAGE_SECRET_ACCESS_FAILED = "STORAGE_SECRET_ACCESS_FAILED",

  // 网络相关错误
  NETWORK_ERROR = "NETWORK_ERROR",
  API_ERROR = "API_ERROR",
  API_RATE_LIMITED = "API_RATE_LIMITED"
}

/**
 * 自定义应用错误基类
 *
 * 特性:
 * - 包含错误码便于程序化判断
 * - 支持错误链 (cause) 追踪根本原因
 * - 支持国际化消息键
 * - 包含额外上下文数据
 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly i18nKey?: string;
  public readonly context?: Record<string, unknown>;
  public readonly cause?: unknown;

  constructor(
    message: string,
    options: {
      code?: ErrorCode;
      cause?: unknown;
      i18nKey?: string;
      context?: Record<string, unknown>;
    } = {}
  ) {
    super(message);
    this.name = "AppError";
    this.code = options.code ?? ErrorCode.UNKNOWN;
    this.cause = options.cause;
    this.i18nKey = options.i18nKey;
    this.context = options.context;

    // 维护正确的原型链
    Object.setPrototypeOf(this, AppError.prototype);

    // 捕获堆栈跟踪
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }

  /**
   * 判断是否为特定错误码
   */
  public hasCode(code: ErrorCode): boolean {
    return this.code === code;
  }

  /**
   * 获取错误详情（包含上下文）
   */
  public toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      i18nKey: this.i18nKey,
      context: this.context,
      stack: this.stack
    };
  }
}

/**
 * 认证相关错误
 */
export class AuthError extends AppError {
  constructor(
    message: string,
    options: {
      code?: ErrorCode;
      cause?: unknown;
      i18nKey?: string;
      context?: Record<string, unknown>;
    } = {}
  ) {
    super(message, { ...options, code: options.code ?? ErrorCode.UNAUTHORIZED });
    this.name = "AuthError";
    Object.setPrototypeOf(this, AuthError.prototype);
  }
}

/**
 * Token 过期错误
 */
export class TokenExpiredError extends AuthError {
  constructor(
    message = "Token has expired",
    options: {
      cause?: unknown;
      i18nKey?: string;
      context?: Record<string, unknown>;
    } = {}
  ) {
    super(message, { ...options, code: ErrorCode.AUTH_TOKEN_EXPIRED });
    this.name = "TokenExpiredError";
    Object.setPrototypeOf(this, TokenExpiredError.prototype);
  }
}

/**
 * Token 缺失错误
 */
export class TokenMissingError extends AuthError {
  constructor(
    message = "Token is missing",
    options: {
      cause?: unknown;
      i18nKey?: string;
      context?: Record<string, unknown>;
    } = {}
  ) {
    super(message, { ...options, code: ErrorCode.AUTH_TOKEN_MISSING });
    this.name = "TokenMissingError";
    Object.setPrototypeOf(this, TokenMissingError.prototype);
  }
}

/**
 * 账号相关错误
 */
export class AccountError extends AppError {
  constructor(
    message: string,
    options: {
      code?: ErrorCode;
      cause?: unknown;
      i18nKey?: string;
      context?: Record<string, unknown>;
    } = {}
  ) {
    super(message, { ...options, code: options.code ?? ErrorCode.ACCOUNT_NOT_FOUND });
    this.name = "AccountError";
    Object.setPrototypeOf(this, AccountError.prototype);
  }
}

/**
 * 网络相关错误
 */
export class NetworkError extends AppError {
  public readonly statusCode?: number;
  public readonly responseBody?: string;

  constructor(
    message: string,
    options: {
      code?: ErrorCode;
      cause?: unknown;
      i18nKey?: string;
      context?: Record<string, unknown>;
      statusCode?: number;
      responseBody?: string;
    } = {}
  ) {
    super(message, { ...options, code: options.code ?? ErrorCode.NETWORK_ERROR });
    this.name = "NetworkError";
    this.statusCode = options.statusCode;
    this.responseBody = options.responseBody;
    Object.setPrototypeOf(this, NetworkError.prototype);
  }
}

/**
 * API 错误
 */
export class APIError extends NetworkError {
  constructor(
    message: string,
    options: {
      code?: ErrorCode;
      cause?: unknown;
      i18nKey?: string;
      context?: Record<string, unknown>;
      statusCode?: number;
      responseBody?: string;
    } = {}
  ) {
    super(message, { ...options, code: options.code ?? ErrorCode.API_ERROR });
    this.name = "APIError";
    Object.setPrototypeOf(this, APIError.prototype);
  }
}

/**
 * 存储相关错误
 */
export class StorageError extends AppError {
  constructor(
    message: string,
    options: {
      code?: ErrorCode;
      cause?: unknown;
      i18nKey?: string;
      context?: Record<string, unknown>;
    } = {}
  ) {
    super(message, { ...options, code: options.code ?? ErrorCode.STORAGE_READ_FAILED });
    this.name = "StorageError";
    Object.setPrototypeOf(this, StorageError.prototype);
  }
}

/**
 * 错误工厂函数 - 简化错误创建
 */
export const createError = {
  unknown: (message: string, cause?: unknown): AppError => new AppError(message, { code: ErrorCode.UNKNOWN, cause }),

  invalidArgument: (message: string): AppError => new AppError(message, { code: ErrorCode.INVALID_ARGUMENT }),

  notFound: (resource: string, id?: string): AccountError =>
    new AccountError(`${resource} not found${id ? `: ${id}` : ""}`, {
      code: ErrorCode.NOT_FOUND,
      context: { resource, id }
    }),

  unauthorized: (message: string, cause?: unknown): AuthError => new AuthError(message, { cause }),

  tokenExpired: (): TokenExpiredError => new TokenExpiredError(),

  tokenMissing: (tokenType?: string): TokenMissingError =>
    new TokenMissingError(tokenType ? `${tokenType} is missing` : undefined),

  accountNotFound: (accountId: string): AccountError =>
    new AccountError(`Account not found: ${accountId}`, {
      code: ErrorCode.ACCOUNT_NOT_FOUND,
      context: { accountId }
    }),

  accountAlreadyExists: (email: string): AccountError =>
    new AccountError(`Account already exists: ${email}`, {
      code: ErrorCode.ACCOUNT_ALREADY_EXISTS,
      context: { email }
    }),

  quotaFetchFailed: (cause?: unknown, statusCode?: number): APIError =>
    new APIError(`Failed to fetch quota${statusCode ? ` (status: ${statusCode})` : ""}`, {
      code: ErrorCode.QUOTA_FETCH_FAILED,
      cause,
      statusCode
    }),

  storageReadFailed: (path: string, cause?: unknown): StorageError =>
    new StorageError(`Failed to read from ${path}`, {
      code: ErrorCode.STORAGE_READ_FAILED,
      cause,
      context: { path }
    }),

  storageWriteFailed: (path: string, cause?: unknown): StorageError =>
    new StorageError(`Failed to write to ${path}`, {
      code: ErrorCode.STORAGE_WRITE_FAILED,
      cause,
      context: { path }
    }),

  networkError: (message: string, statusCode?: number, responseBody?: string): NetworkError =>
    new NetworkError(message, { statusCode, responseBody }),

  apiError: (
    message: string,
    options: {
      statusCode?: number;
      responseBody?: string;
      cause?: unknown;
    } = {}
  ): APIError => new APIError(message, options)
};

/**
 * 安全地提取错误消息
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return String(error);
}
