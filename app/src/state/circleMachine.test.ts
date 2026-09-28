/**
 * Circle flow reducer. No React — every legal transition and every rejected
 * one is applied to a plain state value.
 */
import { describe, expect, it } from "vitest";
import type { Keypair } from "@stellar/stellar-sdk";
import type { ContractProof, MerkleTree } from "@sharibo/client";
import {
  circleReducer,
  createCircleReducer,
  initialState,
  isCircleFullyFunded,
  selectCircle,
  type CircleAction,
  type CircleClaimResult,
  type CircleMember,
  type CircleSnapshot,
  type CircleState,
  type CircleStatus,
  type FailedCircle,
} from "./circleMachine";

const devReducer = createCircleReducer(true);
const prodReducer = createCircleReducer(false);

const FULL_POT = 500_000_000n;

const proof: ContractProof = {
  a: new Uint8Array([1]),
  b: new Uint8Array([2]),
  c: new Uint8Array([3]),
};

const claimResult: CircleClaimResult = {
  recipient: "GRECIPIENT",
  hash: "tx-hash",
  proofDurationMs: 1200,
  verifyTimeMs: 30,
};

function member(funded = false): CircleMember {
  return {
    keypair: { publicKey: () => "GMEMBER" } as Keypair,
    identity: { commitment: 1n },
    funded,
  } as CircleMember;
}

function snapshot(overrides: Partial<CircleSnapshot> = {}): CircleSnapshot {
  return {
    contributionXlm: 10,
    admin: { publicKey: () => "GADMIN" } as Keypair,
    members: [member()],
    tree: {} as MerkleTree,
    circleId: 1n as CircleSnapshot["circleId"],
    round: 0,
    pot: 0n,
    claimantIndex: 0,
    feeBps: 0,
    feeRecipient: "",
    onChainContributors: [],
    cancelled: false,
    stepTimings: {},
    feeEstimate: null,
    ...overrides,
  };
}

function failedCircle(base: CircleSnapshot, extras: Partial<FailedCircle> = {}): FailedCircle {
  return {
    ...base,
    proof: null,
    nullifierHash: null,
    provingElapsedMs: null,
    claimResult: null,
    nullifierClaimed: false,
    rejection: null,
    ...extras,
  };
}

const fundingSnap = snapshot();
const readySnap = snapshot({ pot: FULL_POT });
const provingSnap = snapshot({ pot: FULL_POT });
const claimingSnap = snapshot({ pot: FULL_POT });
const claimedSnap = snapshot({ round: 1, pot: 0n });

const fixtures: Record<string, CircleState> = {
  idle: initialState,
  creating: {
    status: "creating",
    contributionXlm: 10,
    previousCircleId: null,
    busy: "creating",
  },
  funding: { ...fundingSnap, status: "funding", previousCircleId: null, busy: null },
  ready: { ...readySnap, status: "readyToClaim", previousCircleId: null, busy: null },
  proving: {
    ...provingSnap,
    status: "proving",
    previousCircleId: null,
    busy: "proving",
    claimStage: "artifacts",
    proveElapsedSeconds: 2,
  },
  claiming: {
    ...claimingSnap,
    status: "claiming",
    previousCircleId: null,
    busy: "submitting",
    claimStage: "submitting",
    proveElapsedSeconds: 4,
    proof,
    nullifierHash: 9n,
    provingElapsedMs: 1200,
  },
  claimed: {
    ...claimedSnap,
    status: "claimed",
    previousCircleId: null,
    busy: null,
    proof,
    nullifierHash: 9n,
    provingElapsedMs: 1200,
    claimResult,
    nullifierClaimed: true,
    rejection: "prior",
  },
  failedEmpty: {
    status: "failed",
    error: "create failed",
    failedFrom: "creating",
    contributionXlm: 10,
    previousCircleId: null,
    circle: null,
  },
  failedFunding: {
    status: "failed",
    error: "fund failed",
    failedFrom: "funding",
    contributionXlm: 10,
    previousCircleId: null,
    circle: failedCircle(fundingSnap),
  },
  failedReady: {
    status: "failed",
    error: "not eligible",
    failedFrom: "readyToClaim",
    contributionXlm: 10,
    previousCircleId: null,
    circle: failedCircle(readySnap),
  },
  failedProve: {
    status: "failed",
    error: "prove failed",
    failedFrom: "proving",
    contributionXlm: 10,
    previousCircleId: null,
    circle: failedCircle(provingSnap),
  },
  failedClaimed: {
    status: "failed",
    error: "cancel failed",
    failedFrom: "claimed",
    contributionXlm: 10,
    previousCircleId: null,
    circle: failedCircle(claimedSnap, {
      proof,
      nullifierHash: 9n,
      provingElapsedMs: 1200,
      claimResult,
      nullifierClaimed: true,
      rejection: "prior",
    }),
  },
};

