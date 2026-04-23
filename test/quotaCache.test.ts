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

  it("falls back to code review secondary window when primary has no used_percent", async () => {
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

    expect(result.quota?.codeReviewWindowPresent).toBe(true);
    expect(result.quota?.codeReviewPercentage).toBe(70);
  });

  it("reads code review quota from nested rate_limit aliases", async () => {
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
            },
            code_review_rate_limit: {
              secondary_window: {
                remaining_percent: 35,
                reset_after_seconds: 1200,
                limit_window_seconds: 86_400
              }
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

    expect(result.quota?.codeReviewWindowPresent).toBe(true);
    expect(result.quota?.codeReviewPercentage).toBe(35);
  });

  it("falls back review quota to weekly when no dedicated review window is returned", async () => {
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
              used_percent: 40,
              reset_after_seconds: 900,
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

    expect(result.quota?.weeklyPercentage).toBe(60);
    expect(result.quota?.codeReviewWindowPresent).toBe(true);
    expect(result.quota?.codeReviewPercentage).toBe(60);
  });
});
