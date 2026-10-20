import assert from "node:assert/strict";
import { Hson, hsonLiveMap, hsonTransform } from "../../src/index.ts";
import type { LiveMap, LiveMapDefinitions, LiveMapLibraryAddOperation } from "../../src/types/livemap.types.ts";
import { internal_livemap_aggregate_authority as authority } from "../../src/api/livemap/livemap.internal.ts";
import { enumerate_livemap_issued_quids as issued } from "../../src/api/livemap/livemap.identity-epoch.ts";
import { prepare_hosted_livemap_library_add_internal as prepare, replay_durable_library_add_internal as replay } from "../../src/api/livemap/livemap.libraries.ts";
import { encode_authoritative_topology_commit as encode, make_hosted_topology_commit } from "../../src/api/livemap/livemap.hosted.ts";
import { create_persistent_locus_hosted_aggregate_internal as persist, load_persistent_locus_hosted_aggregate_internal as resume,
  checkpoint_libraries_equal, durable_aggregate_commit } from "../../src/api/locus/locus.aggregate.persistence.ts";
import { parse_document_stylesheet } from "../../src/internal/css/parse-document-stylesheet.ts";
import { decode_portable_document_stylesheet } from "../../src/internal/css/portable-document-stylesheet.ts";
import { MemoryCheckpointAdapter } from "../helpers/memory-checkpoint-adapter.mts";
import { review_admission_management } from "./h0b-review-admission-management.mts";
import { review_missing_scopes } from "./h0b-review-missing-scopes.mts";

const parts = { parts: {
  leaf: { kind: "document", document: '<button @:root/>' },
  panel: { kind: "document", document: '<section @:root <hson-part at="leaf"/>/>' },
} } as const;
const page = { document: '<main @:root <hson-part @:slot lib="parts" at="panel"/> <hson-part lib="parts" at="panel"/>/>' };
function initial() { return hsonLiveMap.fromLibraries({ parts, initial: { data: 0 } }); }
function scopes(map: LiveMap, name: string) {
  const a = authority(map), index = a.hostedRegistry().libraries.findIndex(entry => entry.name === name);
  return a.documentScopes(a.libraries()[index]!);
}
function unchanged(map: LiveMap) {
  const a = authority(map), checkpoint = a.captureSemanticCheckpoint(), registry = a.hostedRegistry();
  const ledger = a.identityEpoch().issued(), epoch = a.identityEpoch().current();
  const refs = a.libraries().map(id => ({ id, root: a.root(id), scopes: a.documentScopes(id) }));
  let observations = 0;
  const stop = map.commits.observe(() => observations++), off = a.observeAuthorityPosition(() => observations++);
  return () => {
    stop(); off(); assert.equal(observations, 0); assert.equal(a.hostedRegistry(), registry);
    assert.deepEqual(a.captureSemanticCheckpoint(), checkpoint); assert.equal(a.identityEpoch().issued(), ledger); assert.equal(a.identityEpoch().current(), epoch);
    for (const ref of refs) { assert.equal(a.root(ref.id), ref.root); assert.equal(a.documentScopes(ref.id), ref.scopes); }
  };
}

/** One existing checkpoint plus flat, CSS-free scoped, styled scoped and empty-scoped tail entries. */
export async function topology_contract_fixture() {
  const map = initial(), a = authority(map), adapter = new MemoryCheckpointAdapter();
  const l = await persist({ map, persistence: adapter, scopedDocuments: true });
  try {
    await l.add_libraries_internal({ flat: { document: '<article @:root/>' } }, undefined, [{ name: "flat", ownership: "shared" }]);
    await l.add_libraries_internal({ page }, undefined, [{ name: "page", ownership: "shared" }]);
    await l.add_libraries_internal({ styled: page }, undefined, [{ name: "styled", ownership: "shared" }],
      { styled: parse_document_stylesheet('main{color:purple}', []) });
  } finally { l.dispose(); }
  // Use the existing canonical managed owner to author explicitly present empty
  // scoped evidence; the public definition grammar intentionally has no such API.
  const owner = {}; a.claimManagement(owner);
  try {
    const p = a.prepareAddLibrariesManaged(owner, [{ name: "empty", family: "document", hsonSchema: Hson.schema`<type "document">`,
      root: hsonTransform.fromHson('<main/>').toNode(), scopes: { document: [], occurrences: [], subjects: [] },
      css: decode_portable_document_stylesheet(parse_document_stylesheet('', [])) }]);
    assert.ok(p.transition.commit.hosted);
    const release = a.reserve(p.transition);
    try {
      await adapter.appendCommit(durable_aggregate_commit(p.transition.commit.hosted, [{ name: "empty", ownership: "shared" }]));
      a.accept(p.transition);
    } finally { release(); }
  } finally { a.releaseManagement(owner); }
  return { state: adapter.state(l.logicalMapId)!, expected: a.captureSemanticCheckpoint(), adapter, sourceIds: issued(a.identityEpoch().issued()) };
}

