import { gzipSync, brotliCompressSync } from "node:zlib";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  PERSISTED_QUID_ALPHABET,
  is_persisted_quid,
} from "../dist/core/hson-node-quid.js";
import {
  make_livemap_issued_quid_ledger,
  stage_livemap_identity_epoch,
} from "../dist/api/livemap/livemap.identity-epoch.js";
import {
  create_livetree_runtime,
} from "../dist/api/livetree/runtime/livetree-runtime.js";
import { create_livetree_in_runtime } from "../dist/api/livetree/creation/create-livetree.js";
import {
  build_livemap_document_identity_overlay,
  reconcile_livemap_document_identity_overlay,
} from "../dist/api/livemap/livemap.document.identity.js";
import { validate_document_path } from "../dist/api/livemap/livemap.document.path.js";
import {
  collect_hson_node_quid_claims,
} from "../dist/core/hson-node-quid.js";
import { hson } from "../dist/index.js";

const mode = process.argv[2] ?? "model";
const count = Number(process.argv[3] ?? 100_000);

function collect() {
  if (typeof globalThis.gc !== "function") {
    throw new Error("Run this benchmark with node --expose-gc");
  }
  for (let index = 0; index < 6; index += 1) globalThis.gc();
}

function timed(run) {
  const started = performance.now();
  const value = run();
  return { value, elapsedMs: performance.now() - started };
}

function measureHeap(run) {
  collect();
  const before = process.memoryUsage().heapUsed;
  const result = timed(run);
  collect();
  return {
    value: result.value,
    elapsedMs: result.elapsedMs,
    heapBytes: process.memoryUsage().heapUsed - before,
  };
}

function quidFor(index, length = 9) {
  let value = BigInt(index);
  let output = "";
  for (let digit = 0; digit < length; digit += 1) {
    output = PERSISTED_QUID_ALPHABET[Number(value & 31n)] + output;
    value >>= 5n;
  }
  return output;
}

function payloadQuidFor(index, length) {
  const bytes = createHash("sha256").update(`quid-scale-${index}`).digest();
  const output = new Array(length);
  for (let digit = 0; digit < length; digit += 1) {
    output[digit] = PERSISTED_QUID_ALPHABET[bytes[digit] & 31];
  }
  return output.join("");
}

function flatGraph(nodeCount, identityCount = 0) {
  if (!Number.isSafeInteger(nodeCount) || nodeCount < 3) throw new Error("node count must be at least three");
  if (!Number.isSafeInteger(identityCount) || identityCount < 0 || identityCount > nodeCount - 2) {
    throw new Error("identity count exceeds eligible nodes");
  }
  const children = new Array(nodeCount - 3);
  const identifyMain = identityCount > 0;
  for (let index = 0; index < children.length; index += 1) {
    const identified = index < identityCount - (identifyMain ? 1 : 0);
    children[index] = {
      $_tag: "i",
      ...(identified ? { $_meta: { quid: quidFor(index + 2) } } : {}),
      $_content: [],
    };
  }
  return { $_tag: "_hson_elem", $_content: [{
    $_tag: "main",
    ...(identifyMain ? { $_meta: { quid: quidFor(1) } } : {}),
    $_content: [{ $_tag: "_hson_elem", $_content: children }],
  }] };
}

function birthdayProbability(issued, namespace) {
  if (issued < 2) return 0;
  if (BigInt(issued) > namespace) return 1;
  // log1p remains stable when each term is tiny. The quadratic expansion
  // avoids an impractical O(I) loop for the largest proof rows.
  const n = Number(issued);
  const m = Number(namespace);
  const s1 = n * (n - 1) / 2;
  const s2 = n * (n - 1) * (2 * n - 1) / 6;
  const logNoCollision = -(s1 / m) - (s2 / (2 * m * m));
  return -Math.expm1(logNoCollision);
}

function thresholdPopulation(namespace, risk) {
  const m = Number(namespace);
  return Math.ceil((1 + Math.sqrt(1 + 8 * m * -Math.log1p(-risk))) / 2);
}

