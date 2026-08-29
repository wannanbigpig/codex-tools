import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import type { CodexTokens } from "../src/core/types";

const { writeAuthFileMock, readAuthFileMock } = vi.hoisted(() => ({
  writeAuthFileMock: vi.fn(),
  readAuthFileMock: vi.fn()
}));

vi.mock("../src/codex", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/codex")>();
  return {
    ...actual,
    readAuthFile: readAuthFileMock,
    writeAuthFile: writeAuthFileMock
  };
});

import { AccountsRepository } from "../src/storage";
import { mirrorAideckCodexAccount } from "../src/storage/aideckCodexStorage";
import { buildAccountStorageId } from "../src/utils/accountIdentity";
import { removeTestDirectory } from "./testFilesystem";

function createJwt(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `header.${encoded}.signature`;
}

function createTokens(
  accountId = "acct_123",
  email = "dev@example.com",
  options: {
    organizationId?: string;
    userId?: string;
  } = {}
): CodexTokens {
  const authPayload: Record<string, unknown> = {
    chatgpt_account_id: accountId
  };
  if (options.organizationId) {
    authPayload["organization_id"] = options.organizationId;
  }
  if (options.userId) {
    authPayload["chatgpt_user_id"] = options.userId;
  }

  return {
    idToken: createJwt({
      email,
      "https://api.openai.com/auth": authPayload
    }),
    accessToken: createJwt({
      "https://api.openai.com/auth": authPayload
    }),
    refreshToken: "refresh-token",
    accountId
  };
}

async function writeAideckAccountJson(accountId: string, value: Record<string, unknown>): Promise<void> {
  const root = path.join(process.env.AIDECK_DATA_DIR as string, "accounts", "codex");
  const accountFile = path.join(root, "accounts", `${accountId}.json`);
  await fs.mkdir(path.dirname(accountFile), { recursive: true });
  await fs.writeFile(accountFile, JSON.stringify(value), "utf8");
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(
    path.join(root, "accounts-index.json"),
    JSON.stringify({
      schema_version: 1,
      accounts: [
        {
          id: accountId,
          email: value.email,
          updated_at: Date.now()
        }
      ]
    }),
    "utf8"
  );
}

