import { describe, expect, it } from "vitest";
import type { CodexAccountRecord } from "../src/core/types";
import { buildAccountStorageId } from "../src/utils/accountIdentity";
import { cloneIndex, markActive, parseAccountsIndex, syncActiveAccountState } from "../src/storage/accountsIndex";
import { buildAccountRecordDraft } from "../src/storage/accountMetadata";
import {
  addAccountTags,
  dismissAccountHealthIssue,
  removeAccountFromIndex,
  removeAccountTags,
  setAccountEnabled,
  setAccountQueuePriority,
  setStatusBarVisibility,
  switchActiveAccount
} from "../src/storage/accountMutations";
import {
  applyQuotaUpdate,
  applyRemoteProfileFromTokens,
  shouldAttemptRemoteProfileRepair,
  syncLoginAtFromTokens
} from "../src/storage/accountProfileMaintenance";
import {
  fromSharedQuota,
  normalizeAccountTags,
  previewSharedEntry,
  restoreSharedTokens,
  toSharedAccountJson
} from "../src/storage/sharedAccounts";
import {
  applySharedAccountEntry,
  previewSharedAccountsImportEntries,
  toSharedEntries
} from "../src/storage/sharedAccountsImport";

function createJwt(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `header.${encoded}.signature`;
}

describe("accountsIndex helpers", () => {
  it("syncs active flags from current account id", () => {
    const index = cloneIndex({
      currentAccountId: undefined,
      accounts: [
        { id: "a", email: "a@example.com", isActive: false, createdAt: 1, updatedAt: 1 },
        { id: "b", email: "b@example.com", isActive: true, createdAt: 1, updatedAt: 1 }
      ]
    });

    const changed = syncActiveAccountState(index, "a", 50);

    expect(changed).toBe(true);
    expect(index.currentAccountId).toBe("a");
    expect(index.accounts.map((account) => account.isActive)).toEqual([true, false]);
    expect(index.accounts[0]?.sessionStartedAt).toBe(50);

    expect(syncActiveAccountState(index, "a", 100)).toBe(false);
    expect(index.accounts[0]?.sessionStartedAt).toBe(50);
  });

  it("accumulates completed usage separately for each account", () => {
    const index = cloneIndex({
      currentAccountId: "a",
      accounts: [
        {
          id: "a",
          email: "a@example.com",
          isActive: true,
          sessionStartedAt: 1_000,
          totalUsageMs: 5_000,
          createdAt: 1,
          updatedAt: 1
        },
        { id: "b", email: "b@example.com", isActive: false, createdAt: 1, updatedAt: 1 }
      ]
    });

    markActive(index, "b", 11_000);

    expect(index.accounts[0]?.totalUsageMs).toBe(15_000);
    expect(index.accounts[0]?.sessionStartedAt).toBeUndefined();
    expect(index.accounts[1]?.totalUsageMs).toBeUndefined();
    expect(index.accounts[1]?.sessionStartedAt).toBe(11_000);
  });

  it("parses a valid index payload", () => {
    const parsed = parseAccountsIndex(
      JSON.stringify({
        currentAccountId: "a",
        accounts: [{ id: "a", email: "a@example.com", isActive: true, createdAt: 1, updatedAt: 1 }]
      }),
      "accounts-index.json"
    );

    expect(parsed.currentAccountId).toBe("a");
    expect(parsed.accounts).toHaveLength(1);
  });
});

