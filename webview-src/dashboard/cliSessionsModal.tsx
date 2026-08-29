import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type {
  DashboardCliComposerConfig,
  DashboardCliSandboxMode,
  DashboardCliSessionMessage,
  DashboardCliSessionSummary,
  DashboardNotice
} from "../../src/domain/dashboard/types";

export type CliSessionFeedback = DashboardNotice & { key: number };

export type CliSessionsPageProps = {
  sessions: DashboardCliSessionSummary[];
  selectedSession?: DashboardCliSessionSummary;
  messages: DashboardCliSessionMessage[];
  composerConfig?: DashboardCliComposerConfig;
  loading: boolean;
  messagesLoading: boolean;
  sending: boolean;
  stopping: boolean;
  mutating: boolean;
  error?: string;
  messagesError?: string;
  feedback?: CliSessionFeedback;
  onDashboard: () => void;
  onRefresh: () => void;
  onSelect: (session: DashboardCliSessionSummary) => void;
  onBackToList: () => void;
  onRefreshMessages: () => void;
  onSend: (input: {
    text: string;
    model?: string;
    reasoningEffort?: string;
    sandboxMode: DashboardCliSandboxMode;
  }) => void;
  onStop: () => void;
  onOpenInVsCode: () => void;
  onRename: (name: string) => void;
  onFork: () => void;
  onCopyLink: () => void;
  onShare: () => void;
  onArchive: () => void;
  onUnarchive: (session: DashboardCliSessionSummary) => void;
  onDelete: (session: DashboardCliSessionSummary) => void;
};

