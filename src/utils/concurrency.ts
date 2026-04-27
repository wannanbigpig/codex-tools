export async function runWithConcurrencyLimit<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
  options: { delayMs?: number } = {}
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  let cursor = 0;
  const runnerCount = Math.min(limit, items.length);
  const delayMs = Math.max(0, options.delayMs ?? 0);

  await Promise.allSettled(
    Array.from({ length: runnerCount }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        const item = items[index];
        if (item === undefined) {
          return;
        }

        if (delayMs > 0) {
          await sleep(delayMs);
        }
        await worker(item, index);
      }
    })
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
