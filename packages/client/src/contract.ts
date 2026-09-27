import { networkOf } from "./networks.js";
import { Client as ContractClient, basicNodeSigner } from "@stellar/stellar-sdk/contract";
import { Keypair } from "@stellar/stellar-sdk";
import { Api } from "@stellar/stellar-sdk/rpc";
import type { ContractProof, ContractVerificationKey } from "./prove.js";
import { ContractError, RpcError, InvalidInputError } from "./errors.js";
import { decodeContractError } from "./decodeError.js";
import { withRetry, DEFAULT_RETRY_POLICY, type RetryPolicy } from "./retry.js";
import { validateContractProof, validateContractVerificationKey } from "./validate.js";
import { SdkEventEmitter, type OnEventFn } from "./events.js";

/**
 * Configuration required to connect to the Sharibo contract.
 *
 * @property contractId - The Stellar contract ID.
 * @property rpcUrl - The RPC URL for the Stellar network.
 * @property networkPassphrase - The network passphrase.
 * @property onEvent - Optional callback for observability events.
 */
export interface ShariboNetworkConfig {
  contractId: string;
  rpcUrl: string;
  networkPassphrase: string;
  onEvent?: OnEventFn;
}

/**
 * A Sharibo contract client with dynamically attached methods.
 *
 * The contract's methods (create_circle/fund/claim/get_circle/has_claimed)
 * are attached to the Client at runtime from the on-chain contract spec (see
 * @stellar/stellar-sdk's `contract.Client.from`), so they aren't visible to
 * TypeScript's static checker — hence `any` here rather than a hand-rolled
 * or codegen'd interface. Keeps this SDK working against whatever the
 * deployed contract's real spec is, rather than a copy that can drift.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ShariboClient = any;

/**
 * The transaction builder the dynamically-typed contract client returns from
 * each contract method (create_circle/fund/claim/get_circle/...). Kept as
 * `any` for the same reason as `ShariboClient` — the shape is defined by the
 * on-chain spec, not by a hand-rolled interface. It exposes `signAndSend`,
 * whose result shape is documented by `populateTxResult`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ContractTx = any;

export interface ShariboSigner {
  publicKey: string;
  signTransaction: (txXdr: string, opts?: unknown) => Promise<string>;
  signAuthEntry?: (entryXdr: string, opts?: unknown) => Promise<string>;
}

export interface ResolvedSigner {
  publicKey: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signTransaction: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signAuthEntry: any;
}

/**
 * Turns a keypair or a wallet signer into the pieces the contract client
 * needs, without constructing the client. Shared by `connect` and the SDK
 * facade so both agree on who the signer is.
 */
export interface FeeEstimate {
  /** Minimum resource fee in stroops, as reported by simulation. */
  minResourceFee: bigint;
  /** Total fee (base + resource) encoded in the assembled transaction, in stroops. */
  totalFee: bigint;
}

export function resolveSigner(
  keypairOrSigner: Keypair | ShariboSigner,
  networkPassphrase: string,
): ResolvedSigner {
  if (keypairOrSigner instanceof Keypair) {
    const signer = basicNodeSigner(keypairOrSigner, networkPassphrase);
    return {
      publicKey: keypairOrSigner.publicKey(),
      signTransaction: signer.signTransaction,
      signAuthEntry: signer.signAuthEntry,
    };
  }
  return {
    publicKey: keypairOrSigner.publicKey,
    signTransaction: keypairOrSigner.signTransaction,
    signAuthEntry: keypairOrSigner.signAuthEntry,
  };
}

const contractClientCache = new Map<string, Promise<ShariboClient>>();

export function clearContractClientCache(): void {
  contractClientCache.clear();
}

