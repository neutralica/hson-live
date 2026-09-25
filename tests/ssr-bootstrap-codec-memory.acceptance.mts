import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { decode_ssr_bootstrap, encode_ssr_bootstrap } from "../src/api/ssr/index.ts";
import { Hson, hsonTransform, type HsonSchema } from "../src/index.ts";
import { encode_hosted_root, hosted_sha256 } from "../src/api/livemap/livemap.hosted.ts";
import { locus_projection_contract_digest } from "../src/api/locus/locus.projection.ts";

const MIB = 1_024 * 1_024;
const mode = process.argv[2];

if (mode === "--child") {
  const requestedEncodedBytes = Number(process.argv[3]);
  assert(Number.isSafeInteger(requestedEncodedBytes) && requestedEncodedBytes > 2_048);
  // Base64 expands each payload by 4/3. Account for the per-library envelope
  // as well so the 60 MiB case measures memory instead of failing setup.
  const payloadChunks = Math.ceil(requestedEncodedBytes * 3 / 4 / (2 * MIB));
  const hsonBytes = Math.floor(requestedEncodedBytes * 3 / 4) - 1_300 - 800 * payloadChunks;
  const schema: HsonSchema = Hson.schema`<type "data" content <value "string">>`;
  const schemaText = schema.toHson();
  const authority = { logicalMapId: "memory-map", incarnationId: "memory-incarnation" };
  const rootTemplate = encode_hosted_root(hsonTransform.fromJson({ value: "xxx" }).toNode()).payload;
  const contracts = [];
  const libraries = [];
  let remaining = hsonBytes - 10;
  for (let index = 0; remaining > 0; index += 1) {
    const size = Math.min(remaining, 2 * MIB);
    remaining -= size;
    const contract = { name: `large${String(index).padStart(3, "0")}`, mode: "data-object" as const,
      schema: schemaText, schemaDigest: hosted_sha256(schemaText), rootCodec: "hson-exact-value" as const };
    contracts.push(contract);
    libraries.push({ ...contract, root: { format: "hson-exact-value" as const,
      payload: rootTemplate.replace('"xxx"', `"${"x".repeat(size)}"`) } });
  }
  const bootstrap = { format: "hson-authority-projection-snapshot-v2" as const, authority, revision: 0,
    projectionDigest: locus_projection_contract_digest(authority, contracts, null, [], []),
    libraries,
    htmlDocument: null, systemFeatures: [], writableDocuments: [], system: null };
  globalThis.gc?.();
  const baselineRssMiB = process.memoryUsage().rss / MIB;
  const encoded = encode_ssr_bootstrap(bootstrap);
  assert(encoded.length >= requestedEncodedBytes - 16_384 && encoded.length <= requestedEncodedBytes + 16_384,
    `Requested ${requestedEncodedBytes}, encoded ${encoded.length}.`);
  globalThis.gc?.();
  const decoded = decode_ssr_bootstrap(encoded);
  assert.equal(decoded.kind, "hosted-projection");
  if (decoded.kind !== "hosted-projection") throw new Error("Memory fixture decoded as the wrong family.");
  assert.equal(decoded.bootstrap.libraries.length, libraries.length);
  globalThis.gc?.();
  assert.equal(encode_ssr_bootstrap(decoded.bootstrap), encoded);
  process.stdout.write(JSON.stringify({
    encodedBytes: encoded.length,
    baselineRssMiB,
    maxRssMiB: process.resourceUsage().maxRSS / 1_024,
    finalHeapMiB: process.memoryUsage().heapUsed / MIB,
  }));
  process.exit(0);
}

type Measurement = Readonly<{ encodedBytes: number; baselineRssMiB: number; maxRssMiB: number; finalHeapMiB: number }>;
function measure(encodedMiB: number, heapMiB: number): Measurement {
  const child = spawnSync(process.execPath, [
    `--max-old-space-size=${heapMiB}`,
    "--expose-gc",
    "--import=tsx",
    fileURLToPath(import.meta.url),
    "--child",
    String(encodedMiB * MIB),
  ], { encoding: "utf8", maxBuffer: MIB });
  assert.equal(child.status, 0, `Memory child failed for ${encodedMiB} MiB under ${heapMiB} MiB heap:\n${child.stderr}`);
  return JSON.parse(child.stdout) as Measurement;
}

if (mode === "--near-limit") {
  const nearLimit = measure(60, 1_024);
  assert(nearLimit.encodedBytes > 59 * MIB);
  // Measured setup RSS absorbs Node/tsx startup and allocator variation. The
  // 725 MiB growth ceiling is below the cost of another two full-size copies.
  assert(nearLimit.maxRssMiB - nearLimit.baselineRssMiB < 725,
    `Near-limit peak RSS grew ${(nearLimit.maxRssMiB - nearLimit.baselineRssMiB).toFixed(1)} MiB from its measured baseline.`);
  process.stdout.write(`SSR bootstrap near-limit memory acceptance passed: ${JSON.stringify(nearLimit)}\n`);
  process.exit(0);
}

const small = measure(1.5, 256);
const moderate = measure(6, 256);
const constrained = measure(12, 256);
const large = measure(26, 384);

assert(constrained.encodedBytes > 11.19 * MIB);
assert(large.encodedBytes > 25 * MIB);
assert(small.maxRssMiB - small.baselineRssMiB < 115,
  `Small peak RSS grew ${(small.maxRssMiB - small.baselineRssMiB).toFixed(1)} MiB from its measured baseline.`);
assert(moderate.maxRssMiB - moderate.baselineRssMiB < 190,
  `Moderate peak RSS grew ${(moderate.maxRssMiB - moderate.baselineRssMiB).toFixed(1)} MiB from its measured baseline.`);
assert(constrained.maxRssMiB - constrained.baselineRssMiB < 260,
  `Constrained peak RSS grew ${(constrained.maxRssMiB - constrained.baselineRssMiB).toFixed(1)} MiB from its measured baseline.`);
// Three post-calibration runs grew 346-356 MiB; 400 MiB leaves process noise
// room while catching two additional 26 MiB buffers.
assert(large.maxRssMiB - large.baselineRssMiB < 400,
  `Large peak RSS grew ${(large.maxRssMiB - large.baselineRssMiB).toFixed(1)} MiB from its measured baseline.`);
// The old character-array/rope implementations exceeded these ceilings and
// died under the 256 MiB heap. This generous slope tolerates CI RSS variance.
assert((large.maxRssMiB - small.maxRssMiB) / 24.5 < 16, "Peak RSS did not scale proportionally to encoded size.");

process.stdout.write(`SSR bootstrap codec memory acceptance passed: ${JSON.stringify({ small, moderate, constrained, large })}\n`);
