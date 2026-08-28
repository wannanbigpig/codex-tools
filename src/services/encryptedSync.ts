import * as crypto from "crypto";
import * as os from "os";
import * as zlib from "zlib";
import * as vscode from "vscode";
import type { SharedCodexAccountJson } from "../core/types";
import { AccountsRepository } from "../storage";
import {
  CrossWindowOperationBusyError,
  runEncryptedSyncOperation
} from "../utils/crossWindowOperations";
import { getCodexAccountsConfiguration } from "../infrastructure/config/extensionSettings";
import { clearTokenAutomationError } from "../presentation/workbench/tokenAutomationState";
import { canonicalizeSyncAccountLeases, isValidSyncAccountLease, type SyncAccountLease } from "./syncLeases";
import {
  canonicalizeSyncAccountEnablement,
  createSyncAccountEnablement,
  isValidSyncAccountEnablement,
  mergeSyncAccountEnablement,
  type SyncAccountEnablement
} from "./syncEnablementRegistry";

const SYNC_KEY = "codexAccounts.encryptedSync.v1";
const PASSPHRASE_KEY = "codexAccounts.encryptedSync.passphrase";
const DEVICE_KEY = "codexAccounts.encryptedSync.deviceId";
const LOCAL_DELETIONS_KEY = "codexAccounts.encryptedSync.localDeletions.v1";
const LOCAL_ENABLEMENT_KEY = "codexAccounts.encryptedSync.localEnablement.v1";
const LEGACY_LOCAL_ASSIGNMENTS_KEY = "codexAccounts.encryptedSync.localAssignments.v1";
const LOCAL_ENABLEMENT_PENDING_KEY = "codexAccounts.encryptedSync.localEnablementPending.v1";
const ENABLEMENT_SYNC_CONSOLIDATION_DELAY_MS = 5 * 60 * 1000;
const REGISTRY_OVERRIDE_KEY = "codexAccounts.encryptedSync.enablementOverride.v1";
const SCRYPT_COST = 131_072;
const MAX_ACCOUNTS = 500;
const MAX_LEASES = 500;
const MAX_DELETIONS = 1_000;
const MAX_ENABLEMENT_RECORDS = 1_000;
const MAX_PLAINTEXT_BYTES = 16 * 1024 * 1024;
const MAX_ENVELOPE_BYTES = 2 * 1024 * 1024;
const MAX_METADATA_LENGTH = 4096;
const MAX_TOKEN_LENGTH = 512 * 1024;
const VAULT_AUTHENTICATION_ERROR = "The vault passphrase is incorrect or the synchronized data was modified.";
let encryptedSyncNeedsConfiguration = false;
let encryptedSyncNeedsSettingsSync = false;
let visibleAccountEnablement: SyncAccountEnablement[] = [];
let visibleEnablementDeviceId: string | undefined;
let encryptedSyncRegistryOverrideEnabled = false;
let pendingEnablementAccountIds = new Set<string>();
let encryptedSyncLastCompletedAt: number | undefined;
let encryptedSyncLastSessionCount: number | undefined;
let encryptedSyncLastEnabledSessionCount: number | undefined;

export type SyncAccountEntry = SharedCodexAccountJson;

export type SyncPayload = {
  format: "codex-accounts-encrypted-sync";
  version: 1;
  updatedAt: number;
  deviceId: string;
  accounts: SyncAccountEntry[];
  /** Legacy read-only field. New vaults do not publish real-time account usage leases. */
  leases?: SyncAccountLease[];
  /** Deletion tombstones prevent stale PCs from restoring removed accounts. */
  deletions?: SyncAccountDeletion[];
  /** Plain per-account enable/disable registry. */
  enablementRegistry?: SyncAccountEnablement[];
  /** Legacy development field migrated into enablementRegistry when encountered. */
  assignments?: SyncAccountEnablement[];
};

export type SyncAccountDeletion = {
  accountId: string;
  deletedAt: number;
  deviceId: string;
};

export type SyncedAccountLeaseView = SyncAccountLease & { isCurrentDevice: boolean };

type CipherEnvelopeBase = {
  format: "codex-accounts-encrypted-sync";
  version: 1;
  updatedAt: number;
  deviceId: string;
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
};

type CipherEnvelope = CipherEnvelopeBase & {
  compression: "gzip";
};

type ParsedCipherEnvelope = CipherEnvelopeBase & {
  /** Early v1 vaults used gzip but did not authenticate an explicit compression field. */
  compression?: "gzip";
};

