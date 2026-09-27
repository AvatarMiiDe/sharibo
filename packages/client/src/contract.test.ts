import { test } from "vitest";
import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";
import { xdr, scValToNative } from "@stellar/stellar-sdk";
import { fund } from "./contract.js";
import { DEFAULT_RETRY_POLICY } from "./retry.js";

test("transient simulate-phase failure recovers", async () => {
    let simulateCalls = 0;
    let signAndSendCalls = 0;
    const mockTx = {
      signAndSend: async () => {
        signAndSendCalls++;
        return {
          result: undefined,
          sendTransactionResponse: { hash: "0xabc" },
        };
      },
    };

  const mockClient = {
    fund: () => {
      simulateCalls++;
      if (simulateCalls < 3) {
        throw new Error("RPC Error 429 Too Many Requests");
      }
      return mockTx;
    },
  };

  const policy = { ...DEFAULT_RETRY_POLICY, sleep: async () => {} };

  const result = await fund(mockClient, { circleId: 0n, from: "G..." }, policy);
  assert.strictEqual(simulateCalls, 3);
  assert.strictEqual(signAndSendCalls, 1);
  assert.strictEqual(result.hash, "0xabc");
});

test("post-submit failure surfaces immediately without a second submission", async () => {
  let simulateCalls = 0;
  let signAndSendCalls = 0;
  const mockTx = {
    signAndSend: async () => {
      signAndSendCalls++;
      throw new Error("RPC Error 504 Gateway Timeout during polling");
    },
  };

  const mockClient = {
    fund: () => {
      simulateCalls++;
      return mockTx;
    },
  };

  await assert.rejects(
    async () =>
      await fund(mockClient, { circleId: 0n, from: "G..." }, {
        ...DEFAULT_RETRY_POLICY,
        sleep: async () => {},
      }),
    /504/
  );
  assert.strictEqual(simulateCalls, 1);
  assert.strictEqual(signAndSendCalls, 1);
});

// =====================================================================
// #494: structural read/write invariant.
//
// The reads/writes split is load-bearing: read-only calls must go through
// pure simulation, while writes go through signAndSend. #279 was a bug
// caused by a read accidentally reaching for signAndSend. This test makes
// that mistake structurally unrepeatable by asserting reads.ts never
// references signAndSend.
// =====================================================================

test("reads.ts never reaches for signAndSend", () => {
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const readsPath = path.join(here, "contract", "reads.ts");
  const source = fs.readFileSync(readsPath, "utf8");
  assert.ok(
    !source.includes("signAndSend"),
    "reads.ts must not reference signAndSend; read paths must use pure simulation"
  );
});
