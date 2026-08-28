import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { writeIndexAtomically } from "../src/storage/accountsPersistence";
import type { CodexAccountsIndex } from "../src/core/types";
import { removeTestDirectory } from "./testFilesystem";

describe("accounts index persistence", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => removeTestDirectory(dir)));
  }, 15_000);

  it("replaces an existing index without leaving a shared temp file", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-index-write-"));
    tempDirs.push(dir);
    const indexPath = path.join(dir, "accounts-index.json");
    const oldIndex = { version: 1, accounts: [], updatedAt: 1 } as unknown as CodexAccountsIndex;
    const newIndex = { version: 1, accounts: [], updatedAt: 2 } as unknown as CodexAccountsIndex;
    await fs.writeFile(indexPath, JSON.stringify(oldIndex), "utf8");

    await writeIndexAtomically(indexPath, newIndex, ".tmp");

    expect(JSON.parse(await fs.readFile(indexPath, "utf8"))).toEqual(newIndex);
    expect((await fs.readdir(dir)).filter((name) => name.includes(".tmp"))).toEqual([]);
  });
});