export async function verify_topology_contract_restart(f: Awaited<ReturnType<typeof topology_contract_fixture>>) {
  const l = await resume(f.state.checkpoint.logicalMapId, { persistence: f.adapter, scopedDocuments: true }); assert.ok(l);
  try {
    const a = authority(l.map), actual = a.captureSemanticCheckpoint();
    assert.ok(checkpoint_libraries_equal(f.expected.libraries, actual.libraries)); assert.deepEqual(actual.registry, f.expected.registry);
    assert.deepEqual(actual.authority, f.expected.authority); assert.equal(actual.revision, 4);
    assert.equal(scopes(l.map, "flat"), undefined); assert.equal(scopes(l.map, "page")?.occurrences.length, 4);
    assert.equal(scopes(l.map, "styled")?.occurrences.length, 4);
    assert.deepEqual(actual.libraries.find(e => e.name === "empty")?.scopes, { document: [], occurrences: [], subjects: [] });
    for (const quid of issued(a.identityEpoch().issued())) assert.ok(!f.sourceIds.includes(quid));
    // Checkpoint after the additions, then restore that checkpoint with a new tail.
    await l.checkpoint();
    await l.add_libraries_internal({ later: { data: 9 } }, undefined, [{ name: "later", ownership: "shared" }]);
    const next = await resume(l.logicalMapId, { persistence: f.adapter, scopedDocuments: true }); assert.ok(next);
    try {
      assert.equal(next.rev, 5); assert.ok(checkpoint_libraries_equal(a.captureSemanticCheckpoint().libraries,
        authority(next.map).captureSemanticCheckpoint().libraries));
    } finally { next.dispose(); }
  } finally { l.dispose(); }
}

