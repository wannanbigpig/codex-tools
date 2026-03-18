import { NetworkError, ErrorCode } from "../core/errors";

const DEFAULT_FETCH_TIMEOUT_MS = 15000;

export async function fetchWithTimeout(
  input: string | URL | globalThis.Request,
  init: RequestInit = {},
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
  timeoutLabel = "Request"
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new NetworkError(`${timeoutLabel} timed out after ${Math.round(timeoutMs / 1000)}s`, {
        code: ErrorCode.NETWORK_ERROR,
        cause: error,
        context: { timeoutMs, timeoutLabel }
      });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
