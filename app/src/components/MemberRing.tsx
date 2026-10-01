import { useEffect, useState } from "react";

// Reads --ring-radius from CSS custom properties so the ring scales with
// responsive breakpoints without JS hard-coding.
export function useRingRadius(): number {
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

// Purely presentational: after a claim, none of the 5 nodes are highlighted
// as "the one that claimed" — that's the point. From outside the ring, all
// five remain equally plausible; only the demo operator (via the radio
// picker below) ever knows which one actually did.
import type { Member } from "../types.js";
import { useI18n } from "../i18n.js";
import styles from "./MemberRing.module.css";

export function MemberRing({
  members,
  revealed,
}: {
  members: Member[];
  revealed: boolean;
}) {
  const { t } = useI18n();
  const radius = 100;
  const center = 170;

  return (
    <div className={styles.ringWrap}>
      <svg
        className={styles.ring}
        viewBox="0 0 340 340"
        width="100%"
        role="img"
        aria-label="Member ring"
      >
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          className={styles.ringCircle}
        />

        <text
          x={center}
          y={center}
          textAnchor="middle"
          dominantBaseline="middle"
          className={styles.ringCenter}
        >
          {revealed ? "✓" : "pot"}
        </text>

        {members.map((m, i) => {
          const angle = (i / members.length) * 2 * Math.PI - Math.PI / 2;
          const x = center + Math.cos(angle) * radius;
          const y = center + Math.sin(angle) * radius;

          return (
            <g
              key={i}
              className={`${styles.ringNode} ${m.funded ? styles.funded : ""} ${m.ineligible ? styles.ineligible : ""}`}
              aria-label={`member ${i + 1}${m.ineligible ? ", ineligible: already claimed" : ""}`}
            >
              <circle cx={x} cy={y} r="20" />
              <text
                x={x}
                y={y}
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {m.ineligible ? "×" : i + 1}
              </text>
            </g>
          );
        })}

        {revealed && (
          <g className={`${styles.ringNode} ${styles.ringRecipient}`}>
            <circle cx={center} cy="0" r="20" />
            <text
              x={center}
              y="0"
              textAnchor="middle"
              dominantBaseline="middle"
            >
              ?
            </text>
          </g>
        )}
      </svg>

      {revealed && (
        <p className={styles.ringCaption}>
          Payout landed on the address above — cryptographically, it could be
          tied to <em>any</em> of the 5 members in the ring. An outside
          observer cannot tell which.
        </p>
      )}
    </div>
  );
}

export function MemberRingSkeleton() {
  const radius = 100;
  return (
    <div className={styles.ringWrap} aria-hidden="true">
      <div className={styles.ring}>
        <div className={`${styles.skeleton} ${styles.skeletonRingCenter}`} />
        {Array.from({ length: 5 }, (_, i) => {
          const angle = (i / 5) * 2 * Math.PI - Math.PI / 2;
          const x = Math.round(Math.cos(angle) * radius);
          const y = Math.round(Math.sin(angle) * radius);
          return (
            <div
              key={i}
              className={`${styles.skeleton} ${styles.skeletonRingNode}`}
              style={{ transform: `translate(${x}px, ${y}px)` }}
            />
          );
        })}
      </div>
    </div>
  );
}
