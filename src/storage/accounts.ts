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
  setAccountEnabled as setAccountEnabledOnIndex,
  setAccountQueuePriority as setAccountQueuePriorityOnIndex,
  setAccountTokenRefreshEnabled as setAccountTokenRefreshEnabledOnIndex,
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
import { buildAccountRecordDraft, reconcileStatusBarSelections } from "./accountMetadata";
import {
  previewSharedEntry,
  resolveSharedAccountIdentity,
  restoreSharedTokens,
  toSharedAccountJson
} from "./sharedAccounts";
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
import { buildCodexAuthFile, ensureCodexAuthFileFormat, readAuthFile, writeAuthFile } from "../codex";
import { refreshTokens } from "../auth/oauth";
import { createKeyedMutex } from "../utils/concurrency";
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
import {
  clearSubscriptionRetryPending,
  fetchSubscriptionStatus,
  markSubscriptionRetryPending,
  shouldAttemptSubscriptionRefresh,
  subscriptionMissingOrExpired
} from "../services/subscription";
import { buildAccountStorageId } from "../utils/accountIdentity";
import { extractClaims, isTokenExpired } from "../utils/jwt";
import { getQuotaIssueKind } from "../utils/quotaIssue";
import {
  CrossWindowOperationBusyError,
  runCentralAccountOperation,
  runCentralAccountOperationWithCooldown
} from "../utils/crossWindowOperations";
import { AccountError, StorageError, createError, ErrorCode } from "../core/errors";
import {
  AideckMirrorTokenSnapshot,
  listAideckCodexSharedAccounts,
  mirrorAideckCodexAccount,
  mirrorAideckCurrentAccount,
  removeAideckCodexAccount,
  readAideckCodexTokens
} from "./aideckCodexStorage";

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
/** getTokens 内存缓存 TTL（避免 Dashboard 刷新时重复读 Keychain） */
const TOKEN_CACHE_TTL_MS = 30_000;

type TokenCacheEntry = {
  tokens: CodexTokens | undefined;
  cachedAt: number;
};

export interface AccountSwitchCoordinator {
  prepareAccountSwitch(accountId: string): Promise<void>;
  completeAccountSwitch(accountId: string): Promise<void>;
  cancelAccountSwitch(accountId: string): Promise<void>;
  onAccountsMutated?(change: { addedAccountIds: string[]; removedAccountIds: string[] }): void;
  prepareAccountEnablement?(accountId: string, enabled: boolean): Promise<void>;
  completeAccountEnablement?(accountId: string, enabled: boolean): Promise<void>;
}

export class AccountsRepository {
  private readonly secretStore: SecretStore;
  private readonly indexPath: string;
  private readonly state = createAccountsRepositoryState();
  /** 按账号串行化切号/刷新，避免并发刷新同一账号 token */
  private readonly accountMutex = createKeyedMutex();
  /** getTokens 内存缓存，减少 SecretStore/Keychain 重复读取 */
  private readonly tokenCache = new Map<string, TokenCacheEntry>();
  private switchCoordinator: AccountSwitchCoordinator | undefined;

  /** 防止重复释放 */
  private disposed = false;
  private startupSyncTimer: NodeJS.Timeout | undefined;

  /** 任何 token 写入后清空整个缓存，下次 getTokens 重新从 SecretStore 读取 */
  private invalidateTokenCache(): void {
    if (this.tokenCache.size > 0) {
      this.tokenCache.clear();
    }
  }

  constructor(private readonly context: vscode.ExtensionContext) {
    this.secretStore = new SecretStore(context.secrets);
    this.indexPath = path.join(context.globalStorageUri.fsPath, INDEX_FILE);
  }

  /**
   * 初始化仓库
   * - 创建存储目录
   * - 同步激活账号状态
   */
  async init(options: { deferSync?: boolean } = {}): Promise<{ authSyncCompleted: boolean; mirrorSyncCompleted: boolean }> {
    try {
      await fs.mkdir(this.context.globalStorageUri.fsPath, { recursive: true });
    } catch (cause) {
      throw createError.storageWriteFailed(this.context.globalStorageUri.fsPath, cause);
    }

    try {
      await ensureCodexAuthFileFormat().catch((error: unknown) => {
        console.warn("[codexAccounts] unable to migrate the active auth.json format:", error);
      });
      if (options.deferSync) {
        return { authSyncCompleted: true, mirrorSyncCompleted: true };
      }
      await runCentralAccountOperation("Account auth sync", () =>
        this.runAndFlush(() => this.syncActiveAccountFromAuthFileInternal())
      );
      await runCentralAccountOperation("Account mirror sync", () =>
        this.runAndFlush(() => this.syncFromAideckMirrorInternal())
      );
      return { authSyncCompleted: true, mirrorSyncCompleted: true };
    } catch (cause) {
      if (isIndexHealthError(cause)) {
        console.error("[codexAccounts] accounts index init failed:", cause);
        return { authSyncCompleted: false, mirrorSyncCompleted: false };
      }
      throw cause;
    }
  }

