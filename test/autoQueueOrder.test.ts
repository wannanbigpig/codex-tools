import { describe, expect, it } from "vitest";
import { compareCodexAccountAutoQueueOrder } from "../src/application/accounts/autoQueueOrder";
import type { CodexAccountRecord } from "../src/core/types";

describe("auto queue order", () => {
  it("keeps starred accounts ahead of all automatic criteria", () => {
    const starred = account("starred", { hourly: 10, weekly: 10, queuePriority: true });
    const unstarred = account("unstarred", { hourly: 100, weekly: 100 });

    expect(sortedIds(unstarred, starred)).toEqual(["starred", "unstarred"]);
  });

  it("does not prioritize a starred account with no quota or credits", () => {
    const emptyStarred = account("empty-starred", { hourly: 0, weekly: 0, queuePriority: true });
    const capable = account("capable", { hourly: 50, weekly: 50 });

    expect(sortedIds(emptyStarred, capable)).toEqual(["capable", "empty-starred"]);
  });

  it("uses each window reset time immediately after its remaining quota", () => {
    const renewsSooner = account("renews-sooner", {
      hourly: 80,
      hourlyResetAt: 1_000,
      weekly: 20
    });
    const renewsLater = account("renews-later", {
      hourly: 80,
      hourlyResetAt: 2_000,
      weekly: 100
    });

    expect(sortedIds(renewsLater, renewsSooner)).toEqual(["renews-sooner", "renews-later"]);
  });

  it("skips a missing value and continues to the next criterion", () => {
    const missingHourlyReset = account("missing-reset", { hourly: 80, weekly: 90 });
    const knownHourlyReset = account("known-reset", {
      hourly: 80,
      hourlyResetAt: 1_000,
      weekly: 40
    });

    expect(sortedIds(knownHourlyReset, missingHourlyReset)).toEqual(["missing-reset", "known-reset"]);
  });

  it("orders monthly quota by remaining amount and then days until reset", () => {
    const renewsSooner = account("monthly-sooner", {
      hourlyPresent: false,
      monthly: 70,
      weeklyResetAt: 2_000,
      planType: "free"
    });
    const renewsLater = account("monthly-later", {
      hourlyPresent: false,
      monthly: 70,
      weeklyResetAt: 3_000,
      planType: "free"
    });

    expect(sortedIds(renewsLater, renewsSooner)).toEqual(["monthly-sooner", "monthly-later"]);
  });

  it("uses credits before the earliest subscription expiry", () => {
    const moreCredits = account("more-credits", {
      hourly: 80,
      weekly: 90,
      credits: "20",
      subscriptionExpiresAt: 3_000
    });
    const expiresSooner = account("expires-sooner", {
      hourly: 80,
      weekly: 90,
      credits: "5",
      subscriptionExpiresAt: 1_000
    });

    expect(sortedIds(expiresSooner, moreCredits)).toEqual(["more-credits", "expires-sooner"]);
  });

  it("uses the earliest subscription expiry after all earlier criteria tie", () => {
    const sooner = account("sooner", { hourly: 80, weekly: 90, subscriptionExpiresAt: 1_000 });
    const later = account("later", { hourly: 80, weekly: 90, subscriptionExpiresAt: 2_000 });

    expect(sortedIds(later, sooner)).toEqual(["sooner", "later"]);
  });
});

type AccountOptions = {
  hourly?: number;
  hourlyPresent?: boolean;
  hourlyResetAt?: number;
  weekly?: number;
  monthly?: number;
  weeklyResetAt?: number;
  credits?: string;
  subscriptionExpiresAt?: number;
  planType?: string;
  queuePriority?: boolean;
};

function account(id: string, options: AccountOptions): CodexAccountRecord {
  const longQuota = options.monthly ?? options.weekly;
  return {
    id,
    email: `${id}@example.com`,
    isActive: false,
    createdAt: 1,
    updatedAt: 1,
    planType: options.planType,
    queuePriority: options.queuePriority,
    subscriptionActiveUntil:
      options.subscriptionExpiresAt === undefined ? undefined : String(options.subscriptionExpiresAt / 1_000),
    quotaSummary: {
      hourlyPercentage: options.hourly,
      hourlyResetTime: options.hourlyResetAt,
      hourlyWindowMinutes: 300,
      hourlyWindowPresent: options.hourlyPresent ?? options.hourly !== undefined,
      weeklyPercentage: longQuota,
      weeklyResetTime: options.weeklyResetAt,
      weeklyWindowMinutes: options.monthly === undefined ? 10_080 : 43_200,
      weeklyWindowPresent: longQuota !== undefined,
      credits:
        options.credits === undefined
          ? undefined
          : {
              hasCredits: true,
              unlimited: false,
              overageLimitReached: false,
              balance: options.credits,
              approxLocalMessages: [],
              approxCloudMessages: []
            }
    }
  };
}

function sortedIds(...accounts: CodexAccountRecord[]): string[] {
  return accounts.sort(compareCodexAccountAutoQueueOrder).map((item) => item.id);
}
