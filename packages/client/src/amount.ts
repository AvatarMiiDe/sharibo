import { STROOPS_PER_XLM } from "./constants";

/**
 * Convert a whole XLM amount to stroops.
 *
 * @param xlm - A decimal XLM amount as a string, e.g. `"1.5"`.
 * @returns The equivalent amount in stroops.
 */
export function xlmToStroops(xlm: string): bigint {
  const [whole, fraction = ""] = xlm.split(".");
  const paddedFraction = fraction.padEnd(7, "0").slice(0, 7);
  return BigInt(whole) * STROOPS_PER_XLM + BigInt(paddedFraction);
}

/**
 * Convert stroops to whole XLM, discarding any fractional remainder.
 *
 * This is a **lossy** conversion: `bigint` division truncates toward zero, so
 * any sub-XLM remainder is silently dropped. For example `9_999_999n` stroops
 * (0.9999999 XLM) returns `0n`, and `-9_999_999n` also returns `0n`.
 *
 * If you need the precise value with all seven decimal digits preserved, use
 * {@link formatXlm}, which returns the full amount as a string.
 *
 * @param stroops - The amount in stroops.
 * @returns The whole-XLM portion, truncated toward zero.
 */
export function stroopsToWholeXlm(stroops: bigint): bigint {
  return stroops / STROOPS_PER_XLM;
}

/**
 * Format a stroop amount as a decimal XLM string, preserving all seven
 * fractional digits.
 *
 * @param stroops - The amount in stroops.
 * @returns The XLM amount as a string, e.g. `"0.9999999"`.
 */
export function formatXlm(stroops: bigint): string {
  const whole = stroops / STROOPS_PER_XLM;
  const fraction = stroops % STROOPS_PER_XLM;
  return `${whole}.${fraction.toString().padStart(7, "0")}`;
}
