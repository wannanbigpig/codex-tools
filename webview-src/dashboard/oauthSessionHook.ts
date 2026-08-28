import { useRef, useState } from "preact/hooks";
import type { DashboardHostMessage } from "../../src/domain/dashboard/types";
import type { SendAction } from "./hookTypes";
import { reduceOAuthActionResult, type OAuthModalState } from "./sessionModalState";

export function useOAuthSessionModal(params: {
  sendAction: SendAction;
  showCopyFeedback: (key: string) => void;
  openAuthorizationInClient: boolean;
  getPrepareAccountId?: () => string | undefined;
}) {
  const [oauthState, setOauthState] = useState<OAuthModalState>({
    oauthFlowStarted: false,
    oauthCallbackUrl: ""
  });
  const actionInFlight = useRef<"prepare" | "start" | "complete" | undefined>(undefined);

  const reset = (): void => {
    setOauthState({
      oauthSession: undefined,
      oauthFlowStarted: false,
      oauthCallbackUrl: "",
      oauthError: undefined
    });
    actionInFlight.current = undefined;
  };

  const cancelSession = (): void => {
    if (oauthState.oauthSession) {
      params.sendAction("cancelOAuthSession", undefined, {
        oauthSessionId: oauthState.oauthSession.sessionId
      });
    }
    reset();
  };

  const handlePrepareOauthLink = (): void => {
    if (oauthState.oauthSession?.authUrl || actionInFlight.current) {
      return;
    }
    actionInFlight.current = "prepare";
    params.sendAction("prepareOAuthSession", params.getPrepareAccountId?.());
  };

  const handleCopyOauthLink = (): void => {
    if (!oauthState.oauthSession?.authUrl) {
      handlePrepareOauthLink();
      return;
    }
    params.sendAction("copyText", undefined, { text: oauthState.oauthSession.authUrl });
    params.showCopyFeedback("oauth-link");
  };

  const handleStartOAuthAutoFlow = (): void => {
    if (actionInFlight.current) {
      return;
    }
    if (!oauthState.oauthSession?.authUrl) {
      handlePrepareOauthLink();
      return;
    }
    if (params.openAuthorizationInClient) {
      if (!openOAuthAuthorizationWindow(oauthState.oauthSession.authUrl)) {
        setOauthState((current) => ({
          ...current,
          oauthError: "The browser blocked the authorization window. Allow pop-ups or copy the authorization link."
        }));
      }
      return;
    }
    actionInFlight.current = "start";
    setOauthState((current) => ({
      ...current,
      oauthFlowStarted: true,
      oauthError: undefined
    }));
    params.sendAction("startOAuthAutoFlow", undefined, {
      oauthSessionId: oauthState.oauthSession.sessionId
    });
  };

  const handleCompleteOAuth = (): void => {
    if (!oauthState.oauthSession || !oauthState.oauthCallbackUrl.trim() || actionInFlight.current) {
      return;
    }
    actionInFlight.current = "complete";
    setOauthState((current) => ({
      ...current,
      oauthFlowStarted: true,
      oauthError: undefined
    }));
    params.sendAction("completeOAuthSession", undefined, {
      oauthSessionId: oauthState.oauthSession.sessionId,
      callbackUrl: oauthState.oauthCallbackUrl
    });
  };

  const applyActionResult = (
    message: Extract<DashboardHostMessage, { type: "dashboard:action-result" }>
  ): { handled: boolean; shouldCloseModal?: boolean } => {
    const reduced = reduceOAuthActionResult(oauthState, message);
    if (!reduced.handled) {
      return { handled: false };
    }
    if (message.action === "startOAuthAutoFlow" || message.action === "completeOAuthSession") {
      actionInFlight.current = undefined;
    }
    if (message.action === "prepareOAuthSession") {
      actionInFlight.current = undefined;
    }
    setOauthState(reduced.next);
    return {
      handled: true,
      shouldCloseModal: reduced.shouldCloseModal
    };
  };

  return {
    oauthSession: oauthState.oauthSession,
    oauthCallbackUrl: oauthState.oauthCallbackUrl,
    oauthError: oauthState.oauthError,
    oauthFlowStarted: oauthState.oauthFlowStarted,
    cancelSession,
    reset,
    handlePrepareOauthLink,
    handleCopyOauthLink,
    handleStartOAuthAutoFlow,
    handleCompleteOAuth,
    applyActionResult,
    setOauthCallbackUrl: (value: string) => {
      setOauthState((current) => ({ ...current, oauthCallbackUrl: value }));
    }
  };
}

export function openOAuthAuthorizationWindow(authUrl: string): boolean {
  try {
    return Boolean(window.open(authUrl, "_blank", "noopener,noreferrer"));
  } catch {
    return false;
  }
}