/** Opt-in account sync through VS Code Settings Sync. Only authenticated ciphertext is synchronized. */
export class EncryptedSyncManager implements vscode.Disposable {
  private disposed = false;
  private syncing = false;
  private lastRemoteRaw: string | undefined;
  private lastRemotePayload: SyncPayload | undefined;
  private lastRemotePassphraseHash: string | undefined;
  private mutationChain: Promise<void> = Promise.resolve();
  private mutationVersion = 0;
  private currentSyncTask: Promise<boolean> | undefined;
  private backgroundSyncTimer: NodeJS.Timeout | undefined;
  private onStateChanged: (() => void) | undefined;
  private applyingRemote = false;
  private localEnablementDefaults = new Map<string, boolean>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly repo: AccountsRepository
  ) {}

  async start(): Promise<void> {
    this.context.globalState.setKeysForSync([SYNC_KEY]);
    this.context.subscriptions.push(this);
    encryptedSyncRegistryOverrideEnabled = this.context.globalState.get<boolean>(REGISTRY_OVERRIDE_KEY, false);
    const persistedPending = this.context.globalState.get<unknown>(LOCAL_ENABLEMENT_PENDING_KEY, []);
    pendingEnablementAccountIds = new Set(
      Array.isArray(persistedPending) ? persistedPending.filter((id): id is string => typeof id === "string") : []
    );
    const deviceId = await this.getDeviceId();
    this.updateVisibleEnablement(this.readLocalEnablement(), deviceId);
    const remoteVault = this.context.globalState.get<string>(SYNC_KEY);
    // A downloaded vault or an active Settings Sync sign-in opts this PC into
    // sync mode. Do not require a second enable-toggle before asking for its password.
    if ((remoteVault || (await this.hasSettingsSyncAccount())) && !this.isEnabled()) {
      await getCodexAccountsConfiguration().update("encryptedSyncEnabled", true, vscode.ConfigurationTarget.Global);
      if (remoteVault) {
        encryptedSyncNeedsConfiguration = true;
      }
    }
    if (this.isEnabled()) {
      try {
        // Apply a vault that VS Code downloaded just before activation so the
        // dashboard starts with the latest enablement state even when the
        // subsequent full sync cannot run yet.
        await this.refreshEnablementFromDownloadedVault();
      } catch (error) {
        encryptedSyncNeedsConfiguration = true;
        console.warn("[codexAccounts] could not read synchronized enablement registry during activation:", error);
      }
      // Refresh the Settings Sync service and merge the encrypted vault on
      // every activation/reload. This uses the saved passphrase only; startup
      // never opens prompts. Failures are surfaced as an actionable warning.
      let synced = false;
      try {
        synced = await this.syncNow(false, false, true);
      } catch (error) {
        if (error instanceof CrossWindowOperationBusyError) {
          synced = true;
        } else {
          console.warn("[codexAccounts] startup encrypted sync failed:", error);
        }
      }
      if (!synced) {
        const message = encryptedSyncNeedsConfiguration
          ? "Encrypted sync is ready for this workspace. Set the sync passphrase, then run Sync Now to complete startup sync."
          : encryptedSyncNeedsSettingsSync
            ? "Startup sync is ready when VS Code Settings Sync is active. Sign in to VS Code and turn on Settings Sync, then run Sync Now."
            : "Startup encrypted sync needs attention. Run Sync Now to retry.";
        void vscode.window.showWarningMessage(message);
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.backgroundSyncTimer) {
      clearTimeout(this.backgroundSyncTimer);
      this.backgroundSyncTimer = undefined;
    }
    this.clearVisibleEnablement();
  }

  /** Queue pending local mutations without surfacing background lock contention. */
  queueBackgroundSync(delayMs = 1_000): void {
    if (this.disposed || this.backgroundSyncTimer) return;
    this.backgroundSyncTimer = setTimeout(() => {
      this.backgroundSyncTimer = undefined;
      void this.syncNow(false, false, true).catch((error: unknown) => {
        if (error instanceof CrossWindowOperationBusyError) {
          this.queueBackgroundSync(Math.min(delayMs * 2, 10_000));
          return;
        }
        console.warn("[codexAccounts] queued encrypted sync failed:", error);
      });
    }, delayMs);
    this.backgroundSyncTimer.unref?.();
  }

  onAccountsMutated(change: { addedAccountIds: string[]; removedAccountIds: string[] }): void {
    if (this.disposed || this.applyingRemote || (!change.addedAccountIds.length && !change.removedAccountIds.length)) {
      return;
    }
    this.mutationVersion += 1;
    this.mutationChain = this.mutationChain
      .catch(() => undefined)
      .then(async () => {
        const deviceId = await this.getDeviceId();
        const deviceName = resolveDeviceName();
        const current = this.readLocalDeletions();
        const byAccountId = new Map(current.map((entry) => [entry.accountId, entry]));
        for (const accountId of change.addedAccountIds) byAccountId.delete(accountId);
        const deletedAt = Date.now();
        for (const accountId of change.removedAccountIds) {
          byAccountId.set(accountId, { accountId, deletedAt, deviceId });
        }
        await this.context.globalState.update(
          LOCAL_DELETIONS_KEY,
          canonicalizeSyncAccountDeletions([...byAccountId.values()])
        );
        const enablement = new Map(this.readLocalEnablement().map((entry) => [entry.accountId, entry]));
        const updatedAt = Date.now();
        for (const accountId of change.addedAccountIds) {
          const currentEntry = enablement.get(accountId);
          enablement.set(
            accountId,
            createSyncAccountEnablement({
              accountId,
              deviceId,
              deviceName,
              enabled: true,
              revision: (currentEntry?.revision ?? 0) + 1,
              now: updatedAt
            })
          );
        }
        for (const accountId of change.removedAccountIds) {
          const currentEntry = enablement.get(accountId);
          enablement.set(
            accountId,
            createSyncAccountEnablement({
              accountId,
              deviceId,
              deviceName,
              enabled: false,
              revision: (currentEntry?.revision ?? 0) + 1,
              now: updatedAt
            })
          );
        }
        await this.storeLocalEnablement([...enablement.values()], deviceId);
        await this.markEnablementPending([...change.addedAccountIds, ...change.removedAccountIds]);
      })
      .catch((error) => {
        console.warn("[codexAccounts] could not record encrypted-sync mutation:", error);
        void vscode.window.showWarningMessage(
          "The account change was saved locally, but its enable/disable registry could not be updated. Run Sync Sessions Now to retry."
        );
      });
  }

  shutdown(): void {
    if (this.disposed) {
      return;
    }
    this.dispose();
  }

  setOnStateChanged(callback: () => void): void {
    this.onStateChanged = callback;
  }

  canRefreshAccount(accountId: string): boolean {
    return encryptedSyncRegistryOverrideEnabled || !this.findForeignEnablement(accountId);
  }

  async prepareAccountSwitch(accountId: string): Promise<void> {
    if (encryptedSyncRegistryOverrideEnabled) return;
    await this.refreshEnablementFromDownloadedVault();
    const enabledElsewhere = this.findForeignEnablement(accountId);
    if (enabledElsewhere) {
      throw new Error(
        `This account is enabled on ${enabledElsewhere.deviceName}. Disable it there and run Sync Now first.`
      );
    }
  }

  completeAccountSwitch(): Promise<void> {
    return Promise.resolve();
  }

  cancelAccountSwitch(): Promise<void> {
    return Promise.resolve();
  }

  async prepareAccountEnablement(accountId: string, enabled: boolean): Promise<void> {
    if (encryptedSyncRegistryOverrideEnabled) return;
    await this.mutationChain.catch(() => undefined);
    await this.refreshEnablementFromDownloadedVault();
    const current = this.readLocalEnablement().find((entry) => entry.accountId === accountId);
    if (enabled && current?.enabled && current.deviceId !== (await this.getDeviceId())) {
      throw new Error(`This account is enabled on ${current.deviceName}. Disable it there and run Sync Now first.`);
    }
  }

  async completeAccountEnablement(accountId: string, enabled: boolean): Promise<void> {
    if (encryptedSyncRegistryOverrideEnabled) {
      void vscode.window.showWarningMessage(
        "The account changed locally under rescue override; the shared enable/disable registry was not changed."
      );
      return;
    }
    this.mutationVersion += 1;
    this.mutationChain = this.mutationChain
      .catch(() => undefined)
      .then(async () => {
        const deviceId = await this.getDeviceId();
        const enablement = new Map(this.readLocalEnablement().map((entry) => [entry.accountId, entry]));
        const current = enablement.get(accountId);
        enablement.set(
          accountId,
          createSyncAccountEnablement({
            accountId,
            deviceId,
            deviceName: resolveDeviceName(),
            enabled,
            revision: (current?.revision ?? 0) + 1,
            now: Date.now()
          })
        );
        await this.storeLocalEnablement([...enablement.values()], deviceId);
        await this.markEnablementPending([accountId]);
      });
    await this.mutationChain;
    this.queueBackgroundSync(ENABLEMENT_SYNC_CONSOLIDATION_DELAY_MS);
  }

  async setRegistryOverrideEnabled(enabled: boolean): Promise<boolean> {
    if (enabled === encryptedSyncRegistryOverrideEnabled) {
      void vscode.window.showInformationMessage(
        enabled ? "Rescue override is already enabled on this PC." : "Rescue override is already off."
      );
      return true;
    }
    if (enabled) {
      if (!this.isEnabled()) {
        void vscode.window.showErrorMessage("Enable encrypted VS Code sync before using rescue override.");
        return false;
      }
      const stored = await this.context.secrets.get(PASSPHRASE_KEY);
      if (!stored) {
        void vscode.window.showErrorMessage("Set the encrypted sync passphrase before enabling rescue override.");
        return false;
      }
      const entered = await this.promptForPassphrase("Enter the encrypted sync passphrase to enable rescue override");
      if (!entered) {
        void vscode.window.showWarningMessage(
          "Rescue override was not enabled because password verification was cancelled."
        );
        return false;
      }
      const raw = this.context.globalState.get<string>(SYNC_KEY);
      let valid = false;
      try {
        if (raw) {
          await decryptSyncPayload(raw, entered);
          valid = true;
        } else {
          const expectedHash = crypto.createHash("sha256").update(stored, "utf8").digest();
          const enteredHash = crypto.createHash("sha256").update(entered, "utf8").digest();
          valid = crypto.timingSafeEqual(expectedHash, enteredHash);
        }
      } catch {
        valid = false;
      }
      if (!valid) {
        void vscode.window.showErrorMessage(
          "Rescue override was not enabled because the encrypted sync passphrase was incorrect."
        );
        return false;
      }
    }
    await this.context.globalState.update(REGISTRY_OVERRIDE_KEY, enabled);
    encryptedSyncRegistryOverrideEnabled = enabled;
    this.onStateChanged?.();
    if (enabled) {
      void vscode.window.showWarningMessage(
        "Rescue override enabled on this PC. Foreign-PC enablement is now warning-only and the shared registry will not be changed."
      );
    } else {
      void vscode.window.showInformationMessage(
        "Rescue override disabled. The synchronized enable/disable registry is enforced again."
      );
    }
    return true;
  }

  async configure(): Promise<boolean> {
    const rawRemote = this.context.globalState.get<string>(SYNC_KEY);
    const passphrase = await this.promptForPassphrase(
      rawRemote
        ? "Enter the passphrase used by the encrypted sync vault"
        : "Create a passphrase for encrypted account sync"
    );
    if (!passphrase) {
      return false;
    }

    if (rawRemote) {
      try {
        const verified = await decryptSyncPayload(rawRemote, passphrase);
        this.lastRemoteRaw = rawRemote;
        this.lastRemotePayload = verified;
        this.lastRemotePassphraseHash = crypto.createHash("sha256").update(passphrase, "utf8").digest("base64");
      } catch {
        const choice = await vscode.window.showWarningMessage(
          "That passphrase cannot decrypt the existing synchronized vault.",
          { modal: true },
          "Try Again",
          "Replace Remote Vault"
        );
        if (choice === "Try Again") {
          return this.configure();
        }
        if (choice !== "Replace Remote Vault") {
          return false;
        }
        this.lastRemoteRaw = undefined;
        this.lastRemotePayload = undefined;
        this.lastRemotePassphraseHash = undefined;
        await this.context.globalState.update(SYNC_KEY, undefined);
      }
    } else {
      const confirmation = await this.promptForPassphrase("Confirm the encrypted sync passphrase");
      if (confirmation === undefined || confirmation !== passphrase) {
        void vscode.window.showErrorMessage("The sync passphrases did not match.");
        return false;
      }
    }

    await this.context.secrets.store(PASSPHRASE_KEY, passphrase);
    encryptedSyncNeedsConfiguration = false;
    if (!this.isEnabled()) {
      await getCodexAccountsConfiguration().update("encryptedSyncEnabled", true, vscode.ConfigurationTarget.Global);
    }
    return this.syncing ? true : this.syncNow(true);
  }

  async syncNow(interactive = true, announceSuccess = interactive, syncSettings = interactive): Promise<boolean> {
    if (this.disposed) {
      return false;
    }
    if (this.currentSyncTask) {
      return this.currentSyncTask;
    }
    const execute = async (): Promise<boolean> => {
      try {
        return await this.performSyncNow(interactive, announceSuccess, syncSettings);
      } finally {
        await this.repo.flush?.();
      }
    };
    // User-triggered sync runs immediately. Only background maintenance takes
    // the cross-window lease, so a maintenance sync cannot block a click.
    const task = interactive ? execute() : runEncryptedSyncOperation("Encrypted account sync", execute);
    this.currentSyncTask = task;
    try {
      return await task;
    } finally {
      if (this.currentSyncTask === task) this.currentSyncTask = undefined;
    }
  }

  private async performSyncNow(
    interactive: boolean,
    announceSuccess: boolean,
    syncSettings: boolean
  ): Promise<boolean> {
    if (!this.isEnabled()) {
      if (interactive) {
        void vscode.window.showWarningMessage("Enable Encrypted VS Code sync before syncing sessions.");
      }
      return false;
    }

    // A globalState update only confirms a local write. Ask VS Code's own
    // Settings Sync service to run first so a signed-out or disabled machine
    // cannot be reported as successfully synchronized.
    if (syncSettings && !(await this.ensureSettingsSyncReady(interactive))) {
      return false;
    }

    this.syncing = true;
    try {
      const passphrase = await this.getOrPromptForPassphrase(interactive);
      if (!passphrase) {
        encryptedSyncNeedsConfiguration = true;
        return false;
      }
      await this.mutationChain.catch(() => undefined);
      const mutationVersion = this.mutationVersion;
      const local = await this.buildLocalPayload();
      const rawRemote = this.context.globalState.get<string>(SYNC_KEY);
      // Settings Sync may activate the extension before it has downloaded the
      // synchronized globalState value. Never replace that not-yet-arrived
      // vault with an empty local account list on a new PC.
      if (!rawRemote && local.accounts.length === 0) {
        encryptedSyncNeedsConfiguration = false;
        if (interactive) {
          void vscode.window.showWarningMessage(
            "No synchronized account vault is available yet. Sign in to VS Code Settings Sync on both PCs, sync the source PC first, then try again."
          );
          return false;
        }
        return true;
      }
      const remote = rawRemote ? await this.readRemotePayload(rawRemote, passphrase) : undefined;
      const remoteNeedsUpgrade = rawRemote ? parseCipherEnvelope(rawRemote).compression === undefined : false;
      const candidateDeletions = mergeSyncAccountDeletions(local.deletions ?? [], remote?.deletions ?? []);
      const mergedAccounts = mergeSyncAccounts(local.accounts, remote?.accounts ?? [], candidateDeletions);
      const remoteEnablement = remote?.enablementRegistry ?? remote?.assignments ?? [];
      let mergedEnablement = mergeSyncAccountEnablement(local.enablementRegistry ?? [], remoteEnablement);
      const localAccountIds = new Set(local.accounts.map(getSyncAccountId));
      const localDeviceId = await this.getDeviceId();
      const byAccount = new Map(mergedEnablement.map((entry) => [entry.accountId, entry]));
      const initializedAt = Date.now();
      for (const account of mergedAccounts) {
        const accountId = getSyncAccountId(account);
        if (byAccount.has(accountId)) continue;
        const isLocalAccount = localAccountIds.has(accountId);
        byAccount.set(
          accountId,
          createSyncAccountEnablement({
            accountId,
            deviceId: isLocalAccount ? localDeviceId : (remote?.deviceId ?? localDeviceId),
            deviceName: isLocalAccount
              ? resolveDeviceName()
              : remote
                ? resolveLegacyRemoteDeviceName(remote, accountId)
                : resolveDeviceName(),
            enabled: isLocalAccount ? this.localEnablementDefaults.get(accountId) !== false : true,
            revision: 1,
            now: initializedAt
          })
        );
      }
      mergedEnablement = canonicalizeSyncAccountEnablement([...byAccount.values()]);
      const mergedAccountIdsAfterDeletion = new Set(mergedAccounts.map(getSyncAccountId));
      const mergedDeletions = candidateDeletions.filter(
        (deletion) => !mergedAccountIdsAfterDeletion.has(deletion.accountId)
      );
      const merged = await this.createPayload(mergedAccounts, mergedDeletions, mergedEnablement);

      if (mutationVersion !== this.mutationVersion) {
        if (interactive) {
          void vscode.window.showWarningMessage(
            "Accounts changed while encrypted sync was running. The update was queued; run Sync Sessions Now again to confirm it completed."
          );
        }
        return false;
      }

      await this.context.globalState.update(LOCAL_DELETIONS_KEY, mergedDeletions);
      await this.storeLocalEnablement(mergedEnablement, await this.getDeviceId());

      this.applyingRemote = true;
      try {
        if (syncAccountsFingerprint(local.accounts) !== syncAccountsFingerprint(mergedAccounts)) {
          await this.applyMergedAccounts(local.accounts, mergedAccounts, mergedDeletions);
        }
        await this.applyMergedEnablement(mergedEnablement);
      } finally {
        this.applyingRemote = false;
      }
      let wroteSyncVault = false;
      if (
        !remote ||
        remoteNeedsUpgrade ||
        syncAccountsFingerprint(remote.accounts) !== syncAccountsFingerprint(mergedAccounts) ||
        // Clear old heartbeat leases once. Thereafter account activity cannot
        // create synchronized writes or consume the Settings Sync request budget.
        (remote.leases?.length ?? 0) > 0 ||
        syncEnablementFingerprint(remoteEnablement) !== syncEnablementFingerprint(mergedEnablement) ||
        syncDeletionsFingerprint(remote.deletions ?? []) !== syncDeletionsFingerprint(mergedDeletions)
      ) {
        const encrypted = await encryptSyncPayload(merged, passphrase);
        await this.context.globalState.update(SYNC_KEY, encrypted);
        wroteSyncVault = true;
        this.lastRemoteRaw = encrypted;
        this.lastRemotePayload = merged;
        this.lastRemotePassphraseHash = crypto.createHash("sha256").update(passphrase, "utf8").digest("base64");
      }
      if (wroteSyncVault && syncSettings && !(await this.ensureSettingsSyncReady(interactive))) {
        return false;
      }
      await this.context.globalState.update(LOCAL_ENABLEMENT_PENDING_KEY, []);
      pendingEnablementAccountIds = new Set();
      encryptedSyncLastCompletedAt = Date.now();
      encryptedSyncLastSessionCount = mergedAccounts.length;
      encryptedSyncLastEnabledSessionCount = mergedEnablement.filter((entry) => entry.enabled).length;
      this.onStateChanged?.();
      if (announceSuccess) {
        void vscode.window.showInformationMessage(`Encrypted sync completed (${mergedAccounts.length} sessions).`);
      }
      encryptedSyncNeedsConfiguration = false;
      return true;
    } catch (error) {
      console.error("[codexAccounts] encrypted sync failed:", error);
      if (isVaultAuthenticationError(error)) {
        encryptedSyncNeedsConfiguration = true;
        // Do not keep retrying a stale secret on every activation/background sync.
        // Clearing it makes the next interactive sync go through configure(), where
        // the user can re-enter the passphrase or explicitly replace the vault.
        try {
          await this.context.secrets.delete(PASSPHRASE_KEY);
        } catch (clearError) {
          console.warn("[codexAccounts] could not clear the cached encrypted-sync passphrase:", clearError);
        }
        this.lastRemoteRaw = undefined;
        this.lastRemotePayload = undefined;
        this.lastRemotePassphraseHash = undefined;
      }
      if (interactive) {
        const detail = isVaultAuthenticationError(error)
          ? "The saved sync passphrase was rejected. Set the sync passphrase again and use the same value on both PCs."
          : error instanceof Error
            ? error.message
            : String(error);
        void vscode.window.showErrorMessage(`Encrypted account sync failed: ${detail}`);
      }
      return false;
    } finally {
      this.syncing = false;
    }
  }

  private async ensureSettingsSyncReady(showFailure = true): Promise<boolean> {
    try {
      if (!(await this.hasSettingsSyncAccount())) {
        throw new Error("No Microsoft or GitHub account is signed in to VS Code.");
      }
      await vscode.commands.executeCommand("workbench.userDataSync.actions.syncNow");
      encryptedSyncNeedsSettingsSync = false;
      return true;
    } catch (error) {
      encryptedSyncNeedsSettingsSync = true;
      const detail = error instanceof Error ? error.message : String(error);
      if (showFailure) {
        void vscode.window.showErrorMessage(
          `VS Code Settings Sync is not active on this PC. Sign in to VS Code and turn on Settings Sync, then try again. (${detail})`
        );
      }
      return false;
    }
  }

  private async hasSettingsSyncAccount(): Promise<boolean> {
    let authentication:
      | {
          getAccounts?: (providerId: string) => Thenable<readonly unknown[]>;
        }
      | undefined;
    try {
      authentication = (
        vscode as unknown as {
          authentication?: {
            getAccounts?: (providerId: string) => Thenable<readonly unknown[]>;
          };
        }
      ).authentication;
    } catch {
      // Older test/runtime shims may not expose the authentication namespace.
      return true;
    }
    if (!authentication?.getAccounts) {
      return true;
    }
    const accounts = await Promise.all(
      ["microsoft", "github"].map(async (providerId) => {
        try {
          return await authentication.getAccounts!(providerId);
        } catch {
          return [];
        }
      })
    );
    return accounts.some((providerAccounts) => providerAccounts.length > 0);
  }

  private isEnabled(): boolean {
    return getCodexAccountsConfiguration().get<boolean>("encryptedSyncEnabled", false);
  }

  private async getOrPromptForPassphrase(interactive: boolean): Promise<string | undefined> {
    const stored = await this.context.secrets.get(PASSPHRASE_KEY);
    if (stored) {
      return stored;
    }
    if (!interactive) {
      return undefined;
    }
    const configured = await this.configure();
    return configured ? this.context.secrets.get(PASSPHRASE_KEY) : undefined;
  }

  private async promptForPassphrase(prompt: string): Promise<string | undefined> {
    return vscode.window.showInputBox({
      prompt,
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) => (value.trim().length < 12 ? "Use at least 12 non-whitespace characters." : undefined)
    });
  }

  private async buildLocalPayload(): Promise<SyncPayload> {
    const records = await this.repo.listAccounts();
    this.localEnablementDefaults = new Map(records.map((account) => [account.id, account.enabled !== false]));
    const shared = await this.repo.exportSharedAccounts(records.map((account) => account.id));
    return this.createPayload(shared.map(createSyncEntry), this.readLocalDeletions(), this.readLocalEnablement());
  }

  private async createPayload(
    accounts: SyncAccountEntry[],
    deletions: SyncAccountDeletion[] = [],
    enablementRegistry: SyncAccountEnablement[] = []
  ): Promise<SyncPayload> {
    if (accounts.length > MAX_ACCOUNTS) {
      throw new Error(`The encrypted vault supports at most ${MAX_ACCOUNTS} sessions.`);
    }
    return {
      format: "codex-accounts-encrypted-sync",
      version: 1,
      updatedAt: Date.now(),
      deviceId: await this.getDeviceId(),
      accounts: canonicalizeAccounts(accounts),
      deletions: canonicalizeSyncAccountDeletions(deletions),
      enablementRegistry: canonicalizeSyncAccountEnablement(enablementRegistry).slice(-MAX_ENABLEMENT_RECORDS)
    };
  }

  private readLocalDeletions(): SyncAccountDeletion[] {
    const stored = this.context.globalState.get<unknown>(LOCAL_DELETIONS_KEY);
    if (!Array.isArray(stored)) return [];
    return canonicalizeSyncAccountDeletions(stored.filter(isValidSyncAccountDeletion));
  }

  private readLocalEnablement(): SyncAccountEnablement[] {
    const stored = this.context.globalState.get<unknown>(LOCAL_ENABLEMENT_KEY);
    const legacy = this.context.globalState.get<unknown>(LEGACY_LOCAL_ASSIGNMENTS_KEY);
    const values: unknown[] = [];
    for (const value of [stored, legacy]) {
      if (Array.isArray(value)) {
        for (const item of value as unknown[]) values.push(item);
      }
    }
    return canonicalizeSyncAccountEnablement(values.filter(isValidSyncAccountEnablement));
  }

  private async storeLocalEnablement(entries: SyncAccountEnablement[], deviceId: string): Promise<void> {
    const canonical = canonicalizeSyncAccountEnablement(entries).slice(-MAX_ENABLEMENT_RECORDS);
    await this.context.globalState.update(LOCAL_ENABLEMENT_KEY, canonical);
    this.updateVisibleEnablement(canonical, deviceId);
  }

  private async markEnablementPending(accountIds: readonly string[]): Promise<void> {
    const next = new Set(pendingEnablementAccountIds);
    for (const accountId of accountIds) {
      if (accountId.trim()) next.add(accountId);
    }
    pendingEnablementAccountIds = next;
    await this.context.globalState.update(LOCAL_ENABLEMENT_PENDING_KEY, [...next].sort());
    this.onStateChanged?.();
  }

  private async refreshEnablementFromDownloadedVault(): Promise<void> {
    const raw = this.context.globalState.get<string>(SYNC_KEY);
    if (!raw || raw === this.lastRemoteRaw) return;
    const passphrase = await this.context.secrets.get(PASSPHRASE_KEY);
    if (!passphrase) return;
    const remote = await this.readRemotePayload(raw, passphrase);
    const local = this.readLocalEnablement();
    const remoteEnablement = remote.enablementRegistry ?? remote.assignments;
    if (remoteEnablement === undefined) return;
    const merged = mergeSyncAccountEnablement(local, remoteEnablement);
    await this.storeLocalEnablement(merged, await this.getDeviceId());
    if (remoteEnablement.length > 0 || local.length > 0) {
      await this.applyMergedEnablement(merged);
    }
  }

  private async applyMergedEnablement(entries: SyncAccountEnablement[]): Promise<void> {
    if (encryptedSyncRegistryOverrideEnabled) return;
    const deviceId = await this.getDeviceId();
    const byAccount = new Map(entries.map((entry) => [entry.accountId, entry]));
    const accounts = await this.repo.listAccounts();
    for (const account of accounts) {
      const entry = byAccount.get(account.id);
      if (!entry) continue;
      const enabledHere = Boolean(entry.enabled && entry.deviceId === deviceId);
      if ((account.enabled !== false) !== enabledHere) {
        await this.repo.setAccountEnabledFromSync(account.id, enabledHere);
      }
    }
  }

  private findForeignEnablement(accountId: string): SyncAccountEnablement | undefined {
    if (!this.isEnabled()) return undefined;
    return visibleAccountEnablement.find(
      (entry) => entry.accountId === accountId && entry.enabled && entry.deviceId !== visibleEnablementDeviceId
    );
  }

  private updateVisibleEnablement(entries: SyncAccountEnablement[], deviceId: string): void {
    const before = visibleEnablementFingerprint(visibleAccountEnablement, visibleEnablementDeviceId);
    visibleAccountEnablement = canonicalizeSyncAccountEnablement(entries);
    visibleEnablementDeviceId = deviceId;
    if (before !== visibleEnablementFingerprint(visibleAccountEnablement, visibleEnablementDeviceId)) {
      this.onStateChanged?.();
    }
  }

  private clearVisibleEnablement(): void {
    const changed = visibleAccountEnablement.length > 0;
    visibleAccountEnablement = [];
    visibleEnablementDeviceId = undefined;
    if (changed) this.onStateChanged?.();
  }

  private async getDeviceId(): Promise<string> {
    const existing = await this.context.secrets.get(DEVICE_KEY);
    if (existing) {
      return existing;
    }
    const created = crypto.randomUUID();
    await this.context.secrets.store(DEVICE_KEY, created);
    return created;
  }

  private async readRemotePayload(raw: string, passphrase: string): Promise<SyncPayload> {
    const passphraseHash = crypto.createHash("sha256").update(passphrase, "utf8").digest("base64");
    if (raw === this.lastRemoteRaw && passphraseHash === this.lastRemotePassphraseHash && this.lastRemotePayload) {
      return this.lastRemotePayload;
    }
    const payload = await decryptSyncPayload(raw, passphrase);
    this.lastRemoteRaw = raw;
    this.lastRemotePayload = payload;
    this.lastRemotePassphraseHash = passphraseHash;
    return payload;
  }

  private async applyMergedAccounts(
    local: SyncAccountEntry[],
    merged: SyncAccountEntry[],
    deletions: SyncAccountDeletion[]
  ): Promise<void> {
    const localById = new Map(local.map((entry) => [getSyncAccountId(entry), entry]));
    const mergedIds = new Set(merged.map(getSyncAccountId));
    const deletedIds = new Set(deletions.map((entry) => entry.accountId));
    for (const accountId of localById.keys()) {
      if (deletedIds.has(accountId) && !mergedIds.has(accountId)) await this.repo.removeAccount(accountId);
    }
    const changed = merged.filter((entry) => {
      const current = localById.get(getSyncAccountId(entry));
      return !current || syncEntryFingerprint(current) !== syncEntryFingerprint(entry);
    });
    if (!changed.length) {
      return;
    }
    const result = await this.repo.importSharedAccountsWithSummary(changed);
    if (result.failedCount > 0) {
      throw new Error(`Could not import ${result.failedCount} synchronized session(s).`);
    }
    for (const entry of changed) {
      const current = localById.get(getSyncAccountId(entry));
      if (!current || credentialFingerprint(current) !== credentialFingerprint(entry)) {
        clearTokenAutomationError(getSyncAccountId(entry));
      }
    }
  }
}