function namespaceModel() {
  const populations = [1_000, 10_000, 100_000, 1_000_000, 10_000_000];
  const thresholds = [1e-6, 1e-9, 1e-12, 1e-15];
  return [8, 9, 10, 12, 16].map((length) => {
    const namespace = 32n ** BigInt(length);
    return {
      length,
      entropyBits: length * 5,
      namespace: namespace.toString(),
      populations: populations.map((issued) => {
        const firstCollision = issued / Number(namespace);
        return {
          issued,
          birthdayProbability: birthdayProbability(issued, namespace),
          expectedCollisionPairs: issued * (issued - 1) / (2 * Number(namespace)),
          firstCandidateCollision: firstCollision,
          expectedAttempts: 1 / (1 - firstCollision),
          needsAtLeast2: firstCollision,
          needsAtLeast3: firstCollision ** 2,
          needsAtLeast4: firstCollision ** 3,
          exhausts32: firstCollision ** 32,
        };
      }),
      thresholds: Object.fromEntries(thresholds.map((risk) => [String(risk), thresholdPopulation(namespace, risk)])),
    };
  });
}

function payload(length, nodes, identities) {
  const ids = Array.from({ length: identities }, (_, index) => payloadQuidFor(index + 1, length));
  const hsonNodes = Array.from({ length: nodes }, (_, index) => `<i${index < identities ? ` @${ids[index]}` : ""}/>`);
  const readableNodes = hsonNodes.map((node) => `  ${node}`).join("\n");
  const jsonNodes = Array.from({ length: nodes }, (_, index) => index < identities
    ? { $_tag: "i", $_meta: { quid: ids[index] }, $_content: [] }
    : { $_tag: "i", $_content: [] });
  const htmlNodes = Array.from({ length: nodes }, (_, index) => `<i${index < identities ? ` hson:quid="${ids[index]}"` : ""}></i>`);
  const formats = {
    canonicalHson: `<main ${hsonNodes.join(" ")}/>` ,
    readableHson: `<main\n${readableNodes}\n/>`,
    compactHson: `<main ${hsonNodes.join(" ")}/>` ,
    structuralJson: JSON.stringify({ $_tag: "main", $_content: jsonNodes }),
    structuralHtml: `<main>${htmlNodes.join("")}</main>`,
    snapshot: JSON.stringify({ kind: "document", rev: 42, root: { $_tag: "main", $_content: jsonNodes } }),
    locus: JSON.stringify({ kind: "snapshot", logicalMapId: "scale", incarnationId: "proof", rev: 42, graph: { $_tag: "main", $_content: jsonNodes } }),
  };
  return Object.fromEntries(Object.entries(formats).map(([name, text]) => [name, {
    raw: Buffer.byteLength(text),
    gzip: gzipSync(text, { level: 9 }).byteLength,
    brotli: brotliCompressSync(text).byteLength,
  }]));
}

function payloadModel() {
  const scenarios = [
    { name: "sparse", nodes: 1_000, identities: 10 },
    { name: "moderate", nodes: 1_000, identities: 100 },
    { name: "identity-heavy", nodes: 1_000, identities: 1_000 },
  ];
  return Object.fromEntries(scenarios.map((scenario) => [scenario.name, Object.fromEntries(
    [8, 9, 10, 12, 16].map((length) => [String(length), payload(length, scenario.nodes, scenario.identities)]),
  )]));
}

function qfreeGraph() {
  const graphMeasurement = measureHeap(() => flatGraph(count));
  const graph = graphMeasurement.value;
  const traversal = timed(() => collect_hson_node_quid_claims(graph));
  const ownerMeasurement = measureHeap(() => hson.liveMap.fromNode(graph));
  const owner = ownerMeasurement.value;
  return {
    ownerType: "LiveMap owner epoch",
    graphNodes: count,
    Q: collect_hson_node_quid_claims(owner.root()).length,
    I: 0,
    graphConstructionMs: graphMeasurement.elapsedMs,
    graphHeapBytes: graphMeasurement.heapBytes,
    traversalMs: traversal.elapsedMs,
    admissionMs: ownerMeasurement.elapsedMs,
    ownerHeapBytes: ownerMeasurement.heapBytes,
  };
}

function ledger(ownerType) {
  let retained;
  const creation = measureHeap(() => {
    const values = Array.from({ length: count }, (_, index) => quidFor(index));
    for (const value of values) if (!is_persisted_quid(value)) throw new Error("invalid generated benchmark QUID");
    if (ownerType === "livemap") return { values, ledger: make_livemap_issued_quid_ledger(values) };
    const ledger = create_livetree_runtime();
    for (const value of values) ledger.issuedQuids.add(value);
    return { values, ledger };
  });
  retained = creation.value;
  const values = retained.values;
  const has = ownerType === "livemap"
    ? (value) => retained.ledger.has(value)
    : (value) => retained.ledger.issuedQuids.has(value);
  const lookup = timed(() => {
    let hits = 0;
    const operations = Math.max(100_000, count);
    for (let index = 0; index < operations; index += 1) {
      if (has(values[index % count])) hits += 1;
    }
    return { hits, operations };
  });
  let stagedInsertion;
  if (ownerType === "livemap") {
    const next = quidFor(count);
    stagedInsertion = timed(() => stage_livemap_identity_epoch(retained.ledger, [], [next])).elapsedMs;
  } else {
    const next = quidFor(count);
    stagedInsertion = timed(() => retained.ledger.issuedQuids.add(next)).elapsedMs;
  }
  return {
    ownerType: ownerType === "livemap" ? "LiveMap owner epoch ledger" : "LiveTreeRuntime issued Set",
    I: count,
    Q: 0,
    constructionMs: creation.elapsedMs,
    heapBytes: creation.heapBytes,
    bytesPerIssued: creation.heapBytes / count,
    lookupMs: lookup.elapsedMs,
    lookupOperations: lookup.value.operations,
    stagedInsertionMs: stagedInsertion,
  };
}

