import { test, vi } from "vitest";
import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";
import { xdr, scValToNative } from "@stellar/stellar-sdk";
import { Client as ContractClient } from "@stellar/stellar-sdk/contract";
import { clearContractClientCache, connect, connectReadOnly, fund } from "./contract.js";
import { DEFAULT_RETRY_POLICY } from "./retry.js";

const TEST_CONFIG = {
  contractId: "C-test-contract",
  rpcUrl: "https://rpc.example.test",
  networkPassphrase: "Test Network",
};

function testSigner(publicKey: string) {
  return {
    publicKey,
    signTransaction: async (txXdr: string) => txXdr,
  };
}

test("connect caches separately by signer and refreshes event handlers", async () => {
  clearContractClientCache();
  const from = vi.spyOn(ContractClient, "from").mockImplementation(async (options) => ({
    publicKey: options.publicKey,
  }) as never);
  const firstHandler = vi.fn();
  const secondHandler = vi.fn();

  try {
    const first = await connect({ ...TEST_CONFIG, onEvent: firstHandler }, testSigner("G-FIRST"));
    const repeated = await connect({ ...TEST_CONFIG, onEvent: secondHandler }, testSigner("G-FIRST"));
    const otherSigner = await connect(TEST_CONFIG, testSigner("G-SECOND"));

    assert.strictEqual(first, repeated);
    assert.notStrictEqual(first, otherSigner);
    assert.strictEqual(first.publicKey, "G-FIRST");
    assert.strictEqual(otherSigner.publicKey, "G-SECOND");
    assert.strictEqual(from.mock.calls.length, 2);

    first.emitter.emit({ type: "rpc:attempt" });
    assert.strictEqual(firstHandler.mock.calls.length, 0);
    assert.strictEqual(secondHandler.mock.calls.length, 1);
  } finally {
    clearContractClientCache();
    from.mockRestore();
  }
});

test("clearing the contract client cache refetches the contract spec", async () => {
  clearContractClientCache();
  const from = vi.spyOn(ContractClient, "from").mockImplementation(async () => ({}) as never);

  try {
    await connect(TEST_CONFIG, testSigner("G-RELOAD"));
    assert.strictEqual(from.mock.calls.length, 1);

    clearContractClientCache();
    await connect(TEST_CONFIG, testSigner("G-RELOAD"));

    assert.strictEqual(from.mock.calls.length, 2);
  } finally {
    clearContractClientCache();
    from.mockRestore();
  }
});

test("read-only clients use a separate cache identity", async () => {
  clearContractClientCache();
  const from = vi.spyOn(ContractClient, "from").mockImplementation(async (options) => ({
    publicKey: options.publicKey,
  }) as never);

  try {
    const signed = await connect(TEST_CONFIG, testSigner("G-SIGNED"));
    const readOnly = await connectReadOnly(TEST_CONFIG);
    const readOnlyAgain = await connectReadOnly(TEST_CONFIG);

    assert.notStrictEqual(signed, readOnly);
    assert.strictEqual(readOnly, readOnlyAgain);
    assert.strictEqual(from.mock.calls.length, 2);
  } finally {
    clearContractClientCache();
    from.mockRestore();
  }
});

test("contract client cache evicts the least recently used entry at its bound", async () => {
  clearContractClientCache();
  const from = vi.spyOn(ContractClient, "from").mockImplementation(async () => ({}) as never);

  try {
    for (let index = 0; index < 17; index++) {
      await connect(TEST_CONFIG, testSigner(`G-${index}`));
    }
    await connect(TEST_CONFIG, testSigner("G-0"));

    assert.strictEqual(from.mock.calls.length, 18);
  } finally {
    clearContractClientCache();
    from.mockRestore();
  }
});

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

// =====================================================================});
