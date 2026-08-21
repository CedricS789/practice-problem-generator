export type AsyncRetryDelay = (milliseconds: number) => Promise<void>;

function defaultDelay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

/**
 * Runs one operation once per configured delay. A zero delay starts
 * immediately; later delays are bounded backoff before the next attempt.
 */
export async function retryAsync<T>(
  operation: () => Promise<T>,
  delaysMs: readonly number[],
  wait: AsyncRetryDelay = defaultDelay,
): Promise<T> {
  if (delaysMs.length === 0) {
    throw new Error("At least one retry attempt is required.");
  }
  let lastError: unknown;
  for (const delayMs of delaysMs) {
    if (!Number.isFinite(delayMs) || delayMs < 0) {
      throw new Error("Retry delays must be finite non-negative numbers.");
    }
    if (delayMs > 0) await wait(delayMs);
    try {
      return await operation();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("The retried operation failed.");
}
