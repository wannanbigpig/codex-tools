import type { DashboardAccountViewModel } from "../../domain/dashboard/types";
import { AccountsRepository } from "../../storage";
import { fetchResetCredits } from "../../services/quota";
import { logNetworkEvent } from "../../utils/debug";
import { CrossWindowOperationBusyError, runCentralAccountOperation } from "../../utils/crossWindowOperations";

const RESET_CREDITS_BACKFILL_COOLDOWN_MS = 60_000;
const inflightResetCreditsBackfills = new Set<string>();
const resetCreditsBackfillCooldownUntil = new Map<string, number>();

export function pickResetCreditsBackfillTargets(
  accounts: readonly DashboardAccountViewModel[],
  now = Date.now()
): DashboardAccountViewModel[] {
  return accounts.filter((account) => {
    if ((account.resetCreditsAvailable ?? 0) <= 0) {
      return false;
    }
    if ((account.resetCreditsNextExpiresAt ?? 0) > 0) {
      return false;
    }
    if (inflightResetCreditsBackfills.has(account.id)) {
      return false;
    }
    return (resetCreditsBackfillCooldownUntil.get(account.id) ?? 0) <= now;
  });
}

export async function backfillMissingResetCreditExpiries(
  repo: AccountsRepository,
  accounts: readonly DashboardAccountViewModel[],
  onUpdated: () => void,
  now = Date.now()
): Promise<boolean> {
  try {
    return await runCentralAccountOperation("Reset credits refresh", async () => {
      try {
        return await backfillMissingResetCreditExpiriesInternal(repo, accounts, onUpdated, now);
      } finally {
        await repo.flush?.();
      }
    });
  } catch (error) {
    if (error instanceof CrossWindowOperationBusyError) {
      return false;
    }
    throw error;
  }
}

async function backfillMissingResetCreditExpiriesInternal(
  repo: AccountsRepository,
  accounts: readonly DashboardAccountViewModel[],
  onUpdated: () => void,
  now: number
): Promise<boolean> {
  const targets = pickResetCreditsBackfillTargets(accounts, now);
  if (targets.length === 0) {
    return false;
  }

  let updated = false;
  await Promise.all(
    targets.map(async (account) => {
      inflightResetCreditsBackfills.add(account.id);
      resetCreditsBackfillCooldownUntil.set(account.id, now + RESET_CREDITS_BACKFILL_COOLDOWN_MS);
      try {
        const tokens = await repo.getTokens(account.id, { syncExternal: false });
        if (!tokens?.accessToken) {
          logNetworkEvent("resetCredits.backfill", {
            accountId: account.id,
            remoteAccountId: account.accountId,
            step: "skipped",
            reason: "missing-access-token"
          });
          return;
        }

        const snapshot = await fetchResetCredits(tokens.accessToken, account.accountId ?? undefined);
        logNetworkEvent("resetCredits.backfill", {
          accountId: account.id,
          remoteAccountId: account.accountId,
          step: "fetched",
          availableCount: snapshot.availableCount,
          nextExpiresAt: snapshot.nextExpiresAt ?? null,
          creditsCount: snapshot.credits.length
        });
        if (snapshot.availableCount > 0 && snapshot.nextExpiresAt == null) {
          console.info(
            `[codexAccounts] reset credits backfill returned ${snapshot.availableCount} credit(s) without an expiry for ${
              account.email ?? account.id
            }`
          );
        }
        await repo.updateResetCreditsSnapshot(account.id, snapshot.availableCount, snapshot.nextExpiresAt);
        updated = true;
      } catch (error) {
        console.warn(
          `[codexAccounts] reset credits backfill failed for ${account.email ?? account.id}:`,
          error
        );
        logNetworkEvent("resetCredits.backfill", {
          accountId: account.id,
          remoteAccountId: account.accountId,
          step: "failed",
          error: error instanceof Error ? error.message : String(error)
        });
        return;
      } finally {
        inflightResetCreditsBackfills.delete(account.id);
      }
    })
  );

  if (updated) {
    onUpdated();
  }
  return updated;
}
