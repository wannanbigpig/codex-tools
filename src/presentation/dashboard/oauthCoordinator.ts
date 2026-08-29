import * as vscode from "vscode";
import {
  completeOAuthLoginSession,
  prepareOAuthLoginSession,
  PreparedOAuthLoginSession,
  runPreparedOAuthLoginSession
} from "../../auth/oauth";
import { refreshImportedAccountQuota } from "../../application/accounts/quota";
import {
  activateQueuedAccountIfCurrentMissing,
  type QueuedAccountActivationResult
} from "../../application/accounts/queuedAccountActivation";
import type { AccountsRepository } from "../../storage";
import type { DashboardHostMessage, DashboardNotice } from "../../domain/dashboard/types";
import type { TranslationKey, TranslationParams } from "../../utils/i18n";
import { buildAccountStorageId } from "../../utils/accountIdentity";
import { extractClaims } from "../../utils/jwt";

export class DashboardOAuthCoordinator {
  private static readonly SESSION_TTL_MS = 15 * 60 * 1000;
  private readonly oauthSessions = new Map<string, PreparedOAuthLoginSession>();
  private readonly oauthSessionCreatedAt = new Map<string, number>();
  private readonly oauthSessionAccountIds = new Map<string, string | undefined>();
  private readonly oauthCancellationSources = new Map<string, vscode.CancellationTokenSource>();

  constructor(
    private readonly repo: AccountsRepository,
    private readonly schedulePublishState: () => void,
    private readonly syncAccountChange?: () => Promise<boolean | undefined>
  ) {}

  dispose(): void {
    this.oauthCancellationSources.forEach((source) => {
      source.cancel();
      source.dispose();
    });
    this.oauthCancellationSources.clear();
    this.oauthSessions.clear();
    this.oauthSessionCreatedAt.clear();
    this.oauthSessionAccountIds.clear();
  }

