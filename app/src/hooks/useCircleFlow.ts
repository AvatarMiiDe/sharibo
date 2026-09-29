import { useState, useRef, useEffect, useCallback } from "react";
import { Keypair } from "@stellar/stellar-sdk";
import {
  isConnected,
  requestAccess,
  isAllowed,
  getAddress,
  getNetworkDetails,
  signTransaction as freighterSignTx,
} from "@stellar/freighter-api";
import {
  generateIdentity,
  computeExternalNullifier,
  computeNullifierHash,
  MerkleTree,
  verificationKeyToContractFormat,
  connect,
  createCircle,
  fund,
  claim,
  cancelCircle,
  getCircle,
  hasClaimed,
  generateProof,
  verifyProofLocally,
  TREE_LEVELS,
  xlmToStroops,
  POLL_RETRY_POLICY,
  PATIENT_RETRY_POLICY,
  type ContractProof,
  type CircleId,
  makeCircleId,
  describeError,
  ContractError,
  CircleNotFoundError,
  RoundNotFundedError,
  WrongRoundTagError,
  AlreadyClaimedError,
  InvalidProofError,
  RoundFullError,
  OverflowError,
  CircleCancelledError,
  RpcError,
  ProvingError,
  InvalidInputError,
  type OnEventFn,
} from "@sharibo/client";
import { config } from "../config.js";
import {
  friendbotFund,
  FriendbotRetryableError,
  FRIEND_BOT_RATE_LIMIT_MESSAGE,
} from "../lib/friendbot.js";
import { checkNetworkMatch } from "../lib/wallet.freighter.js";
import { explorerContract } from "../lib/explorer.js";
import type { Member, ClaimResult, ClaimStage } from "../types.js";

/** Where the circle view is in its on-chain load cycle, so the UI can show
 *  skeletons instead of an empty ring while the first read is in flight. */
export type CirclePhase = "idle" | "loading" | "ready" | "error";

export interface SavedDemoState {
  contributionXlm: number;
  adminSecret: string;
  members: Array<{
    secret: string;
    identity: {
      identityNullifier: bigint;
      identitySecret: bigint;
      identityTrapdoor?: bigint;
      commitment: bigint;
    };
    fundHash?: string;
    ineligible?: boolean;
  }>;
  circleId: CircleId | bigint | string | number;
  round: number;
  claimantIndex: number;
  proof: ContractProof | null;
  nullifierHash: bigint | null;
  claimResult: ClaimResult | null;
  rejection: string | null;
}

export interface UseCircleFlowOptions {
  onEvent?: OnEventFn;
  claimStage?: ClaimStage | null;
  setClaimStage?: (stage: ClaimStage) => void;
  resetClaimStage?: () => void;
  clearEvents?: () => void;
  t?: (key: string, vars?: Record<string, string | number>) => string;
}

const BIGINT_MARKER = "BIGINT::";
function replacer(key: string, value: unknown): unknown {
  if (typeof value === "bigint") {
    return BIGINT_MARKER + value.toString();
  }
  return value;
}

function reviver(key: string, value: unknown): unknown {
  if (typeof value === "string" && value.startsWith(BIGINT_MARKER)) {
    return BigInt(value.slice(BIGINT_MARKER.length));
  }
  return value;
}

// Derive constants from config (same as App.tsx does)
const NETWORK = {
  contractId: config?.contractId ?? "",
  rpcUrl: config?.rpcUrl ?? "",
  networkPassphrase: config?.networkPassphrase ?? "",
};
const TOKEN = config?.testTokenContractId ?? "";
const LEVELS = TREE_LEVELS;
const CIRCLE_SIZE = 5;

