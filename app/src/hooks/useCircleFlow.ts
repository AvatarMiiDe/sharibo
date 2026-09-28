import { useReducer, useRef } from "react";
import { Keypair } from "@stellar/stellar-sdk";
import {
  generateIdentity,
  computeExternalNullifier,
  MerkleTree,
  generateProof,
  verifyProofLocally,
  estimateClaimFee,
  verificationKeyToContractFormat,
  connect,
  createCircle,
  fund,
  claim,
  getCircle,
  xlmToStroops,
  makeCircleId,
  type ContractProof,
  TREE_LEVELS,
  getArtifacts,
} from "@sharibo/client";
import { config } from "../config.js";
import { friendbotFund } from "../lib/friendbot.js";
import type { Member } from "../types.js";
import {
  circleReducer,
  initialState,
  isCircleFullyFunded,
  selectCircle,
  type CircleSnapshot,
} from "../state/circleMachine.js";

/** Where the circle view is in its on-chain load cycle, so the UI can show
 *  skeletons instead of an empty ring while the first read is in flight. */
export type CirclePhase = "idle" | "loading" | "ready" | "error";

// Derive constants from config (same as App.tsx does)
const NETWORK = {
  contractId: config.contractId,
  rpcUrl: config.rpcUrl,
  networkPassphrase: config.networkPassphrase,
};
const TOKEN = config.testTokenContractId;
const LEVELS = TREE_LEVELS;
const CIRCLE_SIZE = 5;

