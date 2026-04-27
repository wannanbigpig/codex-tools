import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CodexAccountRecord, CodexTokens } from "../src/core/types";

const { fetchWithTimeoutMock } = vi.hoisted(() => ({
  fetchWithTimeoutMock: vi.fn()
}));

vi.mock("../src/auth/oauth", () => ({
  needsRefresh: vi.fn(() => false),
  needsTokenRefresh: vi.fn(() => false),
  refreshTokens: vi.fn()
}));

vi.mock("../src/services/workspaceRetry", () => ({
  shouldRetryWithoutWorkspace: vi.fn(() => false)
}));

vi.mock("../src/utils/debug", () => ({
  logNetworkEvent: vi.fn()
}));

vi.mock("../src/utils/network", () => ({
  fetchWithTimeout: fetchWithTimeoutMock,
  isRetriableHttpStatus: vi.fn(() => false),
  isRetriableNetworkError: vi.fn(() => false),
  retryWithBackoff: async <T>(operation: () => Promise<T>) => operation()
}));

import { clearQuotaCacheForAccount, refreshQuota } from "../src/services/quota";

function createDeferredResponse() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createUsageResponse(usedPercent: number): Response {
  return new Response(
    JSON.stringify({
      rate_limit: {
        primary_window: {
          used_percent: usedPercent,
          reset_after_seconds: 300,
          limit_window_seconds: 18_000
        }
      }
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    }
  );
}

describe("quota cache invalidation", () => {
  const account: CodexAccountRecord = {
    id: "account-1",
    email: "dev@example.com",
    accountId: "acct_123",
    isActive: false,
    createdAt: 1,
    updatedAt: 1
  };
  const tokens: CodexTokens = {
    idToken: "id-token",
    accessToken: "access-token",
    accountId: "acct_123"
  };

  beforeEach(() => {
    fetchWithTimeoutMock.mockReset();
    clearQuotaCacheForAccount(account.id);
  });

  it("does not repopulate cache from an invalidated inflight refresh", async () => {
    const firstRequest = createDeferredResponse();
    fetchWithTimeoutMock.mockImplementationOnce(() => firstRequest.promise);

    const inflightRefresh = refreshQuota(account, tokens, true);
    clearQuotaCacheForAccount(account.id);

    firstRequest.resolve(createUsageResponse(10));
    const firstResult = await inflightRefresh;
    expect(firstResult.quota?.hourlyPercentage).toBe(90);

    fetchWithTimeoutMock.mockResolvedValueOnce(createUsageResponse(20));
    const secondResult = await refreshQuota(account, tokens);

    expect(fetchWithTimeoutMock).toHaveBeenCalledTimes(2);
    expect(secondResult.quota?.hourlyPercentage).toBe(80);
  });

  it("interprets fractional used_percent values as ratios", async () => {
    fetchWithTimeoutMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          rate_limit: {
            primary_window: {
              used_percent: 0.25,
              reset_after_seconds: 300,
              limit_window_seconds: 18_000
            },
            secondary_window: {
              used_percent: 0.5,
              reset_after_seconds: 600,
              limit_window_seconds: 604_800
            }
          }
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      )
    );

    const result = await refreshQuota(account, tokens, true);

    expect(result.quota?.hourlyPercentage).toBe(75);
    expect(result.quota?.weeklyPercentage).toBe(50);
  });

  it("treats used_percent equal to one as one percent instead of a full ratio", async () => {
    fetchWithTimeoutMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          rate_limit: {
            primary_window: {
              used_percent: 1,
              reset_after_seconds: 300,
              limit_window_seconds: 18_000
            },
            secondary_window: {
              used_percent: 0,
              reset_after_seconds: 600,
              limit_window_seconds: 604_800
            }
          }
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      )
    );

    const result = await refreshQuota(account, tokens, true);

    expect(result.quota?.hourlyPercentage).toBe(99);
    expect(result.quota?.weeklyPercentage).toBe(100);
  });

  it("does not mark a quota window present when used_percent is missing", async () => {
    fetchWithTimeoutMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          rate_limit: {
            primary_window: {
              reset_after_seconds: 300,
              limit_window_seconds: 18_000
            }
          }
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      )
    );

    const result = await refreshQuota(account, tokens, true);

    expect(result.quota?.hourlyWindowPresent).toBe(false);
    expect(result.quota?.hourlyPercentage).toBe(0);
  });

  it("ignores deprecated code review quota fields", async () => {
    fetchWithTimeoutMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          rate_limit: {
            primary_window: {
              used_percent: 10,
              reset_after_seconds: 300,
              limit_window_seconds: 18_000
            }
          },
          code_review_rate_limit: {
            primary_window: {
              reset_after_seconds: 300,
              limit_window_seconds: 86_400
            },
            secondary_window: {
              used_percent: 30,
              reset_after_seconds: 900,
              limit_window_seconds: 86_400
            }
          }
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      )
    );

    const result = await refreshQuota(account, tokens, true);

    expect(result.quota?.codeReviewWindowPresent).toBe(false);
    expect(result.quota?.codeReviewPercentage).toBe(0);
  });

  it("parses additional model quota from additional_rate_limits", async () => {
    fetchWithTimeoutMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          rate_limit: {
            primary_window: {
              used_percent: 10,
              reset_after_seconds: 300,
              limit_window_seconds: 18_000
            },
            secondary_window: {
              used_percent: 20,
              reset_after_seconds: 900,
              limit_window_seconds: 604_800
            }
          },
          additional_rate_limits: [
            {
              limit_name: "GPT-5.3-Codex-Spark",
              metered_feature: "codex_bengalfox",
              rate_limit: {
                primary_window: {
                  used_percent: 0,
                  reset_at: 1_800_000_100,
                  limit_window_seconds: 18_000
                },
                secondary_window: {
                  used_percent: 10,
                  reset_at: 1_800_604_800,
                  limit_window_seconds: 604_800
                }
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      )
    );

    const result = await refreshQuota(account, tokens, true);
    const additional = result.quota?.additionalRateLimits?.[0];

    expect(additional?.limitName).toBe("GPT-5.3-Codex-Spark");
    expect(additional?.meteredFeature).toBe("codex_bengalfox");
    expect(additional?.hourlyPercentage).toBe(100);
    expect(additional?.hourlyResetTime).toBe(1_800_000_100);
    expect(additional?.weeklyPercentage).toBe(90);
    expect(additional?.weeklyResetTime).toBe(1_800_604_800);
  });

  it("parses Aideck-compatible quota aliases and request counts", async () => {
    fetchWithTimeoutMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          rate_limit: {
            primaryWindow: {
              usedPercent: 25,
              resetAfterSeconds: 300,
              limitWindowSeconds: 18_000,
              requestsLeft: 75,
              requestsLimit: 100
            },
            secondaryWindow: {
              remainingPercent: 65,
              resetAt: 1_800_000_000,
              limitWindowSeconds: 604_800,
              remaining: 13,
              limit: 20
            }
          },
          additionalRateLimits: [
            {
              limitName: "GPT-5.3-Codex-Spark",
              meteredFeature: "codex_bengalfox",
              rateLimit: {
                primaryWindow: {
                  remainingPercent: 45,
                  resetTime: 1_800_000_300,
                  limitWindowSeconds: 18_000,
                  requestsLeft: 9,
                  requestsLimit: 20
                }
              }
            }
          ],
          credits: {
            has_credits: false,
            unlimited: false,
            overage_limit_reached: false,
            balance: "0"
          },
          subscription_active_until: 1_900_000_000
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      )
    );

    const result = await refreshQuota(account, tokens, true);

    expect(result.quota?.hourlyPercentage).toBe(75);
    expect(result.quota?.hourlyRequestsLeft).toBe(75);
    expect(result.quota?.hourlyRequestsLimit).toBe(100);
    expect(result.quota?.weeklyPercentage).toBe(65);
    expect(result.quota?.weeklyResetTime).toBe(1_800_000_000);
    expect(result.quota?.weeklyRequestsLeft).toBe(13);
    expect(result.quota?.weeklyRequestsLimit).toBe(20);
    expect(result.quota?.additionalRateLimits?.[0]).toMatchObject({
      limitName: "GPT-5.3-Codex-Spark",
      meteredFeature: "codex_bengalfox",
      hourlyPercentage: 45,
      hourlyResetTime: 1_800_000_300,
      hourlyRequestsLeft: 9,
      hourlyRequestsLimit: 20,
      hourlyWindowPresent: true
    });
    expect(result.quota?.credits?.balance).toBe("0");
    expect(result.updatedSubscriptionActiveUntil).toBe("1900000000");
  });
});
