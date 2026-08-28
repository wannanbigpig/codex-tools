import * as vscode from "vscode";
import { registerCommands, runRegisteredCommand } from "../../commands";
import { AccountsRepository } from "../../storage";
import { AccountsStatusBarProvider } from "../../ui";
import { registerDebugOutput, t } from "../../utils";
import { consumeAutoSwitchNotice, initAutoSwitchRuntimeState } from "./autoSwitchState";
import { WorkbenchRefreshCoordinator } from "./refreshCoordinator";
import { registerAutoRefreshScheduler, registerTokenRefreshScheduler } from "./schedulerRegistration";
import { CodexSessionResumeManager } from "../../services/codexSessionResume";
import { EncryptedSyncManager } from "../../services/encryptedSync";
import { WebDashboardServer } from "../../services/webDashboardServer";
import {
  prepareQuotaSummaryPanelForExtensionHostRestart,
  restoreQuotaSummaryPanelAfterExtensionHostRestart
} from "../dashboard";

const TOKEN_REFRESH_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const TOKEN_REFRESH_SKEW_SECONDS = 5 * 60;

export class AccountsWorkbench {
  private readonly repo: AccountsRepository;
  private readonly statusBar: AccountsStatusBarProvider;
  private readonly refreshCoordinator: WorkbenchRefreshCoordinator;
  private readonly codexSessionResume: CodexSessionResumeManager;
  private readonly encryptedSync: EncryptedSyncManager;
  private readonly webDashboard: WebDashboardServer;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.repo = new AccountsRepository(context);
    this.statusBar = new AccountsStatusBarProvider(context, this.repo);
    this.refreshCoordinator = new WorkbenchRefreshCoordinator(context, this.repo, this.statusBar);
    this.codexSessionResume = new CodexSessionResumeManager(context);
    this.encryptedSync = new EncryptedSyncManager(context, this.repo);
    this.webDashboard = new WebDashboardServer(context, this.repo);
    this.repo.setAccountSwitchCoordinator(this.encryptedSync);
  }

  async activate(): Promise<void> {
    const activationStartedAt = Date.now();
    const activationSteps: Array<{ name: string; durationMs: number }> = [];
    const measureStep = async <T>(name: string, task: () => T | Promise<T>): Promise<T> => {
      const startedAt = Date.now();
      try {
        return await task();
      } finally {
        activationSteps.push({ name, durationMs: Date.now() - startedAt });
      }
    };

    registerDebugOutput(this.context);
    initAutoSwitchRuntimeState(this.context);
    const completedAutoSwitchNotice = consumeAutoSwitchNotice();
    if (completedAutoSwitchNotice) {
      void vscode.window.showInformationMessage(completedAutoSwitchNotice);
    }
    this.codexSessionResume.start();
    this.context.subscriptions.push({ dispose: () => this.codexSessionResume.dispose() });
    await measureStep("repo.init", async () => {
      await this.repo.init({ deferSync: true });
    });
    await measureStep("encryptedSync.start", async () => {
      await this.encryptedSync.start();
    });
    await measureStep("webDashboard.start", async () => {
      try {
        await this.webDashboard.start();
      } catch (error) {
        void vscode.window.showWarningMessage(
          `Web Dashboard could not start on port 39875: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
    this.context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("codexAccounts.webDashboardEnabled")) {
          void this.webDashboard.applyConfiguration().catch((error) => {
            void vscode.window.showWarningMessage(
              `Web Dashboard configuration failed: ${error instanceof Error ? error.message : String(error)}`
            );
          });
        }
      }),
      this.webDashboard,
      vscode.commands.registerCommand("codexAccounts.openWebDashboard", () =>
        runRegisteredCommand("Open web dashboard", () => this.webDashboard.openInBrowser(), "dashboard:open-web")
      ),
      vscode.commands.registerCommand("codexAccounts.setWebDashboardPassword", () =>
        runRegisteredCommand(
          "Set web dashboard password",
          (password?: string) => password === undefined ? this.webDashboard.promptSetPassword() : this.webDashboard.setPasswordValue(password),
          "dashboard:set-web-password"
        )
      ),
      vscode.commands.registerCommand(
        "codexAccounts.prepareDashboardForExtensionHostRestart",
        () => prepareQuotaSummaryPanelForExtensionHostRestart()
      )
    );
    await measureStep("notifyIndexHealth", async () => {
      await this.notifyIndexHealth();
    });
    await measureStep("refreshCoordinator.initObservedAuthIdentity", async () => {
      await this.refreshCoordinator.initializeObservedAuthIdentity();
    });
    this.context.subscriptions.push({ dispose: () => this.repo.dispose() });
    this.context.subscriptions.push({ dispose: () => this.refreshCoordinator.dispose() });

    const refreshers = this.refreshCoordinator.createRefreshView();
    this.repo.scheduleStartupSync(refreshers.refresh);
    this.encryptedSync.setOnStateChanged(refreshers.refresh);
    await measureStep("registerCommands", () => {
      registerCommands(this.context, this.repo, refreshers, this.encryptedSync);
    });
    await measureStep("registerAuthFileWatcher", () => {
      this.context.subscriptions.push(this.refreshCoordinator.registerAuthFileWatcher(refreshers));
    });
    await measureStep("registerAutoRefreshScheduler", () => {
      this.context.subscriptions.push(
        registerAutoRefreshScheduler({
          context: this.context,
          repo: this.repo,
          onRefresh: refreshers.refresh,
          canRefreshAccount: (accountId) => this.encryptedSync.canRefreshAccount(accountId)
        })
      );
    });
    await measureStep("registerTokenRefreshScheduler", () => {
      this.context.subscriptions.push(
        registerTokenRefreshScheduler({
          context: this.context,
          repo: this.repo,
          view: refreshers,
          checkIntervalMs: TOKEN_REFRESH_CHECK_INTERVAL_MS,
          skewSeconds: TOKEN_REFRESH_SKEW_SECONDS,
          canRefreshAccount: (accountId) => this.encryptedSync.canRefreshAccount(accountId)
        })
      );
    });
    await measureStep("promptImportCurrentAccountIfNeeded", async () => {
      await this.refreshCoordinator.promptImportCurrentAccountIfNeeded(refreshers);
    });
    await measureStep("statusBar.refresh", async () => {
      await this.statusBar.refresh();
    });
    await measureStep("restoreDashboardAfterExtensionHostRestart", async () => {
      await restoreQuotaSummaryPanelAfterExtensionHostRestart(this.context, this.repo);
    });
    console.info(
      `[codexAccounts] activation completed in ${Date.now() - activationStartedAt}ms`,
      activationSteps.map((step) => `${step.name}=${step.durationMs}ms`).join(", ")
    );
  }

  dispose(): void {
    this.codexSessionResume.dispose();
    this.encryptedSync.dispose();
    this.refreshCoordinator.dispose();
    this.repo.dispose();
  }

  showActivationFailure(error: unknown): void {
    this.statusBar.showActivationFailure(error instanceof Error ? error.message : String(error));
  }

  shutdown(): void {
    this.encryptedSync.shutdown();
    this.dispose();
  }


  private async notifyIndexHealth(): Promise<void> {
    const summary = await this.repo.getIndexHealthSummary();
    const translate = t();
    if (summary.status === "restored_from_backup") {
      void vscode.window.showInformationMessage(translate("message.indexAutoRestored"));
      return;
    }

    if (summary.status === "corrupted_unrecoverable") {
      void vscode.window.showWarningMessage(translate("message.indexRecoveryFailed"));
    }
  }
}