export function CliSessionsPage(props: CliSessionsPageProps) {
  const [section, setSection] = useState<"active" | "archived">("active");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState<string>();
  const [reasoningEffort, setReasoningEffort] = useState<string>();
  const [sandboxMode, setSandboxMode] = useState<DashboardCliSandboxMode>("workspace-write");
  const [deleteTarget, setDeleteTarget] = useState<DashboardCliSessionSummary>();
  const [localFeedback, setLocalFeedback] = useState<DashboardNotice>();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const previousFeedbackKey = useRef<number>();

  useEffect(() => {
    if (!props.composerConfig) return;
    const defaultModel = props.composerConfig.defaultModel ?? props.composerConfig.models[0]?.id;
    const modelOption = props.composerConfig.models.find((option) => option.id === defaultModel);
    setModel((current) => current ?? defaultModel);
    setReasoningEffort((current) => current ?? props.composerConfig?.defaultReasoningEffort ?? modelOption?.defaultReasoningEffort ?? modelOption?.reasoningEfforts[0] ?? "medium");
    setSandboxMode(props.composerConfig.defaultSandboxMode);
  }, [props.composerConfig]);

  useEffect(() => {
    if (!props.feedback || previousFeedbackKey.current === props.feedback.key) return;
    previousFeedbackKey.current = props.feedback.key;
    setLocalFeedback(props.feedback);
    if (props.feedback.level === "info" && props.feedback.message.includes("completed")) setDraft("");
  }, [props.feedback]);

  useEffect(() => {
    if (props.selectedSession) setSection(props.selectedSession.archived ? "archived" : "active");
    setDeleteTarget(undefined);
  }, [props.selectedSession?.id, props.selectedSession?.archived]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [props.messages.length, props.sending]);

  const activeSessions = props.sessions.filter((session) => !session.archived);
  const archivedSessions = props.sessions.filter((session) => session.archived);
  const runningCount = activeSessions.filter((session) => session.status === "running").length;
  const visibleSessions = useMemo(() => {
    const source = section === "active" ? activeSessions : archivedSessions;
    const query = search.trim().toLocaleLowerCase();
    return query
      ? source.filter((session) => `${session.title} ${session.id}`.toLocaleLowerCase().includes(query))
      : source;
  }, [activeSessions, archivedSessions, search, section]);
  const selectedModel = props.composerConfig?.models.find((option) => option.id === model);
  const reasoningOptions = selectedModel?.reasoningEfforts.length
    ? selectedModel.reasoningEfforts
    : ["low", "medium", "high", "xhigh"];
  const selectedArchived = props.selectedSession?.archived === true;
  const hasInProgressActivity = props.messages.some((message) => message.status === "inProgress");

  const submit = (): void => {
    const text = draft.trim();
    if (!text) {
      setLocalFeedback({ level: "warning", message: "Write a message before sending it to Codex." });
      return;
    }
    setLocalFeedback({ level: "info", message: "Codex is working on your request…" });
    props.onSend({ text, model, reasoningEffort, sandboxMode });
  };

  const copySessionId = async (): Promise<void> => {
    if (!props.selectedSession) return;
    try {
      await navigator.clipboard.writeText(props.selectedSession.id);
      setLocalFeedback({ level: "info", message: "Session ID copied." });
    } catch {
      setLocalFeedback({ level: "error", message: "Session ID could not be copied. Copy it from the header." });
    }
  };

  return (
    <div class="cli-workspace">
      <div class="cli-workspace-grid">
        <aside class={`cli-session-rail ${props.selectedSession ? "has-selection" : ""}`} aria-label="Codex sessions">
          <div class="cli-rail-header">
            <div><IconButton label="Back to dashboard" onClick={props.onDashboard}><ArrowLeftIcon /></IconButton><strong>Chats</strong></div>
            <div><IconButton label={props.loading ? "Refreshing sessions" : "Refresh sessions"} disabled={props.loading} onClick={props.onRefresh}><RefreshIcon /></IconButton><IconButton label="Close sessions" onClick={props.onDashboard}><CloseIcon /></IconButton></div>
          </div>
          <div class="cli-session-search-wrap"><SearchIcon /><input class="cli-session-search" type="search" value={search} placeholder="Search sessions" aria-label="Search sessions" onInput={(event) => setSearch(event.currentTarget.value)} /></div>
          <div class="cli-session-tabs" role="tablist" aria-label="Session state">
            <button type="button" role="tab" aria-selected={section === "active"} class={section === "active" ? "is-active" : ""} onClick={() => setSection("active")}>Active <span>{activeSessions.length}</span></button>
            <button type="button" role="tab" aria-selected={section === "archived"} class={section === "archived" ? "is-active" : ""} onClick={() => setSection("archived")}>Archived <span>{archivedSessions.length}</span></button>
          </div>
          {props.loading && props.sessions.length === 0 ? <SessionRailSkeleton /> : null}
          {props.error ? <InlineError text={props.error} retry={props.onRefresh} /> : null}
          {!props.loading && !props.error && visibleSessions.length === 0 ? <EmptySessions search={Boolean(search)} section={section} /> : null}
          <div class="cli-session-list" role="list">
            {visibleSessions.map((session) => session.archived ? (
              <div role="listitem" class="cli-session-row is-archived" key={session.id}>
                <span class="cli-session-row-main"><strong>{session.title}</strong><small>Archived · {relativeTime(session.updatedAt)}</small></span>
                <span class="cli-session-row-actions">
                  <IconButton label={`Restore ${session.title}`} disabled={props.mutating} onClick={() => props.onUnarchive(session)}><RestoreIcon /></IconButton>
                  <IconButton label={`Delete ${session.title}`} disabled={props.mutating} danger onClick={() => setDeleteTarget(session)}><TrashIcon /></IconButton>
                </span>
              </div>
            ) : (
              <button type="button" role="listitem" class={`cli-session-row ${props.selectedSession?.id === session.id ? "is-selected" : ""}`} key={session.id} onClick={() => props.onSelect(session)}>
                <span class="cli-session-row-main"><strong>{session.title}</strong><small>{relativeTime(session.updatedAt)}</small></span>
                {session.status === "running" ? <span class="cli-running-dot" title="Running" aria-label="Running" /> : null}
              </button>
            ))}
          </div>
          {deleteTarget && deleteTarget.archived ? <DeleteConfirmation compact title={deleteTarget.title} onCancel={() => { setDeleteTarget(undefined); setLocalFeedback({ level: "info", message: "Session deletion cancelled." }); }} onDelete={() => { const target = deleteTarget; setDeleteTarget(undefined); props.onDelete(target); }} /> : null}
        </aside>

        <main class={`cli-conversation ${props.selectedSession ? "has-session" : ""}`}>
          {props.selectedSession ? (
            <>
              <ConversationHeader
                session={props.selectedSession}
                archived={selectedArchived}
                busy={props.mutating}
                sending={props.sending}
                onBack={props.onBackToList}
                onCopy={() => void copySessionId()}
                onRefresh={props.onRefreshMessages}
                onOpen={props.onOpenInVsCode}
                onRename={props.onRename}
                onFork={props.onFork}
                onCopyLink={props.onCopyLink}
                onShare={props.onShare}
                onArchive={props.onArchive}
                onRestore={() => props.onUnarchive(props.selectedSession!)}
                onDelete={() => setDeleteTarget(props.selectedSession)}
                onRenameCancelled={() => setLocalFeedback({ level: "info", message: "Rename cancelled." })}
              />
              {deleteTarget && !deleteTarget.archived ? <DeleteConfirmation title={deleteTarget.title} onCancel={() => { setDeleteTarget(undefined); setLocalFeedback({ level: "info", message: "Session deletion cancelled." }); }} onDelete={() => { const target = deleteTarget; setDeleteTarget(undefined); props.onDelete(target); }} /> : null}
              <section class="cli-message-viewport" aria-live="polite" aria-busy={props.messagesLoading}>
                {props.messagesLoading && props.messages.length === 0 ? <MessageSkeleton /> : null}
                {props.messagesError ? <InlineError text={props.messagesError} retry={props.onRefreshMessages} /> : null}
                {!props.messagesLoading && !props.messagesError && props.messages.length === 0 ? <ConversationEmpty archived={selectedArchived} /> : null}
                <div class="cli-session-messages">
                  {props.messages.map((message) => <SessionMessage key={message.id} message={message} />)}
                  {props.sending || (props.selectedSession?.status === "running" && !hasInProgressActivity) ? <WorkingMessage /> : null}
                  <div ref={messagesEndRef} />
                </div>
              </section>
              {selectedArchived ? (
                <div class="cli-archived-lock"><ArchiveIcon /><span><strong>This session is archived.</strong> Restore it to open or continue the conversation.</span><button type="button" class="cli-primary-button" disabled={props.mutating} onClick={() => props.onUnarchive(props.selectedSession!)}>Restore session</button></div>
              ) : (
                <Composer
                  draft={draft}
                  model={model}
                  reasoningEffort={reasoningEffort}
                  sandboxMode={sandboxMode}
                  models={props.composerConfig?.models ?? []}
                  reasoningOptions={reasoningOptions}
                  sending={props.sending}
                  stopping={props.stopping}
                  onDraft={setDraft}
                  onModel={(nextModel) => {
                    setModel(nextModel);
                    const option = props.composerConfig?.models.find((item) => item.id === nextModel);
                    setReasoningEffort(option?.defaultReasoningEffort ?? option?.reasoningEfforts[0]);
                  }}
                  onReasoning={setReasoningEffort}
                  onSandbox={setSandboxMode}
                  onSubmit={submit}
                  onStop={props.onStop}
                />
              )}
            </>
          ) : <WorkspaceEmpty running={runningCount} active={activeSessions.length} archived={archivedSessions.length} />}
        </main>
      </div>
      {localFeedback ? <div class={`cli-workspace-feedback is-${localFeedback.level}`} role={localFeedback.level === "error" ? "alert" : "status"}><span>{localFeedback.message}</span><button type="button" aria-label="Dismiss message" onClick={() => setLocalFeedback(undefined)}>×</button></div> : null}
    </div>
  );
}