  prepareSession(
    translate: (key: TranslationKey, values?: TranslationParams) => string,
    accountId?: string
  ): Extract<DashboardHostMessage, { type: "dashboard:action-result" }>["payload"] {
    try {
      const prepared = prepareOAuthLoginSession();
      const sessionId = `oauth-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      this.oauthSessions.set(sessionId, prepared);
      this.oauthSessionCreatedAt.set(sessionId, Date.now());
      this.oauthSessionAccountIds.set(sessionId, accountId);
      return {
        oauthSession: {
          sessionId,
          authUrl: prepared.authUrl,
          redirectUri: prepared.redirectUri
        }
      };
    } catch (error) {
      const message = translate("message.oauthPrepareFailed", {
        message: error instanceof Error ? error.message : String(error)
      });
      void vscode.window.showErrorMessage(message);
      throw new Error(message);
    }
  }

  cancelSession(oauthSessionId: string | undefined): void {
    if (!oauthSessionId) {
      return;
    }

    const source = this.oauthCancellationSources.get(oauthSessionId);
    if (source) {
      source.cancel();
      source.dispose();
      this.oauthCancellationSources.delete(oauthSessionId);
    }
    this.oauthSessions.delete(oauthSessionId);
    this.oauthSessionCreatedAt.delete(oauthSessionId);
    this.oauthSessionAccountIds.delete(oauthSessionId);
  }

  async startAutoFlow(
    oauthSessionId: string | undefined,
    translate: (key: TranslationKey, values?: TranslationParams) => string
  ): Promise<Extract<DashboardHostMessage, { type: "dashboard:action-result" }>["payload"] | undefined> {
    if (!oauthSessionId) {
      const message = translate("message.oauthPrepareFailed", {
        message: "Missing OAuth session"
      });
      void vscode.window.showErrorMessage(message);
      throw new Error(message);
    }

    const session = this.oauthSessions.get(oauthSessionId);
    if (!session || this.isSessionExpired(oauthSessionId)) {
      this.cancelSession(oauthSessionId);
      const message = translate("message.oauthPrepareFailed", {
        message: "OAuth session expired"
      });
      void vscode.window.showErrorMessage(message);
      throw new Error(message);
    }

    try {
      const source = new vscode.CancellationTokenSource();
      this.oauthCancellationSources.set(oauthSessionId, source);
      const tokens = await runPreparedOAuthLoginSession(session, source.token);
      const created = await this.upsertAuthorizedAccount(oauthSessionId, tokens);
      await refreshImportedAccountQuota(this.repo, created.id);
      let synced: boolean | undefined;
      if (this.syncAccountChange) {
        synced = await this.syncAccountChange();
      }
      const queuedActivation = await activateQueuedAccountIfCurrentMissing(this.repo);
      this.cancelSession(oauthSessionId);
      this.schedulePublishState();
      const completion = resolveOAuthCompletion(
        translate("message.oauthCompleted", { email: created.email }),
        queuedActivation,
        synced
      );
      showOAuthCompletion(completion);
      return {
        email: created.email,
        ...(completion.level === "warning" ? { notice: completion } : {})
      };
    } catch (error) {
      const cancelled = error instanceof Error && error.message === "OAuth login cancelled by user.";
      this.oauthCancellationSources.get(oauthSessionId)?.dispose();
      this.oauthCancellationSources.delete(oauthSessionId);
      if (cancelled) {
        this.oauthSessions.delete(oauthSessionId);
        this.oauthSessionAccountIds.delete(oauthSessionId);
        return undefined;
      }
      const message = translate("message.oauthCallbackFailed", {
        message: error instanceof Error ? error.message : String(error)
      });
      void vscode.window.showErrorMessage(message);
      throw new Error(message);
    }
  }

  async completeSession(
    oauthSessionId: string | undefined,
    callbackUrl: string | undefined,
    translate: (key: TranslationKey, values?: TranslationParams) => string
  ): Promise<Extract<DashboardHostMessage, { type: "dashboard:action-result" }>["payload"]> {
    if (!oauthSessionId || !callbackUrl?.trim()) {
      const message = translate("message.oauthCallbackFailed", {
        message: "Missing OAuth session or callback URL"
      });
      void vscode.window.showErrorMessage(message);
      throw new Error(message);
    }

    const session = this.oauthSessions.get(oauthSessionId);
    if (!session || this.isSessionExpired(oauthSessionId)) {
      this.cancelSession(oauthSessionId);
      const message = translate("message.oauthPrepareFailed", {
        message: "OAuth session expired"
      });
      void vscode.window.showErrorMessage(message);
      throw new Error(message);
    }

    try {
      const tokens = await completeOAuthLoginSession(session, callbackUrl.trim());
      const created = await this.upsertAuthorizedAccount(oauthSessionId, tokens);
      // Reauthorization must validate the new credentials and clear any stale
      // auth error before publishing the dashboard state. Keep the account
      // visible even when quota is temporarily unavailable.
      await refreshImportedAccountQuota(this.repo, created.id);
      let synced: boolean | undefined;
      if (this.syncAccountChange) {
        synced = await this.syncAccountChange();
      }
      const queuedActivation = await activateQueuedAccountIfCurrentMissing(this.repo);
      this.oauthCancellationSources.get(oauthSessionId)?.dispose();
      this.oauthCancellationSources.delete(oauthSessionId);
      this.oauthSessions.delete(oauthSessionId);
      this.oauthSessionCreatedAt.delete(oauthSessionId);
      this.oauthSessionAccountIds.delete(oauthSessionId);
      this.schedulePublishState();
      const completion = resolveOAuthCompletion(
        translate("message.oauthCompleted", { email: created.email }),
        queuedActivation,
        synced
      );
      showOAuthCompletion(completion);
      return {
        email: created.email,
        ...(completion.level === "warning" ? { notice: completion } : {})
      };
    } catch (error) {
      const message = translate("message.oauthCallbackFailed", {
        message: error instanceof Error ? error.message : String(error)
      });
      void vscode.window.showErrorMessage(message);
      throw new Error(message);
    }
  }

  private async upsertAuthorizedAccount(
    sessionId: string,
    tokens: Parameters<AccountsRepository["upsertFromTokens"]>[0]
  ) {
    const expectedAccountId = this.oauthSessionAccountIds.get(sessionId);
    if (expectedAccountId) {
      const claims = extractClaims(tokens.idToken, tokens.accessToken);
      const authorizedAccountId = claims.email
        ? buildAccountStorageId(claims.email, claims.accountId, claims.organizationId)
        : undefined;
      if (authorizedAccountId !== expectedAccountId) {
        throw new Error("The authorized account does not match the account selected for reauthorization.");
      }

      const existing = await this.repo.getAccount(expectedAccountId);
      if (!existing) {
        throw new Error("The account selected for reauthorization no longer exists.");
      }

      // Update the existing record instead of replacing it. updateTokens clears
      // stale auth errors, preserves tags/quota metadata, and mirrors auth.json
      // when the reauthorized account is active.
      return this.repo.updateTokens(expectedAccountId, {
        ...tokens,
        accountId: tokens.accountId ?? existing.accountId
      });
    }
    const created = await this.repo.upsertFromTokens(tokens, false);
    return created;
  }

  private isSessionExpired(sessionId: string): boolean {
    const createdAt = this.oauthSessionCreatedAt.get(sessionId);
    return !createdAt || Date.now() - createdAt > DashboardOAuthCoordinator.SESSION_TTL_MS;
  }
}

function resolveOAuthCompletion(
  baseMessage: string,
  result: QueuedAccountActivationResult,
  synced?: boolean
): DashboardNotice {
  const syncSuffix = synced === false
    ? " Encrypted sync could not be completed; run Sync Now to share the new credentials."
    : "";
  if (result.status === "activated") {
    return {
      level: synced === false ? "warning" : "info",
      message: `${baseMessage}. Activated queued account ${result.account.email} because no current account was available.${syncSuffix}`
    };
  }
  if (result.status === "failed") {
    return {
      level: "warning",
      message: `${baseMessage}. The account was added, but queued-account activation failed: ${result.message}${syncSuffix}`
    };
  }
  if (synced === false) {
    return { level: "warning", message: `${baseMessage}.${syncSuffix}` };
  }
  return { level: "info", message: baseMessage };
}

function showOAuthCompletion(notice: DashboardNotice): void {
  if (notice.level === "warning") {
    void vscode.window.showWarningMessage(notice.message);
  }
}
