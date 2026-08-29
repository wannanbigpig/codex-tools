import * as vscode from "vscode";
import type { DashboardClientMessage, DashboardSettingKey, DashboardUsageSample } from "../../domain/dashboard/types";

export type DashboardMessageHandlers = {
  onReady: () => void | Promise<void>;
  onAction: (message: Extract<DashboardClientMessage, { type: "dashboard:action" }>) => Promise<void>;
  onSetting: (key: DashboardSettingKey, value: string | number | boolean) => Promise<void>;
  onPickCodexAppPath: () => Promise<void>;
  onClearCodexAppPath: () => Promise<void>;
  onUsageHistory: (samples: DashboardUsageSample[]) => Promise<void>;
};

export async function dispatchDashboardClientMessage(
  message: DashboardClientMessage,
  handlers: DashboardMessageHandlers
): Promise<void> {
  switch (message.type) {
    case "dashboard:ready":
      await handlers.onReady();
      return;
    case "dashboard:action":
      await handlers.onAction(message);
      return;
    case "dashboard:setting":
      await handlers.onSetting(message.key, message.value);
      return;
    case "dashboard:pickCodexAppPath":
      await handlers.onPickCodexAppPath();
      return;
    case "dashboard:clearCodexAppPath":
      await handlers.onClearCodexAppPath();
      return;
    case "dashboard:usage-history":
      await handlers.onUsageHistory(message.samples);
      return;
    default:
      throw new Error("Unsupported dashboard request.");
  }
}

export async function clearDashboardCodexAppPath(): Promise<void> {
  await vscode.workspace.getConfiguration("codexAccounts").update("codexAppPath", "", vscode.ConfigurationTarget.Global);
}
