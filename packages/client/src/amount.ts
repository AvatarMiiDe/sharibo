export const STROOPS_PER_XLM = 10_000_000n;

export function xlmToStroops(xlm: number | bigint | string): bigint {
  if (typeof xlm === "bigint") {
    return xlm * STROOPS_PER_XLM;
  }

  const value = typeof xlm === "number" ? xlm.toString() : xlm.trim();

  if (!/^[+-]?\d+(\.\d+)?$/.test(value)) {
    throw new RangeError(`Invalid XLM value: ${String(xlm)}`);
  }

  const negative = value.startsWith("-");
  const [wholePart, fractionalPart = ""] = value.replace(/^[+-]/, "").split(".");

  const wholeUnits = BigInt(wholePart || "0");
  const adjustedFraction = fractionalPart.padEnd(7, "0").slice(0, 7);
  let result = wholeUnits * STROOPS_PER_XLM + BigInt(adjustedFraction || "0");

  if (fractionalPart.length > 7 && fractionalPart[7] >= "5") {
    result += 1n;
  }

  return negative ? -result : result;
}

export function stroopsToXlm(stroops: bigint): bigint {
  return stroops / STROOPS_PER_XLM;
}

export function formatXlm(stroops: bigint): string {
  const negative = stroops < 0n;
  const absolute = negative ? -stroops : stroops;
  const whole = absolute / STROOPS_PER_XLM;
  const remainder = absolute % STROOPS_PER_XLM;
  const fraction = remainder.toString().padStart(7, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/**
 * Locale-aware display formatting for XLM amounts shown in the UI.
 *
 * Uses `Intl.NumberFormat` with the active locale so Hindi gets lakh/crore
 * grouping and locales that use `,` as the decimal separator render correctly.
 *
 * **Do not use this for anything copied, compared, or persisted** — those
 * paths must keep {@link formatXlm}'s fixed ASCII `123.4567890` form so
 * wire formats and tests stay locale-independent.
 */
export function formatXlmDisplay(
  stroops: bigint,
  locale: string,
  options: Intl.NumberFormatOptions = {},
): string {
  const negative = stroops < 0n;
  const absolute = negative ? -stroops : stroops;
  const whole = absolute / STROOPS_PER_XLM;
  const remainder = absolute % STROOPS_PER_XLM;
  const asNumber = Number(whole) + Number(remainder) / 1e7;
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 7,
    ...options,
  }).format(negative ? -asNumber : asNumber);
  return formatted;
}

