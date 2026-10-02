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
  POLL_RETRY_POLICY,
  PATIENT_RETRY_POLICY,
  type ContractProof,
  TREE_LEVELS,
  getArtifacts,
} from "@sharibo/client";
import { config } from "../config.js";
import { friendbotFund, friendbotFundMany, FriendbotRetryableError, type FriendbotFundResult } from "../lib/friendbot.js";
import type { Member, ClaimResult } from "../types.js";

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
  const [screen, setScreen] = useState<"landing" | "circle">("landing");
  const [circlePhase, setCirclePhase] = useState<CirclePhase>("idle");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [contributionXlm, setContributionXlm] = useState(10);
  const [admin, setAdmin] = useState<Keypair | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [tree, setTree] = useState<MerkleTree | null>(null);
  const [circleId, setCircleId] = useState<bigint | null>(null);
  const [round, setRound] = useState(0);
  const [pot, setPot] = useState(0n);
  const [claimantIndex, setClaimantIndex] = useState(0);
  const [proof, setProof] = useState<ContractProof | null>(null);
  const [nullifierHash, setNullifierHash] = useState<bigint | null>(null);
  const [claimResult, setClaimResult] = useState<ClaimResult | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);
  const [feeEstimate, setFeeEstimate] = useState<FeeEstimate | null>(null);
  // Survives a reset so the landing screen can point back at the circle you
  // just left — it keeps living on-chain even though the UI has moved on.
  const [previousCircleId, setPreviousCircleId] = useState<bigint | null>(null);
  // Track friendbot funding results for partial success handling and retry
  const [fundingResults, setFundingResults] = useState<FriendbotFundResult[]>([]);

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
      setMembers((prev) =>
        prev.map((mm, idx) => (idx === i ? { ...mm, funded: true, fundHash: hash } : mm)),
      );
      const adminClient = await connect(NETWORK, admin);
      const circle = await getCircle(adminClient, circleId, POLL_RETRY_POLICY);
      setPot(circle.pot);
      setRound(circle.round);
    } catch (e) {
      if (stateRef.current.status !== "idle" && stateRef.current.status !== "failed") {
        dispatch({ type: "fail", error: (e as Error).message });
      }
    }
  }

  // Fund all members via friendbot with partial success handling.
  // Returns per-account results so the UI can show which succeeded/failed
  // and offer a targeted retry for failed accounts.
  async function fundAllMembers() {
    if (!admin || circleId === null) return;
    setError(null);
    setBusy("Funding all members via friendbot…");
    try {
      const publicKeys = members.map((m) => m.keypair.publicKey());
      const results = await friendbotFundMany(publicKeys, {
        delayMs: 500,
        onProgress: (result) => {
          setFundingResults((prev) => {
            const existing = prev.find((r) => r.publicKey === result.publicKey);
            if (existing) {
              return prev.map((r) => (r.publicKey === result.publicKey ? result : r));
            }
            return [...prev, result];
          });
        },
      });
      setFundingResults(results);

      // For each successful friendbot funding, submit the on-chain fund transaction
      for (const result of results) {
        if (!result.success) continue;
        const memberIndex = members.findIndex((m) => m.keypair.publicKey() === result.publicKey);
        if (memberIndex === -1) continue;
        const m = members[memberIndex];
        try {
          const memberClient = await connect(NETWORK, m.keypair);
          const { hash } = await fund(memberClient, {
            circleId,
            from: m.keypair.publicKey(),
          });
          setMembers((prev) =>
            prev.map((mm, idx) => (idx === memberIndex ? { ...mm, funded: true, fundHash: hash } : mm)),
          );
        } catch (e) {
          // On-chain fund failed — mark as not funded so it can be retried
          setMembers((prev) =>
            prev.map((mm, idx) => (idx === memberIndex ? { ...mm, funded: false } : mm)),
          );
          result.success = false;
          result.error = e instanceof FriendbotRetryableError ? e : new FriendbotRetryableError(String(e));
        }
      }

      const adminClient = await connect(NETWORK, admin);
      const circle = await getCircle(adminClient, circleId, POLL_RETRY_POLICY);
      setPot(circle.pot);
      setRound(circle.round);

      const failedCount = results.filter((r) => !r.success).length;
      if (failedCount > 0) {
        setError(`${failedCount} of ${results.length} accounts failed to fund. Use "Retry failed" to try again.`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  // Retry friendbot funding for only the accounts that previously failed
  async function retryFailedFunding() {
    if (!admin || circleId === null) return;
    const failedKeys = fundingResults.filter((r) => !r.success).map((r) => r.publicKey);
    if (failedKeys.length === 0) return;

    setError(null);
    setBusy(`Retrying funding for ${failedKeys.length} account(s)…`);
    try {
      const results = await friendbotFundMany(failedKeys, {
        delayMs: 500,
        onProgress: (result) => {
          setFundingResults((prev) =>
            prev.map((r) => (r.publicKey === result.publicKey ? result : r)),
          );
        },
      });

      // Merge new results with existing ones
      setFundingResults((prev) => {
        const merged = [...prev];
        for (const result of results) {
          const idx = merged.findIndex((r) => r.publicKey === result.publicKey);
          if (idx >= 0) merged[idx] = result;
          else merged.push(result);
        }
        return merged;
      });

      // For each newly successful funding, submit on-chain fund transaction
      for (const result of results) {
        if (!result.success) continue;
        const memberIndex = members.findIndex((m) => m.keypair.publicKey() === result.publicKey);
        if (memberIndex === -1) continue;
        const m = members[memberIndex];
        try {
          const memberClient = await connect(NETWORK, m.keypair);
          const { hash } = await fund(memberClient, {
            circleId,
            from: m.keypair.publicKey(),
          });
          setMembers((prev) =>
            prev.map((mm, idx) => (idx === memberIndex ? { ...mm, funded: true, fundHash: hash } : mm)),
          );
        } catch (e) {
          setMembers((prev) =>
            prev.map((mm, idx) => (idx === memberIndex ? { ...mm, funded: false } : mm)),
          );
          result.success = false;
          result.error = e instanceof FriendbotRetryableError ? e : new FriendbotRetryableError(String(e));
        }
      }

      const adminClient = await connect(NETWORK, admin);
      const circle = await getCircle(adminClient, circleId, POLL_RETRY_POLICY);
      setPot(circle.pot);
      setRound(circle.round);

      const failedCount = results.filter((r) => !r.success).length;
      if (failedCount > 0) {
        setError(`${failedCount} of ${results.length} accounts still failed. You can retry again.`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
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

      setBusy("Submitting the claim…");
      const { hash, feeCharged } = await claim(
        adminClient,
        {
          circleId,
          recipient: recipient.publicKey(),
          nullifierHash: generated.nullifierHash,
          externalNullifier: generated.externalNullifier,
          proof: generated.proof,
        },
        PATIENT_RETRY_POLICY,
      );

      setProof(generated.proof);
      setNullifierHash(generated.nullifierHash);
      setClaimResult({
        recipient: recipient.publicKey(),
        hash,
        feeCharged: feeCharged?.toString(),
        feeEstimate: estimate ?? undefined,
      });

      const circle = await getCircle(adminClient, circleId, POLL_RETRY_POLICY);
      setPot(circle.pot);
      setRound(circle.round);
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

      setBusy("Replaying the used nullifier…");
      await claim(
        adminClient,
        {
          circleId,
          recipient: Keypair.random().publicKey(),
          nullifierHash,
          externalNullifier: freshExternalNullifier,
          proof,
        },
        PATIENT_RETRY_POLICY,
      );
      setRejection("Unexpected: the replayed claim was accepted (this should never happen).");
    } catch (e) {
      setRejection((e as Error).message);
    } finally {
      // Reflect the on-chain state either way: the re-funding above happened
      // for real even though the replayed claim itself was rejected.
      try {
        const adminClient = await connect(NETWORK, admin);
        const circle = await getCircle(adminClient, circleId, POLL_RETRY_POLICY);
        setPot(circle.pot);
        setRound(circle.round);
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
    feeEstimate,
    fundingResults,
    resetToLanding,
    startCircle,
    fundMember,
    fundAllMembers,
    retryFailedFunding,
    doClaim,
    claimAgain,
  };
}
