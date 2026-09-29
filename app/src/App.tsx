import { useState, useRef, useEffect } from "react";
import {
  networkOf,
  formatXlmDisplay,
} from "@sharibo/client";
import { config, configError } from "./config";
import { useI18n } from "./i18n";
import { usePoliteLiveRegion } from "./usePoliteLiveRegion";
import { ArtifactProgress } from "./components/ArtifactProgress.js";
import { explorerTx, short, explorerAccount, explorerContract } from "./lib/explorer";
import { useCircleFlow } from "./hooks/useCircleFlow";
import { MemberRingSkeleton } from "./components/MemberRing";
import { FundingListSkeleton } from "./components/FundingList";
import styles from "./App.module.css";
import { Toaster } from "./components/Toaster";
import { ConnectionStatus } from "./components/ConnectionStatus";
import { useOnlineStatus } from "./hooks/useOnlineStatus";
import { useSdkEvents } from "./hooks/useSdkEvents";
import type { Failure } from "./state/circleMachine";
import { copyDebugBundle, type BundleInput } from "./lib/debugBundle";
import type { LoggedSdkEvent } from "./lib/sdkEventLog";
import type { ClaimStage } from "./types.js";

// `config` is null when config validation failed (see config.ts); the component
// below gates on `configError.length > 0` and renders the setup screen, so these
// module-level values are only ever used on the happy path. Optional chaining
// keeps importing this module from crashing on a misconfigured build.
const NETWORK = {
  contractId: config?.contractId ?? "",
  rpcUrl: config?.rpcUrl ?? "",
  networkPassphrase: config?.networkPassphrase ?? "",
};
const CIRCLE_SIZE = 5;

function LanguageSwitcher({ className = "" }: { className?: string }) {
  const { locale, locales, setLocale } = useI18n();
  return (
    <div className={`language-switcher ${className}`}>
      <select
        value={locale}
        onChange={(e) => setLocale(e.target.value)}
        aria-label="Language"
      >
        {locales.map((code) => (
          <option key={code} value={code}>
            {code}
          </option>
        ))}
      </select>
    </div>
  );
}

const NAMES = [
  "ajo",
  "esusu",
  "tanda",
  "cundina",
  "susu",
  "tontine",
  "junta",
  "pandero",
  "consórcio",
  "hui",
  "paluwagan",
  "chit fund",
];



// Every truncated value on screen (addresses, tx hashes) needs to be
// pasteable in full somewhere else — a CLI call, an explorer search — so
// this pairs with each `short(...)` display. Falls back to a prompt() (which
// itself is trivially copyable) when the async Clipboard API isn't
// available, e.g. non-secure contexts.
function CopyButton({ value, label }: { value: string; label: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const tmr = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(tmr);
  }, [copied]);

  async function handleCopy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      window.prompt(`Clipboard unavailable — copy ${label} manually:`, value);
    }
  }

  return (
    <button
      type="button"
      className={styles.copyBtn}
      onClick={handleCopy}
      aria-label={t("copy.aria", { label })}
      title={t("copy.title", { label })}
    >
      {copied ? "✓" : "📋"}
    </button>
  );
}

// Injected at build time by Vite; falls back to "dev" in local dev.
const APP_VERSION: string =
  (typeof import.meta.env.VITE_APP_VERSION === "string"
    ? import.meta.env.VITE_APP_VERSION
    : undefined) ?? "dev";

const BUG_REPORT_URL =
  "https://github.com/crackedstudio/sharibo/issues/new?template=bug_report.yml";

/**
 * Collects the current circle-flow state into a DebugBundle and copies it as
 * formatted markdown to the clipboard. Placed in the footer of the circle
 * screen and next to any error message so a user can grab it whenever
 * something goes wrong.
 *
 * Secret keys are never included — see app/src/lib/debugBundle.ts for the
 * allow-list and the defence-in-depth regex backstop.
 */
