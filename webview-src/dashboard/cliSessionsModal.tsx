import type {
  DashboardCliSessionMessage,
  DashboardCliSessionSummary,
  DashboardState
} from "../../src/domain/dashboard/types";
import { ModalShell } from "./primitives";

function formatSessionTime(value: string | undefined): string {
  if (!value) return "—";
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toLocaleString() : "—";
}

export function CliSessionsModal(props: {
  open: boolean;
  lang: DashboardState["lang"];
  closeLabel: string;
  sessions: DashboardCliSessionSummary[];
  selectedSession?: DashboardCliSessionSummary;
  messages: DashboardCliSessionMessage[];
  loading: boolean;
  messagesLoading: boolean;
  error?: string;
  messagesError?: string;
  onClose: () => void;
  onSelect: (session: DashboardCliSessionSummary) => void;
  onBack: () => void;
}) {
  const isMessages = Boolean(props.selectedSession);
  const title = isMessages
    ? props.selectedSession?.title ?? "Session messages"
    : props.lang === "zh" ? "CLI 会话" : props.lang === "zh-hant" ? "CLI 工作階段" : "CLI Sessions";
  return (
    <ModalShell
      open={props.open}
      title={title}
      closeLabel={props.closeLabel}
      className="dashboard-modal-compact cli-sessions-modal"
      onClose={props.onClose}
    >
      {isMessages ? (
        <>
          <div class="cli-session-toolbar">
            <button type="button" class="settings-inline-link" onClick={props.onBack}>← Back to sessions</button>
            <span class={`cli-session-status ${props.selectedSession?.status === "running" ? "is-running" : ""}`}>
              {props.selectedSession?.status === "running" ? "Running" : "Idle"}
            </span>
          </div>
          {props.messagesLoading ? <div class="cli-session-state" role="status">Loading messages…</div> : null}
          {props.messagesError ? <div class="cli-session-state is-error" role="alert">{props.messagesError}</div> : null}
          {!props.messagesLoading && !props.messagesError && props.messages.length === 0 ? (
            <div class="cli-session-state">No readable user or assistant messages were found.</div>
          ) : null}
          <div class="cli-session-messages" aria-live="polite">
            {props.messages.map((message) => <SessionMessage key={message.id} message={message} />)}
          </div>
        </>
      ) : (
        <>
          {props.loading ? <div class="cli-session-state" role="status">Loading CLI sessions…</div> : null}
          {props.error ? <div class="cli-session-state is-error" role="alert">{props.error}</div> : null}
          {!props.loading && !props.error && props.sessions.length === 0 ? (
            <div class="cli-session-state">No saved Codex CLI sessions were found on this PC.</div>
          ) : null}
          <div class="cli-session-list">
            {props.sessions.map((session) => (
              <button type="button" class="cli-session-row" key={session.id} onClick={() => props.onSelect(session)}>
                <span class="cli-session-row-main">
                  <strong>{session.title}</strong>
                  <small>{session.id}</small>
                </span>
                <span class="cli-session-row-meta">
                  <span class={`cli-session-status ${session.status === "running" ? "is-running" : ""}`}>
                    {session.status === "running" ? "Running" : "Idle"}
                  </span>
                  <small>{formatSessionTime(session.updatedAt)}</small>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </ModalShell>
  );
}

function SessionMessage(props: { message: DashboardCliSessionMessage }) {
  return (
    <article class={`cli-session-message is-${props.message.role}`}>
      <div class="cli-session-message-head">
        <strong>{props.message.role === "user" ? "You" : "Codex"}</strong>
        <time>{formatSessionTime(props.message.timestamp)}</time>
      </div>
      <div class="cli-session-message-text">{props.message.text}</div>
    </article>
  );
}