export function doesEncryptedSyncNeedConfiguration(): boolean {
  return encryptedSyncNeedsConfiguration;
}

export function doesEncryptedSyncNeedSettingsSync(): boolean {
  return encryptedSyncNeedsSettingsSync;
}

export function isEncryptedSyncRegistryOverrideEnabled(): boolean {
  return encryptedSyncRegistryOverrideEnabled;
}

export function getPendingEnablementAccountIds(): string[] {
  return [...pendingEnablementAccountIds];
}

export function getEncryptedSyncStatus(): {
  lastCompletedAt?: number;
  sessionCount?: number;
  enabledSessionCount?: number;
} {
  return {
    lastCompletedAt: encryptedSyncLastCompletedAt,
    sessionCount: encryptedSyncLastSessionCount,
    enabledSessionCount: encryptedSyncLastEnabledSessionCount
  };
}

export function getSyncedAccountLeases(now = Date.now()): SyncedAccountLeaseView[] {
  void now;
  if (!getCodexAccountsConfiguration().get<boolean>("encryptedSyncEnabled", false)) return [];
  return visibleAccountEnablement
    .filter((entry) => entry.enabled)
    .map((entry) => ({
      accountId: entry.accountId,
      deviceId: entry.deviceId,
      deviceName: entry.deviceName,
      updatedAt: entry.updatedAt,
      expiresAt: Number.MAX_SAFE_INTEGER,
      isCurrentDevice: entry.deviceId === visibleEnablementDeviceId
    }));
}

