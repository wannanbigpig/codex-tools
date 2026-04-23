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

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { SecretStore } from "./secrets";
import { createEmptyIndex, cloneIndex, markActive, syncActiveAccountState } from "./accountsIndex";
import {
  addAccountTags as addAccountTagsToIndex,
  dismissAccountHealthIssue,
  removeAccountFromIndex,
  removeAccountTags as removeAccountTagsFromIndex,
  setAccountTags as setAccountTagsOnIndex,
  setStatusBarVisibility as setStatusBarVisibilityOnIndex,
  switchActiveAccount
} from "./accountMutations";
import {
  applyQuotaUpdate,
  applyRemoteProfileFromTokens,
  shouldAttemptRemoteProfileRepair,
  syncLoginAtFromTokens
} from "./accountProfileMaintenance";
import { buildAccountRecordDraft } from "./accountMetadata";
import { restoreSharedTokens, toSharedAccountJson } from "./sharedAccounts";
import {
  applySharedAccountEntry,
  createSharedImportIssue,
  previewSharedAccountsImportEntries,
  toSharedEntries
} from "./sharedAccountsImport";
import { countAvailableBackups, isFileNotFoundError, readIndexSnapshot } from "./accountsPersistence";
import {
  isIndexHealthError,
  markUnrecoverableIndex,
  persistRecoveredIndex,
  readIndexForRecovery,
  restoreMissingIndex,
  tryRestoreFromBackups
} from "./accountsRecovery";
import { createAccountsRepositoryState } from "./accountsRepositoryState";
import {
  assertWriteAllowed,
  disposeWriteCoordinator,
  flushPendingSave,
  markPendingSave,
  markRecoveryPending,
  persistIndexSyncWithBackups,
  persistIndexWithBackups,
  readPendingOrCachedIndex
} from "./accountsWriteCoordinator";
import { readAuthFile, writeAuthFile } from "../codex";
import {
  CodexAccountRecord,
  CodexAccountsIndex,
  CodexAccountsRestoreResult,
  CodexImportPreviewSummary,
  CodexImportResultIssue,
  CodexImportResultSummary,
  CodexIndexHealthSummary,
  CodexQuotaSummary,
  CodexTokens,
  SharedCodexAccountJson
} from "../core/types";
import { fetchRemoteAccountProfile } from "../services/profile";
import { clearQuotaCacheForAccount } from "../services/quota";
import { buildAccountStorageId } from "../utils/accountIdentity";
import { extractClaims } from "../utils/jwt";
import { getQuotaIssueKind } from "../utils/quotaIssue";
import { AccountError, StorageError, createError, ErrorCode } from "../core/errors";

/** 缓存失效时间 (毫秒) */
const CACHE_TTL_MS = 5000;
/** 防抖延迟 (毫秒) */
const DEBOUNCE_DELAY_MS = 100;

const INDEX_FILE = "accounts-index.json";
const INDEX_TEMP_SUFFIX = ".tmp";
const INDEX_BACKUP_COUNT = 3;

/**
 * 账号存储仓库
 *
 * 提供账号数据的持久化和缓存管理
 */
