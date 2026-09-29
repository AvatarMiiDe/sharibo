/**
 * Docs structure checks (#537 / #561 / #563).
 * Plain Node test — no tsx required.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const MANIFEST = JSON.parse(
  readFileSync(join(ROOT, "test-vectors/public-signals.json"), "utf8"),
);

const CANONICAL_LIST = `[${MANIFEST.order.join(", ")}]`;
const STALE_THREE = /\[nullifierHash,\s*root,\s*externalNullifier\](?!\s*,\s*recipientHash)/g;

function walkMarkdown(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === "target" || name === ".git") {
      continue;
    }
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkMarkdown(p, out);
    else if (name.endsWith(".md")) out.push(p);
  }
  return out;
}

function githubSlug(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
}

function collectAnchors(md) {
  const anchors = new Set();
  for (const line of md.split("\n")) {
    const m = /^(#{1,6})\s+(.+)$/.exec(line);
    if (!m) continue;
    anchors.add(githubSlug(m[2]));
  }
  return anchors;
}

describe("documentation structure", () => {
  it("README anchors into full_product_breakdown.md all resolve", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    const breakdown = readFileSync(join(ROOT, "full_product_breakdown.md"), "utf8");
    const anchors = collectAnchors(breakdown);

    const re = /full_product_breakdown\.md#([a-z0-9-]+)/g;
    const missing = [];
    let match;
    while ((match = re.exec(readme)) !== null) {
      if (!anchors.has(match[1])) missing.push(match[1]);
    }
    assert.deepEqual(missing, [], `broken breakdown anchors: ${missing.join(", ")}`);
  });

  it("no markdown states the stale 3-signal public-input list", () => {
    const offenders = [];
    for (const file of walkMarkdown(ROOT)) {
      const text = readFileSync(file, "utf8");
      STALE_THREE.lastIndex = 0;
      if (STALE_THREE.test(text)) {
        offenders.push(relative(ROOT, file));
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `stale public-signal list (want ${CANONICAL_LIST}) in:\n  ${offenders.join("\n  ")}`,
    );
  });

  it("manifest lists four signals including recipientHash", () => {
    assert.equal(MANIFEST.order.length, 4);
    assert.equal(MANIFEST.order[3], "recipientHash");
  });
});
