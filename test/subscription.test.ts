import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchWithTimeoutMock } = vi.hoisted(() => ({
  fetchWithTimeoutMock: vi.fn()
}));

vi.mock("../src/utils/debug", () => ({
  logNetworkEvent: vi.fn()
}));

vi.mock("../src/utils/network", () => ({
  fetchWithTimeout: fetchWithTimeoutMock
}));

import { fetchSubscriptionStatus, shouldAttemptSubscriptionRefresh } from "../src/services/subscription";

describe("subscription service", () => {
  beforeEach(() => {
    fetchWithTimeoutMock.mockReset();
  });

  it("queries the complete account list and selects the requested workspace expiry", async () => {
    fetchWithTimeoutMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          accounts: {
            personal: {
              account: { account_id: "acct_plus", plan_type: "plus", expires_at: "1900000000" }
            },
            team: {
              account: { account_id: "acct_team", plan_type: "team", expires_at: "1950000000" }
            }
          },
          account_ordering: ["personal", "team"]
        }),
        { status: 200 }
      )
    );

    const snapshot = await fetchSubscriptionStatus("access-token", "acct_team");

    expect(snapshot).toMatchObject({
      accountId: "acct_team",
      planType: "team",
      subscriptionActiveUntil: "1950000000"
    });
    const [, init] = fetchWithTimeoutMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).has("ChatGPT-Account-Id")).toBe(false);
  });

  it("allows a forced refresh even when the cached expiry is still valid", () => {
    expect(
      shouldAttemptSubscriptionRefresh(
        {
          id: "team-account",
          email: "dev@example.com",
          subscriptionActiveUntil: "1950000000",
          createdAt: 1,
          updatedAt: 1
        },
        true
      )
    ).toBe(true);
  });

  it("disambiguates Plus and Team workspaces that share the same accountId", async () => {
    fetchWithTimeoutMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          accounts: {
            personal: {
              account: {
                account_id: "acct_shared",
                organization_id: "org_personal",
                plan_type: "plus"
              },
              entitlement: { subscription_plan: "plus", expires_at: "1900000000" }
            },
            team: {
              account: {
                account_id: "acct_shared",
                organization_id: "org_team",
                plan_type: "chatgptteamplan"
              },
              entitlement: { subscription_plan: "chatgptteamplan", expires_at: "1950000000" }
            }
          },
          account_ordering: ["personal", "team"]
        }),
        { status: 200 }
      )
    );

    const snapshot = await fetchSubscriptionStatus("access-token", "acct_shared", "org_team");

    expect(snapshot).toMatchObject({
      accountId: "acct_shared",
      planType: "chatgptteamplan",
      subscriptionActiveUntil: "1950000000"
    });
  });

  it("uses the saved workspace structure when shared accountId records have no organizationId", async () => {
    const payload = {
      accounts: {
        team: {
          account: { account_id: "acct_shared", name: "leixiaoan", structure: "workspace" },
          entitlement: { subscription_plan: "chatgptteamplan", expires_at: "1950000000" }
        },
        personal: {
          account: { account_id: "acct_personal", name: null, structure: "personal" },
          entitlement: { subscription_plan: "plus", expires_at: "1900000000" }
        }
      },
      account_ordering: ["team", "personal"]
    };
    fetchWithTimeoutMock
      .mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }));

    const personal = await fetchSubscriptionStatus("personal-token", "acct_shared", undefined, "Personal", "personal");
    const team = await fetchSubscriptionStatus("team-token", "acct_shared", undefined, "leixiaoan", "workspace");

    expect(personal).toMatchObject({
      accountId: "acct_personal",
      planType: "plus",
      subscriptionActiveUntil: "1900000000"
    });
    expect(team).toMatchObject({ planType: "chatgptteamplan", subscriptionActiveUntil: "1950000000" });
  });

  it("does not return an expired historical paid plan for a Free account", async () => {
    fetchWithTimeoutMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            accounts: {
              personal: {
                account: { account_id: "acct_free", structure: "personal" },
                entitlement: { subscription_plan: "pro", expires_at: "1000000000" }
              }
            }
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ subscription_plan: "pro", active_until: "1000000000" }), { status: 200 })
      );

    const snapshot = await fetchSubscriptionStatus("free-token", "acct_free", undefined, "Personal", "personal");

    expect(snapshot).toEqual({ accountId: "acct_free" });
  });
});
