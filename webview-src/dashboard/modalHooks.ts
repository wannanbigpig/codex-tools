import type { DashboardHostMessage, DashboardNotice } from "../../src/domain/dashboard/types";
import { noticeFromActionResult } from "./actionFeedback";
import type { AppDispatch, SendAction } from "./hookTypes";
import { useCopyFeedback } from "./copyFeedbackHook";
import { useAccountSessionModal } from "./accountSessionModalHook";
import { useShareModal } from "./shareModalHook";

export function useDashboardModals(params: {
  dispatch: AppDispatch;
  sendAction: SendAction;
  importJsonFileReadError: string;
  onNotice: (notice: DashboardNotice) => void;
  isBrowserDashboard: boolean;
}) {
  const feedback = useCopyFeedback();
  const accountModal = useAccountSessionModal({
    sendAction: params.sendAction,
    importJsonFileReadError: params.importJsonFileReadError,
    showCopyFeedback: feedback.showCopyFeedback,
    openAuthorizationInClient: params.isBrowserDashboard
  });
  const shareModal = useShareModal({
    sendAction: params.sendAction,
    showCopyFeedback: feedback.showCopyFeedback
  });

  const handleHostMessage = (message: DashboardHostMessage): void => {
    switch (message.type) {
      case "dashboard:snapshot":
        params.dispatch({ type: "snapshot", snapshot: message.state });
        return;
      case "dashboard:action-result":
        params.dispatch({ type: "resolve-action", requestId: message.requestId });
        const notice = noticeFromActionResult(message);
        if (notice) {
          params.onNotice(notice);
        }
        if (accountModal.applyActionResult(message)) {
          return;
        }
        shareModal.applyActionResult(message);
        return;
      case "dashboard:notice":
        params.onNotice({ level: message.level, message: message.message });
        return;
      default:
        return;
    }
  };

  const handleEscape = (completeOAuthPending: boolean): boolean => {
    if (shareModal.handleEscape()) {
      return true;
    }
    if (accountModal.confirmCancelOauthOpen) {
      accountModal.closeConfirmCancelOauth();
      return true;
    }
    if (accountModal.handleEscape(completeOAuthPending)) {
      return true;
    }
    params.dispatch({ type: "close-settings" });
    return true;
  };

  return {
    ...accountModal,
    ...shareModal,
    copyFeedbackKey: feedback.copyFeedbackKey,
    handleHostMessage,
    handleEscape
  };
}
