import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { describe, expect, it, vi } from "vitest";
import { removeTestDirectory } from "./testFilesystem";

describe("auth file persistence", () => {
  it("writes a unique temporary file before replacing auth.json", async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "codex-auth-write-"));
    const previousHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;
    vi.resetModules();
    const { writeAuthFile } = await import("../src/codex/authFile");

    await fs.writeFile(path.join(codexHome, "auth.json"), JSON.stringify({ old: true }), "utf8");
    await writeAuthFile({ idToken: "id", accessToken: "access", refreshToken: "refresh" });

    const written = JSON.parse(await fs.readFile(path.join(codexHome, "auth.json"), "utf8"));
    expect(written.tokens.access_token).toBe("access");
    expect((await fs.readdir(codexHome)).filter((name) => name.includes(".tmp.")).length).toBe(0);

    if (previousHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousHome;
    await removeTestDirectory(codexHome);
  }, 15_000);
});