const ACTION_TYPES = [
  "start",
  "setBusy",
  "created",
  "patchMember",
  "syncChain",
  "selectClaimant",
  "beginProve",
  "proveStage",
  "proveTick",
  "beginClaim",
  "claimed",
  "recordRejection",
  "clearBusy",
  "fail",
  "retry",
  "reset",
  "resume",
  "setFeeEstimate",
  "setEligibility",
] as const satisfies readonly CircleAction["type"][];

type MissingAction = Exclude<CircleAction["type"], (typeof ACTION_TYPES)[number]>;
const _allActionsCovered: [MissingAction] extends [never] ? true : MissingAction = true;
void _allActionsCovered;

function sample(type: CircleAction["type"]): CircleAction {
  switch (type) {
    case "start":
      return { type: "start", busy: "starting" };
    case "setBusy":
      return { type: "setBusy", busy: "working" };
    case "created":
      return { type: "created", circle: snapshot() };
    case "patchMember":
      return { type: "patchMember", index: 0, pending: true };
    case "syncChain":
      return { type: "syncChain", pot: 1n, round: 5 };
    case "selectClaimant":
      return { type: "selectClaimant", index: 0 };
    case "beginProve":
      return { type: "beginProve", busy: "prove" };
    case "proveStage":
      return { type: "proveStage", stage: "proving", proveElapsedSeconds: 0 };
    case "proveTick":
      return { type: "proveTick" };
    case "beginClaim":
      return { type: "beginClaim", proof, nullifierHash: 9n, provingElapsedMs: 1200 };
    case "claimed":
      return { type: "claimed", claimResult, nullifierClaimed: true };
    case "recordRejection":
      return { type: "recordRejection", rejection: "rejected" };
    case "clearBusy":
      return { type: "clearBusy" };
    case "fail":
      return { type: "fail", error: "nope" };
    case "retry":
      return { type: "retry" };
    case "reset":
      return { type: "reset", previousCircleId: 4n as CircleSnapshot["circleId"] };
    case "resume":
      return {
        type: "resume",
        circle: snapshot(),
        proof: null,
        nullifierHash: null,
        claimResult: null,
        rejection: null,
        nullifierClaimed: false,
        provingElapsedMs: null,
      };
    case "setFeeEstimate":
      return { type: "setFeeEstimate", feeEstimate: { minResourceFee: 1n, totalFee: 2n } };
    case "setEligibility":
      return { type: "setEligibility", ineligible: [true], reason: "Already claimed in this circle" };
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

/** fixture:action → resulting status. Absent keys are rejected transitions. */
const legal: Record<string, CircleStatus> = {
  "idle:start": "creating",
  "idle:reset": "idle",
  "idle:resume": "funding",

  "creating:setBusy": "creating",
  "creating:created": "funding",
  "creating:fail": "failed",
  "creating:reset": "idle",

  "funding:setBusy": "funding",
  "funding:patchMember": "funding",
  "funding:syncChain": "funding",
  "funding:selectClaimant": "funding",
  "funding:clearBusy": "funding",
  "funding:fail": "failed",
  "funding:reset": "idle",

  "ready:setBusy": "readyToClaim",
  "ready:patchMember": "readyToClaim",
  "ready:syncChain": "funding",
  "ready:selectClaimant": "readyToClaim",
  "ready:beginProve": "proving",
  "ready:clearBusy": "readyToClaim",
  "ready:fail": "failed",
  "ready:setEligibility": "readyToClaim",
  "ready:reset": "idle",

  "proving:setBusy": "proving",
  "proving:patchMember": "proving",
  "proving:syncChain": "proving",
  "proving:proveStage": "proving",
  "proving:proveTick": "proving",
  "proving:beginClaim": "claiming",
  "proving:clearBusy": "readyToClaim",
  "proving:fail": "failed",
  "proving:setFeeEstimate": "proving",
  "proving:reset": "idle",

  "claiming:setBusy": "claiming",
  "claiming:patchMember": "claiming",
  "claiming:syncChain": "claiming",
  "claiming:claimed": "claimed",
  "claiming:clearBusy": "readyToClaim",
  "claiming:fail": "failed",
  "claiming:setFeeEstimate": "claiming",
  "claiming:reset": "idle",

  "claimed:setBusy": "claimed",
  "claimed:patchMember": "claimed",
  "claimed:syncChain": "claimed",
  "claimed:recordRejection": "claimed",
  "claimed:clearBusy": "claimed",
  "claimed:fail": "failed",
  "claimed:reset": "idle",

  "failedEmpty:start": "creating",
  "failedEmpty:retry": "idle",
  "failedEmpty:reset": "idle",

  "failedFunding:setBusy": "funding",
  "failedFunding:patchMember": "failed",
  "failedFunding:syncChain": "failed",
  "failedFunding:selectClaimant": "failed",
  "failedFunding:retry": "funding",
  "failedFunding:reset": "idle",

  "failedReady:setBusy": "readyToClaim",
  "failedReady:patchMember": "failed",
  "failedReady:syncChain": "failed",
  "failedReady:selectClaimant": "failed",
  "failedReady:beginProve": "proving",
  "failedReady:retry": "readyToClaim",
  "failedReady:reset": "idle",

  "failedProve:setBusy": "readyToClaim",
  "failedProve:patchMember": "failed",
  "failedProve:syncChain": "failed",
  "failedProve:selectClaimant": "failed",
  "failedProve:beginProve": "proving",
  "failedProve:retry": "readyToClaim",
  "failedProve:reset": "idle",

  "failedClaimed:setBusy": "claimed",
  "failedClaimed:patchMember": "failed",
  "failedClaimed:syncChain": "failed",
  "failedClaimed:retry": "claimed",
  "failedClaimed:reset": "idle",
};

function expectExclusive(state: CircleState) {
  const view = selectCircle(state);
  if (view.claimResult) {
    expect(view.isProving).toBe(false);
    expect(view.claimStage).toBeNull();
  }
  if (view.isProving || view.claimStage === "proving") {
    expect(view.claimResult).toBeNull();
  }
}

describe("circleReducer", () => {
  it("confirms the demo pot that marks a circle ready to claim", () => {
    expect(isCircleFullyFunded(FULL_POT, 10)).toBe(true);
    expect(isCircleFullyFunded(FULL_POT - 1n, 10)).toBe(false);
  });

  it("walks idle → claimed without ever showing proving and claimed together", () => {
    let state = initialState;
    state = devReducer(state, { type: "start", busy: "Generating identities…" });
    expect(state.status).toBe("creating");
    expect(selectCircle(state).screen).toBe("landing");

    state = devReducer(state, { type: "created", circle: snapshot() });
    expect(state.status).toBe("funding");
    expect(selectCircle(state).screen).toBe("circle");
    expect(selectCircle(state).claimResult).toBeNull();

    state = devReducer(state, {
      type: "syncChain",
      pot: FULL_POT,
      round: 0,
      onChainContributors: ["GMEMBER"],
    });
    expect(state.status).toBe("readyToClaim");
    if (state.status === "readyToClaim") {
      expect(state.members[0].funded).toBe(true);
      expect(state.members[0].pending).toBe(false);
    }

    state = devReducer(state, { type: "beginProve", busy: "Proving…" });
    expect(state.status).toBe("proving");
    state = devReducer(state, { type: "proveStage", stage: "proving", proveElapsedSeconds: 0 });
    state = devReducer(state, { type: "proveTick" });
    const provingView = selectCircle(state);
    expect(provingView.isProving).toBe(true);
    expect(provingView.claimStage).toBe("proving");
    expect(provingView.proveElapsedSeconds).toBe(1);
    expect(provingView.claimResult).toBeNull();
    expectExclusive(state);

    expect(() =>
      devReducer(state, { type: "claimed", claimResult, nullifierClaimed: true }),
    ).toThrow(/Illegal circle transition: claimed from proving/);

    state = devReducer(state, {
      type: "beginClaim",
      proof,
      nullifierHash: 9n,
      provingElapsedMs: 1200,
    });
    expect(state.status).toBe("claiming");
    expect(selectCircle(state).claimResult).toBeNull();
    expect(selectCircle(state).isProving).toBe(false);

    state = devReducer(state, { type: "claimed", claimResult, nullifierClaimed: true });
    const claimedView = selectCircle(state);
    expect(state.status).toBe("claimed");
    expect(claimedView.claimResult).toEqual(claimResult);
    expect(claimedView.isProving).toBe(false);
    expect(claimedView.claimStage).toBeNull();
    expect(claimedView.nullifierClaimed).toBe(true);
    expectExclusive(state);

    state = devReducer(state, { type: "recordRejection", rejection: "AlreadyClaimed" });
    expect(selectCircle(state).rejection).toBe("AlreadyClaimed");

    state = devReducer(state, { type: "reset", previousCircleId: 1n as CircleSnapshot["circleId"] });
    expect(state).toEqual({
      status: "idle",
      contributionXlm: 10,
      previousCircleId: 1n,
    });
  });

  it("moves funding to readyToClaim only when the pot is full, and leaves proving in place", () => {
    const ready = devReducer(fixtures.funding, { type: "syncChain", pot: FULL_POT, round: 0 });
    expect(ready.status).toBe("readyToClaim");

    const stillFunding = devReducer(fixtures.funding, { type: "syncChain", pot: FULL_POT - 1n, round: 0 });
    expect(stillFunding.status).toBe("funding");

    const stillProving = devReducer(fixtures.proving, { type: "syncChain", pot: FULL_POT, round: 0 });
    expect(stillProving.status).toBe("proving");
    expect(selectCircle(stillProving).claimResult).toBeNull();
  });

  it("rejects a round that moves backwards and leaves production state untouched", () => {
    const action: CircleAction = { type: "syncChain", pot: 0n, round: 0 };
    expect(() => devReducer(fixtures.claimed, action)).toThrow(/Illegal circle transition/);
    expect(prodReducer(fixtures.claimed, action)).toBe(fixtures.claimed);
  });

  it("keeps a failed prove from rendering a claim result", () => {
    const failed = devReducer(fixtures.proving, { type: "fail", error: "Proof generation failed" });
    expect(failed.status).toBe("failed");
    const view = selectCircle(failed);
    expect(view.error).toBe("Proof generation failed");
    expect(view.claimResult).toBeNull();
    expect(view.isProving).toBe(false);
    expect(view.claimStage).toBeNull();
    expect(view.screen).toBe("circle");
  });

  it("keeps a failed claim payout visible without a proving stage", () => {
    const failed = devReducer(fixtures.claimed, { type: "fail", error: "Cancel failed" });
    const view = selectCircle(failed);
    expect(view.claimResult).toEqual(claimResult);
    expect(view.isProving).toBe(false);
    expect(view.claimStage).toBeNull();
    expect(view.error).toBe("Cancel failed");
  });

  it("drops a rejection when a replay starts over", () => {
    const next = devReducer(fixtures.claimed, {
      type: "setBusy",
      busy: "Replaying…",
      clearRejection: true,
    });
    expect(next.status).toBe("claimed");
    expect(selectCircle(next).rejection).toBeNull();
    expect(selectCircle(next).busy).toBe("Replaying…");
  });

  it("rejects a member index outside the circle", () => {
    expect(() => devReducer(fixtures.funding, { type: "patchMember", index: 3, pending: true })).toThrow(
      /Illegal circle transition/,
    );
  });

  it("throws from the default reducer outside production builds", () => {
    expect(import.meta.env.PROD).toBe(false);
    expect(() => circleReducer(initialState, { type: "fail", error: "x" })).toThrow(/Illegal circle transition/);
  });

  describe("every transition", () => {
    for (const [name, state] of Object.entries(fixtures)) {
      for (const type of ACTION_TYPES) {
        const key = `${name}:${type}`;
        const action = sample(type);
        const expected = legal[key];

        if (expected) {
          it(`${key} → ${expected}`, () => {
            const next = devReducer(state, action);
            expect(next.status).toBe(expected);
            expectExclusive(state);
            expectExclusive(next);
          });
        } else {
          it(`${key} is rejected`, () => {
            expect(() => devReducer(state, action)).toThrow(
              new RegExp(`Illegal circle transition: ${type} from ${state.status}`),
            );
            expect(prodReducer(state, action)).toBe(state);
            expectExclusive(state);
          });
        }
      }
    }
  });
});
