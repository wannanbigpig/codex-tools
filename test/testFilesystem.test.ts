import * as os from "os";
import * as path from "path";
import { describe, expect, it, vi } from "vitest";
import { removeTestDirectory } from "./testFilesystem";

describe("test filesystem cleanup", () => {
  it("retries transient Windows directory locks", async () => {
    const busy = Object.assign(new Error("directory is busy"), { code: "EBUSY" });
    const remove = vi.fn().mockRejectedValueOnce(busy).mockRejectedValueOnce(busy).mockResolvedValue(undefined);
    const wait = vi.fn().mockResolvedValue(undefined);
    const target = path.join(os.tmpdir(), "codex-cleanup-retry-test");

    await removeTestDirectory(target, { remove, wait });

    expect(remove).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
  });

  it("refuses to recursively remove a path outside the system temp folder", async () => {
    const outside = path.parse(path.resolve(os.tmpdir())).root;
    await expect(removeTestDirectory(outside)).rejects.toThrow(/outside the system temp folder/i);
  });
});
