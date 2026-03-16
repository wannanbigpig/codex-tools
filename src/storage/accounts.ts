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
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
      this.saveDebounceTimer = null;
    }
    // 如果有待保存的数据，立即保存
    if (this.pendingSave) {
      void this.persistIndexSync(this.pendingSave);
      this.pendingSave = null;
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

    const account: CodexAccountRecord = {
      id,
      email: claims.email,
      userId: claims.userId,
      authProvider: claims.authProvider,
      planType: claims.planType,
      accountId: remoteProfile?.accountId ?? claims.accountId ?? tokens.accountId,
      organizationId: claims.organizationId,
      accountName:
        remoteProfile?.accountName ??
        pickWorkspaceLikeTitle(claims.organizations?.map((item) => item.title)) ??
        existing?.accountName,
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

    if (!auth) {
      return;
    }

    const claims = extractClaims(auth.tokens.id_token, auth.tokens.access_token);
    const derivedId = claims.email
      ? buildAccountStorageId(claims.email, claims.accountId, claims.organizationId)
      : undefined;

    for (const account of index.accounts) {
      account.isActive = account.id === derivedId;
    }

    index.currentAccountId = derivedId;
    this.writeIndex(index);
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
    // 检查缓存是否有效
    if (this.cache) {
      const age = Date.now() - this.cache.timestamp;
      if (age < CACHE_TTL_MS) {
        // 返回缓存数据的深拷贝
        return JSON.parse(JSON.stringify(this.cache.data)) as CodexAccountsIndex;
      }
    }

    // 缓存无效，从文件读取
    try {
      const raw = await fs.readFile(this.indexPath, "utf8");
      const parsed = JSON.parse(raw) as CodexAccountsIndex;
      parsed.accounts ??= [];

      // 更新缓存
      this.cache = {
        data: parsed,
        timestamp: Date.now()
      };

      return parsed;
    } catch {
      // 文件不存在或解析失败，返回空索引
      const empty: CodexAccountsIndex = { accounts: [] };
      this.cache = {
        data: empty,
        timestamp: Date.now()
      };
      return empty;
    }
  }

  /**
   * 写入索引 (带防抖)
   */
  private writeIndex(index: CodexAccountsIndex): void {
    // 更新缓存
    this.cache = {
      data: JSON.parse(JSON.stringify(index)) as CodexAccountsIndex,
      timestamp: Date.now()
    };

    // 清除之前的定时器
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }

    // 设置新的防抖定时器
    this.pendingSave = index;
    this.saveDebounceTimer = setTimeout(() => {
      if (this.pendingSave) {
        this.persistIndexSync(this.pendingSave);
        this.pendingSave = null;
      }
      this.saveDebounceTimer = null;
    }, DEBOUNCE_DELAY_MS);
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
function pickWorkspaceLikeTitle(candidates?: Array<string | undefined>): string | undefined {
  if (!candidates?.length) {
    return undefined;
  }

  const normalized = (candidates ?? [])
    .filter((item): item is string => Boolean(item?.trim()))
    .map((item) => item.trim());

  return normalized.find((item) => item.toLowerCase() !== "personal") ?? normalized[0];
}

/**
 * 推断账号结构类型
 */
function inferAccountStructure(planType?: string, organizationId?: string): string | undefined {
  if (organizationId) {
    return "organization";
  }
  if (planType && planType.toLowerCase() === "team") {
    return "team";
  }
  return "personal";
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