function ConversationHeader(props: {
  session: DashboardCliSessionSummary; archived: boolean; busy: boolean; sending: boolean;
  onBack: () => void; onCopy: () => void; onRefresh: () => void; onOpen: () => void;
  onRename: (name: string) => void; onFork: () => void; onCopyLink: () => void; onShare: () => void;
  onArchive: () => void; onRestore: () => void; onDelete: () => void; onRenameCancelled: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(props.session.title);
  useEffect(() => setName(props.session.title), [props.session.id, props.session.title]);
  return <header class="cli-conversation-header">
    <button type="button" class="cli-mobile-back" onClick={props.onBack}><ArrowLeftIcon /> Sessions</button>
    <div class="cli-conversation-title"><div class="cli-conversation-title-line"><h1>{props.session.title}</h1><span class={`cli-state-pill ${props.archived ? "is-archived" : props.session.status === "running" ? "is-running" : ""}`}>{props.archived ? "Archived" : props.session.status === "running" ? "Running" : "Ready"}</span></div><button type="button" class="cli-session-id" onClick={props.onCopy} title="Copy session ID">{props.session.id} <CopyIcon /></button></div>
    <div class="cli-conversation-actions">
      {!props.archived ? <><IconButton label="Refresh conversation" disabled={props.busy} onClick={props.onRefresh}><RefreshIcon /></IconButton><button type="button" class="cli-secondary-button" disabled={props.busy || props.sending} onClick={props.onOpen}><OpenIcon /> Open in VS Code</button></> : <button type="button" class="cli-secondary-button" disabled={props.busy} onClick={props.onRestore}><RestoreIcon /> Restore</button>}
      <div class="cli-session-menu-wrap">
        <IconButton label="Session actions" disabled={props.busy || props.sending} onClick={() => setMenuOpen((open) => !open)}><MoreIcon /></IconButton>
        {menuOpen ? <div class="cli-session-menu" role="menu">
          {!props.archived ? <>
            <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setRenaming(true); }}><PencilIcon /> Rename</button>
            <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); props.onFork(); }}><ForkIcon /> Fork session</button>
            <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); props.onArchive(); }}><ArchiveIcon /> Archive</button>
            <span />
            <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); props.onShare(); }}><ShareIcon /> Share</button>
            <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); props.onCopyLink(); }}><LinkIcon /> Copy link</button>
            <span />
          </> : null}
          <button type="button" role="menuitem" class="is-danger" onClick={() => { setMenuOpen(false); props.onDelete(); }}><TrashIcon /> Delete</button>
        </div> : null}
      </div>
    </div>
    {renaming ? <form class="cli-rename-form" onSubmit={(event) => { event.preventDefault(); const normalized = name.trim(); if (normalized) { props.onRename(normalized); setRenaming(false); } }}><PencilIcon /><input value={name} maxLength={160} autoFocus aria-label="Session name" onInput={(event) => setName(event.currentTarget.value)} /><button type="button" onClick={() => { setName(props.session.title); setRenaming(false); props.onRenameCancelled(); }}>Cancel</button><button type="submit" disabled={!name.trim()}>Save</button></form> : null}
  </header>;
}