describe("AccountsRepository token persistence", () => {
  let tempDir: string;
  let originalAideckDataDir: string | undefined;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-accounts-test-"));
    originalAideckDataDir = process.env.AIDECK_DATA_DIR;
    process.env.AIDECK_DATA_DIR = path.join(tempDir, "aideck-data");
    writeAuthFileMock.mockReset();
    readAuthFileMock.mockReset().mockResolvedValue(undefined);
  });

  afterEach(async () => {
    if (originalAideckDataDir === undefined) {
      delete process.env.AIDECK_DATA_DIR;
    } else {
      process.env.AIDECK_DATA_DIR = originalAideckDataDir;
    }
    await removeTestDirectory(tempDir);
  }, 15_000);

  it("syncs active auth.json when quota refresh produces updated tokens", async () => {
    const secrets = new Map<string, string>();
    const context = {
      globalStorageUri: {
        fsPath: tempDir
      },
      secrets: {
        get: vi.fn(async (key: string) => secrets.get(key)),
        store: vi.fn(async (key: string, value: string) => {
          secrets.set(key, value);
        }),
        delete: vi.fn(async (key: string) => {
          secrets.delete(key);
        })
      }
    } as unknown as vscode.ExtensionContext;
    await fs.writeFile(
      path.join(tempDir, "accounts-index.json"),
      JSON.stringify({
        currentAccountId: "account-1",
        accounts: [
          {
            id: "account-1",
            email: "dev@example.com",
            accountName: "Dev",
            accountId: "acct_123",
            isActive: true,
            createdAt: 1,
            updatedAt: 1,
            quotaError: {
              message: "Token expired",
              timestamp: 1
            }
          }
        ]
      }),
      "utf8"
    );

    const repo = new AccountsRepository(context);
    const updatedTokens = createTokens("acct_123");

    await repo.updateQuota("account-1", undefined, undefined, updatedTokens);

    expect(writeAuthFileMock).toHaveBeenCalledWith(updatedTokens);
    expect(JSON.parse(secrets.get("codex.account.account-1") ?? "{}")).toMatchObject({
      refreshToken: "refresh-token",
      accountId: "acct_123"
    });
    expect((await repo.getAccount("account-1"))?.quotaError).toBeUndefined();

    repo.dispose();
  });

  it("hydrates stored tokens from external auth.json changes without rewriting auth.json", async () => {
    const secrets = new Map<string, string>();
    const context = {
      globalStorageUri: {
        fsPath: tempDir
      },
      secrets: {
        get: vi.fn(async (key: string) => secrets.get(key)),
        store: vi.fn(async (key: string, value: string) => {
          secrets.set(key, value);
        }),
        delete: vi.fn(async (key: string) => {
          secrets.delete(key);
        })
      }
    } as unknown as vscode.ExtensionContext;
    const storageId = buildAccountStorageId("dev@example.com", "acct_123", undefined);
    await fs.writeFile(
      path.join(tempDir, "accounts-index.json"),
      JSON.stringify({
        currentAccountId: undefined,
        accounts: [
          {
            id: storageId,
            email: "dev@example.com",
            accountName: "Dev",
            accountId: "acct_123",
            isActive: false,
            createdAt: 1,
            updatedAt: 1,
            quotaError: {
              message: "Token expired",
              timestamp: 1
            }
          }
        ]
      }),
      "utf8"
    );
    await context.secrets.store(`codex.account.${storageId}`, JSON.stringify(createTokens("acct_123")));

    const externalTokens = createTokens("acct_123");
    externalTokens.accessToken = createJwt({
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acct_123"
      }
    });
    externalTokens.refreshToken = "refreshed-token";
    readAuthFileMock.mockResolvedValue({
      OPENAI_API_KEY: null,
      tokens: {
        id_token: externalTokens.idToken,
        access_token: externalTokens.accessToken,
        refresh_token: externalTokens.refreshToken,
        account_id: externalTokens.accountId
      },
      last_refresh: new Date().toISOString()
    });

    const repo = new AccountsRepository(context);
    await repo.syncActiveAccountFromAuthFile();

    expect(writeAuthFileMock).not.toHaveBeenCalled();
    expect(JSON.parse(secrets.get(`codex.account.${storageId}`) ?? "{}")).toMatchObject({
      refreshToken: "refreshed-token",
      accountId: "acct_123"
    });
    expect((await repo.getAccount(storageId))?.isActive).toBe(true);
    expect((await repo.getAccount(storageId))?.quotaError).toBeUndefined();

    repo.dispose();
  });

  it("reads fresher Codex tokens from Aideck account storage", async () => {
    const secrets = new Map<string, string>();
    const context = {
      globalStorageUri: {
        fsPath: tempDir
      },
      secrets: {
        get: vi.fn(async (key: string) => secrets.get(key)),
        store: vi.fn(async (key: string, value: string) => {
          secrets.set(key, value);
        }),
        delete: vi.fn(async (key: string) => {
          secrets.delete(key);
        })
      }
    } as unknown as vscode.ExtensionContext;
    const storageId = buildAccountStorageId("dev@example.com", "acct_123", undefined);
    await fs.writeFile(
      path.join(tempDir, "accounts-index.json"),
      JSON.stringify({
        currentAccountId: storageId,
        accounts: [
          {
            id: storageId,
            email: "dev@example.com",
            accountName: "Dev",
            accountId: "acct_123",
            isActive: true,
            createdAt: 1,
            updatedAt: 1
          }
        ]
      }),
      "utf8"
    );
    await context.secrets.store(`codex.account.${storageId}`, JSON.stringify(createTokens("acct_123")));

    const externalTokens = createTokens("acct_123");
    externalTokens.refreshToken = "aideck-refreshed-token";
    const aideckAccountFile = path.join(
      process.env.AIDECK_DATA_DIR as string,
      "accounts",
      "codex",
      "accounts",
      `${storageId}.json`
    );
    await fs.mkdir(path.dirname(aideckAccountFile), { recursive: true });
    await fs.writeFile(
      aideckAccountFile,
      JSON.stringify({
        id: storageId,
        email: "dev@example.com",
        tokens: {
          id_token: externalTokens.idToken,
          access_token: externalTokens.accessToken,
          refresh_token: externalTokens.refreshToken,
          account_id: externalTokens.accountId
        }
      }),
      "utf8"
    );

    const repo = new AccountsRepository(context);
    const merged = await repo.getTokens(storageId);

    expect(merged?.refreshToken).toBe("aideck-refreshed-token");
    expect(JSON.parse(secrets.get(`codex.account.${storageId}`) ?? "{}")).toMatchObject({
      refreshToken: "aideck-refreshed-token",
      accountId: "acct_123"
    });

    repo.dispose();
  });

  it("imports missing accounts from Aideck mirror on init", async () => {
    const secrets = new Map<string, string>();
    const context = {
      globalStorageUri: {
        fsPath: tempDir
      },
      secrets: {
        get: vi.fn(async (key: string) => secrets.get(key)),
        store: vi.fn(async (key: string, value: string) => {
          secrets.set(key, value);
        }),
        delete: vi.fn(async (key: string) => {
          secrets.delete(key);
        })
      }
    } as unknown as vscode.ExtensionContext;
    const aideckTokens = createTokens("acct_aideck", "aideck@example.com");
    const storageId = buildAccountStorageId("aideck@example.com", "acct_aideck", undefined);
    await writeAideckAccountJson(storageId, {
      id: storageId,
      email: "aideck@example.com",
      plan_type: "plus",
      account_name: "Aideck Team",
      account_id: "acct_aideck",
      added_via: "oauth",
      tokens: {
        id_token: aideckTokens.idToken,
        access_token: aideckTokens.accessToken,
        refresh_token: "aideck-refresh-token",
        account_id: "acct_aideck"
      },
      quota: {
        hourly_percentage: 88,
        hourly_window_present: true,
        hourly_window_minutes: 300,
        weekly_percentage: 96,
        weekly_window_present: true,
        weekly_window_minutes: 10080,
        code_review_percentage: 0
      },
      tags: ["from-aideck"]
    });

    const repo = new AccountsRepository(context);
    await repo.init();

    const imported = await repo.getAccount(storageId);
    expect(imported).toMatchObject({
      id: storageId,
      email: "aideck@example.com",
      planType: "plus",
      accountName: "Aideck Team",
      accountId: "acct_aideck",
      tags: ["from-aideck"]
    });
    expect(imported?.quotaSummary?.weeklyPercentage).toBe(96);
    expect(JSON.parse(secrets.get(`codex.account.${storageId}`) ?? "{}")).toMatchObject({
      refreshToken: "aideck-refresh-token",
      accountId: "acct_aideck"
    });

    repo.dispose();
  });

  it("does not re-import a stale Aideck mirror entry when sync has a deletion tombstone", async () => {
    const secrets = new Map<string, string>();
    const context = {
      globalStorageUri: {
        fsPath: tempDir
      },
      secrets: {
        get: vi.fn(async (key: string) => secrets.get(key)),
        store: vi.fn(async (key: string, value: string) => {
          secrets.set(key, value);
        }),
        delete: vi.fn(async (key: string) => {
          secrets.delete(key);
        })
      }
    } as unknown as vscode.ExtensionContext;
    const aideckTokens = createTokens("acct_stale", "stale@example.com");
    const storageId = buildAccountStorageId("stale@example.com", "acct_stale", undefined);
    await writeAideckAccountJson(storageId, {
      id: storageId,
      email: "stale@example.com",
      account_id: "acct_stale",
      tokens: {
        id_token: aideckTokens.idToken,
        access_token: aideckTokens.accessToken,
        refresh_token: "stale-refresh-token",
        account_id: "acct_stale"
      }
    });

    const repo = new AccountsRepository(context);
    repo.setAccountSwitchCoordinator({
      isAccountDeletionPending: (accountId) => accountId === storageId
    });
    await repo.init();

    expect(await repo.getAccount(storageId)).toBeUndefined();
    expect(secrets.get(`codex.account.${storageId}`)).toBeUndefined();
    repo.dispose();
  });

  it("does not absorb an Aideck token from a different organization when accountId is shared", async () => {
    const secrets = new Map<string, string>();
    const context = {
      globalStorageUri: {
        fsPath: tempDir
      },
      secrets: {
        get: vi.fn(async (key: string) => secrets.get(key)),
        store: vi.fn(async (key: string, value: string) => {
          secrets.set(key, value);
        }),
        delete: vi.fn(async (key: string) => {
          secrets.delete(key);
        })
      }
    } as unknown as vscode.ExtensionContext;
    const storageId = buildAccountStorageId("dev@example.com", "acct_shared", "org_team");
    await fs.writeFile(
      path.join(tempDir, "accounts-index.json"),
      JSON.stringify({
        currentAccountId: storageId,
        accounts: [
          {
            id: storageId,
            email: "dev@example.com",
            userId: "user_same",
            accountId: "acct_shared",
            organizationId: "org_team",
            isActive: true,
            createdAt: 1,
            updatedAt: 1
          }
        ]
      }),
      "utf8"
    );
    await context.secrets.store(
      `codex.account.${storageId}`,
      JSON.stringify(
        createTokens("acct_shared", "dev@example.com", { organizationId: "org_team", userId: "user_same" })
      )
    );

    const externalTokens = createTokens("acct_shared", "dev@example.com", {
      organizationId: "org_plus",
      userId: "user_same"
    });
    externalTokens.refreshToken = "wrong-org-refresh-token";
    const aideckAccountFile = path.join(
      process.env.AIDECK_DATA_DIR as string,
      "accounts",
      "codex",
      "accounts",
      `${storageId}.json`
    );
    await fs.mkdir(path.dirname(aideckAccountFile), { recursive: true });
    await fs.writeFile(
      aideckAccountFile,
      JSON.stringify({
        id: storageId,
        email: "dev@example.com",
        organization_id: "org_plus",
        user_id: "user_same",
        tokens: {
          id_token: externalTokens.idToken,
          access_token: externalTokens.accessToken,
          refresh_token: externalTokens.refreshToken,
          account_id: externalTokens.accountId
        }
      }),
      "utf8"
    );

    const repo = new AccountsRepository(context);
    const merged = await repo.getTokens(storageId);

    expect(merged?.refreshToken).toBe("refresh-token");
    expect(merged?.accessToken).not.toBe(externalTokens.accessToken);
    expect(JSON.parse(secrets.get(`codex.account.${storageId}`) ?? "{}")).toMatchObject({
      refreshToken: "refresh-token",
      accountId: "acct_shared"
    });

    repo.dispose();
  });

  it("ignores Aideck mirror tokens when mirror identity and embedded tokens disagree", async () => {
    const secrets = new Map<string, string>();
    const context = {
      globalStorageUri: {
        fsPath: tempDir
      },
      secrets: {
        get: vi.fn(async (key: string) => secrets.get(key)),
        store: vi.fn(async (key: string, value: string) => {
          secrets.set(key, value);
        }),
        delete: vi.fn(async (key: string) => {
          secrets.delete(key);
        })
      }
    } as unknown as vscode.ExtensionContext;
    const storageId = buildAccountStorageId("dev@example.com", "acct_shared", "org_team");
    await fs.writeFile(
      path.join(tempDir, "accounts-index.json"),
      JSON.stringify({
        currentAccountId: storageId,
        accounts: [
          {
            id: storageId,
            email: "dev@example.com",
            userId: "user_same",
            accountId: "acct_shared",
            organizationId: "org_team",
            isActive: true,
            createdAt: 1,
            updatedAt: 1
          }
        ]
      }),
      "utf8"
    );

    const wrongOrgTokens = createTokens("acct_shared", "dev@example.com", {
      organizationId: "org_plus",
      userId: "user_same"
    });
    await writeAideckAccountJson(storageId, {
      id: storageId,
      email: "dev@example.com",
      user_id: "user_same",
      account_id: "acct_shared",
      organization_id: "org_team",
      tokens: {
        id_token: wrongOrgTokens.idToken,
        access_token: wrongOrgTokens.accessToken,
        refresh_token: "wrong-org-refresh-token",
        account_id: wrongOrgTokens.accountId
      }
    });

    const repo = new AccountsRepository(context);
    const merged = await repo.getTokens(storageId);

    expect(merged).toBeUndefined();
    expect(secrets.get(`codex.account.${storageId}`)).toBeUndefined();

    repo.dispose();
  });

  it("does not overwrite existing VS Code accounts from Aideck mirror on init", async () => {
    const secrets = new Map<string, string>();
    const context = {
      globalStorageUri: {
        fsPath: tempDir
      },
      secrets: {
        get: vi.fn(async (key: string) => secrets.get(key)),
        store: vi.fn(async (key: string, value: string) => {
          secrets.set(key, value);
        }),
        delete: vi.fn(async (key: string) => {
          secrets.delete(key);
        })
      }
    } as unknown as vscode.ExtensionContext;
    const storageId = buildAccountStorageId("dev@example.com", "acct_123", undefined);
    await fs.writeFile(
      path.join(tempDir, "accounts-index.json"),
      JSON.stringify({
        accounts: [
          {
            id: storageId,
            email: "dev@example.com",
            accountName: "VS Code Source",
            accountId: "acct_123",
            planType: "team",
            isActive: false,
            createdAt: 1,
            updatedAt: 2
          }
        ]
      }),
      "utf8"
    );
    await context.secrets.store(`codex.account.${storageId}`, JSON.stringify(createTokens("acct_123")));
    const aideckTokens = createTokens("acct_123", "dev@example.com");
    await writeAideckAccountJson(storageId, {
      id: storageId,
      email: "dev@example.com",
      plan_type: "plus",
      account_name: "Stale Aideck Source",
      account_id: "acct_123",
      tokens: {
        id_token: aideckTokens.idToken,
        access_token: aideckTokens.accessToken,
        refresh_token: "stale-aideck-refresh",
        account_id: "acct_123"
      }
    });

    const repo = new AccountsRepository(context);
    await repo.init();

    const account = await repo.getAccount(storageId);
    expect(account?.accountName).toBe("VS Code Source");
    expect(account?.planType).toBe("team");

    repo.dispose();
  });

  it("removes Aideck mirror data so deleted accounts are not re-imported on next init", async () => {
    const secrets = new Map<string, string>();
    const context = {
      globalStorageUri: {
        fsPath: tempDir
      },
      secrets: {
        get: vi.fn(async (key: string) => secrets.get(key)),
        store: vi.fn(async (key: string, value: string) => {
          secrets.set(key, value);
        }),
        delete: vi.fn(async (key: string) => {
          secrets.delete(key);
        })
      }
    } as unknown as vscode.ExtensionContext;
    const aideckTokens = createTokens("acct_aideck", "aideck@example.com");
    const storageId = buildAccountStorageId("aideck@example.com", "acct_aideck", undefined);
    await writeAideckAccountJson(storageId, {
      id: storageId,
      email: "aideck@example.com",
      account_id: "acct_aideck",
      tokens: {
        id_token: aideckTokens.idToken,
        access_token: aideckTokens.accessToken,
        refresh_token: "aideck-refresh-token",
        account_id: "acct_aideck"
      }
    });
    await fs.writeFile(
      path.join(process.env.AIDECK_DATA_DIR as string, "accounts", "codex", "current.json"),
      JSON.stringify({
        id: storageId,
        updated_at: Date.now()
      }),
      "utf8"
    );

    const repo = new AccountsRepository(context);
    await repo.init();
    await repo.removeAccount(storageId);
    repo.dispose();

    const accountFile = path.join(
      process.env.AIDECK_DATA_DIR as string,
      "accounts",
      "codex",
      "accounts",
      `${storageId}.json`
    );
    await expect(fs.readFile(accountFile, "utf8")).rejects.toThrow();

    const aideckIndex = JSON.parse(
      await fs.readFile(
        path.join(process.env.AIDECK_DATA_DIR as string, "accounts", "codex", "accounts-index.json"),
        "utf8"
      )
    );
    expect(aideckIndex.accounts).not.toContainEqual(expect.objectContaining({ id: storageId }));

    await expect(
      fs.readFile(path.join(process.env.AIDECK_DATA_DIR as string, "accounts", "codex", "current.json"), "utf8")
    ).rejects.toThrow();

    const reloaded = new AccountsRepository(context);
    await reloaded.init();

    expect(await reloaded.getAccount(storageId)).toBeUndefined();

    reloaded.dispose();
  });

  it("does not replace a valid stored access token with an expired Aideck token", async () => {
    const secrets = new Map<string, string>();
    const context = {
      globalStorageUri: {
        fsPath: tempDir
      },
      secrets: {
        get: vi.fn(async (key: string) => secrets.get(key)),
        store: vi.fn(async (key: string, value: string) => {
          secrets.set(key, value);
        }),
        delete: vi.fn(async (key: string) => {
          secrets.delete(key);
        })
      }
    } as unknown as vscode.ExtensionContext;
    const storageId = buildAccountStorageId("dev@example.com", "acct_123", undefined);
    await fs.writeFile(
      path.join(tempDir, "accounts-index.json"),
      JSON.stringify({
        currentAccountId: storageId,
        accounts: [
          {
            id: storageId,
            email: "dev@example.com",
            accountName: "Dev",
            accountId: "acct_123",
            isActive: true,
            createdAt: 1,
            updatedAt: 1
          }
        ]
      }),
      "utf8"
    );
    const storedTokens = createTokens("acct_123");
    await context.secrets.store(`codex.account.${storageId}`, JSON.stringify(storedTokens));

    const expiredAideckTokens = createTokens("acct_123");
    expiredAideckTokens.accessToken = createJwt({
      exp: 1,
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acct_123"
      }
    });
    expiredAideckTokens.refreshToken = "expired-aideck-refresh";
    const aideckAccountFile = path.join(
      process.env.AIDECK_DATA_DIR as string,
      "accounts",
      "codex",
      "accounts",
      `${storageId}.json`
    );
    await fs.mkdir(path.dirname(aideckAccountFile), { recursive: true });
    await fs.writeFile(
      aideckAccountFile,
      JSON.stringify({
        id: storageId,
        email: "dev@example.com",
        tokens: {
          id_token: expiredAideckTokens.idToken,
          access_token: expiredAideckTokens.accessToken,
          refresh_token: expiredAideckTokens.refreshToken,
          account_id: expiredAideckTokens.accountId
        }
      }),
      "utf8"
    );

    const repo = new AccountsRepository(context);
    const merged = await repo.getTokens(storageId);

    expect(merged?.accessToken).toBe(storedTokens.accessToken);
    expect(merged?.refreshToken).toBe("refresh-token");

    repo.dispose();
  });

  it("mirrors refreshed tokens and quota to Aideck account storage", async () => {
    const secrets = new Map<string, string>();
    const context = {
      globalStorageUri: {
        fsPath: tempDir
      },
      secrets: {
        get: vi.fn(async (key: string) => secrets.get(key)),
        store: vi.fn(async (key: string, value: string) => {
          secrets.set(key, value);
        }),
        delete: vi.fn(async (key: string) => {
          secrets.delete(key);
        })
      }
    } as unknown as vscode.ExtensionContext;
    const storageId = buildAccountStorageId("dev@example.com", "acct_123", undefined);
    await fs.writeFile(
      path.join(tempDir, "accounts-index.json"),
      JSON.stringify({
        currentAccountId: storageId,
        accounts: [
          {
            id: storageId,
            email: "dev@example.com",
            accountName: "Dev",
            accountId: "acct_123",
            planType: "plus",
            isActive: true,
            createdAt: 1,
            updatedAt: 1
          }
        ]
      }),
      "utf8"
    );

    const repo = new AccountsRepository(context);
    const updatedTokens = createTokens("acct_123");
    updatedTokens.refreshToken = "shared-refresh-token";

    await repo.updateQuota(
      storageId,
      {
        hourlyPercentage: 91,
        hourlyResetTime: 1_800_000_000,
        hourlyWindowMinutes: 300,
        hourlyWindowPresent: true,
        weeklyPercentage: 64,
        weeklyResetTime: 1_800_100_000,
        weeklyWindowMinutes: 10080,
        weeklyWindowPresent: true,
        codeReviewPercentage: 64,
        codeReviewWindowPresent: false
      },
      undefined,
      updatedTokens,
      undefined,
      "1800000000"
    );

    const aideckAccountFile = path.join(
      process.env.AIDECK_DATA_DIR as string,
      "accounts",
      "codex",
      "accounts",
      `${storageId}.json`
    );
    const aideckAccount = JSON.parse(await fs.readFile(aideckAccountFile, "utf8"));
    expect(aideckAccount.tokens.refresh_token).toBe("shared-refresh-token");
    expect(aideckAccount.quota.hourly_percentage).toBe(91);
    expect(aideckAccount.quota.weekly_percentage).toBe(64);
    expect(aideckAccount.plan_type).toBe("plus");
    expect(aideckAccount.subscription_active_until).toBe("1800000000");

    const aideckCurrent = JSON.parse(
      await fs.readFile(path.join(process.env.AIDECK_DATA_DIR as string, "accounts", "codex", "current.json"), "utf8")
    );
    expect(aideckCurrent.id).toBe(storageId);

    const aideckIndex = JSON.parse(
      await fs.readFile(
        path.join(process.env.AIDECK_DATA_DIR as string, "accounts", "codex", "accounts-index.json"),
        "utf8"
      )
    );
    expect(aideckIndex.accounts).toContainEqual(expect.objectContaining({ id: storageId, has_quota: true }));

    repo.dispose();
  });

  it("preserves existing Aideck workspace metadata and quota when codex-tools mirrors tokens", async () => {
    const secrets = new Map<string, string>();
    const context = {
      globalStorageUri: {
        fsPath: tempDir
      },
      secrets: {
        get: vi.fn(async (key: string) => secrets.get(key)),
        store: vi.fn(async (key: string, value: string) => {
          secrets.set(key, value);
        }),
        delete: vi.fn(async (key: string) => {
          secrets.delete(key);
        })
      }
    } as unknown as vscode.ExtensionContext;
    const storageId = buildAccountStorageId("dev@example.com", "acct_123", "org_team");
    await fs.writeFile(
      path.join(tempDir, "accounts-index.json"),
      JSON.stringify({
        currentAccountId: storageId,
        accounts: [
          {
            id: storageId,
            email: "dev@example.com",
            userId: "user_same",
            accountId: "acct_123",
            organizationId: "org_team",
            accountName: "VS Code Personal",
            accountStructure: "personal",
            planType: "plus",
            isActive: true,
            createdAt: 1,
            updatedAt: 1
          }
        ]
      }),
      "utf8"
    );
    await writeAideckAccountJson(storageId, {
      id: storageId,
      email: "dev@example.com",
      user_id: "user_same",
      account_id: "acct_123",
      organization_id: "org_team",
      plan_type: "team",
      subscription_active_until: "1900000000",
      account_name: "Aideck Team Workspace",
      account_structure: "organization",
      quota: {
        hourly_percentage: 12,
        weekly_percentage: 34,
        code_review_percentage: 0,
        updated_at: 123
      },
      tokens: {
        id_token: createTokens("acct_123", "dev@example.com", { organizationId: "org_team", userId: "user_same" })
          .idToken,
        access_token: createTokens("acct_123", "dev@example.com", { organizationId: "org_team", userId: "user_same" })
          .accessToken,
        refresh_token: "old-aideck-refresh",
        account_id: "acct_123"
      }
    });

    const repo = new AccountsRepository(context);
    const updatedTokens = createTokens("acct_123", "dev@example.com", {
      organizationId: "org_team",
      userId: "user_same"
    });
    updatedTokens.refreshToken = "shared-refresh-token";

    await repo.updateQuota(
      storageId,
      {
        hourlyPercentage: 91,
        hourlyResetTime: 1_800_000_000,
        hourlyWindowMinutes: 300,
        hourlyWindowPresent: true,
        weeklyPercentage: 64,
        weeklyResetTime: 1_800_100_000,
        weeklyWindowMinutes: 10080,
        weeklyWindowPresent: true,
        codeReviewPercentage: 64,
        codeReviewWindowPresent: false
      },
      undefined,
      updatedTokens,
      undefined,
      "1800000000"
    );

    const aideckAccountFile = path.join(
      process.env.AIDECK_DATA_DIR as string,
      "accounts",
      "codex",
      "accounts",
      `${storageId}.json`
    );
    const aideckAccount = JSON.parse(await fs.readFile(aideckAccountFile, "utf8"));
    expect(aideckAccount.tokens.refresh_token).toBe("shared-refresh-token");
    expect(aideckAccount.plan_type).toBe("team");
    expect(aideckAccount.subscription_active_until).toBe("1900000000");
    expect(aideckAccount.account_name).toBe("Aideck Team Workspace");
    expect(aideckAccount.account_structure).toBe("organization");
    expect(aideckAccount.quota.hourly_percentage).toBe(12);
    expect(aideckAccount.quota.weekly_percentage).toBe(34);

    repo.dispose();
  });

  it("does not overwrite Aideck mirror tokens when supplied tokens do not match account identity", async () => {
    const storageId = buildAccountStorageId("dev@example.com", "acct_123", "org_team");
    const existingTokens = createTokens("acct_123", "dev@example.com", {
      organizationId: "org_team",
      userId: "user_same"
    });
    await writeAideckAccountJson(storageId, {
      id: storageId,
      email: "dev@example.com",
      user_id: "user_same",
      account_id: "acct_123",
      organization_id: "org_team",
      tokens: {
        id_token: existingTokens.idToken,
        access_token: existingTokens.accessToken,
        refresh_token: existingTokens.refreshToken,
        account_id: existingTokens.accountId
      }
    });

    await mirrorAideckCodexAccount(
      {
        id: storageId,
        email: "dev@example.com",
        userId: "user_same",
        accountId: "acct_123",
        organizationId: "org_team",
        isActive: false,
        createdAt: 1,
        updatedAt: 1
      },
      createTokens("acct_123", "dev@example.com", {
        organizationId: "org_plus",
        userId: "user_same"
      })
    );

    const aideckAccountFile = path.join(
      process.env.AIDECK_DATA_DIR as string,
      "accounts",
      "codex",
      "accounts",
      `${storageId}.json`
    );
    const aideckAccount = JSON.parse(await fs.readFile(aideckAccountFile, "utf8"));
    expect(aideckAccount.tokens.id_token).toBe(existingTokens.idToken);
    expect(aideckAccount.tokens.access_token).toBe(existingTokens.accessToken);
    expect(aideckAccount.tokens.refresh_token).toBe(existingTokens.refreshToken);
  });

  it("repairs status visibility when force-activating an OAuth account", async () => {
    const secrets = new Map<string, string>();
    const context = {
      globalStorageUri: {
        fsPath: tempDir
      },
      secrets: {
        get: vi.fn(async (key: string) => secrets.get(key)),
        store: vi.fn(async (key: string, value: string) => {
          secrets.set(key, value);
        }),
        delete: vi.fn(async (key: string) => {
          secrets.delete(key);
        })
      }
    } as unknown as vscode.ExtensionContext;
    const activeId = buildAccountStorageId("oauth@example.com", "acct_oauth", undefined);
    await fs.writeFile(
      path.join(tempDir, "accounts-index.json"),
      JSON.stringify({
        currentAccountId: activeId,
        accounts: [
          {
            id: activeId,
            email: "oauth@example.com",
            accountId: "acct_oauth",
            isActive: true,
            showInStatusBar: false,
            createdAt: 1,
            updatedAt: 1
          },
          {
            id: "extra-visible",
            email: "extra@example.com",
            isActive: false,
            showInStatusBar: true,
            createdAt: 1,
            updatedAt: 1
          }
        ]
      }),
      "utf8"
    );

    const repo = new AccountsRepository(context);
    const imported = await repo.upsertFromTokens(createTokens("acct_new", "new@example.com"), true);
    const accounts = await repo.listAccounts();

    expect(imported.isActive).toBe(true);
    expect(accounts.find((account) => account.id === imported.id)?.showInStatusBar).toBe(false);
    expect(accounts.find((account) => account.id === activeId)?.showInStatusBar).toBe(true);

    repo.dispose();
  });

  it("imports new and overwrites existing exported accounts when old tokens lack email claims", async () => {
    const secrets = new Map<string, string>();
    const context = {
      globalStorageUri: {
        fsPath: tempDir
      },
      secrets: {
        get: vi.fn(async (key: string) => secrets.get(key)),
        store: vi.fn(async (key: string, value: string) => {
          secrets.set(key, value);
        }),
        delete: vi.fn(async (key: string) => {
          secrets.delete(key);
        })
      }
    } as unknown as vscode.ExtensionContext;
    const repo = new AccountsRepository(context);
    const existing = await repo.upsertFromTokens(createTokens("acct_existing", "existing@example.com"));
    const oldIdToken = createJwt({
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acct_existing"
      }
    });

    const result = await repo.importSharedAccountsWithSummary({
      id: existing.id,
      email: existing.email,
      account_id: "acct_existing",
      tokens: {
        id_token: oldIdToken,
        access_token: "invalidated-opaque-access-token",
        refresh_token: "replacement-refresh-token",
        account_id: "acct_existing"
      }
    });

    expect(result).toMatchObject({
      total: 1,
      successCount: 1,
      overwriteCount: 1,
      failedCount: 0
    });
    expect(await repo.listAccounts()).toHaveLength(1);
    expect((await repo.getTokens(existing.id))?.refreshToken).toBe("replacement-refresh-token");

    const newResult = await repo.importSharedAccountsWithSummary({
      email: "new-legacy@example.com",
      account_id: "acct_new_legacy",
      tokens: {
        id_token: createJwt({
          "https://api.openai.com/auth": {
            chatgpt_account_id: "acct_new_legacy"
          }
        }),
        access_token: "another-invalidated-opaque-access-token",
        refresh_token: "new-refresh-token",
        account_id: "acct_new_legacy"
      }
    });

    expect(newResult).toMatchObject({
      total: 1,
      successCount: 1,
      overwriteCount: 0,
      failedCount: 0
    });
    expect(await repo.listAccounts()).toHaveLength(2);

    repo.dispose();
  });

  it("clears a stale auth error only when shared import replaces the credentials", async () => {
    const secrets = new Map<string, string>();
    const context = {
      globalStorageUri: {
        fsPath: tempDir
      },
      secrets: {
        get: vi.fn(async (key: string) => secrets.get(key)),
        store: vi.fn(async (key: string, value: string) => {
          secrets.set(key, value);
        }),
        delete: vi.fn(async (key: string) => {
          secrets.delete(key);
        })
      }
    } as unknown as vscode.ExtensionContext;
    const repo = new AccountsRepository(context);
    const originalTokens = createTokens("acct_sync", "sync@example.com");
    const account = await repo.upsertFromTokens(originalTokens);
    const authError = {
      code: "unauthorized",
      message: "API returned 401: token expired",
      timestamp: 100
    };

    await repo.updateQuota(account.id, undefined, authError);
    await repo.importSharedAccountsWithSummary({
      id: account.id,
      email: account.email,
      account_id: account.accountId,
      tokens: {
        id_token: originalTokens.idToken,
        access_token: originalTokens.accessToken,
        refresh_token: originalTokens.refreshToken,
        account_id: originalTokens.accountId
      }
    });
    expect((await repo.getAccount(account.id))?.quotaError).toEqual(authError);

    const replacementTokens = { ...originalTokens, refreshToken: "reauthorized-refresh-token" };
    await repo.importSharedAccountsWithSummary({
      id: account.id,
      email: account.email,
      account_id: account.accountId,
      tokens: {
        id_token: replacementTokens.idToken,
        access_token: replacementTokens.accessToken,
        refresh_token: replacementTokens.refreshToken,
        account_id: replacementTokens.accountId
      }
    });
    expect((await repo.getAccount(account.id))?.quotaError).toBeUndefined();

    repo.dispose();
  });

  it("keeps reset credits expiry when snapshot refresh still has available credits but no expiry", async () => {
    const secrets = new Map<string, string>();
    const context = {
      globalStorageUri: {
        fsPath: tempDir
      },
      secrets: {
        get: vi.fn(async (key: string) => secrets.get(key)),
        store: vi.fn(async (key: string, value: string) => {
          secrets.set(key, value);
        }),
        delete: vi.fn(async (key: string) => {
          secrets.delete(key);
        })
      }
    } as unknown as vscode.ExtensionContext;
    await fs.writeFile(
      path.join(tempDir, "accounts-index.json"),
      JSON.stringify({
        accounts: [
          {
            id: "account-1",
            email: "dev@example.com",
            isActive: false,
            createdAt: 1,
            updatedAt: 1,
            quotaSummary: {
              hourlyPercentage: 90,
              hourlyWindowPresent: true,
              weeklyPercentage: 95,
              weeklyWindowPresent: true,
              codeReviewPercentage: 0,
              resetCreditsAvailable: 1,
              resetCreditsNextExpiresAt: 1_785_109_796
            }
          }
        ]
      }),
      "utf8"
    );

    const repo = new AccountsRepository(context);
    await repo.updateResetCreditsSnapshot("account-1", 1, undefined);

    expect((await repo.getAccount("account-1"))?.quotaSummary?.resetCreditsNextExpiresAt).toBe(1_785_109_796);

    await repo.updateResetCreditsSnapshot("account-1", 0, undefined);

    expect((await repo.getAccount("account-1"))?.quotaSummary?.resetCreditsNextExpiresAt).toBeUndefined();

    repo.dispose();
  });
});
