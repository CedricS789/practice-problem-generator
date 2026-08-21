import assert from "node:assert/strict";
import test from "node:test";

import { retryAsync } from "../src/async-retry";

test("a transient persistence failure is retried with bounded backoff", async () => {
  let calls = 0;
  const waits: number[] = [];
  const result = await retryAsync(
    async () => {
      calls += 1;
      if (calls < 3) throw new Error("Synthetic sync-provider lock");
      return "saved";
    },
    [0, 500, 2_000],
    async (milliseconds) => {
      waits.push(milliseconds);
    },
  );

  assert.equal(result, "saved");
  assert.equal(calls, 3);
  assert.deepEqual(waits, [500, 2_000]);
});

test("a persistent failure is retained after exactly the configured attempts", async () => {
  let calls = 0;
  await assert.rejects(
    retryAsync(
      async () => {
        calls += 1;
        throw new Error("Still locked");
      },
      [0, 1, 2],
      async () => undefined,
    ),
    /Still locked/u,
  );
  assert.equal(calls, 3);
});

test("retry configuration fails closed for empty or invalid delays", async () => {
  await assert.rejects(retryAsync(async () => true, []), /At least one/u);
  await assert.rejects(
    retryAsync(async () => true, [Number.NaN]),
    /finite non-negative/u,
  );
});