function Composer(props: {
  draft: string; model?: string; reasoningEffort?: string; sandboxMode: DashboardCliSandboxMode;
  models: DashboardCliComposerConfig["models"]; reasoningOptions: string[]; sending: boolean; stopping: boolean;
  onDraft: (value: string) => void; onModel: (value: string) => void; onReasoning: (value: string) => void;
  onSandbox: (value: DashboardCliSandboxMode) => void; onSubmit: () => void; onStop: () => void;
}) {
  return <form class="cli-composer" onSubmit={(event) => { event.preventDefault(); props.onSubmit(); }}>
    <textarea value={props.draft} rows={3} maxLength={64_000} placeholder="Do anything" aria-label="Message Codex" disabled={props.sending} onInput={(event) => props.onDraft(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); props.onSubmit(); } }} />
    <div class="cli-composer-toolbar"><div class="cli-composer-selectors">
      <label class="cli-composer-control" title="Filesystem access"><ShieldIcon /><select value={props.sandboxMode} aria-label="Access mode" onChange={(event) => props.onSandbox(event.currentTarget.value as DashboardCliSandboxMode)}><option value="read-only">Read only</option><option value="workspace-write">Workspace</option><option value="danger-full-access">Full access</option></select></label>
    </div><div class="cli-composer-submit">
      <label class="cli-composer-control" title="Model"><SparkIcon /><select value={props.model ?? ""} aria-label="Model" onChange={(event) => props.onModel(event.currentTarget.value)}>{props.models.length === 0 ? <option value="">Default model</option> : null}{props.models.map((option) => <option value={option.id}>{option.label}</option>)}</select></label>
      <label class="cli-composer-control" title="Reasoning effort"><ReasoningIcon /><select value={props.reasoningEffort} aria-label="Reasoning effort" onChange={(event) => props.onReasoning(event.currentTarget.value)}>{props.reasoningOptions.map((effort) => <option value={effort}>{effort === "xhigh" ? "Extra high" : capitalize(effort)}</option>)}</select></label>
      <span>{props.draft.length > 60_000 ? `${64_000 - props.draft.length} left` : "Enter to send"}</span>{props.sending ? <button type="button" class="cli-stop-button" disabled={props.stopping} aria-busy={props.stopping} onClick={props.onStop}><StopIcon /> {props.stopping ? "Stopping" : "Stop"}</button> : <button type="submit" class="cli-send-button" disabled={!props.draft.trim()} aria-label="Send message" title="Send message"><SendIcon /></button>}</div></div>
  </form>;
}

