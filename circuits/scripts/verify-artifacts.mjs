import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const circuitsDir = path.resolve(scriptDir, "..");
const buildDir = path.join(circuitsDir, "build");
const fixHint = "run `npm run compile && npm run setup` in `circuits/`";

// ── Compiled artifacts (reproducibility, issue #535) ─────────────────────────
// These are produced by `npm run compile` and are deterministic given the
// pinned circom version + template + config.json. They are NOT the zkey
// (that is non-deterministic ceremony entropy, verified separately by
// verify-setup.sh against the committed verification_key.json).
const artifacts = [
  {
    name: "membership.r1cs",
    filePath: path.join(buildDir, "membership.r1cs"),
    manifestKey: "r1cs",
  },
  {
    name: "membership_js/membership.wasm",
    filePath: path.join(buildDir, "membership_js", "membership.wasm"),
    manifestKey: "wasm",
  },
  {
    name: "membership.sym",
    filePath: path.join(buildDir, "membership.sym"),
    manifestKey: "sym",
  },
];

function hashFile(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function fail(message) {
  console.error(`Circuit artifact verification failed: ${message}`);
  console.error(`Fix: ${fixHint}`);
  process.exit(1);
}

const manifestPath = path.join(circuitsDir, "artifact-hashes.json");
const manifest = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, "utf8"))
  : {};

for (const artifact of artifacts) {
  if (!existsSync(artifact.filePath)) {
    fail(`${artifact.name} is missing. Run \`npm run compile\` first.`);
  }
  const expected = manifest[artifact.manifestKey];
  if (!expected) {
    fail(`No committed hash for ${artifact.name} in artifact-hashes.json. ${fixHint}`);
  }
  const actual = hashFile(artifact.filePath);
  if (actual !== expected.toLowerCase()) {
    fail(
      `${artifact.name} hash mismatch. Expected ${expected.toLowerCase()} but found ${actual}. ${fixHint}`,
    );
  }
}

console.log("Circuit artifacts verified.");
