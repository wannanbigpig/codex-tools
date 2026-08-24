import { describe, expect, it } from "vitest";
import { findMacAppProcessIds, getCodexAppCandidates } from "../src/utils/codexApp";

describe("Codex desktop app compatibility", () => {
  it("prefers the merged ChatGPT app while retaining legacy Codex candidates", () => {
    expect(getCodexAppCandidates("darwin", "/Users/test")).toEqual([
      "/Applications/ChatGPT.app",
      "/Users/test/Applications/ChatGPT.app",
      "/Applications/Codex.app",
      "/Applications/OpenAI Codex.app",
      "/Users/test/Applications/Codex.app",
      "/Users/test/Applications/OpenAI Codex.app"
    ]);
  });

  it("matches only the selected app bundle executable", () => {
    const processList = [
      " 101 /Applications/ChatGPT.app/Contents/MacOS/ChatGPT",
      " 102 /Applications/ChatGPT Classic.app/Contents/MacOS/ChatGPT",
      " 103 /Applications/ChatGPT.app/Contents/Frameworks/Codex Renderer.app/Contents/MacOS/Codex Renderer"
    ].join("\n");

    expect(findMacAppProcessIds(processList, "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT")).toEqual([101]);
  });
});