export class AccountsRepository {
  private readonly secretStore: SecretStore;
  private readonly indexPath: string;
  private readonly state = createAccountsRepositoryState();

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
    } catch (cause) {
      throw createError.storageWriteFailed(this.context.globalStorageUri.fsPath, cause);
    }

    try {
      await this.syncActiveAccountFromAuthFile();
    } catch (cause) {
      if (isIndexHealthError(cause)) {
        console.error("[codexAccounts] accounts index init failed:", cause);
        return;
      }
      throw cause;
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
    disposeWriteCoordinator(this.state, (index) => {
      this.persistIndexSync(index);
    });
  }

  /**
   * 获取所有账号列表
   */
  async listAccounts(): Promise<CodexAccountRecord[]> {
    try {
      return (await this.readIndex()).accounts;
    } catch (error) {
      if (isIndexHealthError(error)) {
        return [];
      }
      throw error;
    }
  }

  /**
   * 获取单个账号
   */
  async getAccount(accountId: string): Promise<CodexAccountRecord | undefined> {
    try {
      return (await this.readIndex()).accounts.find((item) => item.id === accountId);
    } catch (error) {
      if (isIndexHealthError(error)) {
        return undefined;
      }
      throw error;
    }
  }

  async getIndexHealthSummary(): Promise<CodexIndexHealthSummary> {
    try {
      await this.readIndex();
    } catch (error) {
      if (!isIndexHealthError(error)) {
        throw error;
      }
    }

    return {
      ...this.state.indexHealth,
      availableBackups: await countAvailableBackups(this.indexPath, INDEX_BACKUP_COUNT)
    };
  }

  async restoreIndexFromLatestBackup(): Promise<CodexAccountsRestoreResult> {
    const restored = await this.tryRestoreFromBackups("backup");
    if (!restored) {
      throw createError.storageIndexRecoveryFailed(this.indexPath, this.state.indexHealth.lastErrorMessage);
    }

    return {
      source: "backup",
      restoredCount: restored.accounts.length,
      restoredEmails: restored.accounts.map((account) => account.email)
    };
  }

  async restoreAccountsFromAuthFile(): Promise<CodexAccountsRestoreResult> {
    const auth = await readAuthFile();
    if (!auth) {
      throw new AccountError("Current auth.json was not found", {
        code: ErrorCode.NOT_FOUND,
        i18nKey: "message.accountNotFound"
      });
    }

    const restored = await this.upsertFromTokensInternal(
      {
        idToken: auth.tokens.id_token,
        accessToken: auth.tokens.access_token,
        refreshToken: auth.tokens.refresh_token,
        accountId: auth.tokens.account_id
      },
      true,
      {
        allowRecoveryWrite: true,
        persistImmediately: true,
        restoreSource: "auth_json"
      }
    );

    return {
      source: "auth_json",
      restoredCount: 1,
      restoredEmails: [restored.email]
    };
  }

  async restoreAccountsFromSharedJson(
    input: SharedCodexAccountJson | SharedCodexAccountJson[]
  ): Promise<CodexAccountsRestoreResult> {
    let restored: CodexAccountRecord[];
    try {
      restored = await this.importSharedAccountsInternal(input, {
        allowRecoveryWrite: true,
        persistImmediately: true,
        restoreSource: "shared_json"
      });
    } catch (error) {
      this.state.pendingSave = null;
      this.state.isDirty = false;
      this.state.cache = this.state.indexHealth.status === "corrupted_unrecoverable" ? null : this.state.cache;
      throw error;
    }

    return {
      source: "shared_json",
      restoredCount: restored.length,
      restoredEmails: restored.map((account) => account.email)
    };
  }

  /**
   * 获取账号的令牌
   */
  async getTokens(accountId: string): Promise<CodexTokens | undefined> {
    try {
      const storedTokens = await this.secretStore.getTokens(accountId);
      const aideckTokens = await readAideckCodexTokens(accountId);
      const mergedTokens = mergeExternalTokens(storedTokens, aideckTokens);

      if (!mergedTokens) {
        return storedTokens;
      }

      if (!storedTokens || shouldSyncTokensFromAuthFile(storedTokens, mergedTokens)) {
        await this.secretStore.setTokens(accountId, mergedTokens);
        clearQuotaCacheForAccount(accountId);
      }

      return mergedTokens;
    } catch (cause) {
      throw new StorageError(`Failed to get tokens for ${accountId}`, {
        code: ErrorCode.STORAGE_SECRET_ACCESS_FAILED,
        cause
      });
    }
  }

  async updateTokens(accountId: string, tokens: CodexTokens): Promise<CodexAccountRecord> {
    const index = await this.readIndex();
    const account = index.accounts.find((item) => item.id === accountId);

    if (!account) {
      throw createError.accountNotFound(accountId);
    }

    const effectiveTokens = {
      ...tokens,
      accountId: tokens.accountId ?? account.accountId
    };

    await this.secretStore.setTokens(accountId, effectiveTokens);

    let shouldWriteIndex = false;
    if (effectiveTokens.accountId && effectiveTokens.accountId !== account.accountId) {
      account.accountId = effectiveTokens.accountId;
      account.updatedAt = Date.now();
      shouldWriteIndex = true;
    }

    if (getQuotaIssueKind(account.quotaError) === "auth") {
      account.quotaError = undefined;
      account.dismissedHealthIssueKey = undefined;
      account.updatedAt = Date.now();
      shouldWriteIndex = true;
    }

    if (account.isActive) {
      await writeAuthFile({
        ...effectiveTokens,
        accountId: account.accountId ?? effectiveTokens.accountId
      });
    }

    if (shouldWriteIndex) {
      this.writeIndex(index);
    }

    return account;
  }

  async refreshAccountProfileMetadata(accountId: string): Promise<CodexAccountRecord> {
    const index = await this.readIndex();
    const account = index.accounts.find((item) => item.id === accountId);
    if (!account) {
      throw createError.accountNotFound(accountId);
    }

    const tokens = await this.secretStore.getTokens(accountId);
    if (!tokens) {
      throw new AccountError(`Tokens missing for account ${account.email}`, {
        code: ErrorCode.AUTH_TOKEN_MISSING
      });
    }

    const remoteProfile = await fetchRemoteAccountProfile(tokens);
    if (!remoteProfile) {
      throw new AccountError(`No remote profile returned for ${account.email}`, {
        code: ErrorCode.ACCOUNT_INVALID_DATA
      });
    }

    if (applyRemoteProfileFromTokens({ account, tokens, remoteProfile, planType: account.planType })) {
      account.updatedAt = Date.now();
      account.dismissedHealthIssueKey = undefined;
      this.writeIndex(index);
    }

    return account;
  }

  async dismissHealthIssue(accountId: string, issueKey?: string): Promise<CodexAccountRecord> {
    const index = await this.readIndex();
    const account = dismissAccountHealthIssue(index, accountId, issueKey, Date.now());
    if (!account) {
      throw createError.accountNotFound(accountId);
    }

    this.writeIndex(index);
    return account;
  }

  async setAccountTags(accountId: string, tags: string[]): Promise<CodexAccountRecord> {
    const index = await this.readIndex();
    const account = setAccountTagsOnIndex(index, accountId, tags, Date.now());
    if (!account) {
      throw createError.accountNotFound(accountId);
    }

    this.writeIndex(index);
    return account;
  }

  async addAccountTags(accountIds: string[], tags: string[]): Promise<CodexAccountRecord[]> {
    const index = await this.readIndex();
    const updated = addAccountTagsToIndex(index, accountIds, tags, Date.now());

    if (updated.length > 0) {
      this.writeIndex(index);
    }

    return updated;
  }

  async removeAccountTags(accountIds: string[], tags: string[]): Promise<CodexAccountRecord[]> {
    const index = await this.readIndex();
    const updated = removeAccountTagsFromIndex(index, accountIds, tags, Date.now());

    if (updated.length > 0) {
      this.writeIndex(index);
    }

    return updated;
  }

  async previewSharedAccountsImport(
    input: SharedCodexAccountJson | SharedCodexAccountJson[]
  ): Promise<CodexImportPreviewSummary> {
    const entries = toSharedEntries(input);
    const existing = await this.readIndex().catch(() => createEmptyIndex());
    return previewSharedAccountsImportEntries(entries, new Set(existing.accounts.map((account) => account.id)));
  }

  /**
   * 插入或更新账号 (从令牌)
   *
   * @param tokens - 认证令牌
   * @param forceActive - 是否强制设为激活状态
   * @returns 账号记录
   */
  async upsertFromTokens(tokens: CodexTokens, forceActive = false): Promise<CodexAccountRecord> {
    return this.upsertFromTokensInternal(tokens, forceActive);
  }

  private async upsertFromTokensInternal(
    tokens: CodexTokens,
    forceActive = false,
    options: {
      allowRecoveryWrite?: boolean;
      persistImmediately?: boolean;
      restoreSource?: CodexAccountsRestoreResult["source"];
    } = {}
  ): Promise<CodexAccountRecord> {
    const claims = extractClaims(tokens.idToken, tokens.accessToken);
    if (!claims.email) {
      throw new AccountError("Unable to extract email from id_token", {
        code: ErrorCode.ACCOUNT_INVALID_DATA
      });
    }
    const claimsWithEmail = {
      ...claims,
      email: claims.email
    };

    // 异步获取远程配置，不阻塞主要流程
    let remoteProfile;
    try {
      remoteProfile = await fetchRemoteAccountProfile(tokens);
    } catch {
      remoteProfile = undefined;
    }

    const index = options.allowRecoveryWrite ? await this.readIndexForRecovery() : await this.readIndex();
    const id = buildAccountStorageId(claimsWithEmail.email, claims.accountId, claims.organizationId);
    const existing = index.accounts.find((item) => item.id === id);
    const now = Date.now();
    const account = buildAccountRecordDraft({
      storageId: id,
      claims: claimsWithEmail,
      tokens,
      existing,
      existingAccounts: index.accounts,
      remoteProfile,
      forceActive,
      now
    });

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

    if (options.persistImmediately) {
      await this.persistRecoveredIndex(index, options.restoreSource ?? "shared_json");
    } else if (options.allowRecoveryWrite) {
      markRecoveryPending(this.state, index);
    } else {
      this.writeIndex(index);
    }

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

  async exportSharedAccounts(accountIds: string[]): Promise<SharedCodexAccountJson[]> {
    const uniqueIds = Array.from(new Set(accountIds));
    if (uniqueIds.length === 0) {
      return [];
    }

    const index = await this.readIndex();
    const accounts = index.accounts.filter((account) => uniqueIds.includes(account.id));
    const sharedAccounts: SharedCodexAccountJson[] = [];

    for (const account of accounts) {
      const tokens = await this.secretStore.getTokens(account.id);
      if (!tokens?.idToken || !tokens.accessToken) {
        continue;
      }

      sharedAccounts.push(toSharedAccountJson(account, tokens));
    }

    return sharedAccounts;
  }

  async importSharedAccounts(input: SharedCodexAccountJson | SharedCodexAccountJson[]): Promise<CodexAccountRecord[]> {
    return this.importSharedAccountsInternal(input);
  }

  async importSharedAccountsWithSummary(
    input: SharedCodexAccountJson | SharedCodexAccountJson[]
  ): Promise<CodexImportResultSummary> {
    const entries = toSharedEntries(input);
    const preview = await this.previewSharedAccountsImport(entries);
    const failures: CodexImportResultIssue[] = [];
    const importedEmails: string[] = [];
    let successCount = 0;

    for (const [index, entry] of entries.entries()) {
      try {
        const imported = await this.importSharedAccountsInternal(entry);
        const first = imported[0];
        if (!first) {
          failures.push(createSharedImportIssue(entry, index, "Import returned no account"));
          continue;
        }
        successCount += 1;
        importedEmails.push(first.email);
      } catch (error) {
        failures.push(createSharedImportIssue(entry, index, error));
      }
    }

    return {
      total: entries.length,
      successCount,
      overwriteCount: preview.overwriteCount,
      failedCount: failures.length,
      importedEmails,
      failures
    };
  }

  private async importSharedAccountsInternal(
    input: SharedCodexAccountJson | SharedCodexAccountJson[],
    options: {
      allowRecoveryWrite?: boolean;
      persistImmediately?: boolean;
      restoreSource?: CodexAccountsRestoreResult["source"];
    } = {}
  ): Promise<CodexAccountRecord[]> {
    const entries = toSharedEntries(input);
    const imported: CodexAccountRecord[] = [];

    for (const entry of entries) {
      const restoredTokens = restoreSharedTokens(entry);
      const created = await this.upsertFromTokensInternal(restoredTokens, false, {
        allowRecoveryWrite: options.allowRecoveryWrite,
        persistImmediately: false
      });
      const index = options.allowRecoveryWrite ? await this.readIndexForRecovery() : await this.readIndex();
      const account = index.accounts.find((item) => item.id === created.id);
      if (!account) {
        continue;
      }

      applySharedAccountEntry(account, entry);

      await this.secretStore.setTokens(account.id, {
        ...restoredTokens,
        accountId: account.accountId ?? restoredTokens.accountId
      });

      if (options.persistImmediately) {
        await this.persistRecoveredIndex(index, options.restoreSource ?? "shared_json");
      } else {
        this.writeIndex(index);
      }
      imported.push({ ...account });
    }

    return imported;
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

    const nextAccount = switchActiveAccount(index, accountId);
    if (!nextAccount) {
      throw createError.accountNotFound(accountId);
    }

    this.writeIndex(index);

    return nextAccount;
  }

  /**
   * 移除账号
   */
  async removeAccount(accountId: string): Promise<void> {
    const index = await this.readIndex();
    if (!removeAccountFromIndex(index, accountId)) {
      return;
    }

    await this.secretStore.deleteTokens(accountId);
    clearQuotaCacheForAccount(accountId);
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
    const account = setStatusBarVisibilityOnIndex(index, accountId, visible, Date.now());

    if (!account) {
      throw createError.accountNotFound(accountId);
    }
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

    const now = Date.now();
    const effectivePlanType = applyQuotaUpdate({
      account,
      quotaSummary,
      quotaError,
      updatedPlanType,
      now
    });
    const storedTokens = updatedTokens ?? (await this.secretStore.getTokens(accountId));
    const previousStoredAccountId = storedTokens?.accountId;
    if (storedTokens) {
      syncLoginAtFromTokens(account, storedTokens);
    }

    if (storedTokens && shouldAttemptRemoteProfileRepair(account, effectivePlanType)) {
      const remoteProfile = await fetchRemoteAccountProfile(storedTokens).catch(() => undefined);
      applyRemoteProfileFromTokens({
        account,
        tokens: storedTokens,
        remoteProfile,
        planType: effectivePlanType
      });
    }

    const nextStoredTokens = updatedTokens ?? (account.accountId !== previousStoredAccountId ? storedTokens : undefined);
    if (storedTokens && nextStoredTokens) {
      const effectiveNextTokens = {
        ...nextStoredTokens,
        accountId: account.accountId ?? storedTokens.accountId
      };
      await this.secretStore.setTokens(accountId, effectiveNextTokens);
      if (account.isActive) {
        await writeAuthFile(effectiveNextTokens);
      }
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
    let changed = syncActiveAccountState(index, derivedId);

    if (auth?.tokens?.id_token && auth.tokens.access_token && derivedId) {
      const account = index.accounts.find((item) => item.id === derivedId);
      if (account) {
        const nextTokens: CodexTokens = {
          idToken: auth.tokens.id_token,
          accessToken: auth.tokens.access_token,
          refreshToken: auth.tokens.refresh_token,
          accountId: auth.tokens.account_id ?? claims?.accountId ?? account.accountId
        };
        const storedTokens = await this.secretStore.getTokens(derivedId);

        if (shouldSyncTokensFromAuthFile(storedTokens, nextTokens)) {
          await this.secretStore.setTokens(derivedId, nextTokens);
          clearQuotaCacheForAccount(derivedId);

          if (nextTokens.accountId && nextTokens.accountId !== account.accountId) {
            account.accountId = nextTokens.accountId;
          }

          if (getQuotaIssueKind(account.quotaError) === "auth") {
            account.quotaError = undefined;
            account.dismissedHealthIssueKey = undefined;
          }

          account.updatedAt = Date.now();
          changed = true;
        }
      }
    }

    if (changed) {
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
    if (this.state.indexHealth.status === "corrupted_unrecoverable") {
      throw createError.storageWriteBlocked(
        "Accounts index is corrupted and must be restored before continuing."
      );
    }

    const cached = readPendingOrCachedIndex(this.state, CACHE_TTL_MS);
    if (cached) {
      return cached;
    }

    try {
      const snapshot = await readIndexSnapshot(this.indexPath);
      this.state.cache = {
        data: snapshot,
        timestamp: Date.now()
      };
      this.state.indexHealth = {
        ...this.state.indexHealth,
        status: this.state.indexHealth.status === "restored_from_backup" ? "restored_from_backup" : "healthy",
        availableBackups: await countAvailableBackups(this.indexPath, INDEX_BACKUP_COUNT)
      };
      return cloneIndex(snapshot);
    } catch (cause) {
      if (isFileNotFoundError(cause)) {
        return restoreMissingIndex(this.state, this.indexPath, INDEX_BACKUP_COUNT);
      }

      console.error("[codexAccounts] failed to read accounts index, attempting recovery:", cause);
      const restored = await this.tryRestoreFromBackups("backup", cause);
      if (restored) {
        return cloneIndex(restored);
      }

      return markUnrecoverableIndex({
        state: this.state,
        indexPath: this.indexPath,
        backupCount: INDEX_BACKUP_COUNT,
        cause
      });
    }
  }

  private async readIndexForRecovery(): Promise<CodexAccountsIndex> {
    return readIndexForRecovery(this.state, async () => this.readIndex());
  }

  /**
   * 写入索引 (带防抖)
   */
  private writeIndex(index: CodexAccountsIndex): void {
    assertWriteAllowed(this.state);
    markPendingSave(this.state, index, DEBOUNCE_DELAY_MS, () => {
      void this.flushPendingSave();
    });
  }

  private async flushPendingSave(): Promise<void> {
    await flushPendingSave(this.state, async (index) => this.persistIndex(index));
  }

  private async persistIndex(index: CodexAccountsIndex): Promise<void> {
    await persistIndexWithBackups({
      state: this.state,
      indexPath: this.indexPath,
      index,
      tempSuffix: INDEX_TEMP_SUFFIX,
      backupCount: INDEX_BACKUP_COUNT
    });
  }

  /**
   * 持久化索引到文件 (同步模式，用于 dispose 时)
   */
  private persistIndexSync(index: CodexAccountsIndex): void {
    persistIndexSyncWithBackups({
      state: this.state,
      indexPath: this.indexPath,
      index,
      tempSuffix: INDEX_TEMP_SUFFIX,
      backupCount: INDEX_BACKUP_COUNT
    });
  }

  private async persistRecoveredIndex(
    index: CodexAccountsIndex,
    source: CodexAccountsRestoreResult["source"]
  ): Promise<void> {
    await persistRecoveredIndex({
      state: this.state,
      index,
      source,
      indexPath: this.indexPath,
      tempSuffix: INDEX_TEMP_SUFFIX,
      backupCount: INDEX_BACKUP_COUNT
    });
  }

  private async tryRestoreFromBackups(
    source: CodexAccountsRestoreResult["source"],
    originalError?: unknown
  ): Promise<CodexAccountsIndex | undefined> {
    return tryRestoreFromBackups({
      state: this.state,
      indexPath: this.indexPath,
      backupCount: INDEX_BACKUP_COUNT,
      tempSuffix: INDEX_TEMP_SUFFIX,
      source,
      originalError
    });
  }
}

function shouldSyncTokensFromAuthFile(
  current: CodexTokens | undefined,
  next: CodexTokens
): boolean {
  return toComparableTokenSnapshot(current) !== toComparableTokenSnapshot(next);
}

function toComparableTokenSnapshot(tokens: CodexTokens | undefined): string {
  if (!tokens) {
    return "";
  }

  return JSON.stringify({
    idToken: tokens.idToken ?? "",
    accessToken: tokens.accessToken ?? "",
    refreshToken: tokens.refreshToken ?? "",
    accountId: tokens.accountId ?? ""
  });
}

function mergeExternalTokens(
  current: CodexTokens | undefined,
  external: Partial<CodexTokens> | undefined
): CodexTokens | undefined {
  if (!external) {
    return current;
  }

  const merged: CodexTokens = {
    idToken: external.idToken ?? current?.idToken ?? "",
    accessToken: external.accessToken ?? current?.accessToken ?? "",
    refreshToken: external.refreshToken ?? current?.refreshToken,
    accountId: external.accountId ?? current?.accountId
  };

  if (!merged.idToken || !merged.accessToken) {
    return current;
  }

  return merged;
}

async function readAideckCodexTokens(accountId: string): Promise<Partial<CodexTokens> | undefined> {
  const filePath = getAideckCodexAccountFilePath(accountId);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const tokenSource = getRecord(parsed["tokens"]);
    const idToken = readString(tokenSource?.["id_token"]) ?? readString(parsed["id_token"]);
    const accessToken =
      readString(tokenSource?.["access_token"]) ??
      readString(parsed["access_token"]) ??
      readString(parsed["token"]);
    const refreshToken =
      readString(tokenSource?.["refresh_token"]) ??
      readString(parsed["refresh_token"]) ??
      undefined;
    const externalAccountId =
      readString(tokenSource?.["account_id"]) ??
      readString(parsed["account_id"]) ??
      undefined;

    if (!idToken && !accessToken && !refreshToken && !externalAccountId) {
      return undefined;
    }

    return {
      idToken,
      accessToken,
      refreshToken,
      accountId: externalAccountId
    };
  } catch {
    return undefined;
  }
}

function getAideckCodexAccountFilePath(accountId: string): string {
  const envDataRoot = process.env["AIDECK_DATA_DIR"]?.trim();
  const dataRoot = envDataRoot ? envDataRoot.replace(/^['"]|['"]$/g, "") : path.join(os.homedir(), ".ai_deck");
  return path.join(dataRoot, "accounts", "codex", "accounts", `${accountId}.json`);
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * 协调状态栏选择
 */
