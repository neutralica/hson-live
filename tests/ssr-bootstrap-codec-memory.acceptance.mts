import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { decode_ssr_bootstrap, encode_ssr_bootstrap } from "../src/api/ssr/index.ts";

const MIB = 1_024 * 1_024;
const mode = process.argv[2];

if (mode === "--child") {
  const requestedEncodedBytes = Number(process.argv[3]);
  assert(Number.isSafeInteger(requestedEncodedBytes) && requestedEncodedBytes > 2_048);
  const hsonBytes = Math.floor(requestedEncodedBytes * 3 / 4) - 1_024;
  const bootstrap = {
    logicalMapId: "memory-map",
    incarnationId: "memory-incarnation",
    rev: 0,
    mode: "document" as const,
    format: "hson-client-snapshot-v1" as const,
    payload: `<main "${"x".repeat(hsonBytes - 10)}"/>`,
  };
  const encoded = encode_ssr_bootstrap(bootstrap);
  assert(encoded.length >= requestedEncodedBytes - 2_048 && encoded.length <= requestedEncodedBytes);
  const decoded = decode_ssr_bootstrap(encoded);
  assert.equal(decoded.kind, "hosted-document");
  if (decoded.kind !== "hosted-document") throw new Error("Memory fixture decoded as the wrong family.");
  assert.equal(decoded.bootstrap.payload.length, hsonBytes);
  assert.equal(encode_ssr_bootstrap(decoded.bootstrap), encoded);
  process.stdout.write(JSON.stringify({
    encodedBytes: encoded.length,
    maxRssMiB: process.resourceUsage().maxRSS / 1_024,
    finalHeapMiB: process.memoryUsage().heapUsed / MIB,
  }));
  process.exit(0);
}

type Measurement = Readonly<{ encodedBytes: number; maxRssMiB: number; finalHeapMiB: number }>;
function measure(encodedMiB: number, heapMiB: number): Measurement {
  const child = spawnSync(process.execPath, [
    `--max-old-space-size=${heapMiB}`,
    "--import=tsx",
    fileURLToPath(import.meta.url),
    "--child",
    String(encodedMiB * MIB),
  ], { encoding: "utf8", maxBuffer: MIB });
  assert.equal(child.status, 0, `Memory child failed for ${encodedMiB} MiB under ${heapMiB} MiB heap:\n${child.stderr}`);
  return JSON.parse(child.stdout) as Measurement;
}

if (mode === "--near-limit") {
  const nearLimit = measure(95, 1_024);
  assert(nearLimit.encodedBytes > 94 * MIB);
  assert(nearLimit.maxRssMiB < 1_024, `Near-limit peak RSS was ${nearLimit.maxRssMiB.toFixed(1)} MiB.`);
  process.stdout.write(`SSR bootstrap near-limit memory acceptance passed: ${JSON.stringify(nearLimit)}\n`);
  process.exit(0);
}

const small = measure(1.5, 256);
const moderate = measure(6, 256);
const constrained = measure(12, 256);
const large = measure(26, 384);

assert(constrained.encodedBytes > 11.19 * MIB);
assert(large.encodedBytes > 25 * MIB);
assert(small.maxRssMiB < 256, `Small peak RSS was ${small.maxRssMiB.toFixed(1)} MiB.`);
assert(moderate.maxRssMiB < 320, `Moderate peak RSS was ${moderate.maxRssMiB.toFixed(1)} MiB.`);
assert(constrained.maxRssMiB < 384, `Constrained peak RSS was ${constrained.maxRssMiB.toFixed(1)} MiB.`);
assert(large.maxRssMiB < 512, `Large peak RSS was ${large.maxRssMiB.toFixed(1)} MiB.`);
// The old character-array/rope implementations exceeded these ceilings and
// died under the 256 MiB heap. This generous slope tolerates CI RSS variance.
assert((large.maxRssMiB - small.maxRssMiB) / 24.5 < 16, "Peak RSS did not scale proportionally to encoded size.");

process.stdout.write(`SSR bootstrap codec memory acceptance passed: ${JSON.stringify({ small, moderate, constrained, large })}\n`);
