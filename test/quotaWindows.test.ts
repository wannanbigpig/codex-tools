import { describe, expect, it } from "vitest";
import { normalizeQuotaSummary } from "../src/utils/quotaWindows";
import { normalizeQuotaColorThresholds } from "../src/utils/ui";

describe("normalizeQuotaSummary", () => {
  it("reclassifies swapped hourly and weekly windows by duration", () => {
    const normalized = normalizeQuotaSummary({
      hourlyPercentage: 10,
      hourlyResetTime: 100,
      hourlyWindowMinutes: 10080,
      hourlyWindowPresent: true,
      weeklyPercentage: 80,
      weeklyResetTime: 200,
      weeklyWindowMinutes: 300,
      weeklyWindowPresent: true,
      codeReviewPercentage: 50
    });

    expect(normalized?.hourlyPercentage).toBe(80);
    expect(normalized?.hourlyWindowMinutes).toBe(300);
    expect(normalized?.weeklyPercentage).toBe(10);
    expect(normalized?.weeklyWindowMinutes).toBe(10080);
  });

  it("derives additional model quota and credits from raw usage data without inventing missing values", () => {
    const normalized = normalizeQuotaSummary({
      hourlyPercentage: 90,
      hourlyWindowPresent: true,
      weeklyPercentage: 80,
      weeklyWindowPresent: true,
      codeReviewPercentage: 0,
      rawData: {
        additional_rate_limits: [
          {
            limit_name: "GPT-5.3-Codex-Spark",
            metered_feature: "codex_bengalfox",
            rate_limit: {
              primary_window: {
                used_percent: 0,
                limit_window_seconds: 18_000,
                reset_at: 1_800_000_000
              },
              secondary_window: {
                used_percent: 0,
                limit_window_seconds: 604_800,
                reset_at: 1_800_604_800
              }
            }
          }
        ],
        credits: {
          has_credits: false,
          unlimited: false,
          overage_limit_reached: false,
          balance: "0"
        }
      }
    });

    expect(normalized?.additionalRateLimits?.[0]).toMatchObject({
      limitName: "GPT-5.3-Codex-Spark",
      meteredFeature: "codex_bengalfox",
      hourlyPercentage: 100,
      weeklyPercentage: 100
    });
    expect(normalized?.credits?.balance).toBe("0");

    const withoutRawAdditional = normalizeQuotaSummary({
      hourlyPercentage: 90,
      hourlyWindowPresent: true,
      weeklyPercentage: 80,
      weeklyWindowPresent: true,
      codeReviewPercentage: 0,
      rawData: {}
    });

    expect(withoutRawAdditional?.additionalRateLimits).toBeUndefined();
    expect(withoutRawAdditional?.credits).toBeUndefined();
  });
});

describe("normalizeQuotaColorThresholds", () => {
  it("keeps green at least 10 points above yellow", () => {
    expect(normalizeQuotaColorThresholds(45, 44)).toEqual({
      green: 45,
      yellow: 35
    });
  });
});
