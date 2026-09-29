# Security Policy

## Supported Versions

Currently, Sharibo is in development and deployed to testnet only. All components in the `main` branch are subject to this security policy.

## Scope

See [docs/threat-model.md](docs/threat-model.md) for the structured breakdown of assets, adversaries, and which security properties each part of the code is actually responsible for.

The following components qualify as in-scope for security vulnerabilities:

- **Smart contract logic:** `contracts/sharibo/src/lib.rs` (e.g., bypassing auth, double-claiming, unauthorized access to funds).
- **Circuit soundness:** `circuits/membership.circom` (e.g., forged proofs, soundness errors, missing constraints allowing unintended witness generation).
- **Proof/nullifier handling:** `packages/client/` (e.g., improper nullifier generation, replay vulnerabilities, weak randomness).

## Reporting a Vulnerability

**Do not report security vulnerabilities through public GitHub issues.**

Please report vulnerabilities using **GitHub Security Advisories / private vulnerability reporting** on this repository.

If you are unable to use GitHub's private vulnerability reporting, please use our fallback private contact method by emailing **security@sharibo.local**.

### Response Expectations

- **Acknowledgement:** We aim to acknowledge receipt of your vulnerability report within 48 hours.
- **Investigation:** We will provide an initial assessment and timeline for a fix within 7 days.
- **Responsible Disclosure:** We ask that you maintain strict confidentiality until we have had time to investigate, patch, and release a fix. We will coordinate a public disclosure timeline with you.

## Limitations and Exclusions

Please note the following known limitations which are **not** considered qualifying vulnerabilities for the purposes of this policy:

- **Deployment is testnet-only:** The current deployment operates on the Stellar testnet. No real funds are at risk.
- **Trusted setup is currently single-party:** The trusted setup for the Groth16 circuit was run by a single party. This is a known limitation for the current development phase. A multi-party ceremony is **planned but not executed** — runbook: [docs/ceremony.md](docs/ceremony.md) (#546).
- **Not audited:** No third-party security audit of the circuit or contract has been completed. Audit-readiness index: [docs/audit/](docs/audit/README.md) (#547).
- For additional context, please refer to the "Honest limitations" section in the `README.md`.