export async function connect(
  config: ShariboNetworkConfig,
  keypairOrSigner: Keypair | ShariboSigner,
): Promise<ShariboClient> {
  const signer = resolveSigner(keypairOrSigner, config.networkPassphrase);

  const cacheKey = JSON.stringify([
    config.contractId,
    config.rpcUrl,
    config.networkPassphrase,
    signer.publicKey,
  ]);

  const cached = contractClientCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const emitter = new SdkEventEmitter(config.onEvent);
  const clientPromise = ContractClient.from({
    contractId: config.contractId,
    networkPassphrase: config.networkPassphrase,
    rpcUrl: config.rpcUrl,
    publicKey: signer.publicKey,
    signTransaction: signer.signTransaction,
    signAuthEntry: signer.signAuthEntry,
  });

  contractClientCache.set(cacheKey, clientPromise);

  try {
    const client: ShariboClient = await clientPromise;
    client.emitter = emitter;
    return client;
  } catch (error) {
    contractClientCache.delete(cacheKey);
    throw error;
  }
}

/**
 * Build a read-only contract client that can simulate view calls without a
 * signer, a funded account, or any fee payment.
 *
 * Use this for {@link getCircle}, {@link getCircleCount}, and
 * {@link hasClaimed}.  The returned client must **not** be passed to
 * write-path functions (`fund`, `claim`, `createCircle`) — those require a
 * signed client from {@link connect}.
 */
export async function connectReadOnly(
  config: ShariboNetworkConfig,
): Promise<ShariboClient> {
  return ContractClient.from({
    contractId: config.contractId,
    networkPassphrase: config.networkPassphrase,
    rpcUrl: config.rpcUrl,
    // publicKey omitted — the SDK accepts undefined for simulation-only calls
  });
}

/**
 * Result of a contract transaction.
 *
 * @template T - The type of the transaction result.
 * @property result - The return value from the contract method.
 * @property hash - The transaction hash.
 */
export interface TxResult<T> {
  result: T;
  hash: string;
  /** Ledger sequence number the transaction was included in, if available. */
  ledger?: number;
  /** Fee charged for the transaction in stroops, if available. */
  feeCharged?: string;
}

/**
 * Known Stellar network passphrases mapped to their stellar.expert path
 * segment (the part after "https://stellar.expert/explorer/").
 *
 * Only networks that stellar.expert actually hosts are listed here.
 * Any passphrase not in this map is unknown — callers receive `null`
 * instead of a silently wrong URL (e.g. futurenet would otherwise
 * receive a testnet URL, which is misleading).
 */
export const EXPLORER_NETWORKS: ReadonlyMap<string, string> = new Map([
  // Mainnet — "Public Global Stellar Network ; September 2015"
  ["Public Global Stellar Network ; September 2015", "public"],
  // Testnet — "Test SDF Network ; September 2015"
  ["Test SDF Network ; September 2015", "testnet"],
]);

/**
 * Build a Stellar explorer URL for a transaction hash, network-aware.
 *
 * Returns `null` for any network passphrase that stellar.expert does not
 * host (futurenet, custom networks, etc.) so callers can decide whether to
 * show a link at all, rather than silently linking to the wrong network.
 *
 * @param hash - Transaction hash (hex string).
 * @param networkPassphrase - Stellar network passphrase.
 * @returns A fully-qualified stellar.expert URL.
 */
export function explorerTxUrl(hash: string, networkPassphrase: string): string | null {
  const network = EXPLORER_NETWORKS.get(networkPassphrase);
  if (network === undefined) return null;
  return `https://stellar.expert/explorer/${network}/tx/${hash}`;
}


function populateTxResult<T>(
  result: T,
  sent: { sendTransactionResponse: { hash: string }; getTransactionResponse?: { ledger?: number; feeCharged?: string } },
): TxResult<T> {
  return {
    result,
    hash: sent.sendTransactionResponse.hash,
    ledger: sent.getTransactionResponse?.ledger,
    feeCharged: sent.getTransactionResponse?.feeCharged,
  };
}