export function createSyncEntry(entry: SharedCodexAccountJson): SyncAccountEntry {
  return {
    id: entry.id,
    email: entry.email,
    user_id: entry.user_id,
    account_id: entry.account_id,
    organization_id: entry.organization_id,
    added_at: entry.added_at,
    tokens: entry.tokens ? { ...entry.tokens } : undefined,
    created_at: entry.created_at,
    token_refresh_enabled: entry.token_refresh_enabled
  };
}

export function mergeSyncAccounts(
  local: SyncAccountEntry[],
  remote: SyncAccountEntry[],
  deletions: readonly SyncAccountDeletion[] = []
): SyncAccountEntry[] {
  const merged = new Map<string, SyncAccountEntry>();
  for (const candidate of [...local, ...remote]) {
    const id = getSyncAccountId(candidate);
    if (!id) {
      continue;
    }
    const current = merged.get(id);
    if (!current) {
      merged.set(id, candidate);
      continue;
    }
    const preferred = compareEntryFreshness(candidate, current) > 0 ? candidate : current;
    merged.set(id, preferred);
  }
  const deletionByAccountId = new Map(deletions.map((entry) => [entry.accountId, entry]));
  return canonicalizeAccounts(
    [...merged.values()].filter((entry) => {
      const deletion = deletionByAccountId.get(getSyncAccountId(entry));
      return !deletion || getAccountCreationTime(entry) > deletion.deletedAt;
    })
  );
}

