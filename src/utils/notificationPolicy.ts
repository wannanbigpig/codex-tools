import { AsyncLocalStorage } from "async_hooks";
import * as vscode from "vscode";

const dashboardActionContext = new AsyncLocalStorage<boolean>();

/** Run a dashboard request without duplicating its terminal result as a VS Code toast. */
export function withDashboardNotificationSuppression<T>(task: () => Promise<T>): Promise<T> {
  const windowApi = vscode.window as typeof vscode.window;
  const originalInfo = windowApi.showInformationMessage;
  const originalWarning = windowApi.showWarningMessage;
  const originalError = windowApi.showErrorMessage;
  const hasAction = (args: unknown[]): boolean =>
    args.slice(1).some((arg) => typeof arg === "string" || (typeof arg === "object" && arg !== null && "title" in arg));
  windowApi.showInformationMessage = ((...args: unknown[]) =>
    hasAction(args) ? originalInfo.apply(windowApi, args as never) : Promise.resolve(undefined)) as typeof originalInfo;
  windowApi.showWarningMessage = ((...args: unknown[]) =>
    hasAction(args) ? originalWarning.apply(windowApi, args as never) : Promise.resolve(undefined)) as typeof originalWarning;
  windowApi.showErrorMessage = ((...args: unknown[]) =>
    hasAction(args) ? originalError.apply(windowApi, args as never) : Promise.resolve(undefined)) as typeof originalError;
  return dashboardActionContext.run(true, task).finally(() => {
    windowApi.showInformationMessage = originalInfo;
    windowApi.showWarningMessage = originalWarning;
    windowApi.showErrorMessage = originalError;
  });
}

export function shouldSuppressDashboardNotifications(): boolean {
  return dashboardActionContext.getStore() === true;
}