export async function topology_repair_cases(check: (name: string, run: () => Promise<void>) => Promise<void>) {
  await check("H0b exact reviewer reproducer: entry grant revoked during definition inspection", async () => { review_admission_management(); });
  await check("H0b exact reviewer reproducer: CSS-free scoped durable entry loses only scopes", review_missing_scopes);
  await check("H0b definition, batch and CSS inspection retain the entry grant and preserve replacement work", async () => {
    for (const surface of ["definition", "batch", "css", "core-batch"] as const)
      for (const activity of ["release", "same-owner", "replacement", "replacement-work"] as const) {
        const map = initial(), a = authority(map), owner = {}, other = {};
        a.claimManagement(owner); let verify = unchanged(map), entered = false;
        const revoke = () => {
          if (entered) return; entered = true;
          verify(); a.releaseManagement(owner);
          if (activity === "same-owner") a.claimManagement(owner);
          if (activity === "replacement" || activity === "replacement-work") a.claimManagement(other);
          if (activity === "replacement-work") {
            const inner = prepare(map, other, { inner: { data: 7 } }); a.accept(inner.transition, "isolate", inner.afterInstall);
          }
          verify = unchanged(map);
        };
        const inputs: LiveMapDefinitions = surface === "definition" ? { earlier: { data: 1 }, get page() { revoke(); return page; } }
          : surface === "batch" ? new Proxy({ earlier: { data: 1 }, page }, { ownKeys(target) { revoke(); return Reflect.ownKeys(target); } })
          : { earlier: { data: 1 }, page };
        try {
          if (surface === "core-batch") {
            const definitions = new Proxy([{ name: "earlier", family: "data" as const, root: hsonTransform.fromJson(1).toNode(), hsonSchema: Hson.schema`<type "data">` }],
              { get(target, key, receiver) { if (key === "length") revoke(); return Reflect.get(target, key, receiver); } });
            assert.throws(() => a.prepareAddLibrariesManaged(owner, definitions), /management|authority|changed/i);
          } else {
            const css: NonNullable<Parameters<typeof prepare>[3]> = surface === "css"
              ? { get page() { revoke(); return parse_document_stylesheet('main{color:red}', []); } } : {};
            assert.throws(() => prepare(map, owner, inputs, css), /management|authority|changed/i);
          }
          assert.ok(entered); verify(); assert.throws(() => map.data.must("earlier")); assert.throws(() => map.doc.must("page"));
          assert.equal(map.rev, activity === "replacement-work" ? 1 : 0);
          if (activity === "replacement-work") { const inner = map.data.must("inner"); assert.ok("snap" in inner); assert.equal(inner.snap(), 7); }
          a.releaseManagement(owner); a.releaseManagement(other); a.claimManagement(owner);
          const healthy = prepare(map, owner, { later: page }); a.accept(healthy.transition, "isolate", healthy.afterInstall);
          assert.equal(map.rev, activity === "replacement-work" ? 2 : 1); assert.equal(scopes(map, "later")?.occurrences.length, 4);
        } finally { a.releaseManagement(owner); a.releaseManagement(other); }
      }
  });
  await check("H0b reserved topology candidates retain the original grant through installation", async () => {
    for (const reserved of [false, true]) for (const reacquire of [false, true]) {
      const map = initial(), a = authority(map), owner = {}; a.claimManagement(owner);
      const p = prepare(map, owner, { earlier: { data: 1 }, page }), release = reserved ? a.reserve(p.transition) : () => {};
      a.releaseManagement(owner); if (reacquire) a.claimManagement(owner); const verify = unchanged(map);
      try { assert.throws(() => a.accept(p.transition, "isolate", p.afterInstall), /management authority changed/); verify(); }
      finally { release(); a.discard(p.transition); a.releaseManagement(owner); }
    }
  });
  await check("H0b historic flat and CSS-free, styled, nested, repeated, unnamed and explicitly empty scoped entries restore", async () => {
    const f = await topology_contract_fixture(), flat = f.state.commits[0]!.commit.topology!;
    const entry = flat.operation.libraries[0]!;
    assert.deepEqual(Object.keys(entry), ["name", "mode", "schema", "root", "quads"]);
    assert.equal(entry.documentContract, undefined); assert.equal(entry.scopes, undefined);
    const map = initial(); assert.deepEqual(replay(map, flat), flat); assert.equal(scopes(map, "flat"), undefined);
    const declared = f.state.commits.slice(1).map(record => record.commit.topology!.operation.libraries[0]!);
    assert.ok(declared.every(e => e.documentContract === "scoped" && Object.hasOwn(e, "scopes")));
    assert.deepEqual(declared[2]!.scopes, { document: [], occurrences: [], subjects: [] });
    await verify_topology_contract_restart(f);
  });
  await check("H0b live encoding and durable replay agree on classification and complete evidence", async () => {
    const f = await topology_contract_fixture(), scoped = f.state.commits[1]!.commit.topology!;
    const corruptions: ((value: any) => void)[] = [
      x => delete x.operation.libraries[0].scopes,
      x => x.operation.libraries[0].scopes = undefined,
      x => delete x.operation.libraries[0].css,
      x => x.operation.libraries[0].quads = [],
      x => delete x.operation.libraries[0].documentContract,
      x => x.operation.libraries[0].documentContract = "flat",
      x => x.operation.libraries[0].documentContract = "unknown",
      x => x.operation.libraries[0].documentContract = ["scoped", "scoped"],
      x => x.operation.libraries[0].scopes.occurrences.push(x.operation.libraries[0].scopes.occurrences[0]),
      x => x.operation.libraries[0].scopes.document.push(x.operation.libraries[0].scopes.document[0]),
      x => x.operation.libraries[0].scopes.subjects.push({ name: "_000000000", path: [0] }),
    ];
    const source = initial(), a = authority(source), previous = a.hostedRegistry(); source.addLibraries({ page });
    const commit = make_hosted_topology_commit(a.hostedPosition().authority, previous, a.hostedRegistry(), scoped, 0);
    for (const corrupt of corruptions) {
      const bad: LiveMapLibraryAddOperation = structuredClone(scoped); corrupt(bad);
      const map = initial(), verify = unchanged(map); assert.throws(() => replay(map, bad)); verify();
      assert.throws(() => encode({ ...commit, topology: bad }));
      const durable = structuredClone(f.state); corrupt(durable.commits[1]!.commit.topology!);
      f.adapter.seed(f.state.checkpoint.logicalMapId, durable);
      await assert.rejects(resume(f.state.checkpoint.logicalMapId, { persistence: f.adapter, scopedDocuments: true }), /invalid/);
    }
    // A forged scoped contract on a historic flat document or a data Library
    // cannot supply authority to missing evidence.
    const flat: LiveMapLibraryAddOperation = structuredClone(f.state.commits[0]!.commit.topology!);
    Object.assign(flat.operation.libraries[0]!, { documentContract: "scoped" });
    const map = initial(), verify = unchanged(map); assert.throws(() => replay(map, flat)); verify();
    const forged = structuredClone(scoped); Object.assign(forged.operation.libraries[0]!, { mode: "data-object" });
    assert.throws(() => replay(map, forged));
  });
}
