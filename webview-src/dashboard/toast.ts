export const DASHBOARD_TOAST_DURATION_MS = 10_000;

export function scheduleDashboardToastDismiss(onDismiss: () => void): () => void {
  const timeout = globalThis.setTimeout(onDismiss, DASHBOARD_TOAST_DURATION_MS);
  return () => globalThis.clearTimeout(timeout);
}