function SessionMessage({ message }: { message: DashboardCliSessionMessage }) {
  if (!message.kind || message.kind === "message") {
    return <article class={`cli-session-message is-${message.role ?? "assistant"}`}><div class="cli-session-avatar">{message.role === "user" ? "Y" : <CodexSessionIcon />}</div><div class="cli-session-message-body"><div class="cli-session-message-head"><strong>{message.role === "user" ? "You" : "Codex"}</strong><time>{formatTime(message.timestamp)}</time></div><div class="cli-session-message-text">{message.text}</div></div></article>;
  }
  return <ActivityMessage message={message} />;
}

function ActivityMessage({ message }: { message: DashboardCliSessionMessage }) {
  const running = message.status === "inProgress";
  const failed = message.status === "failed" || message.kind === "error";
  return <details class={`cli-activity is-${message.kind} ${running ? "is-running" : ""} ${failed ? "is-failed" : ""}`} open={running}>
    <summary>
      <span class="cli-activity-icon"><ActivityGlyph kind={message.kind} /></span>
      <span class="cli-activity-heading"><strong>{message.title ?? activityTitle(message.kind)}</strong><small>{activityMeta(message)}</small></span>
      <span class={`cli-activity-status is-${message.status ?? "completed"}`}>{running ? <i /> : failed ? "Failed" : message.status === "declined" ? "Declined" : <CheckIcon />}</span>
      <ChevronIcon />
    </summary>
    <div class="cli-activity-body">
      {message.kind === "command" ? <>
        <pre class="cli-activity-code"><code>{message.command ?? message.text}</code></pre>
        {message.cwd ? <div class="cli-activity-path">in {message.cwd}</div> : null}
        {message.output ? <pre class="cli-activity-output"><code>{message.output}</code></pre> : <div class="cli-activity-copy">{running ? "Waiting for command output…" : "No command output."}</div>}
      </> : message.kind === "file-change" ? <FileChangeDetails changes={message.changes ?? []} /> : message.kind === "tool-call" ? <>
        <div class="cli-activity-copy">{message.text}</div>
        {message.arguments ? <ActivityData label="Input" value={message.arguments} /> : null}
        {message.result ? <ActivityData label={failed ? "Error" : "Result"} value={message.result} /> : null}
      </> : <div class="cli-activity-copy">{message.text}</div>}
    </div>
  </details>;
}