export function mergeSyncAccountDeletions(
  local: readonly SyncAccountDeletion[],
  remote: readonly SyncAccountDeletion[]
): SyncAccountDeletion[] {
  const merged = new Map<string, SyncAccountDeletion>();
  for (const candidate of [...local, ...remote]) {
    if (!isValidSyncAccountDeletion(candidate)) continue;
    const current = merged.get(candidate.accountId);
    if (!current || candidate.deletedAt > current.deletedAt) merged.set(candidate.accountId, candidate);
  }
  return canonicalizeSyncAccountDeletions([...merged.values()]);
}

export async function encryptSyncPayload(payload: SyncPayload, passphrase: string): Promise<string> {
  validateSyncPayload(payload);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  if (plaintext.byteLength > MAX_PLAINTEXT_BYTES) {
    throw new Error("The encrypted session vault is too large to synchronize.");
  }
  const compressed = zlib.gzipSync(plaintext, { level: 9 });
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = await deriveKey(passphrase, salt);
  const header = {
    format: "codex-accounts-encrypted-sync" as const,
    version: 1 as const,
    updatedAt: payload.updatedAt,
    deviceId: payload.deviceId,
    compression: "gzip" as const
  };
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(JSON.stringify(header), "utf8"));
  const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const envelope: CipherEnvelope = {
    ...header,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64")
  };
  const serialized = JSON.stringify(envelope);
  if (Buffer.byteLength(serialized, "utf8") > MAX_ENVELOPE_BYTES) {
    throw new Error("The encrypted session vault exceeds the safe Settings Sync size limit.");
  }
  return serialized;
}