  async syncFromAideckMirror(): Promise<CodexAccountRecord[]> {
    return runCentralAccountOperation("Account mirror sync", () =>
      this.runAndFlush(() => this.syncFromAideckMirrorInternal())
    );
  }

  private async syncFromAideckMirrorInternal(): Promise<CodexAccountRecord[]> {
    const sharedAccounts = await listAideckCodexSharedAccounts();
    if (sharedAccounts.length === 0) {
      return [];
    }

    let index: CodexAccountsIndex;
    try {
      index = await this.readIndex();
    } catch (error) {
      if (isIndexHealthError(error)) {
        return [];
      }
      throw error;
    }

    const existingIds = new Set(index.accounts.map((account) => account.id));
    const missing = sharedAccounts.filter((entry) => {
      try {
        const preview = previewSharedEntry(entry);
        return Boolean(preview.storageId && !existingIds.has(preview.storageId));
      } catch {
        return false;
      }
    });

    if (missing.length === 0) {
      return [];
    }

    const imported = await this.importSharedAccountsInternal(missing);
    if (imported.length > 0) {
      console.info(`[codexAccounts] imported ${imported.length} account(s) from Aideck mirror`);
    }
    return imported;
  }

  /**
   * 清理资源
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    if (this.startupSyncTimer) {
      clearTimeout(this.startupSyncTimer);
      this.startupSyncTimer = undefined;
    }
    try {
      disposeWriteCoordinator(this.state, (index) => {
        this.persistIndexSync(index);
      });
    } catch (error) {
      // Deactivation is best-effort. A write owned by another VS Code window
      // must not escape and fail the entire extension host shutdown.
      console.error("[codexAccounts] final account index flush failed during deactivation:", error);
    }
  }

  scheduleStartupSync(onComplete: () => void, delayMs = 5_000): void {
    if (this.startupSyncTimer || this.disposed) return;
    this.startupSyncTimer = setTimeout(() => {
      this.startupSyncTimer = undefined;
      void runCentralAccountOperationWithCooldown("Deferred startup account sync", 5 * 60 * 1000, async () => {
        await this.syncActiveAccountFromAuthFile();
        await this.syncFromAideckMirror();
      })
        .then(() => {
          // Even when another window already completed the cooldown-protected
          // sync, refresh this window from the shared index.
          onComplete();
        })
        .catch((error: unknown) => {
          console.warn("[codexAccounts] deferred startup account sync skipped:", error);
          // Give the owning window a moment to flush the shared index, then
          // refresh this window without attempting another sync.
          const refreshTimer = setTimeout(onComplete, 1_000);
          refreshTimer.unref?.();
          if (!(error instanceof CrossWindowOperationBusyError)) {
            // A genuine failure (rather than another window owning the work)
            // can recover automatically, but never more often than the global
            // five-minute sync cooldown.
            this.scheduleStartupSync(onComplete, 5 * 60 * 1000);
          }
        });
    }, delayMs);
    this.startupSyncTimer.unref?.();
  }

  /** Persist all debounced account-index changes before a cross-window action releases its lock. */
  async flush(): Promise<void> {
    if (this.state.saveDebounceTimer) {
      clearTimeout(this.state.saveDebounceTimer);
      this.state.saveDebounceTimer = null;
    }
    await this.flushPendingSave();
    await this.state.persistChain;
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
   * Drop this host's short-lived index cache after another VS Code window
   * replaces the shared accounts-index.json. Pending local writes always win.
   */
  invalidateCachedIndex(): void {
    if (this.state.pendingSave || this.state.isDirty) {
      return;
    }
    this.state.cache = null;
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

    if (!auth.tokens?.id_token || !auth.tokens.access_token) {
      throw new AccountError("Current auth.json does not include valid tokens", {
        code: ErrorCode.ACCOUNT_INVALID_DATA
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
  async getTokens(
    accountId: string,
    options: { syncExternal?: boolean; bypassCache?: boolean } = {}
  ): Promise<CodexTokens | undefined> {
    try {
      // 内存缓存命中直接返回，避免 Dashboard 刷新时重复读 Keychain
      const cached = this.tokenCache.get(accountId);
      if (!options.bypassCache && cached && Date.now() - cached.cachedAt < TOKEN_CACHE_TTL_MS) {
        return cached.tokens;
      }

      const storedTokens = await this.secretStore.getTokens(accountId);
      this.tokenCache.set(accountId, { tokens: storedTokens, cachedAt: Date.now() });

      if (options.syncExternal === false) {
        return storedTokens;
      }

      const index = await this.readIndex();
      const account = index.accounts.find((item) => item.id === accountId);
      if (!account) {
        return storedTokens;
      }

      const aideckTokens = await readAideckCodexTokens(accountId);
      const mergedTokens = mergeExternalTokens(storedTokens, aideckTokens, account);

      if (!mergedTokens) {
        return storedTokens;
      }

      if (!storedTokens || shouldSyncTokensFromAuthFile(storedTokens, mergedTokens)) {
        await this.secretStore.setTokens(accountId, mergedTokens);
        this.invalidateTokenCache();
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
    this.invalidateTokenCache();
    await mirrorAideckCodexAccount(account, effectiveTokens);

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
      await mirrorAideckCurrentAccount(accountId);
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

    const tokens = await this.getTokens(accountId);
    if (!tokens) {
      throw new AccountError(`Tokens missing for account ${account.email}`, {
        code: ErrorCode.AUTH_TOKEN_MISSING
      });
    }

    const remoteProfile = await fetchRemoteAccountProfile(tokens, {
      forceRefresh: true,
      preferredAccountName: account.accountName,
      preferredAccountStructure: account.accountStructure
    });
    if (!remoteProfile) {
      throw new AccountError(`No remote profile returned for ${account.email}`, {
        code: ErrorCode.ACCOUNT_INVALID_DATA
      });
    }

    if (
      applyRemoteProfileFromTokens({
        account,
        tokens,
        remoteProfile,
        planType: account.planType,
        allowAccountIdRepair: true
      })
    ) {
      account.updatedAt = Date.now();
      account.dismissedHealthIssueKey = undefined;
      await mirrorAideckCodexAccount(account, tokens);
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

    await mirrorAideckCodexAccount(account, await this.secretStore.getTokens(accountId));
    this.writeIndex(index);
    return account;
  }

  async setAccountTags(accountId: string, tags: string[]): Promise<CodexAccountRecord> {
    const index = await this.readIndex();
    const account = setAccountTagsOnIndex(index, accountId, tags, Date.now());
    if (!account) {
      throw createError.accountNotFound(accountId);
    }

    await mirrorAideckCodexAccount(account, await this.secretStore.getTokens(accountId));
    this.writeIndex(index);
    return account;
  }

  async addAccountTags(accountIds: string[], tags: string[]): Promise<CodexAccountRecord[]> {
    const index = await this.readIndex();
    const updated = addAccountTagsToIndex(index, accountIds, tags, Date.now());

    if (updated.length > 0) {
      await Promise.all(
        updated.map(async (account) => mirrorAideckCodexAccount(account, await this.secretStore.getTokens(account.id)))
      );
      this.writeIndex(index);
    }

    return updated;
  }

  async removeAccountTags(accountIds: string[], tags: string[]): Promise<CodexAccountRecord[]> {
    const index = await this.readIndex();
    const updated = removeAccountTagsFromIndex(index, accountIds, tags, Date.now());

    if (updated.length > 0) {
      await Promise.all(
        updated.map(async (account) => mirrorAideckCodexAccount(account, await this.secretStore.getTokens(account.id)))
      );
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
      addedVia?: CodexAccountRecord["addedVia"];
      identityFallback?: {
        email?: string;
        accountId?: string;
        organizationId?: string;
      };
    } = {}
  ): Promise<CodexAccountRecord> {
    let claims: ReturnType<typeof extractClaims>;
    try {
      claims = extractClaims(tokens.idToken, tokens.accessToken);
    } catch (error) {
      // Shared exports from older clients can contain an opaque/non-JWT ID
      // token. If the export includes its own account identity, keep the
      // import actionable instead of labeling the account invalid solely due
      // to a token format that is not needed for storage.
      if (!options.identityFallback?.email) {
        throw error;
      }
      claims = {};
    }
    const email = claims.email ?? options.identityFallback?.email;
    if (!email) {
      throw new AccountError("Unable to extract email from id_token", {
        code: ErrorCode.ACCOUNT_INVALID_DATA
      });
    }
    const claimsWithEmail = {
      ...claims,
      email,
      accountId: claims.accountId ?? tokens.accountId ?? options.identityFallback?.accountId,
      organizationId: claims.organizationId ?? options.identityFallback?.organizationId
    };

    // 异步获取远程配置，不阻塞主要流程
    let remoteProfile;
    try {
      remoteProfile = await fetchRemoteAccountProfile(tokens);
    } catch {
      remoteProfile = undefined;
    }

    const index = options.allowRecoveryWrite ? await this.readIndexForRecovery() : await this.readIndex();
    const previousActiveId = index.currentAccountId;
    const id = buildAccountStorageId(claimsWithEmail.email, claimsWithEmail.accountId, claimsWithEmail.organizationId);
    const existing = index.accounts.find((item) => item.id === id);
    const now = Date.now();
    const account = buildAccountRecordDraft({
      storageId: id,
      claims: claimsWithEmail,
      tokens,
      existing,
      existingAccounts: index.accounts,
      remoteProfile,
      addedVia: options.addedVia ?? "oauth",
      forceActive,
      now
    });

    // 替换或添加账号
    index.accounts = index.accounts.filter((item) => item.id !== id);
    index.accounts.push(account);

    if (forceActive) {
      markActive(index, id);
      reconcileStatusBarSelections(index, id, previousActiveId);
    }

    // 保存令牌
    const storedTokens = {
      ...tokens,
      accountId: account.accountId ?? tokens.accountId
    };
    await this.secretStore.setTokens(id, storedTokens);
    this.invalidateTokenCache();
    await mirrorAideckCodexAccount(account, storedTokens);
    if (account.isActive) {
      await mirrorAideckCurrentAccount(id);
    }

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

    if (!auth.tokens?.id_token || !auth.tokens.access_token) {
      throw new AccountError("Current auth.json does not include valid tokens", {
        code: ErrorCode.ACCOUNT_INVALID_DATA
      });
    }

    return this.upsertFromTokensInternal(
      {
        idToken: auth.tokens.id_token,
        accessToken: auth.tokens.access_token,
        refreshToken: auth.tokens.refresh_token,
        accountId: auth.tokens.account_id
      },
      true,
      {
        addedVia: "local"
      }
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

  setAccountSwitchCoordinator(coordinator: AccountSwitchCoordinator): void {
    this.switchCoordinator = coordinator;
  }

  async exportAuthFile(accountId: string): Promise<string | undefined> {
    const account = await this.getAccount(accountId);
    if (!account) return undefined;
    const tokens = await this.secretStore.getTokens(account.id);
    if (!tokens?.idToken || !tokens.accessToken) return undefined;
    return JSON.stringify(buildCodexAuthFile(tokens), null, 2);
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
      const identityFallback = resolveSharedAccountIdentity(entry);
      const incomingStorageId = previewSharedEntry(entry).storageId;
      const beforeImportIndex = options.allowRecoveryWrite ? await this.readIndexForRecovery() : await this.readIndex();
      const accountExistedBeforeImport = Boolean(
        incomingStorageId && beforeImportIndex.accounts.some((account) => account.id === incomingStorageId)
      );
      const previousTokens = incomingStorageId ? await this.secretStore.getTokens(incomingStorageId) : undefined;
      const credentialsChanged =
        accountExistedBeforeImport && (!previousTokens || !areTokenCredentialsEqual(previousTokens, restoredTokens));
      const created = await this.upsertFromTokensInternal(restoredTokens, false, {
        allowRecoveryWrite: options.allowRecoveryWrite,
        persistImmediately: false,
        addedVia: "json",
        identityFallback
      });
      const index = options.allowRecoveryWrite ? await this.readIndexForRecovery() : await this.readIndex();
      const account = index.accounts.find((item) => item.id === created.id);
      if (!account) {
        continue;
      }

      applySharedAccountEntry(account, entry);
      // Encrypted sync intentionally omits device-local quota errors. When it
      // delivers genuinely different credentials, an auth error produced by
      // the replaced token is stale and must not keep this PC in Reauthorize.
      // Preserve quota and service errors, and do nothing for an unchanged
      // import so a still-invalid credential remains visible.
      if (credentialsChanged && getQuotaIssueKind(account.quotaError) === "auth") {
        account.quotaError = undefined;
        account.dismissedHealthIssueKey = undefined;
      }

      const storedTokens = {
        ...restoredTokens,
        accountId: account.accountId ?? restoredTokens.accountId
      };
      await this.secretStore.setTokens(account.id, storedTokens);
      this.invalidateTokenCache();
      await mirrorAideckCodexAccount(account, storedTokens);

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
  async switchAccount(accountId: string, options: { forceTokenRefresh?: boolean } = {}): Promise<CodexAccountRecord> {
    // 按账号串行化，避免切号与后台续期并发刷新同一账号 token
    return this.accountMutex.runExclusive(accountId, async () => {
      await this.switchCoordinator?.prepareAccountSwitch(accountId);
      let account: CodexAccountRecord;
      try {
        account = await this.switchAccountLocked(accountId, options.forceTokenRefresh === true);
      } catch (error) {
        await this.switchCoordinator?.cancelAccountSwitch(accountId);
        throw error;
      }
      await this.switchCoordinator?.completeAccountSwitch(accountId);
      return account;
    });
  }

  private async switchAccountLocked(accountId: string, forceTokenRefresh = false): Promise<CodexAccountRecord> {
    const index = await this.readIndex();
    const account = index.accounts.find((item) => item.id === accountId);

    if (!account) {
      throw createError.accountNotFound(accountId);
    }

    const tokens = await this.getTokens(accountId);
    if (!tokens) {
      throw new AccountError(`Tokens missing for account ${account.email}`, {
        code: ErrorCode.AUTH_TOKEN_MISSING
      });
    }

    // 切号前按需刷新 token，避免写入过期 token 导致 codex 登录失败（对齐 cockpit switch_account_managed）
    const effectiveTokens = {
      ...tokens,
      accountId: account.accountId ?? tokens.accountId
    };

    let backgroundRotation: (() => Promise<void>) | undefined;
    if (forceTokenRefresh && tokens.refreshToken) {
      // Manual switching must remain immediate. Rotate in the background after
      // the new auth file is written; updateTokens will rewrite auth.json only
      // if this account is still active when the rotation completes.
      backgroundRotation = async () => {
        try {
          const refreshed = await refreshTokens(tokens.refreshToken!, tokens.idToken);
          await this.updateTokens(accountId, {
            ...refreshed,
            accountId: refreshed.accountId ?? account.accountId ?? tokens.accountId
          });
        } catch (error) {
          console.warn(`[codexAccounts] token rotation failed after switching ${account.email}:`, error);
        }
      };
    }

    await writeAuthFile(effectiveTokens);

    const nextAccount = switchActiveAccount(index, accountId);
    if (!nextAccount) {
      throw createError.accountNotFound(accountId);
    }

    await mirrorAideckCodexAccount(nextAccount, effectiveTokens);
    await mirrorAideckCurrentAccount(accountId);
    this.writeIndex(index);
    if (backgroundRotation) {
      void backgroundRotation();
    }

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
    this.invalidateTokenCache();
    clearQuotaCacheForAccount(accountId);
    await removeAideckCodexAccount(accountId);
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

  /** Include or exclude a saved account from automated work on this PC only. */
  async setAccountEnabled(accountId: string, enabled: boolean): Promise<CodexAccountRecord> {
    await this.switchCoordinator?.prepareAccountEnablement?.(accountId, enabled);
    const index = await this.readIndex();
    const account = setAccountEnabledOnIndex(index, accountId, enabled, Date.now());

    if (!account) {
      throw createError.accountNotFound(accountId);
    }
    // Enablement remains local in the account index. Encrypted sync publishes
    // only the ownership registry, never this machine-specific field itself.
    this.writeIndex(index, { notifyAccountSync: false });
    await this.switchCoordinator?.completeAccountEnablement?.(accountId, enabled);
    return account;
  }

  /** Apply synchronized ownership without recursively publishing another claim. */
  async setAccountEnabledFromSync(accountId: string, enabled: boolean): Promise<CodexAccountRecord> {
    const index = await this.readIndex();
    const account = setAccountEnabledOnIndex(index, accountId, enabled, Date.now());
    if (!account) throw createError.accountNotFound(accountId);
    this.writeIndex(index, { notifyAccountSync: false });
    return account;
  }

  /** Set whether this PC prioritizes an account in its automatic switching queue. */
  async setAccountQueuePriority(accountId: string, queuePriority: boolean): Promise<CodexAccountRecord> {
    const index = await this.readIndex();
    const account = setAccountQueuePriorityOnIndex(index, accountId, queuePriority, Date.now());

    if (!account) {
      throw createError.accountNotFound(accountId);
    }
    this.writeIndex(index, { notifyAccountSync: false });
    return account;
  }

  /** Enable or disable background token refresh for one account. */
  async setAccountTokenRefreshEnabled(accountId: string, enabled: boolean): Promise<CodexAccountRecord> {
    const index = await this.readIndex();
    const account = setAccountTokenRefreshEnabledOnIndex(index, accountId, enabled, Date.now());
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
    updatedPlanType?: string,
    updatedSubscriptionActiveUntil?: string
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
      updatedSubscriptionActiveUntil,
      now
    });
    const storedTokens = updatedTokens ?? (await this.secretStore.getTokens(accountId));
    const previousStoredAccountId = storedTokens?.accountId;
    if (storedTokens) {
      syncLoginAtFromTokens(account, storedTokens);
    }

    if (storedTokens && shouldAttemptRemoteProfileRepair(account, effectivePlanType)) {
      // Keep profile repair in the same central operation so it cannot write
      // an older index snapshot after another VS Code window starts an action.
      const remoteProfile = await fetchRemoteAccountProfile(storedTokens).catch(() => undefined);
      if (remoteProfile) {
        applyRemoteProfileFromTokens({
          account,
          tokens: storedTokens,
          remoteProfile,
          planType: effectivePlanType
        });
      }
    }

    const nextStoredTokens =
      updatedTokens ?? (account.accountId !== previousStoredAccountId ? storedTokens : undefined);
    if (storedTokens && nextStoredTokens) {
      const effectiveNextTokens = {
        ...nextStoredTokens,
        accountId: account.accountId ?? storedTokens.accountId
      };
      await this.secretStore.setTokens(accountId, effectiveNextTokens);
      this.invalidateTokenCache();
      await mirrorAideckCodexAccount(account, effectiveNextTokens);
      if (account.isActive) {
        await writeAuthFile(effectiveNextTokens);
        await mirrorAideckCurrentAccount(accountId);
      }
    }
    if (storedTokens && !nextStoredTokens) {
      await mirrorAideckCodexAccount(account, {
        ...storedTokens,
        accountId: account.accountId ?? storedTokens.accountId
      });
    }

    this.writeIndex(index);

    return account;
  }

  /**
   * 同步激活账号状态 (从 auth.json)
   */
  async syncActiveAccountFromAuthFile(): Promise<void> {
    await runCentralAccountOperation("Account auth sync", () =>
      this.runAndFlush(() => this.syncActiveAccountFromAuthFileInternal())
    );
  }

  private async syncActiveAccountFromAuthFileInternal(): Promise<void> {
    const auth = await readAuthFile();
    const index = await this.readIndex();
    const previousActiveId = index.currentAccountId;

    const claims = auth?.tokens ? extractClaims(auth.tokens.id_token, auth.tokens.access_token) : undefined;
    const derivedId = claims?.email
      ? buildAccountStorageId(claims.email, claims.accountId, claims.organizationId)
      : undefined;
    let changed = syncActiveAccountState(index, derivedId);
    if (derivedId && previousActiveId !== derivedId) {
      reconcileStatusBarSelections(index, derivedId, previousActiveId);
      changed = true;
    }

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
          this.invalidateTokenCache();
          await mirrorAideckCodexAccount(account, nextTokens);
          await mirrorAideckCurrentAccount(derivedId);
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

  private async runAndFlush<T>(task: () => Promise<T>): Promise<T> {
    try {
      return await task();
    } finally {
      await this.flush();
    }
  }

  /**
   * 刷新订阅状态（对齐 cockpit refresh_subscription_state）。
   * 先调 accounts/check，不够再降级到 subscriptions。失败后 30min 回退重试。
   */
  async refreshSubscriptionState(accountId: string, force = false): Promise<void> {
    const index = await this.readIndex();
    const account = index.accounts.find((item) => item.id === accountId);
    if (!account) {
      return;
    }

    // 归一化：若当前已有有效 subscription，清除重试标记。
    // 这里不能直接返回；force=true 时仍需重新查询，才能纠正已缓存但属于其他 workspace 的有效时间。
    if (!subscriptionMissingOrExpired(account.subscriptionActiveUntil)) {
      clearSubscriptionRetryPending(account);
      this.writeIndex(index);
    }

    if (!shouldAttemptSubscriptionRefresh(account, force)) {
      return;
    }

    const tokens = await this.getTokens(accountId);
    if (!tokens?.accessToken) {
      markSubscriptionRetryPending(account, "No access token available");
      this.writeIndex(index);
      return;
    }

    const effectiveAccountId = account.accountId ?? undefined;
    let snapshotResult: { planType?: string; subscriptionActiveUntil?: string; accountId?: string } | undefined;
    let fetchError: string | undefined;
    try {
      snapshotResult = await fetchSubscriptionStatus(
        tokens.accessToken,
        effectiveAccountId,
        account.organizationId,
        account.accountName,
        account.accountStructure
      );
    } catch (error) {
      fetchError = error instanceof Error ? error.message : String(error);
    }

    // 网络返回后重读 index，避免覆盖期间其他操作（updateQuota/switchAccount）的并发修改
    const freshIndex = await this.readIndex();
    const freshAccount = freshIndex.accounts.find((item) => item.id === accountId);
    if (!freshAccount) {
      return;
    }

    if (fetchError) {
      markSubscriptionRetryPending(freshAccount, fetchError);
    } else if (snapshotResult) {
      let changed = false;
      if (snapshotResult.accountId && snapshotResult.accountId !== freshAccount.accountId) {
        freshAccount.accountId = snapshotResult.accountId;
        changed = true;
      }
      if (snapshotResult.planType && snapshotResult.planType !== freshAccount.planType) {
        freshAccount.planType = snapshotResult.planType;
        changed = true;
      }
      if (
        snapshotResult.subscriptionActiveUntil &&
        snapshotResult.subscriptionActiveUntil !== freshAccount.subscriptionActiveUntil
      ) {
        freshAccount.subscriptionActiveUntil = snapshotResult.subscriptionActiveUntil;
        changed = true;
      }

      freshAccount.subscriptionQueryLastAttemptAt = Date.now();

      if (subscriptionMissingOrExpired(freshAccount.subscriptionActiveUntil)) {
        markSubscriptionRetryPending(freshAccount, "订阅接口未返回有效订阅时间");
      } else {
        clearSubscriptionRetryPending(freshAccount);
      }

      if (changed) {
        freshAccount.updatedAt = Date.now();
      }
    }

    this.writeIndex(freshIndex);
  }

  /**
   * 更新重置次数快照（由后台 fetchResetCredits 拉取后调用）。
   */
  async updateResetCreditsSnapshot(accountId: string, availableCount: number, nextExpiresAt?: number): Promise<void> {
    const index = await this.readIndex();
    const account = index.accounts.find((item) => item.id === accountId);
    if (!account?.quotaSummary) {
      return;
    }
    const previousNextExpiresAt = account.quotaSummary.resetCreditsNextExpiresAt;
    const effectiveNextExpiresAt =
      nextExpiresAt ?? (availableCount > 0 ? account.quotaSummary.resetCreditsNextExpiresAt : undefined);
    if (availableCount > 0 || previousNextExpiresAt != null || nextExpiresAt != null) {
      console.info("[codexAccounts] reset credits snapshot update", {
        accountId,
        previousAvailable: account.quotaSummary.resetCreditsAvailable ?? null,
        previousNextExpiresAt: previousNextExpiresAt ?? null,
        incomingAvailable: availableCount,
        incomingNextExpiresAt: nextExpiresAt ?? null,
        storedNextExpiresAt: effectiveNextExpiresAt ?? null,
        preservedResetCreditsExpiry: nextExpiresAt == null && effectiveNextExpiresAt != null
      });
    }
    account.quotaSummary.resetCreditsAvailable = availableCount;
    account.quotaSummary.resetCreditsNextExpiresAt = effectiveNextExpiresAt;
    account.updatedAt = Date.now();
    this.writeIndex(index);
  }

  /**
   * 兼容旧调用：仅更新最近到期时间。
   */
  async updateResetCreditsExpiry(accountId: string, nextExpiresAt: number): Promise<void> {
    const index = await this.readIndex();
    const account = index.accounts.find((item) => item.id === accountId);
    if (!account?.quotaSummary) {
      return;
    }
    await this.updateResetCreditsSnapshot(accountId, account.quotaSummary.resetCreditsAvailable ?? 0, nextExpiresAt);
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
      throw createError.storageWriteBlocked("Accounts index is corrupted and must be restored before continuing.");
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
  private writeIndex(index: CodexAccountsIndex, options: { notifyAccountSync?: boolean } = {}): void {
    assertWriteAllowed(this.state);
    const previousIndex = this.state.pendingSave ?? this.state.cache?.data;
    const previousIds = new Set(previousIndex?.accounts.map((account) => account.id) ?? []);
    const nextIds = new Set(index.accounts.map((account) => account.id));
    if (options.notifyAccountSync !== false) {
      this.switchCoordinator?.onAccountsMutated?.({
        addedAccountIds: [...nextIds].filter((accountId) => !previousIds.has(accountId)),
        removedAccountIds: [...previousIds].filter((accountId) => !nextIds.has(accountId))
      });
    }
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

function shouldSyncTokensFromAuthFile(current: CodexTokens | undefined, next: CodexTokens): boolean {
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
  external: AideckMirrorTokenSnapshot | undefined,
  account?: CodexAccountRecord
): CodexTokens | undefined {
  if (!external) {
    return current;
  }

  if (!canAdoptExternalMirrorTokens(current, external, account)) {
    return current;
  }

  if (
    current?.accessToken &&
    external.accessToken &&
    current.accessToken !== external.accessToken &&
    !isTokenExpired(current.accessToken, 0) &&
    isTokenExpired(external.accessToken, 0)
  ) {
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

function areTokenCredentialsEqual(left: CodexTokens, right: CodexTokens): boolean {
  return (
    left.idToken === right.idToken &&
    left.accessToken === right.accessToken &&
    (left.refreshToken ?? "") === (right.refreshToken ?? "") &&
    (left.accountId ?? "") === (right.accountId ?? "")
  );
}

function canAdoptExternalMirrorTokens(
  current: CodexTokens | undefined,
  external: AideckMirrorTokenSnapshot,
  account?: CodexAccountRecord
): boolean {
  const externalClaims = safeExtractTokenClaims(external);
  if (!isMirrorSnapshotInternallyConsistent(external, externalClaims)) {
    return false;
  }

  if (
    hasRequiredIdentityMismatch(
      account?.email ? normalizeEmailIdentity(account.email) : undefined,
      externalClaims?.email
    ) ||
    hasRequiredIdentityMismatch(account?.userId, externalClaims?.userId) ||
    hasRequiredIdentityMismatch(account?.accountId, external.accountId ?? externalClaims?.accountId) ||
    hasRequiredIdentityMismatch(account?.organizationId, externalClaims?.organizationId)
  ) {
    return false;
  }

  const expected = buildExpectedMirrorIdentity(account, current);
  const candidate = buildExternalMirrorIdentity(external, externalClaims);
  if (
    hasRequiredIdentityMismatch(expected.email, candidate.email) ||
    hasRequiredIdentityMismatch(expected.userId, candidate.userId) ||
    hasRequiredIdentityMismatch(expected.accountId, candidate.accountId) ||
    hasRequiredIdentityMismatch(expected.organizationId, candidate.organizationId)
  ) {
    return false;
  }

  return Boolean(candidate.accountId || candidate.organizationId || candidate.email || candidate.userId);
}

function buildExpectedMirrorIdentity(
  account: CodexAccountRecord | undefined,
  current: CodexTokens | undefined
): {
  email?: string;
  userId?: string;
  accountId?: string;
  organizationId?: string;
} {
  const claims = safeExtractTokenClaims(current);
  return {
    email: normalizeEmailIdentity(account?.email ?? claims?.email),
    userId: account?.userId ?? claims?.userId,
    accountId: account?.accountId ?? current?.accountId ?? claims?.accountId,
    organizationId: account?.organizationId ?? claims?.organizationId
  };
}

function buildExternalMirrorIdentity(
  external: AideckMirrorTokenSnapshot,
  claims:
    | {
        email?: string;
        userId?: string;
        accountId?: string;
        organizationId?: string;
      }
    | undefined = safeExtractTokenClaims(external)
): {
  email?: string;
  userId?: string;
  accountId?: string;
  organizationId?: string;
} {
  return {
    email: normalizeEmailIdentity(external.email ?? claims?.email),
    userId: external.userId ?? claims?.userId,
    accountId: external.accountId ?? claims?.accountId,
    organizationId: external.organizationId ?? claims?.organizationId
  };
}

function safeExtractTokenClaims(tokens: Partial<CodexTokens> | undefined):
  | {
      email?: string;
      userId?: string;
      accountId?: string;
      organizationId?: string;
    }
  | undefined {
  if (!tokens?.idToken) {
    return undefined;
  }

  try {
    const claims = extractClaims(tokens.idToken, tokens.accessToken);
    return {
      email: normalizeEmailIdentity(claims.email),
      userId: claims.userId,
      accountId: claims.accountId,
      organizationId: claims.organizationId
    };
  } catch {
    return undefined;
  }
}

function normalizeEmailIdentity(email: string | undefined): string | undefined {
  const trimmed = email?.trim().toLowerCase();
  return trimmed || undefined;
}

function isMirrorSnapshotInternallyConsistent(
  external: AideckMirrorTokenSnapshot,
  claims:
    | {
        email?: string;
        userId?: string;
        accountId?: string;
        organizationId?: string;
      }
    | undefined
): boolean {
  if (!external.idToken) {
    return true;
  }

  if (!claims) {
    return false;
  }

  return !(
    hasRequiredIdentityMismatch(normalizeEmailIdentity(external.email), claims.email) ||
    hasRequiredIdentityMismatch(external.userId, claims.userId) ||
    hasRequiredIdentityMismatch(external.accountId, claims.accountId) ||
    hasRequiredIdentityMismatch(external.organizationId, claims.organizationId)
  );
}

function hasRequiredIdentityMismatch(expected: string | undefined, candidate: string | undefined): boolean {
  // Some exported/legacy tokens intentionally omit email or organization
  // claims (and access tokens may be opaque). An absent claim is unknown, not
  // evidence that the mirror belongs to another account; only a contradiction
  // should block adoption.
  return Boolean(expected && candidate && expected !== candidate);
}

/**
 * 协调状态栏选择
 */
