# Cross-layer wire format (circuit ↔ contract ↔ client)

Authoritative reference for **public signal order** and **byte encodings** used by Groth16 verification on Soroban. Any change here must land in the same change set across all three layers (see [CONTRIBUTING.md](../CONTRIBUTING.md)).

## Public signals (four, not three)

After trusted setup for the current `membership` circuit (including `recipientHash`, issue #266 / [ADR 006](adr/006-recipient-binding.md)), snarkjs emits **four** public signals in this **fixed order**:

```text
[nullifierHash, root, externalNullifier, recipientHash]
```

| Index | Name | Role |
| ----- | ---- | ---- |
| 0 | `nullifierHash` | Circuit **output**: `Poseidon(identityNullifier, externalNullifier)` |
| 1 | `root` | Public input: circle Merkle root |
| 2 | `externalNullifier` | Public input: round tag (must match contract-derived `SHA256(circle_id, round)` reduced into `Fr`) |
| 3 | `recipientHash` | Public input: payout binding (squaring constraint in circuit; contract compares against `compute_recipient_hash(recipient)`) |

**Why this order:** Circom/snarkjs place the main component's public **outputs** first, then public **inputs** in source declaration order (`root`, `externalNullifier`, `recipientHash` in `membership.template.circom`). The order is **not** `[root, externalNullifier, nullifierHash]`.

**Contract `public_inputs` vector** (for `verify_groth16`) must match snarkjs index-for-index:

```text
[nullifier_hash, circle.root, external_nullifier, recipient_hash]
```

See `Contract::claim` in [`contracts/sharibo/src/lib.rs`](../contracts/sharibo/src/lib.rs).

**Verification key `ic` length:** `len(ic) == number_of_public_inputs + 1` (here: 5 elements for 4 public signals).

### Pinned tests

- Circuit: `circuits/test/membership.test.js` — `"public signals are pinned…"`
- Contract: `contracts/sharibo/src/test.rs` — `claim_reverts_on_tampered_public_input`, CPU benchmarks with 4 inputs

## Scalar field elements (`Fr`)

- **Field:** BLS12-381 scalar field (same modulus as `BLS12_381_FR_MODULUS` in soroban-sdk).
- **On-chain:** `soroban_sdk::crypto::bls12_381::Fr` — passed to `claim` as decimal integers in CLI/SDK; internally canonical field elements.
- **In proofs:** Public signals from snarkjs are decimal strings; the client converts to `bigint` for transaction args.
- **Reduction:** Contract uses `Fr::from_bytes` on 32-byte SHA-256 digests for `external_nullifier` and `recipient_hash` (automatic mod‑\(r\)). Client uses `% FR_MODULUS` after SHA-256 for the same digests — must stay aligned with contract byte layout for those hashes (see below).

### Round tag bytes (external nullifier)

Both sides hash **12 bytes**: `circle_id` as big-endian `u64` || `round` as big-endian `u32`. Contract: `compute_external_nullifier` in `lib.rs`. Client: `computeExternalNullifier` in `packages/client/src/identity.ts` (and `@sharibo/core`).

### Recipient hash bytes

Contract: SHA-256 over the recipient `Address` **XDR** encoding (`recipient.to_xdr(env)`), then `Fr::from_bytes`.

Client (current): SHA-256 over the **32-byte ed25519 public key** from StrKey decode (`computeRecipientHash`). Test fixtures and committed proofs were generated with this client rule; **auditors should confirm byte-for-byte agreement with the contract** for every address type you support (muxed vs G-address, etc.). Any mismatch yields `InvalidProof` at pairing time.

## Groth16 proof (`Proof` struct)

| Part | Soroban type | Size | Encoding |
| ---- | ------------ | ---- | -------- |
| `a` | `G1Affine` | 96 bytes | Uncompressed affine: `be(x) \|\| be(y)`, each 48-byte big-endian field element |
| `b` | `G2Affine` | 192 bytes | Uncompressed affine over Fp²: `be(x₁) \|\| be(x₀) \|\| be(y₁) \|\| be(y₀)` (see snarkjs → contract mapping below) |
| `c` | `G1Affine` | 96 bytes | Same as `a` |

**Client encoders:** `encodeG1` / `encodeG2` in [`packages/client/src/prove.ts`](../packages/client/src/prove.ts).

**snarkjs → G2 layout:** snarkjs supplies `pi_b` as `[[x0,x1],[y0,y1]]` decimal strings. The contract expects limb order **`x1 || x0 || y1 || y0`**, each limb 48-byte big-endian (`encodeG2`).

## Verification key (`VerificationKey` struct)

Same G1/G2 rules as proof elements:

- `alpha`: G1 (96 bytes)
- `beta`, `gamma`, `delta`: G2 (192 bytes each)
- `ic`: array of G1, length `num_public_inputs + 1`

**Client:** `verificationKeyToContractFormat` in `packages/client/src/prove.ts` (from `circuits/verification_key.json`).

## Circuit artifacts (off-chain)

| Artifact | Path | Role |
| -------- | ---- | ---- |
| R1CS / WASM | `circuits/build/membership.r1cs`, `membership_js/membership.wasm` | Witness generation |
| Proving key | `circuits/build/membership_final.zkey` (local, not committed) | `snarkjs groth16 fullProve` |
| Verification key | `circuits/verification_key.json` (committed) | On-chain vk at `create_circle` |

## Related docs

- Curve choice: [ADR 005](adr/005-bls12-381-curve-choice.md)
- Recipient binding design: [ADR 006](adr/006-recipient-binding.md)
- CPU impact of extra public input: [contracts/BENCHMARKS.md](../contracts/BENCHMARKS.md)
- Troubleshooting encoding mismatches: [troubleshooting.md](troubleshooting.md)
