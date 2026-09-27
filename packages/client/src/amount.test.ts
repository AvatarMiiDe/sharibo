import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { STROOPS_PER_XLM, formatXlm, xlmToStroops } from "./amount";

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