// All the state and on-chain calls behind a single demo run: create a
// circle, fund it from 5 members, prove + claim, then optionally replay the
// same proof to demonstrate nullifier rejection. Kept as one hook (rather
// than split further) because every step depends on state written by the
// previous one — App.tsx only composes the resulting state and callbacks
// into screens. Transitions go through circleReducer; this hook does not
// keep a parallel set of useState values.
export function useCircleFlow() {
  const [state, dispatch] = useReducer(circleReducer, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const view = selectCircle(state);

  const contribution = xlmToStroops(view.contributionXlm);
  const fundedCount = view.members.filter((m) => m.funded).length;
  const fullyFunded = isCircleFullyFunded(view.pot, view.contributionXlm);

  // Reset every piece of circle state and return to the landing screen. The
  // circle itself is never touched on-chain — it lives on forever; we just
  // stop pointing the UI at it (and remember its id so the landing screen can
  // link back to it). Confirm first only when a circle is mid-flow — funded
  // but not yet claimed — so an accidental click can't throw away an
  // in-progress round; a completed or untouched circle resets silently.
  function resetToLanding() {
    const midFlow = fundedCount > 0 && !view.claimResult;
    if (midFlow) {
      const ok = window.confirm(
        "This circle is funded but hasn't claimed yet. Start over anyway?\n\n" +
          "Your current circle stays on-chain — you just won't see it here.",
      );
      if (!ok) return;
    }

    dispatch({ type: "reset", previousCircleId: view.circleId });
  }

  async function startCircle() {
    if (state.status !== "idle" && !(state.status === "failed" && state.circle === null)) return;
    dispatch({
      type: "start",
      busy: "Generating a fresh admin + 5 member identities and funding via friendbot…",
    });
    try {
      const adminKp = Keypair.random();
      await friendbotFund(adminKp.publicKey());

      const newMembers: Member[] = Array.from({ length: CIRCLE_SIZE }, () => ({
        keypair: Keypair.random(),
        identity: generateIdentity(),
        funded: false,
      }));

      const newTree = MerkleTree.create(
        LEVELS,
        newMembers.map((m) => m.identity.commitment),
      );

      dispatch({ type: "setBusy", busy: "Creating the circle on testnet…" });
      const baseUrl = import.meta.env.BASE_URL.endsWith("/")
        ? import.meta.env.BASE_URL
        : `${import.meta.env.BASE_URL}/`;
      const vkJson = await fetch(`${baseUrl}circuits/verification_key.json`).then((r) => r.json());
      const vk = verificationKeyToContractFormat(vkJson);
      const adminClient = await connect(NETWORK, adminKp);
      const { result: newCircleId } = await createCircle(adminClient, {
        admin: adminKp.publicKey(),
        token: TOKEN,
        root: newTree.root,
        contribution,
        size: CIRCLE_SIZE,
        vk,
        feeBps: 0,
        feeRecipient: adminKp.publicKey(),
      });

      const circle: CircleSnapshot = {
        contributionXlm: view.contributionXlm,
        admin: adminKp,
        members: newMembers,
        tree: newTree,
        circleId: makeCircleId(newCircleId),
        round: 0,
        pot: 0n,
        claimantIndex: 0,
        feeBps: 0,
        feeRecipient: "",
        onChainContributors: [],
        cancelled: false,
        stepTimings: {},
        feeEstimate: null,
      };
      dispatch({ type: "created", circle });
    } catch (e) {
      if (stateRef.current.status !== "idle" && stateRef.current.status !== "failed") {
        dispatch({ type: "fail", error: (e as Error).message });
      }
    }
  }

  async function fundMember(i: number) {
    if (!view.admin || view.circleId === null) return;
    if (
      state.status !== "funding" &&
      state.status !== "readyToClaim" &&
      state.status !== "claimed" &&
      state.status !== "failed"
    ) {
      return;
    }
    dispatch({ type: "setBusy", busy: `Funding from member ${i + 1}…` });
    dispatch({ type: "patchMember", index: i, pending: true });
    try {
      const m = view.members[i];
      await friendbotFund(m.keypair.publicKey());
      const memberClient = await connect(NETWORK, m.keypair);
      const { hash } = await fund(memberClient, {
        circleId: view.circleId,
        from: m.keypair.publicKey(),
      });
      dispatch({ type: "patchMember", index: i, fundHash: hash, pending: false });
      const adminClient = await connect(NETWORK, view.admin);
      const circle = await getCircle(adminClient, view.circleId);
      dispatch({
        type: "syncChain",
        pot: circle.pot,
        round: circle.round,
        onChainContributors: circle.contributors,
        cancelled: circle.cancelled,
        feeBps: circle.fee_bps,
        feeRecipient: circle.fee_recipient,
      });
      dispatch({ type: "clearBusy" });
    } catch (e) {
      if (stateRef.current.status !== "idle" && stateRef.current.status !== "failed") {
        dispatch({ type: "fail", error: (e as Error).message });
      }
    }
  }

  async function doClaim() {
    if (state.status !== "readyToClaim" || !view.admin || !view.tree || view.circleId === null) return;
    dispatch({
      type: "beginProve",
      busy: "Proving… (a real Groth16 proof is being generated in your browser)",
    });
    try {
      const claimant = view.members[view.claimantIndex];
      const merkleProof = view.tree.proof(view.claimantIndex);
      const externalNullifier = await computeExternalNullifier(view.circleId, BigInt(view.round));

      // Fetch artifacts (via configured getArtifacts) and VK in parallel.
      const baseUrl = import.meta.env.BASE_URL.endsWith("/")
        ? import.meta.env.BASE_URL
        : `${import.meta.env.BASE_URL}/`;
      const [{ wasm, zkey }, vkJson] = await Promise.all([
        getArtifacts(),
        fetch(`${baseUrl}circuits/verification_key.json`).then((r) => r.json()),
      ]);

      dispatch({ type: "proveStage", stage: "proving", proveElapsedSeconds: 0 });
      const generated = await generateProof(
        {
          identityNullifier: claimant.identity.identityNullifier,
          identitySecret: claimant.identity.identitySecret,
          pathElements: merkleProof.pathElements,
          pathIndices: merkleProof.pathIndices,
          root: view.tree.root,
          externalNullifier,
        },
        wasm,
        zkey,
      );

      // Local verification catches a bad proof before any network call.
      const verifyTimeMs = await verifyProofLocally(vkJson, generated.publicSignals, generated.snarkjsProof);

      // Fund a fresh recipient before estimating — the estimate needs a valid
      // recipient address in the simulated transaction.
      dispatch({ type: "setBusy", busy: "Funding a fresh, unlinked recipient…" });
      const recipient = Keypair.random();
      await friendbotFund(recipient.publicKey());

      // Dry-run simulation for the fee estimate. This is best-effort:
      // if simulation fails we proceed without an estimate rather than
      // blocking the claim.
      dispatch({ type: "setBusy", busy: "Estimating claim fee…" });
      const adminClient = await connect(NETWORK, view.admin);
      let estimate = null;
      try {
        estimate = await estimateClaimFee(adminClient, {
          circleId: view.circleId,
          recipient: recipient.publicKey(),
          nullifierHash: generated.nullifierHash,
          externalNullifier: generated.externalNullifier,
          proof: generated.proof,
        });
        dispatch({ type: "setFeeEstimate", feeEstimate: estimate });
      } catch {
        estimate = null;
      }

      dispatch({ type: "beginClaim", proof: generated.proof as ContractProof, nullifierHash: generated.nullifierHash, provingElapsedMs: generated.provingTimeMs });
      dispatch({ type: "setBusy", busy: "Submitting the claim…" });
      const { hash, feeCharged } = await claim(adminClient, {
        circleId: view.circleId,
        recipient: recipient.publicKey(),
        nullifierHash: generated.nullifierHash,
        externalNullifier: generated.externalNullifier,
        proof: generated.proof,
      });

      dispatch({
        type: "claimed",
        nullifierClaimed: false,
        claimResult: {
          recipient: recipient.publicKey(),
          hash,
          proofDurationMs: generated.provingTimeMs,
          verifyTimeMs,
          feeCharged,
          feeEstimate: estimate ?? undefined,
        },
      });

      const circle = await getCircle(adminClient, view.circleId);
      dispatch({
        type: "syncChain",
        pot: circle.pot,
        round: circle.round,
        onChainContributors: circle.contributors,
        cancelled: circle.cancelled,
        feeBps: circle.fee_bps,
        feeRecipient: circle.fee_recipient,
      });
      dispatch({ type: "clearBusy" });
    } catch (e) {
      if (stateRef.current.status !== "idle" && stateRef.current.status !== "failed") {
        dispatch({ type: "fail", error: (e as Error).message });
      }
    }
  }

  async function claimAgain() {
    if (state.status !== "claimed" || !view.admin || view.circleId === null || !view.proof || view.nullifierHash === null) {
      return;
    }
    dispatch({
      type: "setBusy",
      busy: "Refunding a new round, then replaying the same proof's nullifier…",
      clearRejection: true,
    });
    try {
      // Fund round `round` again so this exercises the nullifier-reuse
      // check specifically, not just "the pot is empty" — the same
      // proof's nullifier gets rejected even against a fresh, funded round.
      const adminClient = await connect(NETWORK, view.admin);
      for (const m of view.members) {
        const memberClient = await connect(NETWORK, m.keypair);
        await fund(memberClient, { circleId: view.circleId, from: m.keypair.publicKey() });
      }
      const freshExternalNullifier = await computeExternalNullifier(view.circleId, BigInt(view.round));

      dispatch({ type: "setBusy", busy: "Replaying the used nullifier…" });
      try {
        await claim(adminClient, {
          circleId: view.circleId,
          recipient: Keypair.random().publicKey(),
          nullifierHash: view.nullifierHash,
          externalNullifier: freshExternalNullifier,
          proof: view.proof,
        });
        dispatch({
          type: "recordRejection",
          rejection: "Unexpected: the replayed claim was accepted (this should never happen).",
        });
      } catch (e) {
        dispatch({ type: "recordRejection", rejection: (e as Error).message });
      }
      // Reflect the on-chain state either way: the re-funding above happened
      // for real even though the replayed claim itself was rejected.
      try {
        const circle = await getCircle(adminClient, view.circleId);
        dispatch({
          type: "syncChain",
          pot: circle.pot,
          round: circle.round,
          onChainContributors: circle.contributors,
          cancelled: circle.cancelled,
          feeBps: circle.fee_bps,
          feeRecipient: circle.fee_recipient,
        });
      } catch {
        // best-effort refresh only
      }
    } catch (e) {
      dispatch({ type: "recordRejection", rejection: (e as Error).message });
    } finally {
      dispatch({ type: "clearBusy" });
    }
  }

  function setClaimantIndex(index: number) {
    dispatch({ type: "selectClaimant", index });
  }

  return {
    screen: view.screen,
    circlePhase: view.circlePhase,
    busy: view.busy,
    error: view.error,
    contributionXlm: view.contributionXlm,
    members: view.members,
    circleId: view.circleId,
    round: view.round,
    pot: view.pot,
    claimantIndex: view.claimantIndex,
    setClaimantIndex,
    claimResult: view.claimResult,
    rejection: view.rejection,
    previousCircleId: view.previousCircleId,
    fundedCount,
    fullyFunded,
    feeEstimate: view.feeEstimate,
    resetToLanding,
    startCircle,
    fundMember,
    doClaim,
    claimAgain,
  };
}