function FileChangeDetails({ changes }: { changes: NonNullable<DashboardCliSessionMessage["changes"]> }) {
  if (changes.length === 0) return <div class="cli-activity-copy">File changes are being prepared…</div>;
  return <div class="cli-file-change-list">{changes.map((change) => <details key={`${change.path}-${change.kind}`}>
    <summary><span><FileIcon /><strong>{change.path}</strong></span><small>{capitalize(change.kind)}</small><ChevronIcon /></summary>
    {change.diff ? <pre class="cli-activity-output is-diff"><code>{change.diff}</code></pre> : <div class="cli-activity-copy">No diff details were recorded.</div>}
  </details>)}</div>;
}

function ActivityData({ label, value }: { label: string; value: string }) {
  return <div class="cli-activity-data"><strong>{label}</strong><pre class="cli-activity-output"><code>{value}</code></pre></div>;
}

function WorkingMessage() {
  return <ActivityMessage message={{ id: "working", kind: "reasoning", title: "Working", text: "Codex is reasoning, using tools, and preparing a response.", status: "inProgress" }} />;
}

function activityTitle(kind: DashboardCliSessionMessage["kind"]): string {
  switch (kind) {
    case "reasoning": return "Reasoning";
    case "plan": return "Plan";
    case "command": return "Command";
    case "file-change": return "File changes";
    case "tool-call": return "Tool call";
    case "collaboration": return "Agent activity";
    case "web-search": return "Web search";
    case "image": return "Image activity";
    case "review": return "Review";
    case "compaction": return "Context compacted";
    case "error": return "Error";
    default: return "Codex activity";
  }
}

function activityMeta(message: DashboardCliSessionMessage): string {
  const values = [message.subtitle];
  if (message.durationMs !== undefined) values.push(formatDuration(message.durationMs));
  if (message.exitCode !== undefined) values.push(`exit ${message.exitCode}`);
  if (message.timestamp) values.push(formatTime(message.timestamp));
  return values.filter(Boolean).join(" · ") || (message.status === "inProgress" ? "In progress" : "Completed");
}
function DeleteConfirmation(props: { title: string; compact?: boolean; onCancel: () => void; onDelete: () => void }) { return <div class={`cli-delete-confirm ${props.compact ? "is-compact" : ""}`} role="alertdialog" aria-label={`Delete ${props.title} permanently`}><span><TrashIcon /><span><strong>Delete permanently?</strong> {props.title} cannot be recovered.</span></span><div><button type="button" class="cli-secondary-button" onClick={props.onCancel}>Cancel</button><button type="button" class="cli-danger-button" onClick={props.onDelete}>Delete</button></div></div>; }
function InlineError(props: { text: string; retry: () => void }) { return <div class="cli-inline-state is-error" role="alert"><strong>Something went wrong</strong><span>{props.text}</span><button type="button" onClick={props.retry}>Try again</button></div>; }
function EmptySessions(props: { search: boolean; section: "active" | "archived" }) { return <div class="cli-inline-state"><EmptyFolderIcon /><strong>{props.search ? "No matching sessions" : `No ${props.section} sessions`}</strong><span>{props.search ? "Try another title or session ID." : props.section === "active" ? "Start a Codex CLI chat to see it here." : "Archived sessions will appear here."}</span></div>; }
function ConversationEmpty({ archived }: { archived: boolean }) { return <div class="cli-conversation-empty"><CodexSessionIcon /><h2>No messages yet</h2><p>{archived ? "This archived transcript has no readable messages." : "Send a message below to continue this session."}</p></div>; }
function WorkspaceEmpty(props: { running: number; active: number; archived: number }) { return <div class="cli-workspace-empty"><span class="cli-empty-mark"><CodexSessionIcon /></span><h1>Your Codex sessions</h1><p>Select a session to review its work, continue the conversation, or manage its lifecycle.</p><div><span><span class="cli-running-dot" /> {props.running} running</span><span>{props.active} active</span><span>{props.archived} archived</span></div></div>; }
function SessionRailSkeleton() { return <div class="cli-skeleton-list" aria-label="Loading sessions"><i /><i /><i /><i /></div>; }
function MessageSkeleton() { return <div class="cli-message-skeleton" aria-label="Loading messages"><i /><i /><i /></div>; }
function IconButton(props: { label: string; disabled?: boolean; danger?: boolean; onClick: () => void; children: preact.ComponentChildren }) { return <button type="button" class={`cli-icon-button ${props.danger ? "is-danger" : ""}`} disabled={props.disabled} aria-label={props.label} title={props.label} onClick={props.onClick}>{props.children}</button>; }

