import { useEffect, useState } from "preact/hooks";
import type {
  DashboardAccountViewModel,
  DashboardActionName,
  DashboardState
} from "../../src/domain/dashboard/types";
import { ModalShell } from "./components";

export type BrowserActionRequest =
  | {
      kind: "switch";
      accountIds: string[];
    }
  | {
      kind: "confirm";
      action: Extract<DashboardActionName, "reloadPrompt" | "remove" | "batchRemove" | "consumeResetCredit">;
      accountId?: string;
      accountIds?: string[];
      title: string;
      message: string;
      confirmLabel: string;
      danger?: boolean;
    }
  | {
      kind: "tags";
      accountId?: string;
      accountIds: string[];
      mode: "set" | "add" | "remove";
      initialTags: string[];
      title: string;
    }
  | {
      kind: "passphrase";
      action: Extract<DashboardActionName, "configureEncryptedSync" | "setEncryptedSyncRegistryOverride">;
      enabled?: boolean;
      title: string;
      message: string;
      confirmPassphrase: boolean;
    };

export function BrowserActionModal(props: {
  request?: BrowserActionRequest;
  accounts: DashboardAccountViewModel[];
  lang: DashboardState["lang"];
  closeLabel: string;
  onCancel: (request: BrowserActionRequest) => void;
  onConfirm: (request: BrowserActionRequest, submittedTags?: string[]) => void;
}) {
  const request = props.request;
  const [tagText, setTagText] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [passphraseConfirmation, setPassphraseConfirmation] = useState("");

  useEffect(() => {
    setTagText(request?.kind === "tags" ? request.initialTags.join(", ") : "");
    setPassphrase("");
    setPassphraseConfirmation("");
  }, [request]);

  if (!request) {
    return null;
  }

  const cancelLabel = props.lang === "zh" ? "取消" : props.lang === "zh-hant" ? "取消" : "Cancel";
  if (request.kind === "switch") {
    const candidates = request.accountIds
      .map((id) => props.accounts.find((account) => account.id === id))
      .filter((account): account is DashboardAccountViewModel => Boolean(account));
    const title = props.lang === "zh" ? "切换账号" : props.lang === "zh-hant" ? "切換帳號" : "Switch account";
    const empty = props.lang === "zh"
      ? "没有可切换的账号。"
      : props.lang === "zh-hant"
        ? "沒有可切換的帳號。"
        : "No account is available to switch to.";
    return (
      <ModalShell
        open
        title={title}
        closeLabel={props.closeLabel}
        className="dashboard-modal-compact browser-action-modal"
        onClose={() => props.onCancel(request)}
      >
        <div class="modal-stack">
          {candidates.length ? (
            <div class="browser-account-picker" role="listbox" aria-label={title}>
              {candidates.map((account) => (
                <button
                  key={account.id}
                  class="browser-account-picker-item"
                  type="button"
                  role="option"
                  onClick={() => props.onConfirm({ ...request, accountIds: [account.id] })}
                >
                  <span>{account.email}</span>
                  <small>{account.planTypeLabel} · {account.workspaceLabel}</small>
                </button>
              ))}
            </div>
          ) : (
            <div class="modal-note">{empty}</div>
          )}
          <div class="modal-actions">
            <button class="modal-secondary-btn" type="button" onClick={() => props.onCancel(request)}>
              {cancelLabel}
            </button>
          </div>
        </div>
      </ModalShell>
    );
  }

  if (request.kind === "tags") {
    const help = props.lang === "zh"
      ? "用逗号分隔标签。留空可清除全部标签。"
      : props.lang === "zh-hant"
        ? "用逗號分隔標籤。留空可清除全部標籤。"
        : "Separate tags with commas. Leave empty to clear all tags.";
    const saveLabel = props.lang === "zh" ? "保存" : props.lang === "zh-hant" ? "儲存" : "Save";
    return (
      <ModalShell
        open
        title={request.title}
        closeLabel={props.closeLabel}
        className="dashboard-modal-compact browser-action-modal"
        onClose={() => props.onCancel(request)}
      >
        <form
          class="modal-stack"
          onSubmit={(event) => {
            event.preventDefault();
            props.onConfirm(request, parseSubmittedTags(tagText));
          }}
        >
          <label class="modal-note" for="browser-action-tags">{help}</label>
          <input
            id="browser-action-tags"
            class="modal-input"
            type="text"
            value={tagText}
            autoFocus
            onInput={(event) => setTagText(event.currentTarget.value)}
          />
          <div class="modal-actions">
            <button class="modal-secondary-btn" type="button" onClick={() => props.onCancel(request)}>
              {cancelLabel}
            </button>
            <button class="modal-primary-btn" type="submit">{saveLabel}</button>
          </div>
        </form>
      </ModalShell>
    );
  }

  if (request.kind === "passphrase") {
    const submitLabel = props.lang === "zh" ? "继续" : props.lang === "zh-hant" ? "繼續" : "Continue";
    const mismatch = request.confirmPassphrase && passphraseConfirmation !== passphrase;
    return (
      <ModalShell
        open
        title={request.title}
        closeLabel={props.closeLabel}
        className="dashboard-modal-compact browser-action-modal"
        onClose={() => props.onCancel(request)}
      >
        <form
          class="modal-stack"
          onSubmit={(event) => {
            event.preventDefault();
            if (!passphrase || mismatch) {
              return;
            }
            props.onConfirm(request, [passphrase, passphraseConfirmation]);
          }}
        >
          <div class="modal-note">{request.message}</div>
          <input
            class="modal-input"
            type="password"
            value={passphrase}
            placeholder="Passphrase"
            aria-label="Passphrase"
            autoFocus
            onInput={(event) => setPassphrase(event.currentTarget.value)}
          />
          {request.confirmPassphrase ? (
            <input
              class="modal-input"
              type="password"
              value={passphraseConfirmation}
              placeholder="Confirm passphrase"
              aria-label="Confirm passphrase"
              onInput={(event) => setPassphraseConfirmation(event.currentTarget.value)}
            />
          ) : null}
          {mismatch && passphraseConfirmation ? <div class="modal-error">The passphrases do not match.</div> : null}
          <div class="modal-actions">
            <button class="modal-secondary-btn" type="button" onClick={() => props.onCancel(request)}>
              {cancelLabel}
            </button>
            <button class="modal-primary-btn" type="submit" disabled={!passphrase || mismatch}>
              {submitLabel}
            </button>
          </div>
        </form>
      </ModalShell>
    );
  }

  return (
    <ModalShell
      open
      title={request.title}
      closeLabel={props.closeLabel}
      className="dashboard-modal-compact browser-action-modal dashboard-confirm-modal"
      onClose={() => props.onCancel(request)}
    >
      <div class="modal-stack">
        <div class="modal-note">{request.message}</div>
        <div class="modal-actions">
          <button class="modal-secondary-btn" type="button" onClick={() => props.onCancel(request)}>
            {cancelLabel}
          </button>
          <button
            class={`modal-primary-btn ${request.danger ? "danger" : ""}`}
            type="button"
            onClick={() => props.onConfirm(request)}
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

export function parseSubmittedTags(value: string): string[] {
  return [...new Set(value.split(",").map((tag) => tag.trim()).filter(Boolean))];
}
