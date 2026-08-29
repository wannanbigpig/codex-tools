import type { CodexAccountRecord } from "../../core/types";
import type { AccountsRepository } from "../../storage";
import { compareCodexAccountAutoQueueOrder } from "./autoQueueOrder";

export type QueuedAccountActivationResult =
  | { status: "not-needed" }
  | { status: "activated"; account: CodexAccountRecord }
  | { status: "failed"; message: string };

let activationInFlight: Promise<QueuedAccountActivationResult> | undefined;

/**
 * Restores a usable current account after an add/reauthorization flow when the
 * index has no active account. Only explicitly queued, enabled accounts qualify.
 */
export async function activateQueuedAccountIfCurrentMissing(
  repo: AccountsRepository
): Promise<QueuedAccountActivationResult> {
  if (activationInFlight) {
    return activationInFlight;
  }

  const task = activateQueuedAccount(repo);
  activationInFlight = task;
  try {
    return await task;
  } finally {
    if (activationInFlight === task) {
      activationInFlight = undefined;
    }
  }
}

async function activateQueuedAccount(repo: AccountsRepository): Promise<QueuedAccountActivationResult> {
  const accounts = await repo.listAccounts();
  if (accounts.some((account) => account.isActive)) {
    return { status: "not-needed" };
  }

  const queuedAccounts = accounts
    .filter((account) => account.queuePriority === true && account.enabled !== false)
    .sort(compareQueuedAccounts);
  if (queuedAccounts.length === 0) {
    return { status: "not-needed" };
  }

  let lastError: unknown;
  for (const account of queuedAccounts) {
    if (!(await repo.getTokens(account.id))) {
      lastError = new Error(`Stored credentials are missing for ${account.email}.`);
      continue;
    }

    try {
      const activated = await repo.switchAccount(account.id);
      return { status: "activated", account: activated };
    } catch (error) {
      lastError = error;
    }
  }

  return {
    status: "failed",
    message: lastError instanceof Error ? lastError.message : "No queued account could be activated."
  };
}

function compareQueuedAccounts(left: CodexAccountRecord, right: CodexAccountRecord): number {
  return compareCodexAccountAutoQueueOrder(left, right) || left.createdAt - right.createdAt;
}
