import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DASHBOARD_TOAST_DURATION_MS,
  scheduleDashboardToastDismiss
} from "../webview-src/dashboard/toast";

describe("dashboard toast", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("auto-dismisses after ten seconds", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();

    scheduleDashboardToastDismiss(onDismiss);
    vi.advanceTimersByTime(DASHBOARD_TOAST_DURATION_MS - 1);
    expect(onDismiss).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("cancels auto-dismiss when the toast is replaced or manually closed", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();

    const cancel = scheduleDashboardToastDismiss(onDismiss);
    cancel();
    vi.advanceTimersByTime(DASHBOARD_TOAST_DURATION_MS);

    expect(onDismiss).not.toHaveBeenCalled();
  });
});
