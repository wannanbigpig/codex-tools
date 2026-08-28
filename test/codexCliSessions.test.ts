import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readCodexCliSessionMessages, readCodexCliSessions } from "../src/services/codexSessionResume";

const sessionId = "01a04882-d037-7a42-ad24-9afb61901188";
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Codex CLI session integration", () => {
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
});
