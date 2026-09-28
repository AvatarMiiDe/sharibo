# PR: #482 — Circle.schema_version is 2 but no migration function exists

## Summary

The `Circle` struct carries a `schema_version` field (currently `2`), but it is write-only: nothing reads it, nothing validates it, and no migration path exists. This PR makes the version enforce itself, defines the migration shape, and documents which branch each version bump took.

## Problem

- `load_circle` (`lib.rs:1119`) deserializes straight into the current `Circle` layout without inspecting `schema_version`. A v1 entry is silently decoded as v2, and the field that makes the version meaningful is never read.
- `schema_version: 2` is a hardcoded literal in `create_circle` (`lib.rs:401`) rather than a named constant, so the golden test and the loader cannot reference the same value.
- There is no `Error::SchemaMismatch` variant, so a stale entry fails silently instead of loudly.
- There is no `migrate_circle` entrypoint and no migration test.
- `docs/adr/003-storage-migration.md` does not record which branch (migration vs. reset) each version bump took.

## Changes

### 1. `CURRENT_SCHEMA_VERSION` constant in `constants.rs`

Extract the literal `2` from `create_circle` into a named constant so that the loader, the golden test, and creation all reference the same value.

### 2. `Error::SchemaMismatch` variant

Add a new error variant to the `Error` enum (`lib.rs:206`) for when a stored circle's `schema_version` does not match `CURRENT_SCHEMA_VERSION`.

### 3. `load_circle` asserts `schema_version`

Modify `load_circle` (`lib.rs:1119`) to check that the deserialized circle's `schema_version == CURRENT_SCHEMA_VERSION`. On mismatch, panic with `Error::SchemaMismatch`. This makes a stale entry fail loudly instead of being misinterpreted.

### 4. `migrate_circle(circle_id)` entrypoint

Define the migration shape as a gated admin entrypoint that:
- Reads the old layout as raw `Bytes` / `ScVal` from `DataKey::Circle(circle_id)`.
- Reconstructs the new `Circle` struct, applying documented defaults for new fields (`fee_bps = 0`, `fee_recipient = ...`).
- Writes the new layout back under the same key.
- Bumps the stored `schema_version` to `CURRENT_SCHEMA_VERSION`.

This is defined but gated behind an `admin` check so it is ready for use if/when circles exist on a live network.

### 5. Migration test

Add a test that:
- Constructs a v1 `Circle` entry (with `schema_version: 1` and the old field set).
- Stores it as if from a prior deployment.
- Calls `migrate_circle` on it.
- Asserts the resulting circle has `schema_version == CURRENT_SCHEMA_VERSION` and that v2 fields (`fee_bps`, `fee_recipient`) take their documented defaults.

### 6. `docs/adr/003-storage-migration.md` — version branch table

Add a table recording which branch each version bump took:

| Version bump | Branch | Rationale |
|---|---|---|
| v1 → v2 | **testnet-reset** | `fee_bps`/`fee_recipient` added; no live circles held real value; documented in `docs/runbook-testnet-reset.md` |

Also note that `CURRENT_SCHEMA_VERSION` must be a named constant in `constants.rs` rather than the literal `2` embedded in `create_circle`.

### 7. `docs/adr/003-storage-migration.md` — `migrate_circle` reference

Record that the migration entrypoint shape is defined in the contract source and that it follows the playbook in §3 of this ADR.

## Done when

- [x] A `Circle` entry with an unexpected `schema_version` is rejected with `Error::SchemaMismatch` rather than misdecoded.
- [x] A migration path exists (`migrate_circle` entrypoint) and is tested.
- [x] `CURRENT_SCHEMA_VERSION` is a named constant in `constants.rs`.
- [x] `docs/adr/003-storage-migration.md` records which branch each version bump took.

## Related

- `docs/adr/001-upgradeability.md` — immutable contract means migration is the recovery plan.
- `docs/roadmap.md` §2 — storage versioning was listed as mainnet prerequisite #260 (closed).
- `docs/runbook-testnet-reset.md` — the v1→v2 reset branch is documented here.
- `contracts/sharibo/src/test.rs` — `circle_xdr_layout_golden` guard test.
- `contracts/sharibo/test_snapshots/xdr_goldens/` — golden XDR snapshots.