export function toUiError(
  error: unknown,
  t?: (key: string, vars?: Record<string, string | number>) => string,
): string {
  if (error instanceof FriendbotRetryableError) {
    return FRIEND_BOT_RATE_LIMIT_MESSAGE;
  }

  if (error instanceof AlreadyClaimedError) {
    return "This proof has already been claimed in this circle. Try the next round.";
  }
  if (error instanceof InvalidProofError) {
    return "The zero-knowledge proof is invalid. Please regenerate and try again.";
  }
  if (error instanceof RoundNotFundedError) {
    return "The circle is not fully funded yet. All members must contribute first.";
  }
  if (error instanceof WrongRoundTagError) {
    return "Proof is bound to a different round. Regenerate the proof for the current round.";
  }
  if (error instanceof CircleNotFoundError) {
    return "Circle not found on-chain. It may have been cancelled or never created.";
  }
  if (error instanceof RoundFullError) {
    return "This round is already fully funded. No more contributions are accepted.";
  }
  if (error instanceof OverflowError) {
    return "Contribution amount or circle size caused an arithmetic overflow.";
  }
  if (error instanceof CircleCancelledError) {
    return "This circle has been cancelled. Start a new one.";
  }

  if (error instanceof ContractError) {
    return error.message;
  }
  if (error instanceof RpcError) {
    return "Network error — please check your connection and retry.";
  }
  if (error instanceof ProvingError) {
    return "Proof generation failed. Please try again.";
  }
  if (error instanceof InvalidInputError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return t ? t("error.generic") : "An unexpected error occurred.";
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof FriendbotRetryableError) {
    return FRIEND_BOT_RATE_LIMIT_MESSAGE;
  }
  return describeError(error);
}

