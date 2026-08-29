import * as vscode from "vscode";
import { needsTokenRefresh, refreshTokens } from "../../auth/oauth";
import {
  getAutoRefreshCurrentMinutes,
  getAutoRefreshMinutes,
  isBackgroundTokenRefreshEnabled
} from "../../infrastructure/config/extensionSettings";
import {
  maybeAutoSwitchForActiveQuota,
  maybeWarnForActiveQuota,
  refreshSingleQuotaSafely
} from "../../application/accounts/quota";
import type { AccountsRepository } from "../../storage";
import { shouldRunAccountScheduler } from "./refreshSignature";
import {
  clearTokenAutomationError,
  configureTokenAutomation,
  markTokenAutomationCheck,
  markTokenAutomationRefreshFailure,
  markTokenAutomationRefreshSuccess,
  markTokenAutomationSweepFinished,
  markTokenAutomationSweepStarted
} from "./tokenAutomationState";
import {
  CrossWindowOperationBusyError,
  runCrossWindowExclusive
} from "../../utils/crossWindowOperations";

const CURRENT_REFRESH_FAILURE_BACKOFF_MULTIPLIER = 5;

export function registerAutoRefreshScheduler(params: {
  context: vscode.ExtensionContext;
  repo: AccountsRepository;
  onRefresh: () => void;
  canRefreshAccount?: (accountId: string) => boolean;
}): vscode.Disposable {
  let allTimer: NodeJS.Timeout | undefined;
  let currentTimer: NodeJS.Timeout | undefined;
  let allInFlight = false;
  let currentInFlight = false;
  let currentScheduleVersion = 0;

  const applySchedule = (): void => {
    const scheduleVersion = ++currentScheduleVersion;
    if (allTimer) {
      clearInterval(allTimer);
      allTimer = undefined;
    }
    if (currentTimer) {
      clearTimeout(currentTimer);
      currentTimer = undefined;
    }

    const runAllRefresh = (): void => {
      if (allInFlight) return;
      allInFlight = true;
      const excludeCurrent = getAutoRefreshCurrentMinutes() > 0;
      void vscode.commands
        .executeCommand("codexAccounts.refreshAllQuotas", {
          silent: true,
          forceRefresh: true,
          excludeCurrent
        })
        .then(
          () => {
            allInFlight = false;
          },
          () => {
            allInFlight = false;
          }
        );
    };

    const scheduleCurrentRefresh = (delayMs: number): void => {
      if (scheduleVersion !== currentScheduleVersion) return;
      currentTimer = setTimeout(() => {
        currentTimer = undefined;
        runCurrentRefresh();
      }, delayMs);
    };

    const runCurrentRefresh = (knownCurrent?: { id: string }): void => {
      if (currentInFlight) {
        scheduleCurrentRefresh(getAutoRefreshCurrentMinutes() * 60 * 1000);
        return;
      }
      currentInFlight = true;
      const refreshCurrent = async (current: { id: string }): Promise<void> => {
        let failed = false;
        try {
          await runCrossWindowExclusive(`background:quota-refresh:${current.id}`, "Quota refresh", async () => {
            if (params.canRefreshAccount && !params.canRefreshAccount(current.id)) {
              return;
            }
            const refreshed = await refreshSingleQuotaSafely(params.repo, { refresh: params.onRefresh }, current.id, {
              forceRefresh: true,
              allowTokenRefresh: isBackgroundTokenRefreshEnabled(),
              skipDisabled: true,
              // Timed refreshes are background maintenance. Keep failures in the
              // automation state/logs without interrupting the user's workspace
              // with a notification toast. Manual refreshes still announce errors.
              announceFailure: false
            });
            if (!refreshed) {
              failed = true;
              return;
            }
            await maybeAutoSwitchForActiveQuota(params.repo, { refresh: params.onRefresh });
            await maybeWarnForActiveQuota(params.repo);
            params.onRefresh();
          });
        } catch (error) {
          if (error instanceof CrossWindowOperationBusyError) {
            return;
          }
          failed = true;
          console.warn("[codexAccounts] current-account auto refresh or auto switch failed:", error);
        } finally {
          currentInFlight = false;
          if (scheduleVersion === currentScheduleVersion) {
            const baseDelayMs = getAutoRefreshCurrentMinutes() * 60 * 1000;
            const delayMs = failed ? baseDelayMs * CURRENT_REFRESH_FAILURE_BACKOFF_MULTIPLIER : baseDelayMs;
            scheduleCurrentRefresh(delayMs);
          }
        }
      };
      if (knownCurrent) {
        void refreshCurrent(knownCurrent);
        return;
      }
      void params.repo
        .listAccounts()
        .then((accounts) => {
          const current = accounts.find((account) => account.isActive && account.enabled !== false);
          if (current) void refreshCurrent(current);
          else {
            currentInFlight = false;
            scheduleCurrentRefresh(getAutoRefreshCurrentMinutes() * 60 * 1000);
          }
        })
        .catch(() => {
          currentInFlight = false;
          scheduleCurrentRefresh(getAutoRefreshCurrentMinutes() * 60 * 1000);
        });
    };

    const allMinutes = getAutoRefreshMinutes();
    if (allMinutes > 0) {
      allTimer = setInterval(runAllRefresh, allMinutes * 60 * 1000);
      runAllRefresh();
    }

    const currentMinutes = getAutoRefreshCurrentMinutes();
    if (currentMinutes > 0) {
      void params.repo
        .listAccounts()
        .then((accounts) => {
          const current = accounts.find((account) => account.isActive && account.enabled !== false);
          if (current) runCurrentRefresh(current);
          else scheduleCurrentRefresh(currentMinutes * 60 * 1000);
        })
        .catch(() => {
          scheduleCurrentRefresh(currentMinutes * 60 * 1000);
        });
    }
  };

  applySchedule();

  const configDisposable = vscode.workspace.onDidChangeConfiguration((event) => {
    if (
      event.affectsConfiguration("codexAccounts.autoRefreshMinutes") ||
      event.affectsConfiguration("codexAccounts.autoRefreshCurrentMinutes")
    ) {
      applySchedule();
    }
  });

  params.context.subscriptions.push(configDisposable);
  return {
    dispose(): void {
      configDisposable.dispose();
      if (allTimer) clearInterval(allTimer);
      currentScheduleVersion += 1;
      if (currentTimer) clearTimeout(currentTimer);
    }
  };
}