export async function decryptSyncPayload(raw: string, passphrase: string): Promise<SyncPayload> {
  if (Buffer.byteLength(raw, "utf8") > MAX_ENVELOPE_BYTES) {
    throw new Error("The synchronized vault is too large.");
  }
  const envelope = parseCipherEnvelope(raw);
  const salt = decodeBase64(envelope.salt, 16, "salt");
  const iv = decodeBase64(envelope.iv, 12, "initialization vector");
  const tag = decodeBase64(envelope.tag, 16, "authentication tag");
  const ciphertext = decodeBase64(envelope.ciphertext, undefined, "ciphertext");
  const key = await deriveKey(passphrase, salt);
  const header = createAuthenticatedHeader(envelope);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(JSON.stringify(header), "utf8"));
  decipher.setAuthTag(tag);
  let compressed: Buffer;
  try {
    compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error(VAULT_AUTHENTICATION_ERROR);
  }
  const plaintext = zlib.gunzipSync(compressed, { maxOutputLength: MAX_PLAINTEXT_BYTES });
  const payload = JSON.parse(plaintext.toString("utf8")) as unknown;
  validateSyncPayload(payload);
  return {
    ...payload,
    accounts: payload.accounts.map(createSyncEntry),
    leases: payload.leases ? canonicalizeSyncAccountLeases(payload.leases) : undefined,
    deletions: payload.deletions ? canonicalizeSyncAccountDeletions(payload.deletions) : undefined,
    enablementRegistry: payload.enablementRegistry
      ? canonicalizeSyncAccountEnablement(payload.enablementRegistry)
      : undefined,
    assignments: payload.assignments ? canonicalizeSyncAccountEnablement(payload.assignments) : undefined
  };
}