describe("sharedAccounts helpers", () => {
  it("normalizes and deduplicates tags", () => {
    expect(normalizeAccountTags([" Foo ", "foo", "Bar", "", "baz".repeat(10)])).toEqual([
      "foo",
      "Bar",
      "bazbazbazbazbazbazbazbaz"
    ]);
  });

  it("restores tokens and previews shared entries", () => {
    const idToken = createJwt({
      email: "dev@example.com",
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acct_123",
        organization_id: "org_456"
      }
    });
    const accessToken = createJwt({
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acct_123",
        organization_id: "org_456"
      }
    });

    const entry = {
      id: "storage-id",
      email: "dev@example.com",
      auth_mode: "oauth",
      tokens: {
        id_token: idToken,
        access_token: accessToken,
        refresh_token: "refresh-token",
        account_id: "acct_123"
      },
      created_at: 10,
      last_used: 20
    };

    expect(restoreSharedTokens(entry).refreshToken).toBe("refresh-token");
    expect(previewSharedEntry(entry)).toEqual({
      storageId: buildAccountStorageId("dev@example.com", "acct_123", "org_456"),
      email: "dev@example.com"
    });
  });

  it("rejects ChatGPT session JSON during shared import preview", () => {
    const accessToken = createJwt({
      sub: "auth0|session-user",
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acct_session"
      },
      "https://api.openai.com/profile": {
        email: "session@example.com",
        email_verified: true
      }
    });

    const sessionEntry = {
      user: {
        id: "user-session",
        email: "session@example.com"
      },
      expires: "2026-08-09T06:23:18.688Z",
      account: {
        id: "acct_session",
        planType: "plus",
        structure: "personal"
      },
      accessToken,
      authProvider: "openai"
    };

    const preview = previewSharedAccountsImportEntries([sessionEntry], new Set());
    expect(preview).toEqual({
      total: 1,
      valid: 0,
      overwriteCount: 0,
      invalidCount: 1,
      invalidEntries: [expect.objectContaining({ index: 0, message: expect.stringContaining("valid tokens") })]
    });

    expect(toSharedEntries(sessionEntry)).toEqual([sessionEntry]);
    expect(() => previewSharedEntry(sessionEntry)).toThrowError(/Shared account JSON does not include valid tokens/);
  });

  it("accepts an exported account when an old access token is no longer a JWT", () => {
    const idToken = createJwt({
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acct_existing"
      }
    });
    const entry = {
      id: buildAccountStorageId("existing@example.com", "acct_existing"),
      email: "existing@example.com",
      account_id: "acct_existing",
      tokens: {
        id_token: idToken,
        access_token: "invalidated-opaque-access-token",
        refresh_token: "refresh-token",
        account_id: "acct_existing"
      }
    };

    expect(previewSharedEntry(entry)).toEqual({
      storageId: buildAccountStorageId("existing@example.com", "acct_existing"),
      email: "existing@example.com"
    });
    expect(previewSharedAccountsImportEntries([entry], new Set([entry.id]))).toMatchObject({
      valid: 1,
      overwriteCount: 1,
      invalidCount: 0
    });
    expect(previewSharedAccountsImportEntries([entry], new Set())).toMatchObject({
      valid: 1,
      overwriteCount: 0,
      invalidCount: 0
    });
  });

  it("maps shared quota payloads into internal summaries", () => {
    expect(
      fromSharedQuota({
        hourly_percentage: 40,
        hourly_reset_time: 100,
        hourly_requests_left: 4,
        hourly_requests_limit: 10,
        hourly_window_minutes: 300,
        hourly_window_present: true,
        weekly_percentage: 70,
        weekly_reset_time: 200,
        weekly_requests_left: 7,
        weekly_requests_limit: 10,
        weekly_window_minutes: 10080,
        weekly_window_present: true,
        code_review_percentage: 90,
        code_review_reset_time: 300,
        code_review_requests_left: 9,
        code_review_requests_limit: 10,
        code_review_window_minutes: 300,
        code_review_window_present: true,
        additional_rate_limits: [
          {
            limit_name: "GPT-5.3-Codex-Spark",
            metered_feature: "codex_bengalfox",
            hourly_percentage: 100,
            hourly_reset_time: 400,
            hourly_window_minutes: 300,
            hourly_window_present: true,
            weekly_percentage: 90,
            weekly_reset_time: 500,
            weekly_window_minutes: 10080,
            weekly_window_present: true
          }
        ],
        credits: {
          has_credits: false,
          unlimited: false,
          overage_limit_reached: false,
          balance: "0",
          approx_local_messages: [0, 0],
          approx_cloud_messages: [0, 0]
        },
        raw_data: { ok: true }
      })
    ).toEqual({
      hourlyPercentage: 40,
      hourlyResetTime: 100,
      hourlyRequestsLeft: 4,
      hourlyRequestsLimit: 10,
      hourlyWindowMinutes: 300,
      hourlyWindowPresent: true,
      weeklyPercentage: 70,
      weeklyResetTime: 200,
      weeklyRequestsLeft: 7,
      weeklyRequestsLimit: 10,
      weeklyWindowMinutes: 10080,
      weeklyWindowPresent: true,
      codeReviewPercentage: 90,
      codeReviewResetTime: 300,
      codeReviewRequestsLeft: 9,
      codeReviewRequestsLimit: 10,
      codeReviewWindowMinutes: 300,
      codeReviewWindowPresent: true,
      additionalRateLimits: [
        {
          limitName: "GPT-5.3-Codex-Spark",
          meteredFeature: "codex_bengalfox",
          hourlyPercentage: 100,
          hourlyResetTime: 400,
          hourlyRequestsLeft: undefined,
          hourlyRequestsLimit: undefined,
          hourlyWindowMinutes: 300,
          hourlyWindowPresent: true,
          weeklyPercentage: 90,
          weeklyResetTime: 500,
          weeklyRequestsLeft: undefined,
          weeklyRequestsLimit: undefined,
          weeklyWindowMinutes: 10080,
          weeklyWindowPresent: true
        }
      ],
      credits: {
        hasCredits: false,
        unlimited: false,
        overageLimitReached: false,
        balance: "0",
        approxLocalMessages: [0, 0],
        approxCloudMessages: [0, 0]
      },
      rawData: { ok: true }
    });
  });

  it("exports and imports subscription expiry metadata", () => {
    const account: CodexAccountRecord = {
      id: "a",
      email: "dev@example.com",
      userId: "user-1",
      planType: "pro",
      subscriptionActiveUntil: "1800000000",
      isActive: false,
      createdAt: 1_000,
      updatedAt: 2_000
    };
    const shared = toSharedAccountJson(account, {
      idToken: "id-token",
      accessToken: "access-token",
      refreshToken: "refresh-token"
    });
    const restored: CodexAccountRecord = {
      id: "a",
      email: "dev@example.com",
      isActive: false,
      createdAt: 1,
      updatedAt: 1
    };

    expect(shared.subscription_active_until).toBe("1800000000");

    applySharedAccountEntry(restored, {
      ...shared,
      subscription_active_until: "1900000000"
    });

    expect(restored.subscriptionActiveUntil).toBe("1900000000");
  });

  it("keeps enablement and queue priority local when exporting and importing shared sessions", () => {
    const account: CodexAccountRecord = {
      id: "local-account",
      email: "local@example.com",
      isActive: false,
      enabled: false,
      queuePriority: true,
      createdAt: 1_000,
      updatedAt: 2_000
    };
    const shared = toSharedAccountJson(account, {
      idToken: "id-token",
      accessToken: "access-token"
    });

    expect(shared).not.toHaveProperty("enabled");
    expect(shared).not.toHaveProperty("queue_priority");

    const locallyEnabled: CodexAccountRecord = {
      ...account,
      enabled: true,
      queuePriority: false
    };
    applySharedAccountEntry(locallyEnabled, {
      ...shared,
      plan_type: "pro",
      queue_priority: true
    });

    expect(locallyEnabled.enabled).toBe(true);
    expect(locallyEnabled.queuePriority).toBe(false);
    expect(locallyEnabled.planType).toBe("pro");
  });
});