function CopyDebugBundleButton({
  circleId,
  round,
  currentStep,
  lastError,
  fundedCount,
  circleSize,
  pot,
  timings,
  recentEvents,
}: {
  circleId: bigint | null;
  round: number;
  currentStep: string | null;
  lastError: string | null;
  fundedCount: number;
  circleSize: number;
  pot: bigint;
  timings: Record<string, number>;
  recentEvents: LoggedSdkEvent[];
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "fallback" | "error">("idle");

  useEffect(() => {
    if (status === "idle") return;
    const t = setTimeout(() => setStatus("idle"), 2500);
    return () => clearTimeout(t);
  }, [status]);

  async function handleClick() {
    const input: BundleInput = {
      appVersion: APP_VERSION,
      network: {
        contractId: config.contractId,
        rpcUrl: config.rpcUrl,
        networkPassphrase: config.networkPassphrase,
        tokenContractId: config.testTokenContractId,
      },
      circleId,
      round,
      currentStep,
      lastError,
      fundedCount,
      circleSize,
      pot,
      // Artifact hashes are not tracked in the App's state yet; omit rather
      // than leave undefined — the bundle accepts an empty record.
      artifactHashes: {},
      timings,
      recentEvents,
      userAgent: navigator.userAgent,
    };

    const result = await copyDebugBundle(input);
    if (result.ok) {
      setStatus("copied");
    } else if (result.markdown) {
      // Clipboard API blocked but we have the markdown — show it via prompt().
      window.prompt(
        "Clipboard unavailable. Select all and copy manually, then paste into your bug report:",
        result.markdown,
      );
      setStatus("fallback");
    } else {
      setStatus("error");
    }
  }

  const label =
    status === "copied"
      ? "✓ Copied!"
      : status === "fallback"
        ? "Opened prompt"
        : status === "error"
          ? "Error — retry?"
          : "📋 Copy debug bundle";

  return (
    <span className="debug-bundle-wrap">
      <button
        type="button"
        className="btn btn-ghost btn-small"
        onClick={handleClick}
        title="Copy a redacted debug snapshot to your clipboard, ready to paste into a bug report. No secret keys are included."
      >
        {label}
      </button>
      {(status === "copied" || status === "fallback") && (
        <a
          className="link fineprint"
          href={BUG_REPORT_URL}
          target="_blank"
          rel="noreferrer"
        >
          open bug report ↗
        </a>
      )}
    </span>
  );
}



const CLAIM_STAGE_LABELS: Record<ClaimStage, string> = {
  artifacts: "Fetching proving artifacts (wasm + zkey)…",
  proving: "Proving…",
  verifying: "Verifying proof locally…",
  funding: "Funding a fresh, unlinked recipient…",
  submitting: "Submitting the claim…",
};

const CLAIM_STAGES: ClaimStage[] = ["artifacts", "proving", "verifying", "funding", "submitting"];

// So a claim never reads as a hung tab: each real substage of doClaim gets
// its own line here (fullProve itself stays one opaque "proving" step, per
// snarkjs, but that step gets a live elapsed-seconds counter + spinner so a
// slow prove still visibly ticks rather than sitting static).
function ClaimProgress({ stage, elapsedSeconds }: { stage: ClaimStage; elapsedSeconds: number }) {
  const { t } = useI18n();
  const activeIndex = CLAIM_STAGES.indexOf(stage);
  const stageLabels: Record<ClaimStage, string> = {
    artifacts: t("claim.stage.artifacts"),
    proving: t("claim.stage.proving"),
    verifying: t("claim.stage.verifying"),
    funding: t("claim.stage.funding"),
    submitting: t("claim.stage.submitting"),
  };
  return (
    <div className={styles.claimProgress}>
      <div className={styles.stepper}>
        {CLAIM_STAGES.map((s, i) => (
          <div
            key={s}
            className={`${styles.step} ${i < activeIndex ? styles.done : i === activeIndex ? styles.active : ""}`}
          >
            <span className={styles.stepDot}>{i < activeIndex ? "✓" : i + 1}</span>
            {stageLabels[s]}
          </div>
        ))}
      </div>
      {stage === "proving" && (
        <p className={styles.techline}>
          <span className={styles.spinner} aria-hidden="true" /> Groth16 · BLS12-381 · 3,757 constraints ·
          proving locally in your browser, nothing sent anywhere until the proof is done ·{" "}
          {elapsedSeconds}s elapsed
        </p>
      )}
    </div>
  );
}

function Stepper({ step }: { step: 0 | 1 | 2 | 3 }) {
  const { t } = useI18n();
  const labels = [t("step.create"), t("step.fund"), t("step.proveClaim"), t("step.unlinked")];
  return (
    // nav + ol give screen readers "step N of 4" list semantics without
    // changing any visual output — CSS targets .stepper and .step as before.
    <nav aria-label="Circle progress">
      <ol className={styles.stepper} style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {labels.map((label, i) => {
          const state = i < step ? "done" : i === step ? "active" : "";
          return (
            <li
              key={label}
              className={`${styles.step} ${state}`}
              // aria-current="step" marks the single active step; completed
              // and upcoming steps get no aria-current attribute at all.
              {...(i === step ? { "aria-current": "step" as const } : {})}
            >
              {/* The dot (✓ / number) is decorative — the li text already
                  conveys position, so hide the dot from the AT tree. */}
              <span className={styles.stepDot} aria-hidden="true">
                {i < step ? "✓" : i + 1}
              </span>
              {label}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function NetworkBanner() {
  const { t } = useI18n();
  const isTestnet = networkOf(NETWORK.networkPassphrase) !== "mainnet";
  if (!isTestnet) return null;
  return (
    <div className={styles.networkBanner}>
      Stellar testnet — no real funds ·{" "}
      <a
        href="https://github.com/glorious21-coder/sharibo#honest-limitations"
        target="_blank"
        rel="noreferrer"
      >
        {t("banner.limitationsShort")}
      </a>
    </div>
  );
}

// Purely presentational: after a claim, none of the 5 nodes are highlighted
// as "the one that claimed" — that's the point. From outside the ring, all
// five remain equally plausible; only the demo operator (via the radio
// picker below) ever knows which one actually did.
function useRingRadius(): number {
  const [radius, setRadius] = useState(100);

  useEffect(() => {
    const read = () => {
      const value = getComputedStyle(document.documentElement).getPropertyValue("--ring-radius");
      setRadius(parseFloat(value) || 100);
    };
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);

  return radius;
}

function MemberRing({ members, revealed }: { members: { funded: boolean; pending?: boolean }[]; revealed: boolean }) {
  const { t } = useI18n();
  const radius = useRingRadius();
  const fundedCount = members.filter((m) => m.funded).length;

  const ringLabel = revealed
    ? t("ring.label.revealed", { count: members.length })
    : t("ring.label.loading", { count: members.length, funded: fundedCount });

  const captionId = "ring-caption";

  return (
    <div className={styles.ringWrap}>
      <div
        className={styles.ring}
        role="img"
        aria-label={ringLabel}
        {...(revealed ? { "aria-describedby": captionId } : {})}
      >
        <div className={styles.ringCenter} aria-hidden="true">
          {revealed ? "✓" : "pot"}
        </div>
        {members.map((m, i) => {
          const angle = (i / members.length) * 2 * Math.PI - Math.PI / 2;
          const x = Math.round(Math.cos(angle) * radius);
          const y = Math.round(Math.sin(angle) * radius);
          return (
            <div
              key={i}
              aria-hidden="true"
              className={`ring-node ${m.funded ? "funded" : ""} ${m.pending ? "pending" : ""}`}
              style={{ transform: `translate(${x}px, ${y}px)` }}
            >
              {i + 1}
            </div>
          );
        })}
        {revealed && (
          <div
            aria-hidden="true"
            className={`${styles.ringNode} ${styles.ringRecipient}`}
            style={{ transform: "translate(0px, -170px)" }}
          >
            ?
          </div>
        )}
      </div>
      {revealed && (
        <p id={captionId} role="note" className={styles.ringCaption}>
          Payout landed on the address above — cryptographically, it could be tied to <em>any</em>{" "}
          of the {members.length} members in the ring. An outside observer cannot tell which.
        </p>
      )}
    </div>
  );
}

function EnvSetupScreen({ errors }: { errors: string[] }) {
  const { t } = useI18n();
  return (
    <div className={styles.page}>
      <div className={`${styles.card} ${styles.hero}`}>
        <LanguageSwitcher className={styles.languageSwitcherHero} />
        <h1>SHARIBO</h1>
        <h2 style={{ color: "var(--color-error, #e55)" }}>{t("env.setupRequired")}</h2>
        <p className={styles.sub}>
          {t("env.setupIntro")} {t("env.setupHowTo")}
        </p>
        <ul style={{ textAlign: "start", margin: "1rem 0", padding: "0 1.25rem" }}>
          {errors.map((err) => (
            <li key={err} style={{ marginBottom: "0.5rem" }}>
              <code>{err}</code>
            </li>
          ))}
        </ul>
        <p className={styles.fineprint}>
          {t("env.setupDetails")}
        </p>
      </div>
    </div>
  );
}

// ── Persistent live-region (must stay in DOM) ───────────────────────────────

function LiveRegion({ message }: { message: string }) {
  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
      style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)" }}
    >
      {message}
    </div>
  );
}

// ── ClaimExplainer ──────────────────────────────────────────────────────────

function ClaimExplainer() {
  const { t } = useI18n();
  return (
    <details className={styles.claimExplainer}>
      <summary>How this claim proof works</summary>
      <div className={styles.claimExplainerBody}>
        <section>
          <h3>{t("explainer.sayingTitle")}</h3>
          <p>
            {t("explainer.sayingBody")}
          </p>
        </section>
        <section>
          <h3>{t("explainer.secretTitle")}</h3>
          <p>{t("explainer.secretBody")}</p>
        </section>
        <section>
          <h3>{t("explainer.checksTitle")}</h3>
          <ol>
            <li>{t("explainer.check1")}</li>
            <li>{t("explainer.check2")}</li>
            <li>{t("explainer.check3")}</li>
            <li>{t("explainer.check4")}</li>
          </ol>
        </section>
        <section>
          <h3>{t("explainer.observersTitle")}</h3>
          <p>{t("explainer.observersBody")}</p>
        </section>
      </div>
    </details>
  );
}

// ── Root component ───────────────────────────────────────────────────────────

export default function App() {
  const { t, locale } = useI18n();
  const online = useOnlineStatus();
  const {
    onEvent,
    claimStage,
    setClaimStage,
    clearEvents,
    resetClaimStage,
    recentEvents,
  } = useSdkEvents();
  const [failure, setFailure] = useState<Failure | null>(null);

  const flow = useCircleFlow({
    onEvent,
    claimStage,
    setClaimStage,
    resetClaimStage,
    clearEvents,
    t,
  });

  const {
    screen,
    circlePhase,
    busy,
    error,
    contributionXlm,
    admin,
    members,
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
    claimResult,
    isProving,
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
  } = flow;

  const { announce, message: liveRegionMessage } = usePoliteLiveRegion(120);

  useEffect(() => {
    if (busy) {
      announce(t("liveRegion.help", { message: busy }));
      return;
    }

    if (circlePhase === "loading") {
      announce("Loading circle data…");
      return;
    }

    if (claimResult) {
      announce(t("liveRegion.claimResultReady"));
      return;
    }

    if (error) {
      announce(t("liveRegion.error", { message: error }));
      return;
    }

    if (fullyFunded) {
      announce(t("liveRegion.claimStepReady"));
    }
  }, [announce, busy, circlePhase, claimResult, error, fullyFunded, t]);

  // ── Focus management ────────────────────────────────────────────────────
  // When a screen or major section appears, move keyboard focus to its
  // heading (tabIndex={-1} makes non-interactive elements programmatically
  // focusable without inserting them into the Tab order).

  // 1. landing → circle: focus the circle card's "SHARIBO" h1
  const circleHeadingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (screen === "circle") circleHeadingRef.current?.focus();
  }, [screen]);

  const claimHeadingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (fullyFunded && !claimResult) {
      claimHeadingRef.current?.focus();
    }
    // Only trigger when fullyFunded flips to true; ignore claimResult changes here.
  }, [fullyFunded, claimResult]);

  const payoutHeadingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (claimResult) {
      payoutHeadingRef.current?.focus();
    }
  }, [claimResult]);

  if (configError.length > 0) {
    return <EnvSetupScreen errors={configError} />;
  }

  if (resumePrompt && screen === "landing") {
    return (
      <div className={styles.page}>
        <div className={`${styles.card} ${styles.hero}`}>
          <h1>Resume Circle #{resumePrompt.circleId.toString()}?</h1>
          <p className={styles.sub}>
            It looks like you refreshed the page while a circle was active. Do you want to resume?
          </p>
          <div className={styles.row} style={{ marginTop: '2rem', justifyContent: 'center', gap: '1rem' }}>
            <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => loadState(resumePrompt)}>
              Resume Circle
            </button>
            <button className={`${styles.btn} ${styles.btnDanger}`} onClick={dismissResumePrompt}>
              {t("resume.discardButton")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (screen === "landing") {
    return (
      <div className={styles.page}>
        <NetworkBanner />
        {!online && (
          <div className="offline-banner" role="status">
            You are offline. Network actions are paused — reconnect to start or retry a circle.
          </div>
        )}
        <div className={`${styles.card} ${styles.hero}`}>
          <LanguageSwitcher className={styles.languageSwitcherHero} />
          <div className={styles.namewall}>
            {NAMES.map((n) => (
              <span key={n} className={styles.namewallItem}>
                {n}
              </span>
            ))}
          </div>
          <h1>SHARIBO</h1>
          <p className={styles.tagline}>
            {t("landing.tagline")}
          </p>
          <p className={styles.sub}>
            {t("landing.sub.before")} <em>{t("landing.sub.em1")}</em> {t("landing.sub.middle")}{" "}
            <em>{t("landing.sub.em2")}</em> {t("landing.sub.after")}
          </p>
          <button
            className={`${styles.btn} ${styles.btnPrimary}`}
            disabled={!online || !!busy}
            onClick={startCircle}
          >
            {busy ?? t("landing.launch")}
          </button>
          {error && <p className={styles.error}>{error}</p>}
          <Toaster failure={failure} busy={!!busy} online={online} onDismiss={() => setFailure(null)} />
          {previousCircleId !== null && (
            <p className={styles.fineprint}>
              Your previous circle lives on at{" "}
              <a
                className={styles.link}
                href={explorerContract()}
                target="_blank"
                rel="noreferrer"
              >
                {t("landing.previousCircleLink", { id: previousCircleId.toString() })}
              </a>
            </p>
          )}
          <p className={styles.fineprint}>
            {t("landing.testnetFineprint")}
          </p>
          {prevCircle && (
            <p className={styles.fineprint}>
              Your previous circle #{prevCircle.id} lives on-chain —{" "}
              <a className={styles.link} href={prevCircle.explorerUrl} target="_blank" rel="noreferrer">
                view on explorer ↗
              </a>
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <NetworkBanner />
      <div className={styles.card}>
        <LanguageSwitcher />
        {/*
          Persistent live region — always in the DOM so the browser registers
          it before any text lands inside it (a common AT pitfall).
        */}
        <LiveRegion message={liveRegionMessage} />
        <ArtifactProgress announce={announce} />
        {!online && (
          <div className="offline-banner" role="status">
            You are offline. Network actions are paused — reconnect to fund, claim, or retry.
          </div>
        )}
        <div className="row space-between">
          <h1 className="small" ref={circleHeadingRef} tabIndex={-1}>
            SHARIBO
          </h1>
          <div className="row">
            <ConnectionStatus online={online} />
            <a className="link" href={explorerContract()} target="_blank" rel="noreferrer">
              circle #{circleId?.toString()} on-chain ↗
            </a>
            <button
              className="btn btn-small"
              disabled={!!busy}
              onClick={resetToLanding}
              title={`Start over. Your current circle (#${circleId?.toString()}) keeps living on-chain.`}
            >
              {t("common.startNewCircle")}
            </button>
          </div>
        </div>

        <Stepper step={step} />

        {circlePhase === "loading" ? (
          <>
            <MemberRingSkeleton />
            <div className="pot-bar-wrap" aria-hidden="true">
              <div className="skeleton skeleton-bar" />
            </div>
            <p className="pot-label" aria-hidden="true">
              <span className="skeleton skeleton-label" />
            </p>
            <FundingListSkeleton />
          </>
        ) : (
          <>
            <MemberRing members={members.map(m => ({ funded: m.funded, pending: m.pending }))} revealed={!!claimResult} />

            <div className={styles.potBarWrap}>
              <div
                className="pot-bar"
                style={{ width: `${(fundedCount / CIRCLE_SIZE) * 100}%` }}
              />
            </div>
            <p className="pot-label">
              pot: {formatXlmDisplay(pot, locale)} / {contributionXlm * CIRCLE_SIZE} XLM ·
              round {round}
              {feeBps > 0 &&
                ` · ${t("pot.fee", {
                  feePercent: (feeBps / 100).toString(),
                  feeRecipient: feeRecipient ? feeRecipient.slice(0, 8) : t("pot.feeUnknown"),
                })}`}
              {cancelled && ` · ${t("cancel.cancelled")}`}
            </p>

            {cancelled && (
              <div className="callout" style={{ backgroundColor: "var(--color-warning-bg)", color: "var(--color-warning-text)" }}>
                <strong>{t("cancel.cancelled")}</strong>
                <p>{t("cancel.cancelledMessage")}</p>
              </div>
            )}

            {!cancelled && admin && (
              <div className="row" style={{ justifyContent: "flex-end", marginTop: "1rem" }}>
                <button
                  className="btn btn-danger btn-small"
                  disabled={!!busy || onChainContributors.length === 0}
                  onClick={doCancelCircle}
                  title="Cancel this circle and refund all contributors"
                >
                  {t("cancel.title")}
                </button>
              </div>
            )}

            <h2>Fund</h2>
            <div className={styles.members}>
              {members.map((m, i) => (
                <div key={i} className={`member ${m.funded ? "funded" : ""} ${m.pending ? "pending" : ""}`}>
                  <span className="member-addr">
                    {t("fund.memberLabel", { index: i + 1 })} · {short(m.keypair.publicKey())}
                    <CopyButton
                      value={m.keypair.publicKey()}
                      label={t("fund.memberAddressLabel", { index: i + 1 })}
                    />
                  </span>
                  {m.pending ? (
                    <span className="pending-indicator">⟳ submitting…</span>
                  ) : m.funded ? (
                    <a
                      className={styles.link}
                      href={explorerTx(m.fundHash!)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t("fund.fundedLink")}
                    </a>
                  ) : (
                    <div className={styles.row}>
                      <button
                        className={`${styles.btn} ${styles.btnSmall}`}
                        disabled={!online || !!busy || round > 0}
                        onClick={() => fundMember(i)}
                      >
                        {t("fund.demoButton", { amount: contributionXlm })}
                      </button>
                      {hasFreighter && (
                        <button
                          className={`${styles.btn} ${styles.btnSmall}`}
                          disabled={!online || !!busy || round > 0}
                          onClick={() => fundWithFreighter(i)}
                        >
                          {t("fund.freighterButton")}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {fullyFunded && !claimResult && (
          <>
            <h2 ref={claimHeadingRef} tabIndex={-1}>
              {t("claim.heading")}
            </h2>
            <p className={styles.sub}>
              Pick which member is claiming this round — the proof will show the
              contract that they're a real member <em>without</em> revealing
              which one.
            </p>
            <div className="row">
              {members.map((m, i) => (
                <label key={i} className="radio">
                  <input
                    type="radio"
                    checked={claimantIndex === i}
                    onChange={() => setClaimantIndex(i)}
                    disabled={!!busy || !!m.ineligible}
                    title={m.ineligible ? m.ineligibleReason ?? "Ineligible to claim" : undefined}
                  />
                  member {i + 1}{m.ineligible ? " (ineligible)" : ""}
                </label>
              ))}
            </div>
            <button className="btn btn-primary" disabled={!online || !!busy} onClick={doClaim}>
              {claimStage ? CLAIM_STAGE_LABELS[claimStage] : "Generate proof & claim"}
            </button>
            {claimStage && <ClaimProgress stage={claimStage} elapsedSeconds={proveElapsedSeconds} />}
            <ClaimExplainer />
            {busy && (
              <p className={styles.techline}>
                {/* Constraint count: update this AND circuits/README.md if the circuit changes. */}
                Groth16 · BLS12-381 · 3,757 constraints · proving locally in your browser, nothing
                sent anywhere until the proof is done
                {isProving && proveElapsedSeconds !== null ? ` · proving… ${proveElapsedSeconds}s` : ""}
              </p>
            )}
          </>
        )}

        {claimResult && (
          <div className={styles.result}>
            <h2 ref={payoutHeadingRef} tabIndex={-1}>
              {t("result.heading")}
            </h2>
            <p>
              {t("result.recipientIntro")} <code>{short(claimResult.recipient)}</code>
              <CopyButton
                value={claimResult.recipient}
                label={t("result.recipientLabel")}
              />{" "}
              <a href={explorerAccount(claimResult.recipient)} target="_blank" rel="noreferrer">
                ↗
              </a>{" "}
              {t("result.recipientOutro")}
            </p>
            <a
              className={styles.link}
              href={explorerTx(claimResult.hash)}
              target="_blank"
              rel="noreferrer"
            >
              {t("result.viewClaimTx")}
            </a>
            <CopyButton value={claimResult.hash} label="claim transaction hash" />
            <p className={styles.callout}>
              Compare the 5 funding transactions above to this claim — same
              contract, no shared address, no visible link.
            </p>
            <p className="techline">
              proof generated in {(claimResult.proofDurationMs / 1000).toFixed(1)}s ·
              local verify {claimResult.verifyTimeMs.toFixed(0)}ms ✓
            </p>
            <button
              className={`${styles.btn} ${styles.btnDanger}`}
              disabled={!online || !!busy || (!!rejection && nullifierClaimed)}
              onClick={claimAgain}
              title={
                rejection && nullifierClaimed ? t("result.claimAgainTitle") : undefined
              }
            >
              {busy ?? t("result.claimAgainButton")}
            </button>
            {nullifierClaimed && !rejection && (
              <p className={styles.callout}>
                <code>has_claimed</code> is true for this nullifier — a replay will be rejected
                on-chain.
              </p>
            )}
            {rejection && (
              <>
                <div className={styles.rejected}>
                  <strong>Rejected on-chain:</strong> {rejection}
                </div>
                <button
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  disabled={!!busy}
                  onClick={resetToLanding}
                >
                  {t("result.startNewCircle")}
                </button>
              </>
            )}
            {rejection && (
              <div className={styles.newCircleCta}>
                <button
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  disabled={!!busy}
                  onClick={resetToLanding}
                >
                  {t("result.startNewCircleAlt")}
                </button>
                <p className={styles.fineprint}>
                  Circle #{circleId?.toString()} stays on-chain forever —{" "}
                  <a className={styles.link} href={explorerContract()} target="_blank" rel="noreferrer">
                    view on explorer ↗
                  </a>
                  {t("result.newCircleOutro")}
                </p>
              </div>
            )}
          </div>
        )}

        {error && <p className="error">{error}</p>}

        {/* ── Debug bundle footer ──────────────────────────────────────────
          Always visible once a circle is active so a user can grab the
          snapshot at any point — not just on error. Placed last so it
          doesn't distract from the happy path. */}
        <div className="debug-bundle-footer">
          <CopyDebugBundleButton
            circleId={circleId}
            round={round}
            currentStep={claimStage}
            lastError={error}
            fundedCount={fundedCount}
            circleSize={CIRCLE_SIZE}
            pot={pot}
            timings={stepTimings}
            recentEvents={recentEvents()}
          />
        </div>
      </div>
    </div>
  );
}