/**
 * Simulate a write call with retry, then sign and send it, decoding any
 * contract error into a typed {@link ContractError}.
 *
 * Shared by every write-path wrapper (`fund`, `claim`, `createCircle`,
 * `expireRound`, `proposeAdmin`, `acceptAdmin`) so they all agree on retry
 * policy, error decoding, and result shape.
 */
async function simulateSignAndSend<T>(
  build: () => Promise<ContractTx>,
  retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY,
): Promise<TxResult<T>> {
  try {
    const tx = await withRetry(() => build(), retryPolicy);
    const sent = await tx.signAndSend();
    return populateTxResult<T>(sent.result as T, sent);
  } catch (error) {
    throw decodeContractError(error);
  }
}

/**
 * Expire a stalled round so contributors can recover their funds without the
 * admin key (contract `expire_round`, error `RoundNotExpired = 12`).
 *
 * Only valid once the round deadline has passed; the contract rejects the
 * call with `RoundNotExpired` otherwise. Use {@link getRoundDeadline} to
 * learn how many ledgers remain before this call will succeed.
 */
export async function expireRound(
  client: ShariboClient,
  circleId: bigint | number,
  retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY,
): Promise<TxResult<void>> {
  return simulateSignAndSend<void>(
    () => client.expire_round({ circle_id: circleId }),
    retryPolicy,
  );
}

/**
 * Propose a new admin for a circle (contract `propose_admin`). The proposal
 * must be accepted by the nominee via {@link acceptAdmin} before it takes
 * effect. Used for key rotation.
 */
export async function proposeAdmin(
  client: ShariboClient,
  circleId: bigint | number,
  newAdmin: string,
  retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY,
): Promise<TxResult<void>> {
  return simulateSignAndSend<void>(
    () => client.propose_admin({ circle_id: circleId, new_admin: newAdmin }),
    retryPolicy,
  );
}

/**
 * Accept a pending admin proposal for a circle (contract `accept_admin`).
 * Must be called by the nominee named in the matching {@link proposeAdmin}.
 */
export async function acceptAdmin(
  client: ShariboClient,
  circleId: bigint | number,
  retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY,
): Promise<TxResult<void>> {
  return simulateSignAndSend<void>(
    () => client.accept_admin({ circle_id: circleId }),
    retryPolicy,
  );
}

/**
 * Remaining-ledgers figure for a circle's round, derived client-side from
 * `round_started_ledger + round_deadline_ledgers` versus the current ledger.
 *
 * A positive `remainingLedgers` means the round is still open; zero or below
 * means it has expired and {@link expireRound} can be invoked. `expired`
 * mirrors that comparison for callers that only need the boolean.
 */
export interface RoundDeadline {
  /** Ledger the round started at. */
  startedLedger: number;
  /** Number of ledgers the round stays open for. */
  deadlineLedgers: number;
  /** Ledger at which the round expires. */
  deadlineLedger: number;
  /** Ledgers remaining until expiry (negative once past the deadline). */
  remainingLedgers: number;
  /** True once the current ledger has reached the deadline. */
  expired: boolean;
}

/**
 * Derive the round deadline from a circle's `round_started_ledger` and
 * `round_deadline_ledgers` fields and the current ledger sequence.
 *
 * Pure helper so both the SDK facade and the app can render "how long until
 * expiry" without an extra contract view.
 */
export function getRoundDeadline(
  circle: { round_started_ledger: number | bigint; round_deadline_ledgers: number | bigint },
  currentLedger: number | bigint,
): RoundDeadline {
  const startedLedger = Number(circle.round_started_ledger);
  const deadlineLedgers = Number(circle.round_deadline_ledgers);
  const deadlineLedger = startedLedger + deadlineLedgers;
  const remainingLedgers = deadlineLedger - Number(currentLedger);
  return {
    startedLedger,
    deadlineLedgers,
    deadlineLedger,
    remainingLedgers,
    expired: remainingLedgers <= 0,
  };
}