describe("accountMetadata helpers", () => {
  it("does not auto-select new accounts for the status popup", () => {
    const draft = buildAccountRecordDraft({
      storageId: "new-account",
      claims: {
        email: "new@example.com",
        planType: "team"
      },
      tokens: {},
      existingAccounts: [
        { id: "a", email: "a@example.com", isActive: false, showInStatusBar: true, createdAt: 1, updatedAt: 1 },
        { id: "b", email: "b@example.com", isActive: false, showInStatusBar: false, createdAt: 1, updatedAt: 1 }
      ],
      forceActive: false,
      now: 10
    });

    expect(draft.showInStatusBar).toBe(false);
  });

  it("preserves status popup selection for existing accounts", () => {
    const draft = buildAccountRecordDraft({
      storageId: "existing-account",
      claims: {
        email: "existing@example.com",
        planType: "team"
      },
      tokens: {},
      existing: {
        id: "existing-account",
        email: "existing@example.com",
        isActive: false,
        showInStatusBar: true,
        createdAt: 1,
        updatedAt: 1
      },
      existingAccounts: [],
      forceActive: false,
      now: 10
    });

    expect(draft.showInStatusBar).toBe(true);
  });
});

describe("accountMutations helpers", () => {
  it("persists automation enablement without blocking manual switching or changing status visibility", () => {
    const index = cloneIndex({
      currentAccountId: "a",
      accounts: [
        { id: "a", email: "a@example.com", isActive: true, createdAt: 1, updatedAt: 1 },
        { id: "b", email: "b@example.com", isActive: false, showInStatusBar: true, createdAt: 1, updatedAt: 1 }
      ]
    });

    const disabled = setAccountEnabled(index, "b", false, 20);

    expect(disabled?.enabled).toBe(false);
    expect(disabled?.updatedAt).toBe(1);
    expect(disabled?.showInStatusBar).toBe(true);

    const switched = switchActiveAccount(index, "b", 30);
    expect(switched?.isActive).toBe(true);
    expect(switched?.enabled).toBe(false);
    expect(switched?.sessionStartedAt).toBe(30);
  });

  it("keeps queue priority local without changing shared account freshness", () => {
    const index = cloneIndex({
      accounts: [{ id: "a", email: "a@example.com", isActive: false, createdAt: 1, updatedAt: 1 }]
    });

    const prioritized = setAccountQueuePriority(index, "a", true, 20);

    expect(prioritized?.queuePriority).toBe(true);
    expect(prioritized?.updatedAt).toBe(1);
  });

  it("updates dismissed health issues in place", () => {
    const index = cloneIndex({
      currentAccountId: "a",
      accounts: [{ id: "a", email: "a@example.com", isActive: true, createdAt: 1, updatedAt: 1 }]
    });

    const updated = dismissAccountHealthIssue(index, "a", "quota-low", 99);

    expect(updated?.dismissedHealthIssueKey).toBe("quota-low");
    expect(index.accounts[0]?.updatedAt).toBe(99);
  });

  it("adds and removes normalized tags for selected accounts", () => {
    const index = cloneIndex({
      currentAccountId: "a",
      accounts: [
        { id: "a", email: "a@example.com", isActive: true, tags: ["team"], createdAt: 1, updatedAt: 1 },
        { id: "b", email: "b@example.com", isActive: false, tags: ["ops"], createdAt: 1, updatedAt: 1 }
      ]
    });

    const added = addAccountTags(index, ["a", "b"], [" Team ", "prod", "PROD"], 20);
    const removed = removeAccountTags(index, ["a"], ["TEAM"], 30);

    expect(added).toHaveLength(2);
    expect(index.accounts[0]?.tags).toEqual(["PROD"]);
    expect(index.accounts[1]?.tags).toEqual(["ops", "Team", "PROD"]);
    expect(removed[0]?.updatedAt).toBe(30);
  });

  it("limits extra status bar accounts and reconciles previous active account on switch", () => {
    const index = cloneIndex({
      currentAccountId: "a",
      accounts: [
        { id: "a", email: "a@example.com", isActive: true, showInStatusBar: false, createdAt: 1, updatedAt: 1 },
        { id: "b", email: "b@example.com", isActive: false, showInStatusBar: true, createdAt: 1, updatedAt: 1 },
        { id: "c", email: "c@example.com", isActive: false, showInStatusBar: true, createdAt: 1, updatedAt: 1 },
        { id: "d", email: "d@example.com", isActive: false, showInStatusBar: false, createdAt: 1, updatedAt: 1 }
      ]
    });

    expect(() => setStatusBarVisibility(index, "d", true, 40)).toThrow(/Only 2 extra accounts/);

    const switched = switchActiveAccount(index, "d");

    expect(switched?.isActive).toBe(true);
    expect(index.currentAccountId).toBe("d");
    expect(index.accounts.find((account) => account.id === "a")?.showInStatusBar).toBe(false);
    expect(index.accounts.find((account) => account.id === "b")?.showInStatusBar).toBe(true);
    expect(index.accounts.find((account) => account.id === "c")?.showInStatusBar).toBe(true);
  });

  it("removes accounts from the index and clears currentAccountId when needed", () => {
    const index = cloneIndex({
      currentAccountId: "a",
      accounts: [
        { id: "a", email: "a@example.com", isActive: true, createdAt: 1, updatedAt: 1 },
        { id: "b", email: "b@example.com", isActive: false, createdAt: 1, updatedAt: 1 }
      ]
    });

    expect(removeAccountFromIndex(index, "a")).toBe(true);
    expect(index.currentAccountId).toBeUndefined();
    expect(index.accounts.map((account) => account.id)).toEqual(["b"]);
  });
});

