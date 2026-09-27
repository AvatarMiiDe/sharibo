import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { STROOPS_PER_XLM, formatXlm, stroopsToWholeXlm, xlmToStroops } from "./amount";

describe("formatXlm", () => {
  it("preserves all seven fractional digits at the i128::MAX boundary without float rounding", () => {
    const maxI128 = 170141183460469231731687303715884105727n;
    assert.equal(formatXlm(maxI128), "17014118346046923173168730371588.4105727");
  });

  it("xlmToStroops and formatXlm handle negative values consistently", () => {
    const maxI128 = 170141183460469231731687303715884105727n;
    assert.equal(formatXlm(-maxI128), "-17014118346046923173168730371588.4105727");
    assert.equal(formatXlm(-1n), "-0.0000001");
  });

  it("formats zero stroops", () => {
    assert.equal(formatXlm(0n), "0.0000000");
  });

  it("formats whole XLM amounts", () => {
    assert.equal(formatXlm(STROOPS_PER_XLM), "1.0000000");
  });

  it("pads sub-stroop remainders instead of using toString", () => {
    assert.equal(formatXlm(10_000_001n), "1.0000001");
  });

  it("round-trips through xlmToStroops", () => {
    const values = [0n, 1n, STROOPS_PER_XLM, 10_000_001n, 170141183460469231731687303715884105727n];
    for (const stroops of values) {
      assert.equal(xlmToStroops(formatXlm(stroops)), stroops);
    }
  });
});

describe("stroopsToWholeXlm", () => {
  it("returns whole XLM for exact multiples of STROOPS_PER_XLM", () => {
    assert.equal(stroopsToWholeXlm(10_000_000n), 1n);
    assert.equal(stroopsToWholeXlm(30_000_000n), 3n);
  });

  it("truncates sub-XLM remainders toward zero", () => {
    assert.equal(stroopsToWholeXlm(9_999_999n), 0n);
    assert.equal(stroopsToWholeXlm(-9_999_999n), 0n);
  });

  it("truncates toward zero for negative values", () => {
    assert.equal(stroopsToWholeXlm(-10_000_000n), -1n);
    assert.equal(stroopsToWholeXlm(-10_000_001n), -1n);
  });

  it("returns zero for zero stroops", () => {
    assert.equal(stroopsToWholeXlm(0n), 0n);
  });

  it("is lossy: it is not the inverse of xlmToStroops for fractional XLM", () => {
    assert.equal(stroopsToWholeXlm(xlmToStroops("0.5")), 0n);
  });
});
