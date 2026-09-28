import { test } from "vitest";
import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";
import { xdr, scValToNative } from "@stellar/stellar-sdk";
import { fund, getVk, clearContractClientCache } from "./contract.js";
import { DEFAULT_RETRY_POLICY } from "./retry.js";
import type { ContractVerificationKey } from "./prove.js";

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
// getVk — one-time fetch with per-(contract, circle) session cache (#481)
// =====================================================================

const MOCK_VK: ContractVerificationKey = {
  alpha: new Uint8Array(96),
  beta: new Uint8Array(192),
  gamma: new Uint8Array(192),
  delta: new Uint8Array(192),
  ic: [new Uint8Array(96), new Uint8Array(96), new Uint8Array(96), new Uint8Array(96)],
};

function mockVkClient(calls: { count: number }, contractId = "CONTRACT") {
  return {
    options: { contractId },
    emitter: undefined,
    get_vk: () => {
      calls.count++;
      return { result: MOCK_VK };
    },
  };
}

test("getVk fetches the verification key at most once per circle per session", async () => {
  clearContractClientCache();
  const calls = { count: 0 };
  const client = mockVkClient(calls);
  const policy = { ...DEFAULT_RETRY_POLICY, sleep: async () => {} };

  const first = await getVk(client as never, 0n, policy);
  const second = await getVk(client as never, 0n, policy);
  const third = await getVk(client as never, 0n, policy);

  assert.strictEqual(calls.count, 1, "repeat reads must be served from the cache");
  assert.strictEqual(first, second);
  assert.strictEqual(second, third);
});

test("getVk caches per (contractId, circleId)", async () => {
  clearContractClientCache();
  const calls = { count: 0 };
  const client = mockVkClient(calls);
  const policy = { ...DEFAULT_RETRY_POLICY, sleep: async () => {} };

  await getVk(client as never, 0n, policy);
  await getVk(client as never, 1n, policy);
  await getVk(client as never, 0n, policy);

  assert.strictEqual(calls.count, 2, "each circle fetches once; circle 0 is cached");
});

test("clearContractClientCache invalidates the vk cache", async () => {
  clearContractClientCache();
  const calls = { count: 0 };
  const client = mockVkClient(calls);
  const policy = { ...DEFAULT_RETRY_POLICY, sleep: async () => {} };

  await getVk(client as never, 0n, policy);
  clearContractClientCache();
  await getVk(client as never, 0n, policy);

  assert.strictEqual(calls.count, 2, "the next fetch after a cache clear hits the contract");
  clearContractClientCache();
});

// =====================================================================