describe("accountProfileMaintenance helpers", () => {
  it("allows an explicitly selected workspace profile to repair a stale accountId", () => {
    const tokens = {
      idToken: createJwt({
        email: "dev@example.com",
        "https://api.openai.com/auth": { chatgpt_account_id: "acct_team" }
      }),
      accessToken: createJwt({
        "https://api.openai.com/auth": { chatgpt_account_id: "acct_team" }
      })
    };
    const account: CodexAccountRecord = {
      id: "personal",
      email: "dev@example.com",
      accountId: "acct_team",
      accountName: "Personal",
      accountStructure: "personal",
      planType: "team",
      createdAt: 1,
      updatedAt: 1
    };

    const repaired = applyRemoteProfileFromTokens({
      account,
      tokens,
      remoteProfile: {
        accountId: "acct_personal",
        accountStructure: "personal",
        planType: "plus"
      },
      allowAccountIdRepair: true
    });

    expect(repaired).toBe(true);
    expect(account.accountId).toBe("acct_personal");
    expect(account.planType).toBe("plus");
    expect(account.accountStructure).toBe("personal");
  });

  it("applies quota updates and repairs profile metadata from tokens", () => {
    const tokens = {
      idToken: createJwt({
        email: "team@example.com",
        auth_time: 1234,
        plan_type: "team",
        "https://api.openai.com/auth": {
          chatgpt_account_id: "acct_123",
          organization_id: "org_456"
        }
      }),
      accessToken: createJwt({
        "https://api.openai.com/auth": {
          chatgpt_account_id: "acct_123",
          organization_id: "org_456"
        }
      })
    };
    const account: CodexAccountRecord = {
      id: "a",
      email: "team@example.com",
      isActive: false,
      planType: "team",
      accountName: "Personal",
      accountStructure: "personal",
      createdAt: 1,
      updatedAt: 1
    };

    const effectivePlanType = applyQuotaUpdate({
      account,
      quotaSummary: { hourlyPercentage: 25, weeklyPercentage: 75, codeReviewPercentage: 50 },
      quotaError: { message: "quota ok", timestamp: 1 },
      updatedSubscriptionActiveUntil: "1800000000",
      now: 88
    });

    syncLoginAtFromTokens(account, tokens);

    expect(effectivePlanType).toBe("team");
    expect(account.lastQuotaAt).toBe(88);
    expect(account.subscriptionActiveUntil).toBe("1800000000");
    expect(account.loginAt).toBe(1_234_000);
    expect(shouldAttemptRemoteProfileRepair(account, effectivePlanType)).toBe(true);

    const repaired = applyRemoteProfileFromTokens({
      account,
      tokens,
      remoteProfile: {
        accountName: "Platform Team",
        accountStructure: "workspace",
        accountId: "acct_123",
        subscriptionActiveUntil: "1900000000"
      },
      planType: effectivePlanType
    });

    expect(repaired).toBe(true);
    expect(account.accountName).toBe("Platform Team");
    expect(account.accountStructure).toBe("workspace");
    expect(account.accountId).toBe("acct_123");
    expect(account.organizationId).toBe("org_456");
    expect(account.subscriptionActiveUntil).toBe("1900000000");
  });

  it("clears an expired paid subscription when current quota reports Free", () => {
    const account: CodexAccountRecord = {
      id: "free-account",
      email: "free@example.com",
      isActive: false,
      planType: "pro",
      subscriptionActiveUntil: "1000000000",
      createdAt: 1,
      updatedAt: 1
    };

    applyQuotaUpdate({
      account,
      quotaSummary: {
        hourlyPercentage: 0,
        weeklyPercentage: 100,
        weeklyWindowMinutes: 43_200,
        weeklyWindowPresent: true
      },
      updatedPlanType: "free",
      now: 88
    });

    expect(account.planType).toBe("free");
    expect(account.subscriptionActiveUntil).toBeUndefined();
  });

  it("preserves reset credits expiry when quota refresh only returns available count", () => {
    const account: CodexAccountRecord = {
      id: "a",
      email: "team@example.com",
      isActive: false,
      createdAt: 1,
      updatedAt: 1,
      quotaSummary: {
        hourlyPercentage: 30,
        hourlyWindowPresent: true,
        weeklyPercentage: 70,
        weeklyWindowPresent: true,
        codeReviewPercentage: 0,
        resetCreditsAvailable: 1,
        resetCreditsNextExpiresAt: 1_785_109_796
      }
    };

    applyQuotaUpdate({
      account,
      quotaSummary: {
        hourlyPercentage: 25,
        hourlyWindowPresent: true,
        weeklyPercentage: 75,
        weeklyWindowPresent: true,
        codeReviewPercentage: 0,
        resetCreditsAvailable: 1
      },
      quotaError: undefined,
      now: 99
    });

    expect(account.quotaSummary?.resetCreditsAvailable).toBe(1);
    expect(account.quotaSummary?.resetCreditsNextExpiresAt).toBe(1_785_109_796);
  });
});
