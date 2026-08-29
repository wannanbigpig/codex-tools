import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

const REMOVE_RETRY_DELAYS_MS = [0, 50, 100, 200, 400, 800];
const TRANSIENT_REMOVE_CODES = new Set(["EACCES", "EBUSY", "ENOTEMPTY", "EPERM"]);

type RemoveDirectory = (targetPath: string, options: { recursive: true; force: true }) => Promise<void>;

export async function removeTestDirectory(
  targetPath: string,
  dependencies: {
    remove?: RemoveDirectory;
    wait?: (milliseconds: number) => Promise<void>;
  } = {}
): Promise<void> {
  const resolvedTempRoot = path.resolve(os.tmpdir());
  const resolvedTarget = path.resolve(targetPath);
  const relativeTarget = path.relative(resolvedTempRoot, resolvedTarget);
  if (!relativeTarget || relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) {
    throw new Error(`Refusing to remove a test directory outside the system temp folder: ${resolvedTarget}`);
  }

  const remove = dependencies.remove ?? fs.rm;
  const wait = dependencies.wait ?? delay;
  let lastError: unknown;
  for (const retryDelayMs of REMOVE_RETRY_DELAYS_MS) {
    if (retryDelayMs > 0) {
      await wait(retryDelayMs);
    }
    try {
      await remove(resolvedTarget, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      if (!isTransientRemoveError(error)) {
        throw error;
      }
    }
  }
  throw lastError;
}

function isTransientRemoveError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    TRANSIENT_REMOVE_CODES.has(String((error as { code?: unknown }).code))
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
