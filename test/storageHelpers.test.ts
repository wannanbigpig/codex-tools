import { describe, expect, it } from "vitest";
import type { CodexAccountRecord } from "../src/core/types";
import { buildAccountStorageId } from "../src/utils/accountIdentity";
import { cloneIndex, parseAccountsIndex, syncActiveAccountState } from "../src/storage/accountsIndex";
import { buildAccountRecordDraft } from "../src/storage/accountMetadata";
import {
  addAccountTags,
  dismissAccountHealthIssue,
  removeAccountFromIndex,
  removeAccountTags,
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
import { applySharedAccountEntry } from "../src/storage/sharedAccountsImport";

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

    const changed = syncActiveAccountState(index, "a");

    expect(changed).toBe(true);
    expect(index.currentAccountId).toBe("a");
    expect(index.accounts.map((account) => account.isActive)).toEqual([true, false]);
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
});