function isVaultAuthenticationError(error: unknown): boolean {
  return error instanceof Error && error.message === VAULT_AUTHENTICATION_ERROR;
}

export function syncAccountsFingerprint(accounts: SyncAccountEntry[]): string {
  return JSON.stringify(canonicalizeAccounts(accounts).map(toSemanticEntry));
}

export function syncLeasesFingerprint(leases: readonly SyncAccountLease[]): string {
  return JSON.stringify(canonicalizeSyncAccountLeases(leases));
}

export function syncDeletionsFingerprint(deletions: readonly SyncAccountDeletion[]): string {
  return JSON.stringify(canonicalizeSyncAccountDeletions(deletions));
}

export function syncEnablementFingerprint(entries: readonly SyncAccountEnablement[]): string {
  return JSON.stringify(canonicalizeSyncAccountEnablement(entries));
}

function syncEntryFingerprint(entry: SyncAccountEntry): string {
  return JSON.stringify(toSemanticEntry(entry));
}

function credentialFingerprint(entry: SyncAccountEntry): string {
  return JSON.stringify({
    idToken: entry.tokens?.id_token ?? "",
    accessToken: entry.tokens?.access_token ?? "",
    refreshToken: entry.tokens?.refresh_token ?? "",
    accountId: entry.tokens?.account_id ?? entry.account_id ?? ""
  });
}

function toSemanticEntry(entry: SyncAccountEntry): Omit<SyncAccountEntry, "last_used"> {
  const { last_used: _lastUsed, ...semantic } = entry;
  return semantic;
}

function canonicalizeAccounts(accounts: SyncAccountEntry[]): SyncAccountEntry[] {
  return [...accounts]
    .map((entry) => ({ ...entry, tags: entry.tags ? [...entry.tags].sort((a, b) => a.localeCompare(b)) : entry.tags }))
    .sort((left, right) => getSyncAccountId(left).localeCompare(getSyncAccountId(right)));
}

function canonicalizeSyncAccountDeletions(deletions: readonly SyncAccountDeletion[]): SyncAccountDeletion[] {
  return [...deletions]
    .filter(isValidSyncAccountDeletion)
    .sort((left, right) => right.deletedAt - left.deletedAt || left.accountId.localeCompare(right.accountId))
    .slice(0, MAX_DELETIONS)
    .sort((left, right) => left.accountId.localeCompare(right.accountId));
}

function isValidSyncAccountDeletion(value: unknown): value is SyncAccountDeletion {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<SyncAccountDeletion>;
  return (
    isBoundedString(candidate.accountId, MAX_METADATA_LENGTH, true) &&
    typeof candidate.deletedAt === "number" &&
    Number.isFinite(candidate.deletedAt) &&
    candidate.deletedAt > 0 &&
    isBoundedString(candidate.deviceId, MAX_METADATA_LENGTH, true)
  );
}

function getAccountCreationTime(entry: SyncAccountEntry): number {
  return Math.max(normalizeSyncTimestamp(entry.added_at), normalizeSyncTimestamp(entry.created_at));
}

function normalizeSyncTimestamp(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  return value < 1_000_000_000_000 ? value * 1000 : value;
}

function compareEntryFreshness(left: SyncAccountEntry, right: SyncAccountEntry): number {
  const tokenDelta = getTokenExpiry(left) - getTokenExpiry(right);
  if (tokenDelta !== 0) {
    return tokenDelta;
  }
  const updatedDelta = Number(left.last_used ?? 0) - Number(right.last_used ?? 0);
  if (updatedDelta !== 0) {
    return updatedDelta;
  }
  return syncEntryFingerprint(left).localeCompare(syncEntryFingerprint(right));
}

function getTokenExpiry(entry: SyncAccountEntry): number {
  return Math.max(readJwtExpiry(entry.tokens?.access_token), readJwtExpiry(entry.tokens?.id_token));
}

function readJwtExpiry(token: string | undefined): number {
  if (!token) {
    return 0;
  }
  try {
    const encoded = token.split(".")[1];
    if (!encoded) {
      return 0;
    }
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as { exp?: unknown };
    return typeof payload.exp === "number" && Number.isFinite(payload.exp) ? payload.exp : 0;
  } catch {
    return 0;
  }
}

function getSyncAccountId(entry: SyncAccountEntry): string {
  const candidates = [
    entry.id,
    entry.account_id,
    typeof entry.email === "string" ? entry.email.toLowerCase() : undefined
  ];
  return candidates.find((value) => typeof value === "string" && value.trim().length > 0)?.trim() ?? "";
}

