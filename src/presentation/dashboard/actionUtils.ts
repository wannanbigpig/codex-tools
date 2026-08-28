import type { DashboardHostMessage } from "../../domain/dashboard/types";
import type {
  CodexAccountsBackup,
  CodexAccountsRestoreResult,
  CodexImportResultSummary,
  SharedCodexAccountJson
} from "../../core/types";

export function parseSharedJsonInput(
  jsonText: string,
  onParseError?: (message: string) => string
): SharedCodexAccountJson | SharedCodexAccountJson[] | CodexAccountsBackup {
  const normalized = jsonText.trim();
  if (!normalized) {
    const message = onParseError ? onParseError("Empty JSON input") : "Empty JSON input";
    throw new Error(message);
  }
  if (normalized.length > 32 * 1024 * 1024) {
    throw new Error(onParseError ? onParseError("JSON input exceeds the 32 MB safety limit") : "JSON input exceeds the 32 MB safety limit");
  }

  try {
    return JSON.parse(normalized) as SharedCodexAccountJson | SharedCodexAccountJson[];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(onParseError ? onParseError(message) : message);
  }
}

export function toImportActionPayload(
  result: CodexAccountsRestoreResult | CodexImportResultSummary
): Extract<DashboardHostMessage, { type: "dashboard:action-result" }>["payload"] {
  if ("successCount" in result) {
    return {
      importedCount: result.successCount,
      importedEmails: result.importedEmails,
      importResult: result
    };
  }

  return {
    importedCount: result.restoredCount,
    importedEmails: result.restoredEmails,
    importResult: {
      total: result.restoredCount,
      successCount: result.restoredCount,
      overwriteCount: 0,
      failedCount: 0,
      importedEmails: result.restoredEmails,
      failures: []
    }
  };
}

export function toFailureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
