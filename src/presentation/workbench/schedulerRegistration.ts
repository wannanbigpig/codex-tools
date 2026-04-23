import * as vscode from "vscode";
import { needsRefresh, refreshTokens } from "../../auth/oauth";
import { getAutoRefreshMinutes, isBackgroundTokenRefreshEnabled } from "../../infrastructure/config/extensionSettings";
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

export function registerAutoRefreshScheduler(params: {
  context: vscode.ExtensionContext;
  repo: AccountsRepository;
  onRefresh: () => void;
}): vscode.Disposable {
  let timer: NodeJS.Timeout | undefined;

  const applySchedule = (): void => {
    if (timer) {
      clearInterval(timer);
      timer = undefined;
    }

    const minutes = getAutoRefreshMinutes();
    if (!minutes || minutes <= 0) {
      return;
    }

    const runAutoRefresh = (): void => {
      void params.repo.listAccounts().then((accounts) => {
        if (!shouldRunAccountScheduler(accounts.length)) {
          return;
        }

        void vscode.commands.executeCommand("codexAccounts.refreshAllQuotas", {
          silent: true,
          forceRefresh: true
        });
      });
    };

    timer = setInterval(runAutoRefresh, minutes * 60 * 1000);
    void params.repo.listAccounts().then((accounts) => {
      if (shouldRunAccountScheduler(accounts.length)) {
        runAutoRefresh();
      }
    });
  };

  applySchedule();

  const configDisposable = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("codexAccounts.autoRefreshMinutes")) {
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

export function registerTokenRefreshScheduler(params: {
  context: vscode.ExtensionContext;
  repo: AccountsRepository;
  view: { refresh(): void };
  checkIntervalMs: number;
  skewSeconds: number;
}): vscode.Disposable {
  let timer: NodeJS.Timeout | undefined;
  let inFlight = false;

  const runTokenRefreshSweep = async (): Promise<void> => {
    if (inFlight) {
      return;
    }

    inFlight = true;
    let lastFailureMessage: string | undefined;
    try {
      markTokenAutomationSweepStarted();
      const accounts = await params.repo.listAccounts();
      if (!shouldRunAccountScheduler(accounts.length)) {
        return;
      }

      for (const account of accounts) {
        try {
          const tokens = await params.repo.getTokens(account.id);
          markTokenAutomationCheck(account.id);
          if (!tokens?.accessToken || !needsRefresh(tokens.accessToken, params.skewSeconds)) {
            clearTokenAutomationError(account.id);
            continue;
          }

          if (!tokens.refreshToken) {
            throw new Error("Token expired and no refresh token is available");
          }

          const refreshed = await refreshTokens(tokens.refreshToken);
          await params.repo.updateTokens(account.id, {
            ...refreshed,
            accountId: refreshed.accountId ?? account.accountId ?? tokens.accountId
          });
          markTokenAutomationRefreshSuccess(account.id);
        } catch (error) {
          lastFailureMessage = error instanceof Error ? error.message : String(error);
          markTokenAutomationRefreshFailure(account.id, lastFailureMessage);
          console.warn(`[codexAccounts] background token refresh failed for ${account.email}:`, error);
        }
      }
    } finally {
      inFlight = false;
      markTokenAutomationSweepFinished(lastFailureMessage);
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
