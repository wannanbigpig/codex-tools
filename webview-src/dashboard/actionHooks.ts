import { useEffect, useRef } from "preact/hooks";
import type { DashboardActionName, DashboardNotice, DashboardSettingKey, DashboardSettings } from "../../src/domain/dashboard/types";
import { noticeFromActionTimeout } from "./actionFeedback";
import { BLOCKING_GLOBAL_ACTIONS, createActionRequestId, getActionTimeoutMs, postMessageToHost } from "./host";
import type { AppDispatch, SendAction } from "./hookTypes";
import type { AppState } from "./state";

export function useDashboardActions(
  state: AppState,
  dispatch: AppDispatch,
  onNotice: (notice: DashboardNotice) => void
) {
  const actionTimeoutsRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const timer = window.setInterval(() => {
      dispatch({ type: "tick", now: Date.now() });
    }, 30_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [dispatch]);

  useEffect(() => {
    const activeRequestIds = new Set(state.pendingActions.map((request) => request.requestId));

    state.pendingActions.forEach((request) => {
      if (actionTimeoutsRef.current.has(request.requestId)) {
        return;
      }

      const timeoutId = window.setTimeout(() => {
        dispatch({ type: "resolve-action", requestId: request.requestId });
        onNotice(noticeFromActionTimeout(request.action));
      }, getActionTimeoutMs(request.action));

      actionTimeoutsRef.current.set(request.requestId, timeoutId);
    });

    actionTimeoutsRef.current.forEach((timeoutId, requestId) => {
      if (activeRequestIds.has(requestId)) {
        return;
      }

      window.clearTimeout(timeoutId);
      actionTimeoutsRef.current.delete(requestId);
    });
  }, [dispatch, onNotice, state.pendingActions]);

  useEffect(() => {
    return () => {
      actionTimeoutsRef.current.forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
      actionTimeoutsRef.current.clear();
    };
  }, []);

  const patchSettings = (patch: Partial<DashboardSettings>): void => {
    dispatch({ type: "settings-patch", patch });
  };

  const sendAction: SendAction = (action, accountId, payload) => {
    const requestId = createActionRequestId();
    dispatch({
      type: "request-action",
      request: {
        requestId,
        action,
        accountId,
        requestedAt: Date.now()
      }
    });
    postMessageToHost({
      type: "dashboard:action",
      action,
      accountId,
      requestId,
      payload
    });
  };

  const sendSetting = (key: DashboardSettingKey, value: string | number | boolean): void => {
    postMessageToHost({
      type: "dashboard:setting",
      key,
      value
    });
  };

  const isActionPending = (action: DashboardActionName, accountId?: string): boolean =>
    state.pendingActions.some((request) => request.action === action && request.accountId === accountId);

  const hasGlobalPendingAction = state.pendingActions.some(
    (request) => request.accountId == null && BLOCKING_GLOBAL_ACTIONS.has(request.action)
  );

  return {
    patchSettings,
    sendAction,
    sendSetting,
    isActionPending,
    hasGlobalPendingAction
  };
}
