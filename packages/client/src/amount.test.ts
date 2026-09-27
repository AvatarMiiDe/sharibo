import { test } from "vitest";
import assert from "node:assert/strict";
import fc from "fast-check";

import { formatXlm, xlmToStroops, STROOPS_PER_XLM } from "./amount.js";

test("xlmToStroops truncates sub-stroop amounts toward zero", () => {
  assert.equal(xlmToStroops("0.0000001"), 1n);
  assert.equal(xlmToStroops("0.00000009"), 0n);
  assert.equal(xlmToStroops("0.00000005"), 0n);
  assert.equal(xlmToStroops("0.00000004"), 0n);
  assert.equal(xlmToStroops("-0.00000009"), 0n);
  assert.equal(xlmToStroops("0.0000000"), 0n);
  assert.equal(xlmToStroops("1"), STROOPS_PER_XLM);
});

test("xlmToStroops rejects malformed values, including a trailing dot", () => {
  assert.throws(() => xlmToStroops("1."), RangeError);
  assert.throws(() => xlmToStroops("1e-7"), RangeError);
});

test("formatXlm preserves the full i128::MAX boundary without losing precision", () => {
  const maxI128 = 170141183460469231731687303715884105727n;
  assert.equal(formatXlm(maxI128), "170141183460469231731687303715884105727.0000000");
  assert.equal(STROOPS_PER_XLM, 10_000_000n);
});

test("xlmToStroops and formatXlm handle negative values consistently", () => {
  assert.equal(xlmToStroops("-0.0000001"), -1n);
  assert.equal(formatXlm(-1n), "-0.0000001");
  assert.equal(formatXlm(-170141183460469231731687303715884105727n), "-170141183460469231731687303715884105727.0000000");
});

test("xlmToStroops(formatXlm(n)) round-trips for any non-negative stroop count", () => {
  fc.assert(
    fc.property(fc.bigInt({ min: 0n, max: 170141183460469231731687303715884105727n }), (n) => {
      assert.equal(xlmToStroops(formatXlm(n)), n);
    }),
  );
});