function validateSyncPayload(value: unknown): asserts value is SyncPayload {
  if (!value || typeof value !== "object") {
    throw new Error("The synchronized vault payload is invalid.");
  }
  const payload = value as Partial<SyncPayload>;
  if (
    payload.format !== "codex-accounts-encrypted-sync" ||
    payload.version !== 1 ||
    typeof payload.updatedAt !== "number" ||
    !Number.isFinite(payload.updatedAt) ||
    typeof payload.deviceId !== "string" ||
    !payload.deviceId ||
    !Array.isArray(payload.accounts) ||
    payload.accounts.length > MAX_ACCOUNTS ||
    (payload.leases !== undefined && (!Array.isArray(payload.leases) || payload.leases.length > MAX_LEASES)) ||
    (payload.deletions !== undefined &&
      (!Array.isArray(payload.deletions) || payload.deletions.length > MAX_DELETIONS)) ||
    (payload.enablementRegistry !== undefined &&
      (!Array.isArray(payload.enablementRegistry) || payload.enablementRegistry.length > MAX_ENABLEMENT_RECORDS)) ||
    (payload.assignments !== undefined &&
      (!Array.isArray(payload.assignments) || payload.assignments.length > MAX_ENABLEMENT_RECORDS))
  ) {
    throw new Error("The synchronized vault payload is invalid or unsupported.");
  }
  for (const entry of payload.accounts) {
    validateSyncAccountEntry(entry);
  }
  for (const lease of payload.leases ?? []) {
    if (!isValidSyncAccountLease(lease)) {
      throw new Error("The synchronized vault contains an invalid device lease.");
    }
  }
  for (const deletion of payload.deletions ?? []) {
    if (!isValidSyncAccountDeletion(deletion)) {
      throw new Error("The synchronized vault contains an invalid account deletion.");
    }
  }
  for (const entry of [...(payload.enablementRegistry ?? []), ...(payload.assignments ?? [])]) {
    if (!isValidSyncAccountEnablement(entry)) {
      throw new Error("The synchronized vault contains an invalid account enablement record.");
    }
  }
}

function validateSyncAccountEntry(value: unknown): asserts value is SyncAccountEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The synchronized vault contains an invalid account session.");
  }
  const entry = value as SyncAccountEntry;
  const tokens = entry.tokens;
  const metadataValues = [entry.id, entry.email, entry.user_id, entry.account_id, entry.organization_id];
  const timestamps = [entry.added_at, entry.created_at, entry.last_used];
  if (
    !getSyncAccountId(entry) ||
    metadataValues.some((item) => item !== undefined && item !== null && !isBoundedString(item, MAX_METADATA_LENGTH)) ||
    timestamps.some(
      (item) => item !== undefined && item !== null && (typeof item !== "number" || !Number.isFinite(item))
    ) ||
    !tokens ||
    (entry.queue_priority !== undefined && typeof entry.queue_priority !== "boolean") ||
    (entry.token_refresh_enabled !== undefined && typeof entry.token_refresh_enabled !== "boolean") ||
    typeof tokens !== "object" ||
    !isBoundedString(tokens.id_token, MAX_TOKEN_LENGTH, true) ||
    !isBoundedString(tokens.access_token, MAX_TOKEN_LENGTH, true) ||
    (tokens.refresh_token !== undefined && !isBoundedString(tokens.refresh_token, MAX_TOKEN_LENGTH)) ||
    (tokens.account_id !== undefined &&
      tokens.account_id !== null &&
      !isBoundedString(tokens.account_id, MAX_METADATA_LENGTH))
  ) {
    throw new Error("The synchronized vault contains an invalid account session.");
  }
}

function isBoundedString(value: unknown, maxLength: number, requireNonEmpty = false): value is string {
  return typeof value === "string" && value.length <= maxLength && (!requireNonEmpty || value.trim().length > 0);
}

function parseCipherEnvelope(raw: string): ParsedCipherEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("The synchronized vault envelope is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("The synchronized vault envelope is invalid.");
  }
  const envelope = parsed as Partial<ParsedCipherEnvelope>;
  if (
    envelope.format !== "codex-accounts-encrypted-sync" ||
    envelope.version !== 1 ||
    (envelope.compression !== undefined && envelope.compression !== "gzip") ||
    typeof envelope.updatedAt !== "number" ||
    !Number.isFinite(envelope.updatedAt) ||
    typeof envelope.deviceId !== "string" ||
    !envelope.deviceId ||
    typeof envelope.salt !== "string" ||
    typeof envelope.iv !== "string" ||
    typeof envelope.tag !== "string" ||
    typeof envelope.ciphertext !== "string"
  ) {
    throw new Error("The synchronized vault envelope is invalid or unsupported.");
  }
  return envelope as ParsedCipherEnvelope;
}

function createAuthenticatedHeader(envelope: ParsedCipherEnvelope): {
  format: "codex-accounts-encrypted-sync";
  version: 1;
  updatedAt: number;
  deviceId: string;
  compression?: "gzip";
} {
  const header = {
    format: envelope.format,
    version: envelope.version,
    updatedAt: envelope.updatedAt,
    deviceId: envelope.deviceId
  };
  return envelope.compression === undefined ? header : { ...header, compression: envelope.compression };
}

function decodeBase64(value: string, expectedLength: number | undefined, label: string): Buffer {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new Error(`The vault ${label} is invalid.`);
  }
  const decoded = Buffer.from(value, "base64");
  if (expectedLength !== undefined && decoded.byteLength !== expectedLength) {
    throw new Error(`The vault ${label} is invalid.`);
  }
  return decoded;
}

function deriveKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(passphrase, salt, 32, { N: SCRYPT_COST, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (error, key) => {
      if (error) {
        reject(error);
      } else {
        resolve(key);
      }
    });
  });
}

function visibleEnablementFingerprint(entries: readonly SyncAccountEnablement[], deviceId?: string): string {
  return JSON.stringify(
    canonicalizeSyncAccountEnablement(entries).map((entry) => [
      entry.accountId,
      entry.deviceId,
      entry.deviceName,
      entry.enabled,
      entry.revision,
      entry.deviceId === deviceId
    ])
  );
}

function resolveLegacyRemoteDeviceName(payload: SyncPayload, accountId: string): string {
  return payload.leases?.find((lease) => lease.accountId === accountId)?.deviceName ?? "Synced PC";
}

function resolveDeviceName(): string {
  const hostname = os.hostname().trim();
  return hostname || "Unknown PC";
}
