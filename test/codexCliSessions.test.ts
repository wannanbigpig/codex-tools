import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseCodexAppServerThreadItems,
  readCodexCliComposerConfig,
  readCodexCliSessionMessages,
  readCodexCliSessionSummary,
  readCodexCliSessions
} from "../src/services/codexSessionResume";

const sessionId = "01a04882-d037-7a42-ad24-9afb61901188";
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Codex CLI session integration", () => {
  it("maps rich app-server items into expandable dashboard activity", () => {
    const items = parseCodexAppServerThreadItems({
      thread: {
        turns: [{
          id: "turn-1",
          status: "completed",
          startedAt: 1_787_970_000,
          items: [
            { type: "userMessage", id: "user-1", content: [{ type: "text", text: "Build it" }] },
            { type: "reasoning", id: "reason-1", summary: ["Inspecting the implementation"], content: [] },
            { type: "commandExecution", id: "cmd-1", command: "npm test", cwd: "D:/repo", status: "completed", aggregatedOutput: "42 passed", exitCode: 0, durationMs: 1250 },
            { type: "fileChange", id: "files-1", status: "completed", changes: [{ path: "src/app.ts", kind: "update", diff: "+done" }] },
            { type: "mcpToolCall", id: "tool-1", server: "docs", tool: "search", status: "failed", arguments: { q: "Codex" }, error: { message: "offline" }, durationMs: 40 },
            { type: "agentMessage", id: "agent-1", text: "Completed", phase: "final_answer" }
          ]
        }]
      }
    });

    expect(items).toMatchObject([
      { id: "user-1", kind: "message", role: "user", text: "Build it" },
      { id: "reason-1", kind: "reasoning", title: "Reasoning", text: "Inspecting the implementation" },
      { id: "cmd-1", kind: "command", command: "npm test", output: "42 passed", exitCode: 0, durationMs: 1250 },
      { id: "files-1", kind: "file-change", title: "Edited 1 file", changes: [{ path: "src/app.ts", kind: "update", diff: "+done" }] },
      { id: "tool-1", kind: "tool-call", title: "Used search", subtitle: "docs", status: "failed" },
      { id: "agent-1", kind: "message", role: "assistant", text: "Completed" }
    ]);
  });

  it("shows in-progress activity and terminal turn failures", () => {
    const items = parseCodexAppServerThreadItems({
      thread: {
        turns: [{
          id: "turn-failed",
          status: "failed",
          error: { message: "Usage limit reached" },
          items: [{ type: "commandExecution", id: "cmd-running", command: "npm test", cwd: "D:/repo", status: "inProgress" }]
        }]
      }
    });

    expect(items).toMatchObject([
      { id: "cmd-running", kind: "command", title: "Running command", status: "inProgress" },
      { id: "turn-failed-error", kind: "error", title: "Turn failed", status: "failed", text: "Usage limit reached" }
    ]);
  });

  it("maps persisted Codex activities when app-server content is unavailable", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "codex-cli-activity-"));
    roots.push(root);
    await mkdir(path.join(root, "sessions", "2026", "08", "29"), { recursive: true });
    const transcript = path.join(root, "sessions", "2026", "08", "29", `rollout-${sessionId}.jsonl`);
    await writeFile(transcript, [
      JSON.stringify({ timestamp: "2026-08-29T03:00:00Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Check it" }] } }),
      JSON.stringify({ timestamp: "2026-08-29T03:00:01Z", type: "event_msg", payload: { type: "item_completed", item: { type: "CommandExecution", id: "cmd-1", command: "npm test", cwd: "D:/repo", status: "completed", aggregated_output: "43 passed", exit_code: 0, duration: 1000 } } }),
      JSON.stringify({ timestamp: "2026-08-29T03:00:02Z", type: "event_msg", payload: { type: "item_completed", item: { type: "FileChange", id: "files-1", status: "completed", changes: { "src/app.ts": { type: "update", unified_diff: "+done" } } } } }),
      JSON.stringify({ timestamp: "2026-08-29T03:00:03Z", type: "response_item", payload: { type: "message", role: "assistant", phase: "final_answer", content: [{ type: "output_text", text: "Done" }] } })
    ].join("\n"));

    await expect(readCodexCliSessionMessages(sessionId, root)).resolves.toMatchObject([
      { role: "user", text: "Check it" },
      { kind: "command", command: "npm test", output: "43 passed", exitCode: 0 },
      { kind: "file-change", changes: [{ path: "src/app.ts", kind: "update", diff: "+done" }] },
      { role: "assistant", text: "Done" }
    ]);
  });

  it("lists sessions with running status and reads only user/assistant messages", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "codex-cli-sessions-"));
    roots.push(root);
    await mkdir(path.join(root, "sessions", "2026", "08", "28"), { recursive: true });
    await mkdir(path.join(root, "thread-writer-locks"), { recursive: true });
    await writeFile(path.join(root, "session_index.jsonl"), JSON.stringify({ id: sessionId, thread_name: "Demo", updated_at: "2026-08-28T20:50:00Z" }));
    await writeFile(path.join(root, "thread-writer-locks", `${sessionId}.lock`), "");
    const transcript = path.join(root, "sessions", "2026", "08", "28", `rollout-${sessionId}.jsonl`);
    await writeFile(transcript, [
      JSON.stringify({ type: "response_item", timestamp: "2026-08-28T20:50:00Z", payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "hidden" }] } }),
      JSON.stringify({ type: "response_item", timestamp: "2026-08-28T20:50:01Z", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Hello" }] } }),
      JSON.stringify({ type: "response_item", timestamp: "2026-08-28T20:50:02Z", payload: { type: "message", role: "assistant", phase: "commentary", content: [{ type: "output_text", text: "Hi there" }] } })
    ].join("\n"));

    await expect(readCodexCliSessions(root)).resolves.toMatchObject([
      { id: sessionId, title: "Demo", status: "running" }
    ]);
    await expect(readCodexCliSessionMessages(sessionId, root)).resolves.toMatchObject([
      { role: "user", text: "Hello" },
      { role: "assistant", text: "Hi there" }
    ]);
  });

  it("rejects unsafe session identifiers", async () => {
    await expect(readCodexCliSessionMessages("../../auth.json", os.tmpdir())).rejects.toThrow("invalid");
  });

  it("separates archived sessions and still exposes their readable transcript", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "codex-cli-archived-"));
    roots.push(root);
    await mkdir(path.join(root, "archived_sessions"), { recursive: true });
    await writeFile(
      path.join(root, "session_index.jsonl"),
      JSON.stringify({ id: sessionId, thread_name: "Archived demo", updated_at: "2026-08-28T20:50:00Z" })
    );
    await writeFile(
      path.join(root, "archived_sessions", `rollout-${sessionId}.jsonl`),
      JSON.stringify({
        type: "response_item",
        timestamp: "2026-08-28T20:50:01Z",
        payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Archived hello" }] }
      })
    );

    await expect(readCodexCliSessions(root)).resolves.toMatchObject([
      { id: sessionId, title: "Archived demo", status: "idle", archived: true }
    ]);
    await expect(readCodexCliSessionMessages(sessionId, root)).resolves.toMatchObject([
      { role: "user", text: "Archived hello" }
    ]);
  });

  it("applies the visible limit independently to Active and Archived", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "codex-cli-sections-"));
    roots.push(root);
    await mkdir(path.join(root, "archived_sessions"), { recursive: true });
    const entries = [
      { id: "01a04882-d037-7a42-ad24-9afb61901181", thread_name: "Active newest", updated_at: "2026-08-28T20:54:00Z" },
      { id: "01a04882-d037-7a42-ad24-9afb61901182", thread_name: "Archived newest", updated_at: "2026-08-28T20:53:00Z" },
      { id: "01a04882-d037-7a42-ad24-9afb61901183", thread_name: "Active older", updated_at: "2026-08-28T20:52:00Z" },
      { id: "01a04882-d037-7a42-ad24-9afb61901184", thread_name: "Archived older", updated_at: "2026-08-28T20:51:00Z" }
    ];
    await writeFile(path.join(root, "session_index.jsonl"), entries.map((entry) => JSON.stringify(entry)).join("\n"));
    await writeFile(path.join(root, "archived_sessions", `rollout-${entries[1].id}.jsonl`), "");
    await writeFile(path.join(root, "archived_sessions", `rollout-${entries[3].id}.jsonl`), "");

    const sessions = await readCodexCliSessions(root, 1);

    expect(sessions.map((session) => [session.title, session.archived])).toEqual([
      ["Active newest", false],
      ["Archived newest", true]
    ]);
  });

  it("resolves an older direct-linked session outside the visible list limit", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "codex-cli-direct-link-"));
    roots.push(root);
    const olderId = "01a04882-d037-7a42-ad24-9afb61901189";
    await writeFile(path.join(root, "session_index.jsonl"), [
      JSON.stringify({ id: sessionId, thread_name: "Newest", updated_at: "2026-08-29T03:00:00Z" }),
      JSON.stringify({ id: olderId, thread_name: "Older direct link", updated_at: "2026-08-28T03:00:00Z" })
    ].join("\n"));

    await expect(readCodexCliSessions(root, 1)).resolves.toHaveLength(1);
    await expect(readCodexCliSessionSummary(olderId, root)).resolves.toMatchObject({
      id: olderId,
      title: "Older direct link",
      archived: false
    });
  });

  it("loads visible CLI models and composer defaults from the local Codex configuration", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "codex-cli-config-"));
    roots.push(root);
    await writeFile(
      path.join(root, "models_cache.json"),
      JSON.stringify({
        models: [
          {
            slug: "gpt-demo",
            display_name: "GPT Demo",
            description: "Demo model",
            visibility: "list",
            default_reasoning_level: "medium",
            supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }]
          },
          { slug: "hidden-model", display_name: "Hidden", visibility: "hide" }
        ]
      })
    );
    await writeFile(
      path.join(root, "config.toml"),
      'model = "gpt-demo"\nmodel_reasoning_effort = "medium"\nsandbox_mode = "read-only"\n'
    );

    await expect(readCodexCliComposerConfig(root)).resolves.toEqual({
      models: [{
        id: "gpt-demo",
        label: "GPT Demo",
        description: "Demo model",
        defaultReasoningEffort: "medium",
        reasoningEfforts: ["low", "medium"]
      }],
      defaultModel: "gpt-demo",
      defaultReasoningEffort: "medium",
      defaultSandboxMode: "read-only"
    });
  });
});
