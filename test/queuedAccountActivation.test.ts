import { describe, expect, it, vi } from "vitest";
import { activateQueuedAccountIfCurrentMissing } from "../src/application/accounts/queuedAccountActivation";
import type { CodexAccountRecord, CodexTokens } from "../src/core/types";
import type { AccountsRepository } from "../src/storage";

const tokens: CodexTokens = {
  idToken: "id-token",
  accessToken: "access-token",
  refreshToken: "refresh-token"
};

describe("queued account activation", () => {
  it("does nothing when a current account already exists", async () => {
    const active = account("active", { isActive: true });
    const queued = account("queued", { queuePriority: true });
    const repo = repository([active, queued]);

    await expect(activateQueuedAccountIfCurrentMissing(repo)).resolves.toEqual({ status: "not-needed" });
    expect(repo.switchAccount).not.toHaveBeenCalled();
  });

  it("activates the best enabled queued account when the current account is missing", async () => {
    const lowerQuota = account("lower", {
      queuePriority: true,
      quotaSummary: quota(35, 50)
    });
    const higherQuota = account("higher", {
      queuePriority: true,
      quotaSummary: quota(80, 90)
    });
    const repo = repository([lowerQuota, higherQuota]);

    await expect(activateQueuedAccountIfCurrentMissing(repo)).resolves.toEqual({
      status: "activated",
      account: { ...higherQuota, isActive: true }
    });
    expect(repo.switchAccount).toHaveBeenCalledWith(higherQuota.id);
  });

  it("skips disabled or credential-less queued accounts", async () => {
    const disabled = account("disabled", { queuePriority: true, enabled: false });
    const missingTokens = account("missing", { queuePriority: true, quotaSummary: quota(90, 90) });
    const usable = account("usable", { queuePriority: true, quotaSummary: quota(40, 40) });
    const repo = repository([disabled, missingTokens, usable], new Set([usable.id]));

    const result = await activateQueuedAccountIfCurrentMissing(repo);

    expect(result.status).toBe("activated");
    expect(repo.switchAccount).toHaveBeenCalledWith(usable.id);
  });
});

function repository(
  accounts: CodexAccountRecord[],
  tokenAccountIds = new Set(accounts.map((item) => item.id))
): AccountsRepository & { switchAccount: ReturnType<typeof vi.fn> } {
  const switchAccount = vi.fn(async (accountId: string) => {
    const selected = accounts.find((item) => item.id === accountId)!;
    return { ...selected, isActive: true };
  });
  return {
    listAccounts: vi.fn(async () => accounts),
    getTokens: vi.fn(async (accountId: string) => (tokenAccountIds.has(accountId) ? tokens : undefined)),
    switchAccount
  } as unknown as AccountsRepository & { switchAccount: ReturnType<typeof vi.fn> };
}

function account(id: string, overrides: Partial<CodexAccountRecord> = {}): CodexAccountRecord {
  return {
    id,
    email: `${id}@example.com`,
    isActive: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  };
}

function quota(hourlyPercentage: number, weeklyPercentage: number) {
  return {
    hourlyPercentage,
    hourlyWindowMinutes: 300,
    hourlyWindowPresent: true,
    weeklyPercentage,
    weeklyWindowMinutes: 10_080,
    weeklyWindowPresent: true,
    codeReviewPercentage: 0
  };
}
