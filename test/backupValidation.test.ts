import { describe, expect, it } from "vitest";
import type { CodexAccountsBackup } from "../src/core/types";
import { parseAccountsBackup } from "../src/presentation/dashboard/actionHandlers";
import type { parseSharedJsonInput } from "../src/presentation/dashboard/actionUtils";

describe("manual backup validation", () => {
  it("accepts a complete version-one backup", () => {
    const backup = createBackup();
    expect(parseAccountsBackup(asParsedInput(backup))).toBe(backup);
  });

  it("rejects malformed dates, active-account ids, settings, and logs", () => {
    expect(() => parseAccountsBackup(asParsedInput({ ...createBackup(), exportedAt: "not-a-date" }))).toThrow(
      /invalid or unsupported/i
    );
    expect(() => parseAccountsBackup(asParsedInput({ ...createBackup(), activeAccountId: 42 }))).toThrow(
      /invalid or unsupported/i
    );
    expect(() => parseAccountsBackup(asParsedInput({ ...createBackup(), settings: { dashboardTheme: {} } }))).toThrow(
      /invalid or unsupported/i
    );
    expect(() => parseAccountsBackup(asParsedInput({ ...createBackup(), logs: ["safe", 42] }))).toThrow(
      /invalid or unsupported/i
    );
  });
});

function createBackup(): CodexAccountsBackup {
  return {
    format: "codex-accounts-manager-backup",
    version: 1,
    exportedAt: "2026-08-26T00:00:00.000Z",
    accounts: [],
    activeAccountId: "account-one",
    settings: { dashboardTheme: "dark", autoRefreshMinutes: 5 },
    logs: ["sanitized diagnostic"]
  };
}

function asParsedInput(value: unknown): ReturnType<typeof parseSharedJsonInput> {
  return value as ReturnType<typeof parseSharedJsonInput>;
}
