/**
 * 账号存储仓库
 *
 * 优化内容:
 * - 添加内存缓存层，减少重复文件 I/O 操作
 * - 实现缓存失效和持久化机制
 * - 使用防抖保存优化写入性能
 * - 使用统一的错误类型
 * - 添加类型安全的缓存接口
 */

import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { SecretStore } from "./secrets";
import { readAuthFile, writeAuthFile } from "../codex";
import { CodexAccountRecord, CodexAccountsIndex, CodexQuotaSummary, CodexTokens } from "../core/types";
import { fetchRemoteAccountProfile } from "../services/profile";
import { extractClaims } from "../utils/jwt";
import { AccountError, StorageError, createError, ErrorCode } from "../core/errors";

/** 缓存失效时间 (毫秒) */
const CACHE_TTL_MS = 5000;
/** 防抖延迟 (毫秒) */
const DEBOUNCE_DELAY_MS = 100;

const INDEX_FILE = "accounts-index.json";

/**
 * 缓存条目类型
 */
interface CacheEntry<T> {
  /** 缓存数据 */
  data: T;
  /** 缓存时间戳 */
  timestamp: number;
}

/**
 * 账号存储仓库
 *
 * 提供账号数据的持久化和缓存管理
 */
export class AccountsRepository {
  private readonly secretStore: SecretStore;
  private readonly indexPath: string;

  /** 内存缓存 - 存储索引数据 */
  private cache: CacheEntry<CodexAccountsIndex> | null = null;

  /** 防抖定时器 */
  private saveDebounceTimer: NodeJS.Timeout | null = null;

  /** 待保存的数据队列 */
  private pendingSave: CodexAccountsIndex | null = null;

  /** 持久化串行队列 */
  private persistChain: Promise<void> = Promise.resolve();

  /** 是否存在尚未安全落盘的改动 */
  private isDirty = false;

