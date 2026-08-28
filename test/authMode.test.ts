import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildCodexAuthFile, ensureCodexAuthFileFormat, writeAuthFile } from "../src/codex/authFile";
import type { CodexAccountRecord, CodexTokens } from "../src/core/types";
import { toSharedAccountJson } from "../src/storage/sharedAccounts";
import { removeTestDirectory } from "./testFilesystem";
import { OAUTH_SCOPES } from "../src/infrastructure/config/apiEndpoints";

function createTokens(): CodexTokens {
  return {
    idToken: "id-token",
    accessToken: "access-token",
    refreshToken: "refresh-token",
    accountId: "account-id"
  };
}

describe("Codex auth mode compatibility", () => {
  it("uses the scopes requested by the Codex VS Code ChatGPT flow", () => {
    expect(OAUTH_SCOPES).toBe("openid profile email offline_access api.connectors.read api.connectors.invoke");
  });

  let tempCodexHome: string;
  let originalCodexHome: string | undefined;

  beforeEach(async () => {
    tempCodexHome = await fs.mkdtemp(path.join(os.tmpdir(), "codex-auth-mode-test-"));
    originalCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = tempCodexHome;
  });

  afterEach(async () => {
    if (originalCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = originalCodexHome;
    }
    await removeTestDirectory(tempCodexHome);
  }, 15_000);

  it("writes Codex's explicit chatgpt auth mode to auth.json", async () => {
    await writeAuthFile(createTokens());

    const authFile = JSON.parse(await fs.readFile(path.join(tempCodexHome, "auth.json"), "utf8"));

    expect(authFile.auth_mode).toBe("chatgpt");
    expect(authFile.OPENAI_API_KEY).toBeNull();
    expect(authFile.tokens.access_token).toBe("access-token");
  });

  it("keeps the complete Codex auth schema when optional token values are unavailable", () => {
    const authFile = buildCodexAuthFile(
      { idToken: "id-token", accessToken: "access-token" },
      new Date("2026-08-28T00:00:00.000Z")
    );

    expect(authFile).toEqual({
      auth_mode: "chatgpt",
      OPENAI_API_KEY: null,
      tokens: {
        id_token: "id-token",
        access_token: "access-token",
        refresh_token: "",
        account_id: ""
      },
      last_refresh: "2026-08-28T00:00:00.000Z"
    });
  });

  it("migrates a legacy active auth file without changing its credentials or refresh time", async () => {
    const legacy = {
      OPENAI_API_KEY: null,
      tokens: {
        id_token: "legacy-id",
        access_token: "legacy-access",
        refresh_token: "legacy-refresh",
        account_id: "legacy-account"
      },
      last_refresh: "2026-08-27T10:20:30.000Z"
    };
    await fs.writeFile(path.join(tempCodexHome, "auth.json"), JSON.stringify(legacy), "utf8");

    await expect(ensureCodexAuthFileFormat()).resolves.toBe(true);
    const migrated = JSON.parse(await fs.readFile(path.join(tempCodexHome, "auth.json"), "utf8"));

    expect(migrated).toEqual({ auth_mode: "chatgpt", ...legacy });
    await expect(ensureCodexAuthFileFormat()).resolves.toBe(false);
  });

  it("omits auth_mode when exporting shared accounts", () => {
    const account: CodexAccountRecord = {
      id: "account",
      email: "dev@example.com",
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_001_000
    };

    const shared = toSharedAccountJson(account, createTokens());

    expect(shared.auth_mode).toBeUndefined();
  });
});