function activeOverlay(ownerType) {
  const Q = count;
  const graphNodes = Number(process.argv[4] ?? 100_000);
  const graph = flatGraph(graphNodes, Q);
  if (ownerType === "livemap") {
    const creation = measureHeap(() => build_livemap_document_identity_overlay(graph, "element"));
    const overlay = creation.value;
    const lookup = timed(() => {
      let hits = 0;
      const operations = 100_000;
      for (let index = 0; index < operations; index += 1) {
        if (overlay.pathForQuid(quidFor(index % Q + 1)) !== undefined) hits += 1;
      }
      return { hits, operations };
    });
    const parent = validate_document_path([0]);
    const move = timed(() => reconcile_livemap_document_identity_overlay(
      overlay,
      { kind: "move", parent, from: 0, to: graphNodes - 4 },
    ));
    const retirement = timed(() => reconcile_livemap_document_identity_overlay(
      overlay,
      { kind: "delete", parent, index: 0 },
    ));
    return {
      ownerType: "LiveMap document active overlay",
      graphNodes,
      Q,
      I: Q,
      constructionMs: creation.elapsedMs,
      heapBytes: creation.heapBytes,
      bytesPerActive: creation.heapBytes / Q,
      lookupMs: lookup.elapsedMs,
      lookupOperations: lookup.value.operations,
      moveReconciliationMs: move.elapsedMs,
      destructionReconciliationMs: retirement.elapsedMs,
    };
  }
  const root = graph.$_content[0];
  const runtime = create_livetree_runtime();
  const creation = measureHeap(() => create_livetree_in_runtime(root, runtime));
  const lookup = timed(() => {
    let hits = 0;
    const operations = 100_000;
    for (let index = 0; index < operations; index += 1) {
      if (runtime.quidToNode.has(quidFor(index % Q + 1))) hits += 1;
    }
    return { hits, operations };
  });
  const retirement = timed(() => creation.value.remove());
  return {
    ownerType: "standalone LiveTreeRuntime active overlay",
    graphNodes,
    Q,
    I: Q,
    constructionMs: creation.elapsedMs,
    heapBytes: creation.heapBytes,
    bytesPerActive: creation.heapBytes / Q,
    lookupMs: lookup.elapsedMs,
    lookupOperations: lookup.value.operations,
    destructionMs: retirement.elapsedMs,
    afterDestructionQ: runtime.quidToNode.size,
    afterDestructionI: runtime.issuedQuids.size,
  };
}

function candidateStringLedger() {
  const length = Number(process.argv[4] ?? 16);
  const creation = measureHeap(() => {
    const values = Array.from({ length: count }, (_, index) => payloadQuidFor(index, length));
    return { values, entries: new Set(values) };
  });
  return {
    ownerType: "analytical candidate string Set (not production admission)",
    I: count,
    candidateLength: length,
    heapBytes: creation.heapBytes,
    bytesPerIssued: creation.heapBytes / count,
    constructionMs: creation.elapsedMs,
    retained: creation.value.entries.size,
  };
}

const result = mode === "model"
  ? { namespace: namespaceModel(), payloads: payloadModel() }
  : mode === "qfree"
    ? qfreeGraph()
    : mode === "ledger-livemap"
      ? ledger("livemap")
    : mode === "ledger-livetree"
      ? ledger("livetree")
      : mode === "overlay-livemap"
        ? activeOverlay("livemap")
        : mode === "overlay-livetree"
          ? activeOverlay("livetree")
          : mode === "ledger-strings"
            ? candidateStringLedger()
        : (() => { throw new Error(`Unknown mode ${mode}`); })();

console.log(JSON.stringify({
  benchmark: "quid-scale",
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  mode,
  result,
}));