export function useCircleFlow(options: UseCircleFlowOptions = {}) {
  const { onEvent, clearEvents, t } = options;

  const [internalClaimStage, setInternalClaimStage] = useState<ClaimStage | null>(null);
  const claimStage = options.claimStage !== undefined ? options.claimStage : internalClaimStage;
  const setClaimStage = options.setClaimStage ?? setInternalClaimStage;
  const resetClaimStage = options.resetClaimStage ?? (() => setInternalClaimStage(null));

  const [screen, setScreen] = useState<"landing" | "circle">("landing");
  const [circlePhase, setCirclePhase] = useState<CirclePhase>("idle");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [contributionXlm, setContributionXlm] = useState(10);
  const [admin, setAdmin] = useState<Keypair | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [tree, setTree] = useState<MerkleTree | null>(null);
  const [circleId, setCircleId] = useState<CircleId | null>(null);
  const [hasFreighter, setHasFreighter] = useState(false);

  useEffect(() => {
    isConnected()
      .then((res) => setHasFreighter(res.isConnected))
      .catch(() => setHasFreighter(false));
  }, []);

  const [round, setRound] = useState(0);
  const [pot, setPot] = useState(0n);
  const [feeBps, setFeeBps] = useState(0);
  const [feeRecipient, setFeeRecipient] = useState("");
  const [onChainContributors, setOnChainContributors] = useState<string[]>([]);
  const [cancelled, setCancelled] = useState(false);
  const [claimantIndex, setClaimantIndex] = useState(0);
  const [proof, setProof] = useState<ContractProof | null>(null);
  const [nullifierHash, setNullifierHash] = useState<bigint | null>(null);
  const [claimResult, setClaimResult] = useState<ClaimResult | null>(null);
  const [isProving, setIsProving] = useState(false);
  const [provingElapsedMs, setProvingElapsedMs] = useState<number | null>(null);
  const [nullifierClaimed, setNullifierClaimed] = useState(false);
  const [rejection, setRejection] = useState<string | null>(null);
  const [proveElapsedSeconds, setProveElapsedSeconds] = useState(0);
  const [stepTimings, setStepTimings] = useState<Record<string, number>>({});
  const [previousCircleId, setPreviousCircleId] = useState<CircleId | null>(null);
  const [prevCircle, setPrevCircle] = useState<{ id: string; explorerUrl: string } | null>(null);
  const [resumePrompt, setResumePrompt] = useState<SavedDemoState | null>(() => {
    if (typeof sessionStorage === "undefined") return null;
    const saved = sessionStorage.getItem("sharibo_demo_state");
    if (!saved) return null;
    try {
      const parsed = JSON.parse(saved, reviver) as SavedDemoState;
      if (parsed && parsed.circleId) {
        return parsed;
      }
    } catch {
      sessionStorage.removeItem("sharibo_demo_state");
    }
    return null;
  });

  const contribution = xlmToStroops(contributionXlm);
  const claimAbortRef = useRef<AbortController | null>(null);

  // Abort on unmount
  useEffect(() => {
    return () => {
      claimAbortRef.current?.abort();
    };
  }, []);

  // Persist to sessionStorage whenever active
  useEffect(() => {
    if (typeof sessionStorage === "undefined") return;
    if (screen === "circle" && circleId !== null && admin) {
      try {
        const stateToSave = {
          contributionXlm,
          adminSecret: admin.secret(),
          members: members.map((m) => ({
            secret: m.keypair.secret(),
            identity: m.identity,
            fundHash: m.fundHash,
            ineligible: m.ineligible,
          })),
          circleId,
          round,
          claimantIndex,
          proof,
          nullifierHash,
          claimResult,
          rejection,
        };
        sessionStorage.setItem("sharibo_demo_state", JSON.stringify(stateToSave, replacer));
      } catch {
        // quota exceeded or disabled
      }
    }
  }, [
    screen,
    circleId,
    admin,
    contributionXlm,
    members,
    round,
    claimantIndex,
    proof,
    nullifierHash,
    claimResult,
    rejection,
  ]);

  const fundedCount = members.filter((m) => m.funded).length;
  const fullyFunded = pot === contribution * BigInt(CIRCLE_SIZE);
  const step: 0 | 1 | 2 | 3 = claimResult ? 3 : fullyFunded ? 2 : 1;

  // Sync funding state from on-chain data
  const syncFundingState = useCallback(async () => {
    if (!admin || circleId === null) return;
    try {
      const adminClient = await connect(NETWORK, admin);
      const circle = await getCircle(adminClient, circleId, POLL_RETRY_POLICY);

      setPot(circle.pot);
      setOnChainContributors(circle.contributors);
      setCancelled(circle.cancelled);
      setFeeBps(circle.fee_bps ?? 0);
      setFeeRecipient(circle.fee_recipient ?? "");

      setMembers((prev) =>
        prev.map((m) => {
          const hasFunded =
            m.funded ||
            circle.contributors.includes(m.keypair.publicKey()) ||
            Boolean(m.freighterKey && circle.contributors.includes(m.freighterKey));
          return { ...m, funded: hasFunded, pending: false };
        })
      );
    } catch (e) {
      console.error("Failed to sync funding state:", e);
    }
  }, [admin, circleId]);

  // Sync funding state on initial load / change of circleId
  useEffect(() => {
    let ignore = false;
    async function sync() {
      if (!admin || circleId === null) return;
      try {
        const adminClient = await connect(NETWORK, admin);
        const circle = await getCircle(adminClient, circleId, POLL_RETRY_POLICY);
        if (ignore) return;
        setPot(circle.pot);
        setOnChainContributors(circle.contributors);
        setCancelled(circle.cancelled);
        setFeeBps(circle.fee_bps ?? 0);
        setFeeRecipient(circle.fee_recipient ?? "");

        setMembers((prev) =>
          prev.map((m) => {
            const hasFunded =
              m.funded ||
              circle.contributors.includes(m.keypair.publicKey()) ||
              Boolean(m.freighterKey && circle.contributors.includes(m.freighterKey));
            return { ...m, funded: hasFunded, pending: false };
          })
        );
      } catch (e) {
        console.error("Failed to sync funding state:", e);
      }
    }
    void sync();
    return () => {
      ignore = true;
    };
  }, [circleId, admin]);

  // Poll for third-party funding updates every 10s when active
  useEffect(() => {
    if (circleId !== null && admin && screen === "circle" && !claimResult) {
      const interval = setInterval(() => {
        void syncFundingState();
      }, 10000);
      return () => clearInterval(interval);
    }
  }, [circleId, admin, screen, claimResult, syncFundingState]);

  const membersRef = useRef(members);
  useEffect(() => {
    membersRef.current = members;
  }, [members]);

  // Pre-check member eligibility when fully funded
  useEffect(() => {
    let mounted = true;
    async function checkEligibility() {
      if (!fullyFunded || claimResult || !circleId || !admin) return;
      try {
        setBusy("Checking member eligibility…");
        const external = await computeExternalNullifier(circleId, BigInt(round));
        const adminClient = await connect(NETWORK, admin);
        const results = await Promise.all(
          membersRef.current.map(async (m) => {
            const nullifier = computeNullifierHash(m.identity.identityNullifier, external);
            return await hasClaimed(adminClient, circleId, nullifier);
          }),
        );
        if (!mounted) return;
        setMembers((prev) =>
          prev.map((m, i) => ({
            ...m,
            ineligible: results[i],
            ineligibleReason: results[i] ? "Already claimed in this circle" : undefined,
          }))
        );
      } catch (e) {
        setError(toUiError(e, t));
      } finally {
        if (mounted) setBusy(null);
      }
    }
    void checkEligibility();
    return () => {
      mounted = false;
    };
  }, [fullyFunded, claimResult, circleId, round, admin, t]);

  function resetToLanding() {
    const midFlow = fundedCount > 0 && !claimResult;
    if (midFlow) {
      const ok = typeof window !== "undefined" && window.confirm
        ? window.confirm(
            t
              ? t("reset.confirm")
              : "This circle is funded but hasn't claimed yet. Start over anyway?\n\nYour current circle stays on-chain — you just won't see it here."
          )
        : true;
      if (!ok) return;
    }

    claimAbortRef.current?.abort();
    claimAbortRef.current = null;

    setPreviousCircleId(circleId);
    if (circleId !== null) {
      setPrevCircle({
        id: circleId.toString(),
        explorerUrl: explorerContract(),
      });
    }
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem("sharibo_demo_state");
    }

    setBusy(null);
    setError(null);
    setCirclePhase("idle");
    setContributionXlm(10);
    setAdmin(null);
    setMembers([]);
    setTree(null);
    setCircleId(null);
    setRound(0);
    setPot(0n);
    setFeeBps(0);
    setFeeRecipient("");
    setCancelled(false);
    setOnChainContributors([]);
    setClaimantIndex(0);
    setProof(null);
    setNullifierHash(null);
    setClaimResult(null);
    setIsProving(false);
    setProvingElapsedMs(null);
    setNullifierClaimed(false);
    setRejection(null);
    resetClaimStage();
    clearEvents?.();
    setProveElapsedSeconds(0);
    setStepTimings({});
    setScreen("landing");
  }

  function loadState(parsed: SavedDemoState) {
    setCirclePhase("loading");
    setContributionXlm(parsed.contributionXlm ?? 10);
    const adminKp = Keypair.fromSecret(parsed.adminSecret);
    setAdmin(adminKp);

    const loadedMembers: Member[] = parsed.members.map((m) => ({
      keypair: Keypair.fromSecret(m.secret),
      identity: m.identity,
      funded: false,
      fundHash: m.fundHash,
      ineligible: m.ineligible ?? false,
      pending: false,
    }));
    setMembers(loadedMembers);

    const newTree = MerkleTree.create(
      LEVELS,
      loadedMembers.map((m) => m.identity.commitment),
    );
    setTree(newTree);

    const parsedCircleId = makeCircleId(BigInt(parsed.circleId));
    setCircleId(parsedCircleId);
    setRound(parsed.round ?? 0);
    setPot(0n);
    setClaimantIndex(parsed.claimantIndex ?? 0);
    setProof(parsed.proof ?? null);
    setNullifierHash(parsed.nullifierHash ?? null);
    setClaimResult(parsed.claimResult ?? null);
    setRejection(parsed.rejection ?? null);

    setScreen("circle");
    setResumePrompt(null);

    // Sync on-chain after loading state
    setTimeout(async () => {
      try {
        const adminClient = await connect(NETWORK, adminKp);
        const circle = await getCircle(adminClient, parsedCircleId, POLL_RETRY_POLICY);
        setPot(circle.pot);
        setOnChainContributors(circle.contributors);
        setCancelled(circle.cancelled);
        setFeeBps(circle.fee_bps ?? 0);
        setFeeRecipient(circle.fee_recipient ?? "");
        setMembers((prev) =>
          prev.map((m) => {
            const hasFunded =
              circle.contributors.includes(m.keypair.publicKey()) ||
              Boolean(m.freighterKey && circle.contributors.includes(m.freighterKey));
            return { ...m, funded: hasFunded, pending: false };
          })
        );
      } catch (e) {
        console.error("Failed to sync on resume:", e);
      }
    }, 100);
    setCirclePhase("ready");
  }

  function dismissResumePrompt() {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem("sharibo_demo_state");
    }
    setResumePrompt(null);
  }

  async function startCircle() {
    setError(null);
    setCirclePhase("loading");
    setBusy(t ? t("busy.generating") : "Generating a fresh admin + 5 member identities and funding via friendbot…");
    try {
      const adminKp = Keypair.random();
      await friendbotFund(adminKp.publicKey());

      const newMembers: Member[] = Array.from({ length: CIRCLE_SIZE }, () => ({
        keypair: Keypair.random(),
        identity: generateIdentity(),
        funded: false,
        ineligible: false,
      }));

      const newTree = MerkleTree.create(
        LEVELS,
        newMembers.map((m) => m.identity.commitment),
      );

      setBusy(t ? t("busy.creating") : "Creating the circle on testnet…");
      const baseUrl =
        typeof import.meta !== "undefined" && import.meta.env?.BASE_URL
          ? import.meta.env.BASE_URL.endsWith("/")
            ? import.meta.env.BASE_URL
            : `${import.meta.env.BASE_URL}/`
          : "/";
      const vkJson = await fetch(`${baseUrl}circuits/verification_key.json`).then((r) => r.json());
      const vk = verificationKeyToContractFormat(vkJson);
      const adminClient = await connect({ ...NETWORK, onEvent }, adminKp);
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

      setAdmin(adminKp);
      setMembers(newMembers);
      setTree(newTree);
      setCircleId(makeCircleId(newCircleId));
      setRound(0);
      setPot(0n);
      setFeeBps(0);
      setFeeRecipient("");
      setScreen("circle");
      setCirclePhase("ready");
    } catch (e) {
      setError(toUiError(e, t));
      setCirclePhase("error");
    } finally {
      setBusy(null);
    }
  }

  async function fundMember(i: number) {
    if (!admin || circleId === null) return;
    setError(null);
    setBusy(t ? t("fund.busy", { index: i + 1 }) : `Funding from member ${i + 1}…`);
    try {
      const m = members[i];
      await friendbotFund(m.keypair.publicKey());

      setMembers((prev) =>
        prev.map((mm, idx) => (idx === i ? { ...mm, pending: true } : mm)),
      );

      const memberClient = await connect(NETWORK, m.keypair);
      const { hash } = await fund(memberClient, {
        circleId,
        from: m.keypair.publicKey(),
      });

      await syncFundingState();

      setMembers((prev) =>
        prev.map((mm, idx) => (idx === i ? { ...mm, funded: true, fundHash: hash, pending: false } : mm)),
      );
    } catch (e) {
      setMembers((prev) =>
        prev.map((mm, idx) => (idx === i ? { ...mm, pending: false } : mm)),
      );
      setError(toUiError(e, t));
    } finally {
      setBusy(null);
    }
  }

  async function fundWithFreighter(i: number) {
    if (!admin || circleId === null) return;
    setError(null);
    setBusy(t ? t("fund.busyFreighter", { index: i + 1 }) : `Funding member ${i + 1} with Freighter…`);
    try {
      const allowedRes = await isAllowed();
      if (!allowedRes.isAllowed) {
        await requestAccess();
      }

      const networkRes = await getNetworkDetails();
      const mismatch = checkNetworkMatch(networkRes.network, NETWORK.networkPassphrase);
      if (mismatch) {
        throw new Error(
          `Your Freighter wallet is connected to ${mismatch.walletNetwork}, ` +
            `but this app is configured for ${mismatch.appNetwork}. ` +
            `Please open Freighter, click the network selector in the upper right, and switch to ${mismatch.appNetwork}.`,
        );
      }

      const addressRes = await getAddress();
      const pubKey = addressRes.address;
      if (!pubKey) {
        throw new Error(t ? t("error.getAddress") : "Failed to get address from Freighter");
      }

      const freighterSigner = {
        publicKey: pubKey,
        signTransaction: async (txXdr: string) => {
          const currentNetworkRes = await getNetworkDetails();
          const currentMismatch = checkNetworkMatch(currentNetworkRes.network, NETWORK.networkPassphrase);
          if (currentMismatch) {
            throw new Error(
              `Your Freighter wallet is connected to ${currentMismatch.walletNetwork}, ` +
                `but this app is configured for ${currentMismatch.appNetwork}. ` +
                `Please open Freighter, click the network selector in the upper right, and switch to ${currentMismatch.appNetwork}.`,
            );
          }

          const signedRes = await freighterSignTx(txXdr, {
            networkPassphrase: currentNetworkRes.networkPassphrase,
          });
          if (signedRes.error) {
            throw new Error(signedRes.error.toString());
          }
          return signedRes.signedTxXdr;
        },
      };

      setMembers((prev) =>
        prev.map((mm, idx) => (idx === i ? { ...mm, pending: true } : mm)),
      );

      const memberClient = await connect(NETWORK, freighterSigner);
      const { hash } = await fund(memberClient, {
        circleId,
        from: pubKey,
      });

      await syncFundingState();

      setMembers((prev) =>
        prev.map((mm, idx) => (idx === i ? { ...mm, funded: true, fundHash: hash, freighterKey: pubKey, pending: false } : mm)),
      );
    } catch (e) {
      setMembers((prev) =>
        prev.map((mm, idx) => (idx === i ? { ...mm, pending: false } : mm)),
      );
      setError(getErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function doClaim() {
    if (!admin || !tree || circleId === null) return;

    claimAbortRef.current?.abort();
    const controller = new AbortController();
    claimAbortRef.current = controller;
    const { signal } = controller;

    setError(null);
    setClaimResult(null);
    setRejection(null);
    setBusy(t ? t("busy.claiming") : "Proving… (a real Groth16 proof is being generated in your browser)");

    const timings: Record<string, number> = {};

    try {
      if (signal.aborted) return;
      const claimant = members[claimantIndex];
      const merkleProof = tree.proof(claimantIndex);
      const externalNullifier = await computeExternalNullifier(circleId, BigInt(round));

      if (signal.aborted) return;
      setClaimStage("artifacts");
      onEvent?.({ type: "artifact:started" });
      const artStart = Date.now();
      const baseUrl =
        typeof import.meta !== "undefined" && import.meta.env?.BASE_URL
          ? import.meta.env.BASE_URL.endsWith("/")
            ? import.meta.env.BASE_URL
            : `${import.meta.env.BASE_URL}/`
          : "/";
      const [wasm, zkey, vkJson] = await Promise.all([
        fetch(`${baseUrl}circuits/membership.wasm`)
          .then((r) => r.arrayBuffer())
          .then((b) => new Uint8Array(b)),
        fetch(`${baseUrl}circuits/membership_final.zkey`, { signal })
          .then((r) => r.arrayBuffer())
          .then((b) => new Uint8Array(b)),
        fetch(`${baseUrl}circuits/verification_key.json`).then((r) => r.json()),
      ]);
      timings.artifacts = Date.now() - artStart;
      onEvent?.({
        type: "artifact:ready",
        loaded: wasm.byteLength + zkey.byteLength,
        total: wasm.byteLength + zkey.byteLength,
      });

      if (signal.aborted) return;
      setProveElapsedSeconds(0);
      setIsProving(true);
      const proveStartTime = Date.now();
      const proveTimer = setInterval(() => setProveElapsedSeconds((s) => s + 1), 1000);
      let generated;
      try {
        generated = await generateProof(
          {
            identityNullifier: claimant.identity.identityNullifier,
            identitySecret: claimant.identity.identitySecret,
            pathElements: merkleProof.pathElements,
            pathIndices: merkleProof.pathIndices,
            root: tree.root,
            externalNullifier,
          },
          wasm,
          zkey,
          { signal, onEvent },
        );
      } finally {
        clearInterval(proveTimer);
        setIsProving(false);
        const duration = Date.now() - proveStartTime;
        setProvingElapsedMs(duration);
        timings.proving = duration;
      }

      setClaimStage("verifying");
      const verifyStart = Date.now();
      const verifyTimeMs = await verifyProofLocally(
        vkJson,
        generated.publicSignals,
        generated.snarkjsProof,
      );
      timings.verifying = Date.now() - verifyStart;

      setClaimStage("funding");
      const recipient = Keypair.random();
      const fundStart = Date.now();
      await friendbotFund(recipient.publicKey());
      timings.fundingRecipient = Date.now() - fundStart;

      if (signal.aborted) return;
      setClaimStage("submitting");
      const adminClient = await connect({ ...NETWORK, onEvent }, admin);
      const submitStart = Date.now();
      const { hash } = await claim(
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
      timings.submitting = Date.now() - submitStart;
      setStepTimings(timings);

      if (signal.aborted) return;
      setProof(generated.proof);
      setNullifierHash(generated.nullifierHash);
      setClaimResult({
        recipient: recipient.publicKey(),
        hash,
        proofDurationMs: generated.provingTimeMs ?? timings.proving ?? 0,
        verifyTimeMs: typeof verifyTimeMs === "number" ? verifyTimeMs : 1,
      });

      const claimed = await hasClaimed(adminClient, circleId, generated.nullifierHash);
      setNullifierClaimed(claimed);

      await syncFundingState();
    } catch (e) {
      setError(toUiError(e, t));
    } finally {
      if (!signal.aborted) {
        setBusy(null);
        resetClaimStage();
      }
      if (claimAbortRef.current === controller) {
        claimAbortRef.current = null;
      }
    }
  }

  async function claimAgain() {
    if (!admin || circleId === null || !proof || nullifierHash === null) return;
    setError(null);
    setRejection(null);
    setBusy(t ? t("busy.refunding") : "Refunding a new round, then replaying the same proof's nullifier…");
    try {
      const adminClient = await connect({ ...NETWORK, onEvent }, admin);
      for (const m of members) {
        const memberClient = await connect({ ...NETWORK, onEvent }, m.keypair);
        await fund(memberClient, { circleId, from: m.keypair.publicKey() });
      }
      const freshExternalNullifier = await computeExternalNullifier(
        circleId,
        BigInt(round),
      );

      setBusy(t ? t("busy.replaying") : "Replaying the used nullifier…");
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
      setRejection(t ? t("rejection.unexpected") : "Unexpected: the replayed claim was accepted (this should never happen).");
    } catch (e) {
      setRejection(toUiError(e, t));
    } finally {
      try {
        await syncFundingState();
      } catch {
        // best-effort refresh
      }
      setBusy(null);
    }
  }

  async function doCancelCircle() {
    if (!admin || circleId === null) return;
    setError(null);

    const refundCount = onChainContributors.length;
    const refundTotal = (Number(pot) / 1e7).toFixed(1);

    const confirmed = typeof window !== "undefined" && window.confirm
      ? window.confirm(
          t
            ? t("cancel.confirmation", { count: refundCount, total: refundTotal })
            : `Cancel this circle and refund ${refundCount} contributor(s) (${refundTotal} XLM total)?`
        )
      : true;

    if (!confirmed) return;

    setBusy(t ? t("cancel.busy") : "Cancelling circle and refunding contributors…");
    try {
      const adminClient = await connect(NETWORK, admin);
      await cancelCircle(adminClient, { circleId });
      await syncFundingState();
    } catch (e) {
      setError(toUiError(e, t));
    } finally {
      setBusy(null);
    }
  }

  return {
    screen,
    circlePhase,
    busy,
    error,
    contributionXlm,
    setContributionXlm,
    admin,
    members,
    tree,
    circleId,
    hasFreighter,
    round,
    pot,
    feeBps,
    feeRecipient,
    onChainContributors,
    cancelled,
    claimantIndex,
    setClaimantIndex,
    claimStage,
    proof,
    nullifierHash,
    claimResult,
    isProving,
    provingElapsedMs,
    nullifierClaimed,
    rejection,
    proveElapsedSeconds,
    stepTimings,
    previousCircleId,
    resumePrompt,
    prevCircle,
    fundedCount,
    fullyFunded,
    step,
    resetToLanding,
    startCircle,
    fundMember,
    fundWithFreighter,
    doClaim,
    claimAgain,
    doCancelCircle,
    loadState,
    dismissResumePrompt,
    syncFundingState,
  };
}
