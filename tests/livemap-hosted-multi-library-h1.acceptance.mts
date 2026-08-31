import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  Hson,
  hson,
  hsonLiveMap,
  validate_document_path,
  type HsonSchema,
} from "../src/index.ts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";
import {
  encode_hosted_root,
  hosted_sha256,
  make_hosted_commit,
  make_hosted_registry,
  type HostedAggregateCommit,
  type HostedAggregateSnapshot,
} from "../src/api/livemap/livemap.hosted.ts";
import { livemap_identity_epoch_accounting } from "../src/api/livemap/livemap.identity-epoch.ts";
import { is_Node } from "../src/core/node-guards.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

const DataSchema: HsonSchema = Hson`<type "data" content <negativeZero "number" ordered <content <a "number" b "number">> items <array "number"> count <number <int true min 0>>>>`;
const FlagSchema: HsonSchema = Hson`<type "data" content <enabled "boolean">>`;
const DocumentSchema: HsonSchema = Hson`<type "document" tag "main" content <repeat <tag "item" content "empty">>>`;
const Q_RETIRED = "000008001";
const Q_ACTIVE = "000008002";
let checks = 0;

function check(name: string, run: () => void): void {
  run();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function makeMap() {
  return hsonLiveMap.fromLibraries({
    alpha: { data: { negativeZero: 0, ordered: { a: 1, b: 2 }, items: [1, 2], count: 0 }, schema: DataSchema },
    beta: { data: { enabled: true }, schema: FlagSchema },
    page: { document: "<main/>", schema: DocumentSchema },
    modal: { document: "<main/>", schema: DocumentSchema },
  });
}

function graphInsert(quid: string, index = 0) {
  return {
    domain: "graph" as const,
    op: "insert-content" as const,
    target: { kind: "path" as const, path: validate_document_path([0]) },
    index,
    content: {
      $_tag: "_hson_elem",
      $_content: [{ $_tag: "item", $_meta: { quid }, $_content: [] }],
    },
  };
}

function graphRemove(index = 0) {
  return {
    domain: "graph" as const,
    op: "remove-content" as const,
    target: { kind: "path" as const, path: validate_document_path([0]) },
    index,
  };
}

check("registry order and digest are deterministic and cover name, mode, and exact Schema source", () => {
  const identityA = Object.freeze({});
  const identityB = Object.freeze({});
  const base = [
    { name: "a", identity: identityA, mode: "data-object" as const, schema: DataSchema },
    { name: "b", identity: identityB, mode: "document" as const, schema: DocumentSchema },
  ];
  const left = make_hosted_registry(base);
  const right = make_hosted_registry(base.map((entry) => ({ ...entry })));
  assert.equal(left.digest, right.digest);
  assert.deepEqual(left.libraries.map((entry) => entry.name), ["a", "b"]);
  assert.notEqual(left.digest, make_hosted_registry([{ ...base[0]!, name: "renamed" }, base[1]!]).digest);
  assert.notEqual(left.digest, make_hosted_registry([{ ...base[0]!, mode: "data-array" }, base[1]!]).digest);
  assert.notEqual(left.digest, make_hosted_registry([{ ...base[0]!, schema: FlagSchema }, base[1]!]).digest);
  assert.throws(() => make_hosted_registry([base[0]!, { ...base[1]!, name: "a" }]), /duplicated/i);
  assert.equal(hosted_sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

check("one hosted commit carries ordered qualified semantics plus one exact witness per operation", () => {
  const map = makeMap();
  const aggregate = internal_livemap_aggregate_authority(map);
  const [alpha, beta, page] = aggregate.libraries();
  if (alpha === undefined || beta === undefined || page === undefined) throw new Error("Expected four hosted Libraries");
  const commit = aggregate.commit([
    { target: aggregate.target(alpha, ["negativeZero"]), kind: "set", value: -0 },
    { target: aggregate.target(beta, ["enabled"]), kind: "set", value: false },
    { target: aggregate.target(alpha, ["ordered"]), kind: "replace", value: { b: 2, a: 1 } },
    { target: aggregate.target(alpha, ["items"]), kind: "replace", value: [2, -0, 3] },
    { target: aggregate.target(page, [0]), kind: "graph", operation: graphInsert(Q_ACTIVE) },
  ]);
  const hosted = commit.hosted;
  if (hosted === undefined) throw new Error("Expected exact hosted commit evidence");
  assert.deepEqual(hosted.operations.map((entry) => entry.library), ["alpha", "beta", "alpha", "alpha", "page"]);
  assert.deepEqual(hosted.replay.operations.map((entry) => entry.library), ["alpha", "beta", "alpha", "alpha", "page"]);
  assert.deepEqual(hosted.replay.operations.map((entry) => entry.domain), ["data", "data", "data", "data", "graph"]);
  assert.equal(Object.is(map.lib("alpha").snap(["negativeZero"]), -0), true);
  assert.deepEqual(Object.keys(map.lib("alpha").snap(["ordered"]) as object), ["b", "a"]);
  assert.equal(Object.is((map.lib("alpha").snap(["items"]) as number[])[1], -0), true);
  assert.equal(map.lib("page").document.byQuid(Q_ACTIVE)?.$_tag, "item");
});

check("semantic/payload drift and unknown Library names reject without revision movement", () => {
  const source = makeMap();
  const sourceAggregate = internal_livemap_aggregate_authority(source);
  const atZero = sourceAggregate.captureHosted();
  const alpha = sourceAggregate.libraries()[0]!;
  const hosted = sourceAggregate.commit([
    { target: sourceAggregate.target(alpha, ["count"]), kind: "set", value: 1 },
  ]).hosted!;
  const target = makeMap();
  const authority = internal_livemap_aggregate_authority(target);
  authority.restoreHosted(atZero);
  const before = target.rev;

  const mismatch = structuredClone(hosted) as any;
  mismatch.operations[0].operation.next = 99;
  assert.throws(() => authority.replayHosted(mismatch), /disagree/i);
  assert.equal(target.rev, before);

  const unknown = structuredClone(hosted) as any;
  unknown.operations[0].library = "missing";
  unknown.replay.operations[0].library = "missing";
  assert.throws(() => authority.replayHosted(unknown), /unknown Library/i);
  assert.equal(target.rev, before);
});

check("invalid later-Library replay rejects every staged Library and publishes nothing", () => {
  const target = makeMap();
  const authority = internal_livemap_aggregate_authority(target);
  const snapshot = authority.captureHosted();
  const identities = authority.libraries();
  const bindings = new Map(identities.map((identity, index) => {
    const entry = snapshot.registry.libraries[index]!;
    return [identity, Object.freeze({ name: entry.name, identity, mode: entry.mode, schema: entry.schema })] as const;
  }));
  const [alpha, beta] = identities;
  if (alpha === undefined || beta === undefined) throw new Error("Expected data Libraries");
  const commit = make_hosted_commit(snapshot.authority, snapshot.registry, bindings, {
    changed: true,
    prevRev: 0,
    rev: 1,
    operations: [
      {
        target: { library: alpha },
        operation: { kind: "set", path: ["count"], prev: 0, next: 1 },
      },
      {
        target: { library: beta },
        operation: { kind: "set", path: ["enabled"], prev: true, next: 1 },
      },
    ],
  });
  let publications = 0;
  authority.observe(() => { publications += 1; });
  const before = authority.captureHosted();
  assert.throws(() => authority.replayHosted(commit), /schema/i);
  assert.deepEqual(authority.captureHosted(), before);
  assert.equal(publications, 0);
});

check("aggregate snapshot carries every root, exact Schema source, revision, registry, and full issued ledger", () => {
  const map = makeMap();
  const aggregate = internal_livemap_aggregate_authority(map);
  assert.throws(
    () => aggregate.addLibrary(hson.fromJson({ enabled: true }).toNode(), { hsonSchema: FlagSchema }),
    /topology is immutable/i,
  );
  const [, , page] = aggregate.libraries();
  if (page === undefined) throw new Error("Expected page Library");
  aggregate.commit([{ target: aggregate.target(page, [0]), kind: "graph", operation: graphInsert(Q_RETIRED) }]);
  aggregate.commit([{ target: aggregate.target(page, [0]), kind: "graph", operation: graphRemove() }]);
  const snapshot = aggregate.captureHosted();
  assert.equal(snapshot.revision, 2);
  assert.equal(snapshot.registryDigest, aggregate.hostedRegistry().digest);
  assert.deepEqual(snapshot.libraries.map((entry) => entry.name), ["alpha", "beta", "page", "modal"]);
  assert.deepEqual(snapshot.libraries.map((entry) => entry.schema), [DataSchema, FlagSchema, DocumentSchema, DocumentSchema]);
  assert.deepEqual(snapshot.identity.issuedQuids, [Q_RETIRED]);
});

check("issued-but-retired QUID survives fresh aggregate restore and ABA reuse still rejects", () => {
  const source = makeMap();
  const sourceAuthority = internal_livemap_aggregate_authority(source);
  const page = sourceAuthority.libraries()[2]!;
  sourceAuthority.commit([{ target: sourceAuthority.target(page, [0]), kind: "graph", operation: graphInsert(Q_RETIRED) }]);
  sourceAuthority.commit([{ target: sourceAuthority.target(page, [0]), kind: "graph", operation: graphRemove() }]);
  assert.equal(sourceAuthority.resolveQuid(Q_RETIRED), undefined);

  const target = makeMap();
  const targetAuthority = internal_livemap_aggregate_authority(target);
  targetAuthority.restoreHosted(sourceAuthority.captureHosted());
  assert.equal(targetAuthority.resolveQuid(Q_RETIRED), undefined);
  assert.deepEqual(livemap_identity_epoch_accounting(target.lib("page")), { epoch: 0, issued: 1 });
  const modal = targetAuthority.libraries()[3]!;
  const before = target.rev;
  assert.throws(() => targetAuthority.commit([
    { target: targetAuthority.target(modal, [0]), kind: "graph", operation: graphInsert(Q_RETIRED) },
  ]), /retired|reuse/i);
  assert.equal(target.rev, before);
});

check("restore rebuilds active QUID lookup globally and rejects cross-Library collision atomically", () => {
  const source = makeMap();
  const sourceAuthority = internal_livemap_aggregate_authority(source);
  const page = sourceAuthority.libraries()[2]!;
  sourceAuthority.commit([{ target: sourceAuthority.target(page, [0]), kind: "graph", operation: graphInsert(Q_ACTIVE) }]);
  const snapshot = sourceAuthority.captureHosted();
  const target = makeMap();
  const targetAuthority = internal_livemap_aggregate_authority(target);
  targetAuthority.restoreHosted(snapshot);
  assert.deepEqual(targetAuthority.resolveQuid(Q_ACTIVE), targetAuthority.target(targetAuthority.libraries()[2]!, [0, 0, 0]));

  const collision = structuredClone(snapshot) as any;
  const modalRoot = { $_tag: "_hson_root", $_content: [{
    $_tag: "main",
    $_content: [{ $_tag: "_hson_elem", $_content: [{ $_tag: "item", $_meta: { quid: Q_ACTIVE }, $_content: [] }] }],
  }] };
  collision.libraries[3].root = encode_hosted_root(modalRoot);
  const untouched = makeMap();
  const untouchedAuthority = internal_livemap_aggregate_authority(untouched);
  assert.throws(() => untouchedAuthority.restoreHosted(collision), /collision/i);
  assert.equal(untouched.rev, 0);
  const pageRoot = untouched.lib("page").root().$_content[0];
  const modalRootAfter = untouched.lib("modal").root().$_content[0];
  assert.equal(is_Node(pageRoot) ? pageRoot.$_content.length : -1, 0);
  assert.equal(is_Node(modalRootAfter) ? modalRootAfter.$_content.length : -1, 0);
});

check("one invalid Library or Schema mismatch rejects the entire snapshot with no partial install", () => {
  const source = makeMap();
  const snapshot = internal_livemap_aggregate_authority(source).captureHosted();
  const malformed = structuredClone(snapshot) as any;
  malformed.libraries[1].root = encode_hosted_root(hson.fromJson({ enabled: "not-boolean" }).toNode());
  const target = makeMap();
  const authority = internal_livemap_aggregate_authority(target);
  const before = authority.captureHosted();
  assert.throws(() => authority.restoreHosted(malformed), /schema/i);
  assert.deepEqual(authority.captureHosted(), before);

  const wrongRegistry = structuredClone(snapshot) as any;
  wrongRegistry.registryDigest = "0".repeat(64);
  assert.throws(() => authority.restoreHosted(wrongRegistry), /registry/i);
  assert.deepEqual(authority.captureHosted(), before);
});

check("snapshot plus ordered aggregate tail reproduces exact state, revision, identity, and authority", () => {
  const source = makeMap();
  const sourceAuthority = internal_livemap_aggregate_authority(source);
  const [alpha, beta, page] = sourceAuthority.libraries();
  if (alpha === undefined || beta === undefined || page === undefined) throw new Error("Expected hosted Libraries");
  sourceAuthority.commit([{ target: sourceAuthority.target(page, [0]), kind: "graph", operation: graphInsert(Q_RETIRED) }]);
  sourceAuthority.commit([{ target: sourceAuthority.target(page, [0]), kind: "graph", operation: graphRemove() }]);
  const atR = sourceAuthority.captureHosted();
  const tail = sourceAuthority.commit([
    { target: sourceAuthority.target(alpha, ["negativeZero"]), kind: "set", value: -0 },
    { target: sourceAuthority.target(beta, ["enabled"]), kind: "set", value: false },
    { target: sourceAuthority.target(alpha, ["ordered"]), kind: "replace", value: { b: 2, a: 1 } },
    { target: sourceAuthority.target(alpha, ["items"]), kind: "replace", value: [2, -0, 3] },
    { target: sourceAuthority.target(page, [0]), kind: "graph", operation: graphInsert(Q_ACTIVE) },
  ]).hosted!;

  const rebuilt = makeMap();
  const rebuiltAuthority = internal_livemap_aggregate_authority(rebuilt);
  rebuiltAuthority.restoreHosted(atR);
  let publications = 0;
  rebuiltAuthority.observe(() => { publications += 1; });
  const replayed = rebuiltAuthority.replayHosted(structuredClone(tail) as HostedAggregateCommit);
  assert.equal(publications, 1);
  assert.deepEqual([replayed.prevRev, replayed.rev, rebuilt.rev], [2, 3, 3]);
  assert.deepEqual(rebuiltAuthority.captureHosted(), sourceAuthority.captureHosted());
  assert.equal(Object.is(rebuilt.lib("alpha").snap(["negativeZero"]), -0), true);
  assert.deepEqual(Object.keys(rebuilt.lib("alpha").snap(["ordered"]) as object), ["b", "a"]);
  assert.equal(Object.is((rebuilt.lib("alpha").snap(["items"]) as number[])[1], -0), true);
  assert.equal(rebuilt.lib("page").document.byQuid(Q_ACTIVE)?.$_tag, "item");
  assert.equal(rebuiltAuthority.resolveQuid(Q_RETIRED), undefined);

  const stale = structuredClone(tail) as HostedAggregateCommit;
  assert.throws(() => rebuiltAuthority.replayHosted(stale), /revision|expected/i);
  assert.equal(rebuilt.rev, 3);
});

check("focused capture, codec, ledger hydration, and replay telemetry stays bounded", () => {
  const two = hsonLiveMap.fromLibraries({
    alpha: { data: { negativeZero: 0, ordered: { a: 1, b: 2 }, items: [1, 2], count: 0 }, schema: DataSchema },
    beta: { data: { enabled: true }, schema: FlagSchema },
  });
  const captureTwoStart = performance.now();
  internal_livemap_aggregate_authority(two).captureHosted();
  const captureTwoMs = performance.now() - captureTwoStart;
  const source = makeMap();
  const authority = internal_livemap_aggregate_authority(source);
  const [alpha, beta, page] = authority.libraries();
  if (alpha === undefined || beta === undefined || page === undefined) throw new Error("Expected hosted Libraries");
  authority.commit([{ target: authority.target(page, [0]), kind: "graph", operation: graphInsert(Q_RETIRED) }]);
  authority.commit([{ target: authority.target(page, [0]), kind: "graph", operation: graphRemove() }]);
  const captureFourStart = performance.now();
  const snapshot = authority.captureHosted();
  const captureFourMs = performance.now() - captureFourStart;
  const codecStart = performance.now();
  const cloned = structuredClone(snapshot) as HostedAggregateSnapshot;
  const codecMs = performance.now() - codecStart;
  const target = makeMap();
  const targetAuthority = internal_livemap_aggregate_authority(target);
  const hydrateStart = performance.now();
  targetAuthority.restoreHosted(cloned);
  const hydrateMs = performance.now() - hydrateStart;
  const one = authority.commit([{ target: authority.target(alpha, ["count"]), kind: "set", value: 1 }]).hosted!;
  const replayOneStart = performance.now();
  targetAuthority.replayHosted(structuredClone(one));
  const replayOneMs = performance.now() - replayOneStart;
  const aggregateCommit = authority.commit([
    { target: authority.target(beta, ["enabled"]), kind: "set", value: false },
    { target: authority.target(page, [0]), kind: "graph", operation: graphInsert(Q_ACTIVE) },
  ]).hosted!;
  const replayAggregateStart = performance.now();
  targetAuthority.replayHosted(structuredClone(aggregateCommit));
  const replayAggregateMs = performance.now() - replayAggregateStart;
  const telemetry = targetAuthority.telemetry();
  assert.equal(telemetry.acceptedTransitions, 2);
  assert.equal(telemetry.aggregatePublications, 2);
  assert.ok(telemetry.schemaValidations <= 3);
  process.stdout.write(`# telemetry ${JSON.stringify({ captureTwoMs, captureFourMs, snapshotCloneMs: codecMs, decodeAndLedgerHydrateMs: hydrateMs, replayOneMs, replayAggregateMs, engine: telemetry })}\n`);
});

process.stdout.write(`1..${checks}\n`);
emit_hson_live_test_completion("livemap.hosted-multi-library-h1", checks, checks, 0);
