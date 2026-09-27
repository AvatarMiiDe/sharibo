import {
  connect,
  createCircle,
  fund,
  claim,
  getCircle,
  getCircleCount,
  hasClaimed,
  getStatus,
  cancelCircle,
  getCircleStatus,
  getRound,
  getPot,
  getContributors,
  estimateClaimFee,
  type ShariboNetworkConfig,
  type ShariboSigner,
  type TxResult,
} from "./contract.js";
import { Keypair } from "@stellar/stellar-sdk";
import { DEFAULT_RETRY_POLICY, type RetryPolicy } from "./retry.js";

/**
 * Object-oriented facade over the free functions in `contract.ts`.
 *
 * Each method is a thin delegation that threads the connected `client` and
 * the configured `retryPolicy` through to the corresponding free function,
 * so callers don't have to pass them by hand. The free functions remain the
 * low-level layer (see `docs/adr/003-client-boundary.md`); this facade is the
 * recommended entry point for application code.
 */
export class ShariboSDK {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly client: any;
  private readonly retryPolicy: RetryPolicy;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private constructor(client: any, retryPolicy: RetryPolicy) {
    this.client = client;
    this.retryPolicy = retryPolicy;
  }

  static async connect(
    config: ShariboNetworkConfig,
    keypairOrSigner: Keypair | ShariboSigner,
    retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY,
  ): Promise<ShariboSDK> {
    const client = await connect(config, keypairOrSigner);
    return new ShariboSDK(client, retryPolicy);
  }

  createCircle(...args: Parameters<typeof createCircle> extends [unknown, ...infer R] ? R : never) {
    return createCircle(this.client, this.retryPolicy, ...args);
  }

  fund(...args: Parameters<typeof fund> extends [unknown, ...infer R] ? R : never) {
    return fund(this.client, this.retryPolicy, ...args);
  }

  claim(...args: Parameters<typeof claim> extends [unknown, ...infer R] ? R : never) {
    return claim(this.client, this.retryPolicy, ...args);
  }

  getCircle(...args: Parameters<typeof getCircle> extends [unknown, ...infer R] ? R : never) {
    return getCircle(this.client, this.retryPolicy, ...args);
  }

  getCircleCount(...args: Parameters<typeof getCircleCount> extends [unknown, ...infer R] ? R : never) {
    return getCircleCount(this.client, this.retryPolicy, ...args);
  }

  hasClaimed(...args: Parameters<typeof hasClaimed> extends [unknown, ...infer R] ? R : never) {
    return hasClaimed(this.client, this.retryPolicy, ...args);
  }

  getStatus(...args: Parameters<typeof getStatus> extends [unknown, ...infer R] ? R : never) {
    return getStatus(this.client, this.retryPolicy, ...args);
  }

  cancelCircle(...args: Parameters<typeof cancelCircle> extends [unknown, ...infer R] ? R : never) {
    return cancelCircle(this.client, this.retryPolicy, ...args);
  }

  getCircleStatus(...args: Parameters<typeof getCircleStatus> extends [unknown, ...infer R] ? R : never) {
    return getCircleStatus(this.client, this.retryPolicy, ...args);
  }

  getRound(...args: Parameters<typeof getRound> extends [unknown, ...infer R] ? R : never) {
    return getRound(this.client, this.retryPolicy, ...args);
  }

  getPot(...args: Parameters<typeof getPot> extends [unknown, ...infer R] ? R : never) {
    return getPot(this.client, this.retryPolicy, ...args);
  }

  getContributors(...args: Parameters<typeof getContributors> extends [unknown, ...infer R] ? R : never) {
    return getContributors(this.client, this.retryPolicy, ...args);
  }

  estimateClaimFee(...args: Parameters<typeof estimateClaimFee> extends [unknown, ...infer R] ? R : never) {
    return estimateClaimFee(this.client, this.retryPolicy, ...args);
  }
}

export type { TxResult };