  /** 防止重复释放 */
  private disposed = false;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.secretStore = new SecretStore(context.secrets);
    this.indexPath = path.join(context.globalStorageUri.fsPath, INDEX_FILE);
  }

  /**
   * 初始化仓库
   * - 创建存储目录
   * - 同步激活账号状态
   */
  async init(): Promise<void> {
    try {
      await fs.mkdir(this.context.globalStorageUri.fsPath, { recursive: true });
      await this.syncActiveAccountFromAuthFile();
    } catch (cause) {
      throw createError.storageWriteFailed(this.context.globalStorageUri.fsPath, cause);
    }
  }

  /**
   * 清理资源
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
      this.saveDebounceTimer = null;
    }

    if (this.isDirty) {
      const latestIndex = this.pendingSave ?? this.cache?.data;
      if (latestIndex) {
        this.persistIndexSync(latestIndex);
      }
      this.pendingSave = null;
      this.isDirty = false;
    }
  }

  /**
   * 获取所有账号列表
   */
  async listAccounts(): Promise<CodexAccountRecord[]> {
    return (await this.readIndex()).accounts;
  }

  /**
   * 获取单个账号
   */
  async getAccount(accountId: string): Promise<CodexAccountRecord | undefined> {
    return (await this.readIndex()).accounts.find((item) => item.id === accountId);
  }

  /**
   * 获取账号的令牌
   */
  async getTokens(accountId: string): Promise<CodexTokens | undefined> {
    try {
      return await this.secretStore.getTokens(accountId);
    } catch (cause) {
      throw new StorageError(`Failed to get tokens for ${accountId}`, {
        code: ErrorCode.STORAGE_SECRET_ACCESS_FAILED,
        cause
      });
    }
  }

  /**
   * 插入或更新账号 (从令牌)
   *
   * @param tokens - 认证令牌
   * @param forceActive - 是否强制设为激活状态
   * @returns 账号记录
   */
  async upsertFromTokens(tokens: CodexTokens, forceActive = false): Promise<CodexAccountRecord> {
    const claims = extractClaims(tokens.idToken, tokens.accessToken);
    if (!claims.email) {
      throw new AccountError("Unable to extract email from id_token", {
        code: ErrorCode.ACCOUNT_INVALID_DATA
      });
    }

    // 异步获取远程配置，不阻塞主要流程
    let remoteProfile;
    try {
      remoteProfile = await fetchRemoteAccountProfile(tokens);
    } catch {
      remoteProfile = undefined;
    }

    const index = await this.readIndex();
    const id = buildAccountStorageId(claims.email, claims.accountId, claims.organizationId);
    const existing = index.accounts.find((item) => item.id === id);
    const now = Date.now();
    const resolvedAccountName =
      sanitizeWorkspaceName(remoteProfile?.accountName, claims.planType) ??
      pickWorkspaceLikeTitle(claims.organizations?.map((item) => item.title), claims.planType) ??
      sanitizeWorkspaceName(existing?.accountName, claims.planType);

    const account: CodexAccountRecord = {
      id,
      loginAt: claims.loginAt ?? existing?.loginAt,
      email: claims.email,
      userId: claims.userId,
      authProvider: claims.authProvider,
      planType: claims.planType,
      accountId: remoteProfile?.accountId ?? claims.accountId ?? tokens.accountId,
      organizationId: claims.organizationId,
      accountName: resolvedAccountName,
      accountStructure:
        remoteProfile?.accountStructure ??
        inferAccountStructure(claims.planType, claims.organizationId) ??
        existing?.accountStructure,
      isActive: forceActive,
      showInStatusBar: existing?.showInStatusBar ?? shouldEnableStatusBarByDefault(index.accounts, id),
      lastQuotaAt: existing?.lastQuotaAt,
      quotaSummary: existing?.quotaSummary,
      quotaError: existing?.quotaError,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };

    // 替换或添加账号
    index.accounts = index.accounts.filter((item) => item.id !== id);
    index.accounts.push(account);

    if (forceActive) {
      markActive(index, id);
    }

    // 保存令牌
    await this.secretStore.setTokens(id, {
      ...tokens,
      accountId: account.accountId ?? tokens.accountId
    });

    // 异步保存索引
    this.writeIndex(index);

    return account;
  }

  /**
   * 导入当前 auth.json
   */
  async importCurrentAuth(): Promise<CodexAccountRecord> {
    const auth = await readAuthFile();
    if (!auth) {
      throw new AccountError("Current auth.json was not found", {
        code: ErrorCode.NOT_FOUND,
        i18nKey: "message.accountNotFound"
      });
    }

    return this.upsertFromTokens(
      {
        idToken: auth.tokens.id_token,
        accessToken: auth.tokens.access_token,
        refreshToken: auth.tokens.refresh_token,
        accountId: auth.tokens.account_id
      },
      true
    );
  }

  /**
   * 切换账号
   *
   * @param accountId - 目标账号 ID
   * @returns 切换后的账号记录
   */
  async switchAccount(accountId: string): Promise<CodexAccountRecord> {
    const index = await this.readIndex();
    const account = index.accounts.find((item) => item.id === accountId);

    if (!account) {
      throw createError.accountNotFound(accountId);
    }

    const previousActiveId = index.currentAccountId;

    const tokens = await this.secretStore.getTokens(accountId);
    if (!tokens) {
      throw new AccountError(`Tokens missing for account ${account.email}`, {
        code: ErrorCode.AUTH_TOKEN_MISSING
      });
    }

    // 写入 auth.json
    await writeAuthFile({
      ...tokens,
      accountId: account.accountId ?? tokens.accountId
    });

    // 更新激活状态
    markActive(index, accountId);
    reconcileStatusBarSelections(index, accountId, previousActiveId);

    this.writeIndex(index);

    return index.accounts.find((item) => item.id === accountId)!;
  }

  /**
   * 移除账号
   */
  async removeAccount(accountId: string): Promise<void> {
    const index = await this.readIndex();
    index.accounts = index.accounts.filter((item) => item.id !== accountId);

    if (index.currentAccountId === accountId) {
      index.currentAccountId = undefined;
    }

    await this.secretStore.deleteTokens(accountId);
    this.writeIndex(index);
  }

  /**
   * 设置状态栏可见性
   *
   * @param accountId - 账号 ID
   * @param visible - 是否可见
   * @returns 更新后的账号记录
   */
  async setStatusBarVisibility(accountId: string, visible: boolean): Promise<CodexAccountRecord> {
    const index = await this.readIndex();
    const account = index.accounts.find((item) => item.id === accountId);

    if (!account) {
      throw createError.accountNotFound(accountId);
    }

    if (account.isActive) {
      account.showInStatusBar = false;
    } else if (visible) {
      const enabledCount = index.accounts.filter((item) => !item.isActive && item.showInStatusBar).length;

      if (enabledCount >= 2) {
        throw new AccountError("Only 2 extra accounts can be shown in the status popup", {
          code: ErrorCode.ACCOUNT_INVALID_DATA,
          i18nKey: "status.limitTip"
        });
      }
      account.showInStatusBar = true;
    } else {
      account.showInStatusBar = false;
    }

    account.updatedAt = Date.now();
    this.writeIndex(index);

    return account;
  }

  /**
   * 更新配额信息
   *
   * @param accountId - 账号 ID
   * @param quotaSummary - 配额摘要
   * @param quotaError - 配额错误信息
   * @param updatedTokens - 更新后的令牌
   * @param updatedPlanType - 更新后的计划类型
   * @returns 更新后的账号记录
   */
  async updateQuota(
    accountId: string,
    quotaSummary?: CodexQuotaSummary,
    quotaError?: CodexAccountRecord["quotaError"],
    updatedTokens?: CodexTokens,
    updatedPlanType?: string
  ): Promise<CodexAccountRecord> {
    const index = await this.readIndex();
    const account = index.accounts.find((item) => item.id === accountId);

    if (!account) {
      throw createError.accountNotFound(accountId);
    }

    account.lastQuotaAt = Date.now();
    account.updatedAt = Date.now();
    account.quotaSummary = quotaSummary;
    account.quotaError = quotaError;

    if (updatedPlanType) {
      account.planType = updatedPlanType;
    }

    const storedTokens = updatedTokens ?? (await this.secretStore.getTokens(accountId));
    if (!account.loginAt && storedTokens) {
      const effectiveTokens = storedTokens;
      if (effectiveTokens) {
        const claims = extractClaims(effectiveTokens.idToken, effectiveTokens.accessToken);
        account.loginAt = claims.loginAt ?? account.loginAt;
      }
    }

    if (updatedTokens) {
      await this.secretStore.setTokens(accountId, {
        ...updatedTokens,
        accountId: account.accountId ?? updatedTokens.accountId
      });
    }

    this.writeIndex(index);

    return account;
  }

  /**
   * 同步激活账号状态 (从 auth.json)
   */
  async syncActiveAccountFromAuthFile(): Promise<void> {
    const auth = await readAuthFile();
    const index = await this.readIndex();
    const claims = auth ? extractClaims(auth.tokens.id_token, auth.tokens.access_token) : undefined;
    const derivedId = claims?.email
      ? buildAccountStorageId(claims.email, claims.accountId, claims.organizationId)
      : undefined;

    if (syncActiveAccountState(index, derivedId)) {
      this.writeIndex(index);
    }
  }

  /**
   * 打开 Codex Home 目录
   */
  async openCodexHome(): Promise<void> {
    const codexHome = process.env["CODEX_HOME"]?.trim()
      ? process.env["CODEX_HOME"].replace(/^['"]|['"]$/g, "")
      : path.join(os.homedir(), ".codex");

    await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(path.join(codexHome, "auth.json")));
  }

  /**
   * 读取索引 (带缓存)
   */
  private async readIndex(): Promise<CodexAccountsIndex> {
    if (this.pendingSave) {
      return cloneIndex(this.pendingSave);
    }

    // 检查缓存是否有效
    if (this.cache) {
      const age = Date.now() - this.cache.timestamp;
      if (age < CACHE_TTL_MS) {
        return cloneIndex(this.cache.data);
      }
    }

    // 缓存无效，从文件读取
    try {
      const raw = await fs.readFile(this.indexPath, "utf8");
      const snapshot = cloneIndex(JSON.parse(raw) as CodexAccountsIndex);

      // 更新缓存
      this.cache = {
        data: snapshot,
        timestamp: Date.now()
      };

      return cloneIndex(snapshot);
    } catch {
      // 文件不存在或解析失败，返回空索引
      const empty = createEmptyIndex();
      this.cache = {
        data: empty,
        timestamp: Date.now()
      };
      return cloneIndex(empty);
    }
  }

  /**
   * 写入索引 (带防抖)
   */
  private writeIndex(index: CodexAccountsIndex): void {
    const snapshot = cloneIndex(index);

    // 更新缓存
    this.cache = {
      data: snapshot,
      timestamp: Date.now()
    };
    this.isDirty = true;

    // 清除之前的定时器
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }

    // 设置新的防抖定时器
    this.pendingSave = snapshot;
    this.saveDebounceTimer = setTimeout(() => {
      void this.flushPendingSave();
    }, DEBOUNCE_DELAY_MS);
  }

  private async flushPendingSave(): Promise<void> {
    const snapshot = this.pendingSave;
    this.pendingSave = null;
    this.saveDebounceTimer = null;

    if (!snapshot) {
      return;
    }

    const persistTask = this.persistChain
      .catch(() => undefined)
      .then(async () => {
        await this.persistIndex(snapshot);
      });
    this.persistChain = persistTask;

    try {
      await persistTask;
      if (!this.pendingSave) {
        this.isDirty = false;
      }
    } catch (error) {
      console.error("[codexAccounts] failed to persist accounts index:", error);
    }
  }

  private async persistIndex(index: CodexAccountsIndex): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.indexPath), { recursive: true });
      await fs.writeFile(this.indexPath, JSON.stringify(index, null, 2), "utf8");
    } catch (cause) {
      throw createError.storageWriteFailed(this.indexPath, cause);
    }
  }

  /**
   * 持久化索引到文件 (同步模式，用于 dispose 时)
   */
  private persistIndexSync(index: CodexAccountsIndex): void {
    try {
      fsSync.mkdirSync(path.dirname(this.indexPath), { recursive: true });
      fsSync.writeFileSync(this.indexPath, JSON.stringify(index, null, 2), "utf8");
    } catch (cause) {
      throw createError.storageWriteFailed(this.indexPath, cause);
    }
  }
}

