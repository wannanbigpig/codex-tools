import { useRef, useState } from "preact/hooks";
import type { DashboardHostMessage } from "../../src/domain/dashboard/types";
import type { SendAction } from "./hookTypes";
import { useOAuthSessionModal } from "./oauthSessionHook";
import { useSharedImportModal } from "./sharedImportHook";

export function useAccountSessionModal(params: {
  sendAction: SendAction;
  importJsonFileReadError: string;
  showCopyFeedback: (key: string) => void;
  openAuthorizationInClient: boolean;
}) {
  const [addAccountModalOpen, setAddAccountModalOpen] = useState(false);
  const [addAccountTab, setAddAccountTab] = useState<"oauth" | "import">("oauth");
  const [confirmCancelOauthOpen, setConfirmCancelOauthOpen] = useState(false);
  const [importRecoveryMode, setImportRecoveryMode] = useState(false);
  const oauthPrepareAccountId = useRef<string | undefined>(undefined);
  const oauth = useOAuthSessionModal({
    sendAction: params.sendAction,
    showCopyFeedback: params.showCopyFeedback,
    openAuthorizationInClient: params.openAuthorizationInClient,
    getPrepareAccountId: () => oauthPrepareAccountId.current
  });
  const sharedImport = useSharedImportModal({
    sendAction: params.sendAction,
    importJsonFileReadError: params.importJsonFileReadError
  });

  const performCloseAddAccountModal = (): void => {
    oauth.cancelSession();
    oauthPrepareAccountId.current = undefined;
    setAddAccountModalOpen(false);
    setImportRecoveryMode(false);
    setAddAccountTab("oauth");
    oauth.reset();
    sharedImport.clearImportFeedback();
  };

  const closeAddAccountModal = (completeOAuthPending: boolean): void => {
    if (oauth.oauthFlowStarted || completeOAuthPending) {
      setConfirmCancelOauthOpen(true);
      return;
    }
    performCloseAddAccountModal();
  };

  const openAddAccountModal = (): void => {
    oauthPrepareAccountId.current = undefined;
    setAddAccountModalOpen(true);
    setAddAccountTab("oauth");
    setImportRecoveryMode(false);
    oauth.reset();
    sharedImport.clearImportFeedback();
  };

  const openReauthorizeModal = (accountId: string): void => {
    setAddAccountModalOpen(true);
    setAddAccountTab("oauth");
    setImportRecoveryMode(false);
    oauth.reset();
    sharedImport.clearImportFeedback();
    oauthPrepareAccountId.current = accountId;
  };

  const openRecoveryImportModal = (): void => {
    oauthPrepareAccountId.current = undefined;
    setAddAccountModalOpen(true);
    setAddAccountTab("import");
    setImportRecoveryMode(true);
    sharedImport.clearImportFeedback();
  };

  const openImportModal = (): void => {
    oauthPrepareAccountId.current = undefined;
    setAddAccountModalOpen(true);
    setAddAccountTab("import");
    setImportRecoveryMode(false);
    sharedImport.clearImportFeedback();
  };

  const handleAddAccountTabChange = (tab: "oauth" | "import"): void => {
    setAddAccountTab(tab);
    if (tab === "oauth") {
      setImportRecoveryMode(false);
      sharedImport.clearImportFeedback();
      return;
    }
  };

  const applyActionResult = (message: Extract<DashboardHostMessage, { type: "dashboard:action-result" }>): boolean => {
    const oauthResult = oauth.applyActionResult(message);
    if (oauthResult.handled) {
      if (oauthResult.shouldCloseModal) {
        setAddAccountModalOpen(false);
        setAddAccountTab("oauth");
        setImportRecoveryMode(false);
      }
      return true;
    }
    return sharedImport.applyActionResult(message);
  };

  const handleEscape = (completeOAuthPending: boolean): boolean => {
    if (!addAccountModalOpen) {
      return false;
    }
    closeAddAccountModal(completeOAuthPending);
    return true;
  };

  return {
    addAccountModalOpen,
    addAccountTab,
    oauthSession: oauth.oauthSession,
    oauthCallbackUrl: oauth.oauthCallbackUrl,
    oauthError: oauth.oauthError,
    importJsonText: sharedImport.importJsonText,
    importJsonError: sharedImport.importJsonError,
    importPreview: sharedImport.importPreview,
    importResult: sharedImport.importResult,
    importRecoveryMode,
    confirmCancelOauthOpen,
    openAddAccountModal,
    openReauthorizeModal,
    openRecoveryImportModal,
    openImportModal,
    handleAddAccountTabChange,
    handlePrepareOauthLink: oauth.handlePrepareOauthLink,
    handleCopyOauthLink: oauth.handleCopyOauthLink,
    handleStartOAuthAutoFlow: oauth.handleStartOAuthAutoFlow,
    handleCompleteOAuth: oauth.handleCompleteOAuth,
    handleImportFileSelected: sharedImport.handleImportFileSelected,
    handleImportTextChange: sharedImport.handleImportTextChange,
    handlePreviewImport: sharedImport.handlePreviewImport,
    handleSubmitImport: () => sharedImport.handleSubmitImport(importRecoveryMode),
    applyActionResult,
    handleEscape,
    closeAddAccountModal,
    closeConfirmCancelOauth: () => setConfirmCancelOauthOpen(false),
    confirmCancelOauth: () => {
      setConfirmCancelOauthOpen(false);
      performCloseAddAccountModal();
    },
    setOauthCallbackUrl: oauth.setOauthCallbackUrl
  };
}