function formatTime(value: string | undefined): string { if (!value) return ""; const parsed = Date.parse(value); return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : ""; }
function formatDuration(durationMs: number): string { if (durationMs < 1000) return `${Math.max(0, Math.round(durationMs))} ms`; if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)} s`; return `${Math.floor(durationMs / 60_000)}m ${Math.round((durationMs % 60_000) / 1000)}s`; }
function relativeTime(value: string | undefined): string { if (!value) return "Unknown"; const parsed = Date.parse(value); if (!Number.isFinite(parsed)) return "Unknown"; const minutes = Math.max(0, Math.round((Date.now() - parsed) / 60_000)); if (minutes < 1) return "Just now"; if (minutes < 60) return `${minutes}m`; const hours = Math.round(minutes / 60); return hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`; }
function capitalize(value: string): string { return value.charAt(0).toUpperCase() + value.slice(1); }

function ActivityGlyph({ kind }: { kind: DashboardCliSessionMessage["kind"] }) {
  switch (kind) {
    case "reasoning": return <ReasoningIcon />;
    case "plan": return <SparkIcon />;
    case "command": return <TerminalIcon />;
    case "file-change": return <FileIcon />;
    case "tool-call": return <ToolIcon />;
    case "collaboration": return <ForkIcon />;
    case "web-search": return <SearchIcon />;
    case "image": return <ImageIcon />;
    case "review": return <ReviewIcon />;
    case "compaction": return <ArchiveIcon />;
    case "error": return <WarningIcon />;
    default: return <CodexSessionIcon />;
  }
}