export function registerTokenRefreshScheduler(params: {
  context: vscode.ExtensionContext;
  repo: AccountsRepository;
  view: { refresh(): void };
  checkIntervalMs: number;
  skewSeconds: number;
  canRefreshAccount?: (accountId: string) => boolean;
}): vscode.Disposable {
  let timer: NodeJS.Timeout | undefined;
  let inFlight = false;

  const runTokenRefreshSweep = async (): Promise<void> => {
    if (inFlight) {
      return;
    }

    inFlight = true;
    let lastFailureMessage: string | undefined;
    let checked = 0;
    let refreshedCount = 0;
    try {
      await runCrossWindowExclusive("background:token-refresh-sweep", "Background token refresh", async () => {
        markTokenAutomationSweepStarted();
        const accounts = (await params.repo.listAccounts()).filter(
          (account) =>
            account.enabled !== false &&
            account.tokenRefreshEnabled === true &&
            (params.canRefreshAccount?.(account.id) ?? true)
        );
        if (!shouldRunAccountScheduler(accounts.length)) {
          return;
        }

        for (const account of accounts) {
          try {
            await runCrossWindowExclusive(`background:token-refresh:${account.id}`, "Token refresh", async () => {
              const tokens = await params.repo.getTokens(account.id, { bypassCache: true });
              markTokenAutomationCheck(account.id);
              checked += 1;
              if (!tokens?.accessToken || !needsTokenRefresh(tokens, params.skewSeconds)) {
                clearTokenAutomationError(account.id);
                return;
              }

              if (!tokens.refreshToken) {
                throw new Error("Token expired and no refresh token is available");
              }

              const refreshed = await refreshTokens(tokens.refreshToken, tokens.idToken);
              await params.repo.updateTokens(account.id, {
                ...refreshed,
                accountId: refreshed.accountId ?? account.accountId ?? tokens.accountId
              });
              markTokenAutomationRefreshSuccess(account.id);
              refreshedCount += 1;
            });
          } catch (error) {
            if (error instanceof CrossWindowOperationBusyError) {
              continue;
            }
            lastFailureMessage = error instanceof Error ? error.message : String(error);
            markTokenAutomationRefreshFailure(account.id, lastFailureMessage);
            console.warn(`[codexAccounts] background token refresh failed for ${account.email}:`, error);
          }
        }
      });
    } catch (error) {
      if (!(error instanceof CrossWindowOperationBusyError)) {
        lastFailureMessage = error instanceof Error ? error.message : String(error);
        console.warn("[codexAccounts] background token refresh sweep failed:", error);
      }
    } finally {
      inFlight = false;
      markTokenAutomationSweepFinished(lastFailureMessage);
      console.info(
        `[codexAccounts] background token refresh sweep: checked=${checked}, refreshed=${refreshedCount}` +
          (lastFailureMessage ? `, lastError=${lastFailureMessage}` : ""),
        { checked, refreshed: refreshedCount }
      );
      params.view.refresh();
    }
  };

  const applySchedule = (): void => {
    const enabled = isBackgroundTokenRefreshEnabled();
    configureTokenAutomation(enabled, params.checkIntervalMs, params.skewSeconds);

    if (timer) {
      clearInterval(timer);
      timer = undefined;
    }

    if (!enabled) {
      params.view.refresh();
      return;
    }

    timer = setInterval(() => {
      void runTokenRefreshSweep();
    }, params.checkIntervalMs);
    void params.repo.listAccounts().then((accounts) => {
      if (shouldRunAccountScheduler(accounts.length)) {
        void runTokenRefreshSweep();
      }
    });
  };

  applySchedule();

  const configDisposable = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("codexAccounts.backgroundTokenRefreshEnabled")) {
      applySchedule();
    }
  });

  params.context.subscriptions.push(configDisposable);
  return {
    dispose(): void {
      configDisposable.dispose();
      if (timer) {
        clearInterval(timer);
      }
    }
  };
}
