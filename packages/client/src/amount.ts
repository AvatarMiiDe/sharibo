import { STROOPS_PER_XLM } from "./constants.js";

/**
 * Convert an XLM amount to stroops (1 XLM = 10,000,000 stroops).
 *
 * Rounding rule: **truncation toward zero**. Any fractional part beyond the
 * 7th decimal place (i.e. sub-stroop precision) is discarded rather than
 * rounded. This is the safe default for a deposit amount — the caller is
 * never charged more than the value they typed. For example,
 * `xlmToStroops("0.00000009")` returns `0n`, not `1n`.
 *
 * Accepts a `bigint` (whole XLM) or a decimal `string`. A `number` is
 * deliberately rejected: a JS `number` cannot represent stroop-precision
 * decimals beyond ~15 significant digits, and `Number.prototype.toString()`
 * emits exponent notation below 1e-6, which would silently lose precision.
 *
 * @throws {RangeError} if `xlm` is not a valid decimal string.
 */
export function xlmToStroops(xlm: bigint | string): bigint {
  if (typeof xlm === "bigint") {
    return xlm * STROOPS_PER_XLM;
  }

  const value = xlm.trim();
  if (!/^[+-]?\d+(\.\d+)?$/.test(value)) {
    throw new RangeError(`Invalid XLM value: ${String(xlm)}`);
  }

  const negative = value.startsWith("-");
  const unsigned = value.replace(/^[+-]/, "");
  const [wholePart, fractionalPart = ""] = unsigned.split(".");

  // Truncate toward zero: keep only the first 7 fractional digits.
  const adjustedFraction = fractionalPart.padEnd(7, "0").slice(0, 7);
  const result = BigInt(wholePart) * STROOPS_PER_XLM + BigInt(adjustedFraction || "0");

  return negative ? -result : result;
}