/**
 * 选择工作空间样式的标题
 */
function pickWorkspaceLikeTitle(candidates?: Array<string | undefined>, planType?: string): string | undefined {
  if (!candidates?.length) {
    return undefined;
  }

  const normalized = (candidates ?? [])
    .filter((item): item is string => Boolean(item?.trim()))
    .map((item) => item.trim());

  const preferred = normalized.find((item) => !isGenericPersonalWorkspaceName(item));
  if (preferred) {
    return preferred;
  }

  const fallback = normalized[0];
  return sanitizeWorkspaceName(fallback, planType);
}

/**
 * 推断账号结构类型
 */
function inferAccountStructure(planType?: string, organizationId?: string): string | undefined {
  if (organizationId) {
    return "organization";
  }
  if (planType && ["team", "business", "enterprise"].includes(planType.toLowerCase())) {
    return "team";
  }
  return "personal";
}

function sanitizeWorkspaceName(name: string | undefined, planType?: string): string | undefined {
  const trimmed = name?.trim();
  if (!trimmed) {
    return undefined;
  }

  if (isGenericPersonalWorkspaceName(trimmed) && !isPersonalLikePlan(planType)) {
    return undefined;
  }

  return trimmed;
}

function isGenericPersonalWorkspaceName(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "personal" || normalized === "personal workspace" || normalized === "个人空间";
}