function Icon({ children }: { children: preact.ComponentChildren }) { return <svg viewBox="0 0 24 24" aria-hidden="true">{children}</svg>; }
function CodexSessionIcon() { return <Icon><path d="M8.3 3.2a5 5 0 0 1 8.5 2.1 5 5 0 0 1 2 8.5 5 5 0 0 1-2.1 8.5 5 5 0 0 1-8.5-2.1 5 5 0 0 1-2-8.5 5 5 0 0 1 2.1-8.5Z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m8.2 12 2.5 2.5 5.2-5.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></Icon>; }
function ArrowLeftIcon() { return <Icon><path d="m14.5 5-7 7 7 7M8 12h11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></Icon>; }
function CloseIcon() { return <Icon><path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></Icon>; }
function SearchIcon() { return <Icon><circle cx="10.8" cy="10.8" r="6.3" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="m15.5 15.5 4 4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></Icon>; }
function RefreshIcon() { return <Icon><path d="M19 7v5h-5M5 17v-5h5M7.1 8.2A6.5 6.5 0 0 1 18.6 12M5.4 12a6.5 6.5 0 0 0 11.5 3.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></Icon>; }
function CopyIcon() { return <Icon><rect x="8" y="8" width="10" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" fill="none" stroke="currentColor" stroke-width="1.6"/></Icon>; }
function OpenIcon() { return <Icon><path d="M14 4h6v6M20 4l-9 9M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></Icon>; }
function ArchiveIcon() { return <Icon><path d="M4 7h16v12H4zM3 4h18v3H3zM9 11h6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/></Icon>; }
function RestoreIcon() { return <Icon><path d="M4 9a8 8 0 1 1 .8 7M4 4v5h5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></Icon>; }
function TrashIcon() { return <Icon><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></Icon>; }
function SparkIcon() { return <Icon><path d="m12 3 1.2 4.1L17 9l-3.8 1.9L12 15l-1.2-4.1L7 9l3.8-1.9L12 3Zm6 11 .7 2.3L21 17.5l-2.3 1.2L18 21l-.7-2.3-2.3-1.2 2.3-1.2L18 14Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></Icon>; }
function ReasoningIcon() { return <Icon><path d="M9 18h6M10 21h4M8.5 15.5C6.9 14.4 6 12.6 6 10.6a6 6 0 1 1 12 0c0 2-.9 3.8-2.5 4.9-.5.4-.8.9-.8 1.5H9.3c0-.6-.3-1.1-.8-1.5Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></Icon>; }
function ShieldIcon() { return <Icon><path d="M12 3 5 6v5c0 4.6 2.9 8.2 7 10 4.1-1.8 7-5.4 7-10V6l-7-3Zm-3 9 2 2 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></Icon>; }
function SendIcon() { return <Icon><path d="m4 4 17 8-17 8 3-8-3-8Zm3 8h14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></Icon>; }
function StopIcon() { return <Icon><rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor"/></Icon>; }
function EmptyFolderIcon() { return <Icon><path d="M3 7h7l2 2h9v10H3V7Zm0 0V5h7l2 2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></Icon>; }
function MoreIcon() { return <Icon><circle cx="5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="19" cy="12" r="1.4" fill="currentColor"/></Icon>; }
function PencilIcon() { return <Icon><path d="m4 20 4.2-1 10.4-10.4a2 2 0 0 0-2.8-2.8L5.4 16.2 4 20Zm10.5-12.9 2.8 2.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></Icon>; }
function ForkIcon() { return <Icon><circle cx="7" cy="5" r="2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="17" cy="5" r="2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="19" r="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7 7v2c0 3 2 4 5 4s5-1 5-4V7M12 13v4" fill="none" stroke="currentColor" stroke-width="1.6"/></Icon>; }
function LinkIcon() { return <Icon><path d="m9.5 14.5 5-5M7 16.8l-1 .9a3.3 3.3 0 0 1-4.7-4.7l3.2-3.2a3.3 3.3 0 0 1 4.7 0M17 7.2l1-.9a3.3 3.3 0 0 1 4.7 4.7l-3.2 3.2a3.3 3.3 0 0 1-4.7 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></Icon>; }
function ShareIcon() { return <Icon><circle cx="18" cy="5" r="2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="6" cy="12" r="2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="18" cy="19" r="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m8 11 8-5M8 13l8 5" fill="none" stroke="currentColor" stroke-width="1.6"/></Icon>; }
function TerminalIcon() { return <Icon><path d="m5 7 4 4-4 4m6 1h7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></Icon>; }
function FileIcon() { return <Icon><path d="M6 3h8l4 4v14H6V3Zm8 0v5h4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></Icon>; }
function ToolIcon() { return <Icon><path d="M14.5 6.5a4 4 0 0 0-5-5L12 4l-3 3-2.5-2.5a4 4 0 0 0 5 5L18 16a2.1 2.1 0 1 1-3 3l-6.5-6.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></Icon>; }
function ImageIcon() { return <Icon><rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="9" cy="10" r="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="m4 17 5-4 3 2 3-3 5 5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></Icon>; }
function ReviewIcon() { return <Icon><path d="M4 5h16v12H8l-4 4V5Zm4 4h8m-8 4h5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></Icon>; }
function WarningIcon() { return <Icon><path d="M12 3 2.8 20h18.4L12 3Zm0 6v5m0 3h.01" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></Icon>; }
function CheckIcon() { return <Icon><path d="m5 12 4 4L19 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></Icon>; }
function ChevronIcon() { return <Icon><path d="m8 10 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></Icon>; }
