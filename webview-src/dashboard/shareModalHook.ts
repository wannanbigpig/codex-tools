import { useState } from "preact/hooks";
import type { DashboardHostMessage } from "../../src/domain/dashboard/types";
import type { SendAction } from "./hookTypes";
import { createShareFileName } from "./helpers";

export function useShareModal(params: {
  sendAction: SendAction;
  showCopyFeedback: (key: string) => void;
}) {
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareModalJson, setShareModalJson] = useState("");
  const [shareModalFilename, setShareModalFilename] = useState("codex-accounts-share.json");
  const [sharePreviewExpanded, setSharePreviewExpanded] = useState(false);

  const handleCopyShareJson = (): void => {
    params.sendAction("copyText", undefined, { text: shareModalJson });
    params.showCopyFeedback("share-json");
  };

  const handleDownloadShareJson = (filename: string, text: string): void => {
    params.sendAction("downloadJsonFile", undefined, { filename, text });
  };

  const applyActionResult = (message: Extract<DashboardHostMessage, { type: "dashboard:action-result" }>): boolean => {
    if (message.status === "failed") {
      return false;
    }
    if ((message.action === "shareTokens" || message.action === "exportBackup") && message.payload?.sharedJson) {
      setShareModalJson(message.payload.sharedJson);
      const filename = createShareFileName();
      setShareModalFilename(message.action === "exportBackup" ? filename.replace("-share-", "-backup-") : filename);
      setSharePreviewExpanded(false);
      setShareModalOpen(true);
      return true;
    }
    if (message.action === "exportAuthFile" && message.payload?.authJson) {
      setShareModalJson(message.payload.authJson);
      setShareModalFilename("auth.json");
      setSharePreviewExpanded(false);
      setShareModalOpen(true);
      return true;
    }
    return false;
  };

  const handleEscape = (): boolean => {
    if (!shareModalOpen) {
      return false;
    }
    setShareModalOpen(false);
    return true;
  };

  return {
    shareModalOpen,
    shareModalJson,
    shareModalFilename,
    sharePreviewExpanded,
    handleCopyShareJson,
    handleDownloadShareJson,
    applyActionResult,
    handleEscape,
    closeShareModal: () => setShareModalOpen(false),
    toggleSharePreview: () => setSharePreviewExpanded((current) => !current)
  };
}