function isPersonalLikePlan(planType?: string): boolean {
  const normalized = planType?.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return ["free", "plus", "pro", "personal"].includes(normalized);
}

/**
 * 构建账号存储 ID (使用 MD5 哈希)
 */
function buildAccountStorageId(email: string, accountId?: string, organizationId?: string): string {
  const seed = [email.trim(), accountId?.trim(), organizationId?.trim()].filter(Boolean).join("|");
  return `codex_${crypto.createHash("md5").update(seed).digest("hex")}`;
}

/**
 * 标记账号为激活状态
 */
function markActive(index: CodexAccountsIndex, accountId: string): void {
  index.currentAccountId = accountId;
  for (const account of index.accounts) {
    account.isActive = account.id === accountId;
  }
}

function syncActiveAccountState(index: CodexAccountsIndex, accountId: string | undefined): boolean {
  const normalizedAccountId = accountId && index.accounts.some((account) => account.id === accountId) ? accountId : undefined;
  let changed = index.currentAccountId !== normalizedAccountId;
  index.currentAccountId = normalizedAccountId;

  for (const account of index.accounts) {
    const nextActive = account.id === normalizedAccountId;
    if (account.isActive !== nextActive) {
      account.isActive = nextActive;
      changed = true;
    }
  }

  return changed;
}

function createEmptyIndex(): CodexAccountsIndex {
  return { accounts: [] };
}

function cloneIndex(index: CodexAccountsIndex): CodexAccountsIndex {
  const normalized: CodexAccountsIndex = {
    currentAccountId: index?.currentAccountId,
    accounts: Array.isArray(index?.accounts) ? index.accounts : []
  };
  return JSON.parse(JSON.stringify(normalized)) as CodexAccountsIndex;
}

/**
 * 协调状态栏选择
 */
function reconcileStatusBarSelections(
  index: CodexAccountsIndex,
  nextActiveId: string,
  previousActiveId?: string
): void {
  const nextActive = index.accounts.find((account) => account.id === nextActiveId);
  if (nextActive) {
    nextActive.showInStatusBar = false;
  }

  const extras = index.accounts.filter((account) => account.id !== nextActiveId && account.showInStatusBar);

  if (extras.length > 2) {
    extras
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(2)
      .forEach((account) => {
        account.showInStatusBar = false;
      });
  }

  if (!previousActiveId || previousActiveId === nextActiveId) {
    return;
  }

  const previousActive = index.accounts.find((account) => account.id === previousActiveId);
  if (!previousActive) {
    return;
  }

  const currentExtraCount = index.accounts.filter(
    (account) => account.id !== nextActiveId && account.showInStatusBar
  ).length;

  previousActive.showInStatusBar = currentExtraCount < 2;
  previousActive.updatedAt = Date.now();
}

/**
 * 判断是否默认启用状态栏
 */
function shouldEnableStatusBarByDefault(accounts: CodexAccountRecord[], accountId: string): boolean {
  const enabledCount = accounts.filter(
    (item) => item.id !== accountId && !item.isActive && item.showInStatusBar
  ).length;
  return enabledCount < 2;
}
