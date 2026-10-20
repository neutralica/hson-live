import { HsonSchema } from "../../src/api/schema/hson-schema.ts";
import assert from "node:assert/strict";
import { hsonLiveMap, hsonTransform, Hson, enable_interactions, add_interaction } from "../../src/index.ts";
import { is_Node } from "../../src/core/node-guards.ts";
import { internal_livemap_aggregate_authority as authority } from "../../src/api/livemap/livemap.internal.ts";
import { create_locus_hosted_aggregate_internal as create, type LocusHostedAggregateGateInput, type LocusHostedAggregateStageWriter } from "../../src/api/locus/locus.aggregate.ts";
import { prepare_locus_scoped_commit_internal as encode } from "../../src/api/locus/locus.scoped-preparation.internal.ts";
import { make_locus_hosted_projection_policy, normalize_locus_effective_projection } from "../../src/api/locus/locus.projection.ts";
import { project_locus_live_transition_internal } from "../../src/api/locus/locus.live-projection.ts";
import { make_portable_aggregate_commit, decode_hosted_commit, make_hosted_commit } from "../../src/api/livemap/livemap.hosted.ts";
import { encode_document_scoped_effects } from "../../src/api/livemap/livemap.document.scoped-effects.ts";
import { document_scoped_libraries_semantically_equal as equal } from "../../src/api/livemap/livemap.document.scoped-portable.ts";
import { set_livemap_quid_candidate_source_for_tests as allocator } from "../../src/api/livemap/livemap.quid-allocation.ts";
import { canonical_graph_equal } from "../../src/api/livemap/livemap.document.install.ts";
import { validate_document_path as path } from "../../src/api/livemap/livemap.document.path.ts";
import type { LiveMapGraphOp } from "../../src/types/livemap.types.ts";

const node = (text: string) => { const value = hsonTransform.fromHson(text).toNode().$_content[0]; assert.ok(is_Node(value)); return value; };
const connector = (member = "panel") => node(`<hson-part lib="parts" at="${member}"/>`);
const document = (writer: LocusHostedAggregateStageWriter) => { const doc = writer.doc.must("page"); assert.equal(doc.mode, "document"); if (doc.mode !== "document") throw Error(); return doc; };
const insert = (writer: LocusHostedAggregateStageWriter, index = 0, member = "panel") => document(writer).content.insert({ kind: "path", path: path([0, 0]) }, index, connector(member));
const replace = (writer: LocusHostedAggregateStageWriter, index = 0, member = "panel") => document(writer).content.replace({ kind: "path", path: path([0, 0]) }, index, connector(member));
function fixture() {
  const map = hsonLiveMap.fromLibraries({
    parts: { parts: {
      leaf: { kind: "document", document: '<b @:root <span @:label "visible"/>/>', css: ':scope{color:blue} [hson\\:quad="label"]{opacity:.5}' },
      panel: { kind: "document", document: '<section @:root <div @:body <hson-part @:child at="leaf"/>/>/>', css: ':scope{color:red}' },
      plain: { kind: "document", document: '<i/>' },
      named: { kind: "document", document: '<i @:label/>' },
      secret: { kind: "document", document: '<strong "PRIVATE_DEFINITION_SENTINEL"/>' },
    } }, page: { document: '<main <footer/>/>' }, other: { data: { n: 0 } },
  });
  const a = authority(map), library = a.libraries()[1]!;
  return { map, a, library };
}
async function projection(f: ReturnType<typeof fixture>) {
  const initial = f.a.captureHosted();
  const policy = make_locus_hosted_projection_policy(initial.registry, initial.authority,
    [{ name: "parts", ownership: "private" }, { name: "page", ownership: "shared" }, { name: "other", ownership: "shared" }],
    undefined, () => ({ libraries: ["page"] }));
  return normalize_locus_effective_projection(policy, { libraries: ["page", "parts"] });
}
const operation = (member = "panel"): Extract<LiveMapGraphOp, { op: "insert-content" }> => ({ domain: "graph", op: "insert-content", target: { kind: "path", path: path([0, 0]) }, index: 0, content: connector(member) });
const write = (f: ReturnType<typeof fixture>, op = operation()) => ({ target: { domain: "application" as const, library: f.library, path: path([0, 0]) }, kind: "graph" as const, operation: op, publicStaged: true as const });

function unchanged(f: ReturnType<typeof fixture>, run: () => void) {
  const roots = f.a.libraries().map(id => [id, f.a.root(id)] as const), graphs = roots.map(([, root]) => JSON.stringify(root));
  const overlay = f.a.documentOverlay(f.library), scopes = f.a.documentScopes(f.library), css = f.a.stylesheet(f.library);
  const state = f.a.scopedDocumentState(f.library), ledger = f.a.identityEpoch().issued(), epoch = f.a.identityEpoch().current();
  const revision = f.map.rev, position = f.a.hostedPosition(), projection = f.a.clientProjection(), registry = f.a.hostedRegistry();
  let observations = 0, positions = 0, installations = 0;
  const off = f.map.commits.observe(() => observations++), stop = f.a.observeAuthorityPosition(() => positions++);
  const stopInstalled = f.a.observeAuthorityPosition(() => installations++, "installed");
  try { run(); } finally { off(); stop(); stopInstalled(); }
  assert.equal(f.map.rev, revision); assert.deepEqual(f.a.hostedPosition(), position); assert.deepEqual(f.a.clientProjection(), projection);
  assert.equal(f.a.hostedRegistry(), registry); assert.equal(f.a.identityEpoch().issued(), ledger); assert.equal(f.a.identityEpoch().current(), epoch);
  assert.equal(f.a.documentOverlay(f.library), overlay); assert.equal(f.a.documentScopes(f.library), scopes); assert.equal(f.a.stylesheet(f.library), css);
  assert.ok(equal(state, f.a.scopedDocumentState(f.library))); assert.deepEqual([observations, positions, installations], [0, 0, 0]);
  roots.forEach(([id, root], index) => { assert.equal(f.a.root(id), root); assert.equal(JSON.stringify(root), graphs[index]); });
}

export async function locus_scoped_cases(check: (name: string, run: () => Promise<void>) => Promise<void>) {
  await check("mixed preparation keeps flat effects ordinary and rejection preserves every identity and topology owner", async () => {
    for (const cssOnly of [false, true]) {
      const map = hsonLiveMap.fromLibraries({ parts: { parts: { x: { kind: "document", document: '<b @:root/>', css: ':scope{padding:3px}' } } },
        page: { document: '<main <hson-part @:part lib="parts" at="x"/>/>' }, flat: { document: '<html <head/> <body/>/>' } });
      const a = authority(map), ids = ["page", "flat"].map(name => a.libraries()[a.hostedRegistry().libraries.findIndex(e => e.name === name)]!);
      const ledger = a.identityEpoch().issued();
      let gates = 0, observations = 0;
      const stop = map.commits.observe(() => observations++);
      const locus = create({ map, scopedDocuments: true, prepareGate(input) {
        gates++;
        assert.equal(map.rev, 0); assert.equal(observations, 0);
        assert.equal(a.identityEpoch().issued(), ledger);
        assert.equal(a.documentScopes(ids[1]!), undefined);
        assert.equal(a.documentScopes(ids[0]!)!.occurrences.length, 1);
        assert.deepEqual(input.commit.replay.operations.map(entry => [entry.library, entry.scoped !== undefined]), [["page", true], ["flat", false]]);
        assert.deepEqual(encode(map, input.transition).operations.map(entry => entry.domain), ["document", cssOnly ? "css" : "graph"]);
      } });
      try {
        await locus.stage(w => {
          const page = w.doc.must("page"), flat = w.doc.must("flat");
          if (page.mode !== "document" || flat.mode !== "document") throw Error("Expected documents");
          if (cssOnly) { page.css.sel("main").setProp("color", "blue"); flat.css.sel("body").setProp("color", "red"); }
          else { page.at([]).asElement().attrs.set("title", "s"); flat.at([]).asElement().attrs.set("title", "f"); }
        });
        assert.equal(gates, 1); assert.equal(map.rev, 1); assert.equal(observations, 1);
        assert.equal(a.documentScopes(ids[1]!), undefined);
        assert.equal(a.captureSemanticCheckpoint().libraries.find(entry => entry.name === "flat")!.scopes, undefined);
        const before = ids.map(id => ({ root: a.root(id), graph: JSON.stringify(a.root(id)), overlay: a.documentOverlay(id),
          css: a.stylesheet(id), scopes: a.documentScopes(id) }));
        const issued = a.identityEpoch().issued(), epoch = a.identityEpoch().current();
        await assert.rejects(locus.stage(w => {
          const page = w.doc.must("page"), flat = w.doc.must("flat");
          if (page.mode !== "document" || flat.mode !== "document") throw Error("Expected documents");
          flat.css.clearAll(); page.at([0]).replace(node('<hson-part lib="parts" at="x"/>'));
          page.css.clearAll(); flat.at([99]).asElement().attrs.set("invalid", true);
        }));
        assert.equal(a.identityEpoch().issued(), issued); assert.equal(a.identityEpoch().current(), epoch);
        assert.equal(map.rev, 1); assert.equal(observations, 1); assert.equal(gates, 1);
        ids.forEach((id, index) => {
          const state = before[index]!;
          assert.equal(a.root(id), state.root); assert.equal(JSON.stringify(a.root(id)), state.graph);
          assert.equal(a.documentOverlay(id), state.overlay); assert.equal(a.stylesheet(id), state.css);
          assert.equal(a.documentScopes(id), state.scopes);
        });
      } finally { stop(); locus.dispose(); }
    }
  });
  await check("actual Locus preparation carries complete ordered Library evidence and excludes private definitions", async () => {
    const f = fixture(), effective = await projection(f), initial = f.a.scopedDocumentState(f.library);
    const r = hsonLiveMap.fromLibraries({ page: { document: '<aside/>' } }), ra = authority(r), rl = ra.libraries()[0]!;
    const before = ra.prepareScopedDocumentRestoration(rl, initial);
    let gate!: LocusHostedAggregateGateInput, portable!: ReturnType<typeof encode>, projected!: ReturnType<typeof encode>;
    const locus = create({ map: f.map, scopedDocuments: true,
      prepareGate(input) {
        gate = input; portable = encode(f.map, input.transition); projected = encode(f.map, input.transition, effective);
        for (const op of [input.commit.operations[0]!.operation, input.transition.commit.operations[0]!.operation]) {
          assert.ok("domain" in op && op.domain === "graph" && op.op === "insert-content");
          if (!("domain" in op) || op.domain !== "graph" || op.op !== "insert-content" || !is_Node(op.content)) throw Error();
          const content = op.content;
          assert.throws(() => { content.$_tag = "forged"; }, TypeError);
        }
        assert.equal(f.map.rev, 0); assert.ok(equal(initial, f.a.scopedDocumentState(f.library)));
      },
      gate(input) {
        assert.equal(input, gate); assert.deepEqual(encode(f.map, input.transition), portable);
        assert.throws(() => f.a.acquireLocalDocumentIdentity(f.library, path([0]), "ABCDEFGHIJ"), /reserved|pending/);
      },
    });
    const accepted = await locus.stage(writer => {
      insert(writer); insert(writer, 1);
      const parts = writer.parts.must("parts"); if (String(parts.mode) === "document") throw Error();
      parts.at(["secret", "document"]).set( '<strong "UPDATED_PRIVATE_SENTINEL"/>');
    });
    assert.equal(accepted, gate.commit); assert.equal(f.map.rev, 1);
    assert.deepEqual(projected.operations.map(entry => entry.library), ["page", "page"]);
    assert.equal(projected.prevRev, 0); assert.equal(projected.rev, 1);
    assert.equal(projected.authority.logicalMapId, accepted!.authority.logicalMapId);
    const effects = accepted!.replay.operations.flatMap(entry => entry.scoped === undefined ? [] : [entry.scoped]);
    assert.deepEqual(effects.map(effect => effect.ordinal), [0, 1]);
    assert.equal(effects[0]!.after, effects[1]!.before);
    assert.equal(effects[0]!.created.length, 2); assert.equal(effects[0]!.styles.length, 2);
    assert.ok(effects[0]!.styles.every(style => style.subjects.length > 0));
    const reconstructed = ra.prepareScopedDocumentEffectReplay(before, encode_document_scoped_effects(effects));
    assert.ok(equal(f.a.scopedDocumentState(f.library), ra.captureScopedDocument(reconstructed)));
    const wire = JSON.stringify(projected);
    assert.ok(!wire.includes('"quid"') && !wire.includes('"witness"') && !wire.includes('"issued"'));
    assert.throws(() => { Object.assign(effects[0]!, { ordinal: 9 }); }, TypeError);
    assert.throws(() => decode_hosted_commit(accepted!, f.a.hostedRegistry(), new Map()));
    assert.ok(!wire.includes("PRIVATE_SENTINEL") && !wire.includes("PRIVATE_DEFINITION_SENTINEL"));
    assert.ok(!wire.includes('"library":"parts"') && !wire.includes('"at"') && !wire.includes('"lineage":['));
    assert.throws(() => encode(f.map, gate.transition), /stale/);
    assert.throws(() => make_portable_aggregate_commit(accepted!), /Echo/);
    assert.equal(project_locus_live_transition_internal(accepted!, effective).kind, "commit");
    assert.throws(() => f.map.capture(), /Echo\/checkpoint/);
    assert.ok(f.a.captureSemanticCheckpoint().libraries.some(entry => entry.scopes !== undefined));
    assert.throws(() => f.a.captureDocumentSsr(f.library, []), /inactive/);
    locus.dispose();
  });
  await check("graph-identical namespace and occurrence-only replacements advance authoritative revisions", async () => {
    const f = fixture(), commits: LocusHostedAggregateGateInput[] = [];
    const locus = create({ map: f.map, scopedDocuments: true, prepareGate: input => { commits.push(input); } });
    await locus.stage(writer => insert(writer, 0, "plain"));
    const before = f.a.scopedDocumentState(f.library);
    await locus.stage(writer => replace(writer, 0, "plain"));
    await locus.stage(writer => replace(writer, 0, "plain"));
    await locus.stage(writer => replace(writer, 0, "named"));
    assert.deepEqual(commits.map(input => [input.baseRevision, input.nextRevision]), [[0, 1], [1, 2], [2, 3], [3, 4]]);
    assert.ok(canonical_graph_equal(before.root, f.a.scopedDocumentState(f.library).root));
    for (const input of commits.slice(1)) {
      const effect = input.commit.replay.operations[0]!.scoped!;
      assert.equal(effect.retired.length, 1); assert.equal(effect.created.length, 1); assert.equal(effect.ordinal, 0);
      assert.equal(effect.styles.length, 0); assert.equal(input.commit.changed, true);
    }
    assert.equal(commits[1]!.commit.replay.operations[0]!.scoped!.before, commits[1]!.commit.replay.operations[0]!.scoped!.after);
    assert.equal(f.a.scopedDocumentState(f.library).scopes.occurrences[0]!.bindings[0]!.name, "label");
    locus.dispose();
  });
  await check("failed operation prefix and durable refusal leave all installed state and observations unchanged", async () => {
    const f = fixture(), initial = f.a.scopedDocumentState(f.library), issued = f.a.identityEpoch().issued();
    let observations = 0, gates = 0;
    const off = f.map.commits.observe(() => observations++);
    const locus = create({ map: f.map, scopedDocuments: true, gate() { gates++; throw Error("durable refusal"); } });
    await assert.rejects(locus.stage(writer => { insert(writer); insert(writer, 1, "missing"); }), /Unknown Part/);
    assert.equal(gates, 0);
    await assert.rejects(locus.stage(writer => insert(writer)), /durable refusal/);
    assert.equal(gates, 1); assert.equal(f.map.rev, 0); assert.equal(f.a.identityEpoch().issued(), issued);
    assert.equal(observations, 0); assert.ok(equal(initial, f.a.scopedDocumentState(f.library)));
    off(); locus.dispose();
  });
  await check("same authority rejects forged, duplicate, stale and competing prepared transitions", async () => {
    const f = fixture(), owner = {};
    f.a.claimManagement(owner);
    const first = f.a.prepareManaged(owner, [write(f)], true), duplicate = f.a.prepareManaged(owner, [write(f)], true);
    assert.throws(() => encode(f.map, { ...first }), /another authority/);
    const foreign = fixture(); assert.throws(() => encode(foreign.map, first), /another authority/);
    const release = f.a.reserve(first);
    assert.throws(() => f.a.accept(duplicate), /fenced/);
    assert.throws(() => f.a.prepareManaged(owner, [write(f)], true), /reserved/);
    f.a.accept(first); release();
    assert.throws(() => f.a.accept(first), /already accepted/);
    assert.throws(() => f.a.accept(duplicate), /stale/);
    assert.throws(() => encode(f.map, duplicate), /stale/);
    f.a.releaseManagement(owner);
  });
  for (const reserved of [false, true]) for (const revocation of ["release", "replacement", "same-owner reacquisition"]) {
    await check(`scoped Locus candidate rejects ${revocation} after preparation${reserved ? " while reserved" : ""}`, async () => {
      const f = fixture(), owner = {}, nextOwner = revocation === "same-owner reacquisition" ? owner : {};
      f.a.claimManagement(owner);
      const initial = f.a.scopedDocumentState(f.library), root = f.a.root(f.library), overlay = f.a.documentOverlay(f.library);
      const ledger = f.a.identityEpoch().issued(), css = f.a.stylesheet(f.library), scopes = f.a.documentScopes(f.library);
      let observations = 0, installations = 0;
      const off = f.map.commits.observe(() => observations++), stop = f.a.observeAuthorityPosition(() => installations++, "installed");
      const pending = f.a.prepareManaged(owner, [write(f)], true);
      const release = reserved ? f.a.reserve(pending) : () => {};
      try {
        f.a.releaseManagement(owner);
        if (revocation !== "release") f.a.claimManagement(nextOwner);
        assert.throws(() => f.a.accept(pending), /management|authority|stale|installation/i);
        assert.equal(f.map.rev, 0); assert.equal(f.a.identityEpoch().issued(), ledger);
        assert.equal(f.a.root(f.library), root); assert.equal(f.a.documentOverlay(f.library), overlay);
        assert.equal(f.a.stylesheet(f.library), css); assert.equal(f.a.documentScopes(f.library), scopes);
        assert.ok(equal(initial, f.a.scopedDocumentState(f.library))); assert.equal(observations, 0); assert.equal(installations, 0);
        release();
        if (revocation === "release") f.a.claimManagement(nextOwner);
        f.a.accept(f.a.prepareManaged(nextOwner, [write(f)], true));
        assert.equal(f.map.rev, 1); assert.equal(observations, 1); assert.equal(installations, 1);
        assert.throws(() => f.a.accept(pending), /stale|discarded/);
      } finally { release(); off(); stop(); f.a.releaseManagement(owner); f.a.releaseManagement(nextOwner); }
    });
  }
  for (const empty of [false, true]) for (const activity of ["release", "different-owner reacquisition", "same-owner reacquisition", "same-owner replacement", "retained grant"] as const) {
    await check(`scoped aggregate captures before inspecting ${empty ? "empty" : "changed"} writes: ${activity}`, async () => {
      const f = fixture(), owner = {}, replacement = activity === "different-owner reacquisition" ? {} : owner;
      f.a.claimManagement(owner);
      let entered = false;
      const writes = new Proxy(empty ? [] : [write(f)], {
        get(target, key, receiver) {
          if (!entered && key === "length") {
            entered = true;
            if (activity === "retained grant") f.a.releaseManagement({});
            else {
              if (activity !== "same-owner replacement") f.a.releaseManagement(owner);
              if (activity !== "release") f.a.claimManagement(replacement);
            }
          }
          return Reflect.get(target, key, receiver);
        },
      });
      try {
        if (activity === "retained grant") {
          const pending = f.a.prepareManaged(owner, writes, true);
          assert.equal(pending.commit.changed, !empty);
          f.a.accept(pending);
          assert.equal(f.map.rev, empty ? 0 : 1);
        } else unchanged(f, () => assert.throws(() => f.a.prepareManaged(owner, writes, true), /management|authority|stale/i));
        assert.ok(entered);
      } finally { f.a.releaseManagement(owner); f.a.releaseManagement(replacement); }
    });
  }
  for (const empty of [false, true]) for (const reserved of [false, true]) for (const activity of ["release", "different-owner reacquisition", "same-owner reacquisition", "same-owner replacement", "retained grant"] as const) {
    await check(`scoped ${empty ? "empty" : "unchanged"} candidate validates its original grant${reserved ? " while reserved" : ""}: ${activity}`, async () => {
      const f = fixture(), owner = {}, replacement = activity === "different-owner reacquisition" ? {} : owner;
      f.a.claimManagement(owner);
      // A real unchanged graph operation, as well as empty aggregate input,
      // must retain authority even though neither invokes installation.
      const noop = { ...write(f), operation: { domain: "graph" as const, op: "remove-attr" as const,
        target: { kind: "path" as const, path: path([0]) }, name: "missing" } };
      const pending = f.a.prepareManaged(owner, empty ? [] : [noop], true);
      assert.equal(pending.commit.changed, false);
      const release = reserved ? f.a.reserve(pending) : () => {};
      try {
        if (activity === "retained grant") f.a.releaseManagement({});
        else {
          if (activity !== "same-owner replacement") f.a.releaseManagement(owner);
          if (activity !== "release") f.a.claimManagement(replacement);
        }
        unchanged(f, () => {
          if (activity === "retained grant") assert.equal(f.a.accept(pending).commit, pending.commit);
          else assert.throws(() => f.a.accept(pending), /management|authority|stale|installation/i);
        });
        release();
        if (activity !== "retained grant") {
          f.a.releaseManagement(replacement); f.a.claimManagement(owner);
        }
        unchanged(f, () => {
          const healthy = f.a.prepareManaged(owner, [noop], true), release = reserved ? f.a.reserve(healthy) : () => {};
          try { assert.equal(f.a.accept(healthy).commit.changed, false); } finally { release(); }
        });
      } finally { release(); f.a.releaseManagement(owner); f.a.releaseManagement(replacement); }
    });
  }
  await check("reentrant identity allocation preserves independent accepted work and rejects the outer candidate", async () => {
    const f = fixture(), owner = {}, initial = f.a.scopedDocumentState(f.library); f.a.claimManagement(owner);
    let entered = false;
    allocator(f.a.identityEpoch().owner, () => {
      if (!entered) {
        entered = true;
        const other = f.a.libraries()[2]!;
        f.a.accept(f.a.prepareManaged(owner, [{ kind: "set", target: { domain: "application", library: other, path: ["n"] }, value: 7 }]));
      }
      return "ABCDEFGHIJ";
    });
    try { assert.throws(() => f.a.prepareManaged(owner, [write(f)], true), /changed/); }
    finally { allocator(f.a.identityEpoch().owner, undefined); f.a.releaseManagement(owner); }
    assert.equal(f.map.rev, 1); assert.equal(f.map.data.must("other").snap(["n"]), 7);
    assert.ok(equal(initial, f.a.scopedDocumentState(f.library)));
  });
  await check("complete envelopes reject reordered, duplicated, missing and mismatched Library evidence", async () => {
    const f = fixture(), owner = {}; f.a.claimManagement(owner);
    const initial = f.a.captureHosted();
    const transition = f.a.prepareManaged(owner, [write(f), write(f, { ...operation(), index: 1 })], true);
    const entries = transition.commit.operations;
    const bindings = new Map(initial.registry.libraries.map((entry, index) => [f.a.libraries()[index]!, {
      name: entry.name, mode: entry.mode, schema: HsonSchema.fromHson(entry.schema), identity: f.a.libraries()[index]!,
    }]));
    const build = (operations: typeof entries) => make_hosted_commit(initial.authority, initial.registry, bindings,
      { changed: true, prevRev: 0, rev: 1, operations });
    assert.throws(() => build([...entries].reverse()), /order/);
    assert.throws(() => build([entries[0]!, entries[0]!]), /order/);
    const { scoped: _effect, ...missing } = entries[1]!;
    assert.throws(() => build([entries[0]!, missing]), /Missing/);
    assert.throws(() => build([{ ...entries[0]!, target: { domain: "application", library: f.a.libraries()[0]!, path: [] } }]), /document|incompatible|disagree/);
    const variants = [
      { ...transition.commit.hosted!, prevRev: 9, rev: 10 },
      { ...transition.commit.hosted!, registryDigest: "forged" },
      { ...transition.commit.hosted!, authority: { logicalMapId: "forged", incarnationId: "forged" } },
      { ...transition.commit.hosted!, replay: { operations: [...transition.commit.hosted!.replay.operations].reverse() } },
    ];
    for (const hosted of variants) assert.throws(() => encode(f.map, { ...transition, commit: { ...transition.commit, hosted } }), /another authority/);
    f.a.discard(transition); f.a.releaseManagement(owner); assert.equal(f.map.rev, 0);
  });
  await check("CSS mixed preparation and dynamic occurrence evidence support subsequent writes", async () => {
    const f = fixture(); let gates = 0;
    const locus = create({ map: f.map, scopedDocuments: true, gate() { gates++; } });
    await locus.stage(writer => { insert(writer); document(writer).css.stylesheet("main{color:red}"); });
    assert.equal(gates, 1); assert.equal(f.map.rev, 1); locus.dispose();
    gates = 0;
    // Dynamic construction now installs the same complete evidence as initial composition.
    const initial = hsonLiveMap.fromLibraries({ parts: { parts: { leaf: { kind: "document", document: '<b/>' } } } });
    initial.addLibraries({ page: { document: '<main <hson-part lib="parts" at="leaf"/>/>' } });
    const blocked = create({ map: initial, scopedDocuments: true, gate() { gates++; } });
    await blocked.stage(writer => document(writer).attrs.set({ kind: "path", path: path([0]) }, "title", "new"));
    assert.equal(gates, 1); blocked.dispose();
  });
  await check("durable suspension reserves the complete batch and queues the next revision", async () => {
    const f = fixture();
    let release!: () => void, entered!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    let gates = 0, observations = 0;
    const off = f.map.commits.observe(() => observations++);
    const locus = create({ map: f.map, scopedDocuments: true, async gate(input) {
      if (++gates === 1) { entered(); await pending; }
      assert.equal(encode(f.map, input.transition).rev, input.nextRevision);
    } });
    const first = locus.stage(writer => insert(writer, 0, "plain")); await started;
    const second = locus.stage(writer => replace(writer, 0, "plain"));
    await Promise.resolve(); assert.equal(f.map.rev, 0); assert.equal(gates, 1); assert.equal(observations, 0);
    assert.throws(() => f.a.acquireLocalDocumentIdentity(f.library, path([0]), "ABCDEFGHIJ"), /reserved/);
    release(); await first; await second;
    assert.equal(f.map.rev, 2); assert.equal(gates, 2); assert.equal(observations, 2);
    off(); locus.dispose();
  });
  await check("private projection retains existing interaction grants and filters hidden effects", async () => {
    const f = fixture(); enable_interactions(f.map);
    const listener = { event: "click", target: "element" as const, capture: false, once: false, passive: false,
      missingTarget: "ignore" as const, preventDefault: false, stopPropagation: false, stopImmediatePropagation: false };
    add_interaction(f.map, { id: "footer", subject: { library: "page", path: [0, 0, 0] }, listener, kind: "browser", key: "footer", args: null });
    const initial = f.a.captureHosted();
    const policy = make_locus_hosted_projection_policy(initial.registry, initial.authority,
      [{ name: "parts", ownership: "private" }, { name: "page", ownership: "shared" }, { name: "other", ownership: "shared" }],
      undefined, () => ({ libraries: ["page"], systemFeatures: ["interactions"] }));
    const granted = await normalize_locus_effective_projection(policy, { libraries: ["page"], systemFeatures: ["interactions"] });
    const absent = await normalize_locus_effective_projection(policy, { libraries: ["page"] });
    const locus = create({ map: f.map, scopedDocuments: true, prepareGate(input) {
      const complete = encode(f.map, input.transition, granted), without = encode(f.map, input.transition, absent);
      assert.deepEqual(complete.operations.map(op => op.library), ["page", "@hson/canonical-interactions"]);
      assert.deepEqual(without.operations.map(op => op.library), ["page"]);
      assert.ok(JSON.stringify(complete.operations[1]).includes("footer"));
      assert.ok(!JSON.stringify(complete).includes("PRIVATE_DEFINITION_SENTINEL"));
    } });
    await locus.stage(writer => insert(writer, 0, "plain")); locus.dispose();
  });
  await check("Schema validates the final transaction while effects retain the complete operation prefix", async () => {
    const map = hsonLiveMap.fromLibraries({ parts: { parts: { plain: { kind: "document", document: '<i/>' } } },
      page: { document: '<main <footer/>/>', schema: Hson.schema`<type "document" tag "main" content <sequence [<tag "footer" content "empty">]>>` } });
    const a = authority(map), library = a.libraries()[1]!, before = a.scopedDocumentState(library);
    const locus = create({ map, scopedDocuments: true });
    const accepted = await locus.stage(writer => {
      insert(writer, 0, "plain"); document(writer).content.remove({ kind: "path", path: path([0, 0]) }, 0);
    });
    assert.equal(accepted!.replay.operations.length, 2); assert.equal(map.rev, 1);
    assert.ok(equal(before, a.scopedDocumentState(library))); locus.dispose();
  });
  await check("identical nested styled replacements retain distinct commits and immutable earlier evidence", async () => {
    const f = fixture(), evidence: ReturnType<typeof encode>[] = [];
    const locus = create({ map: f.map, scopedDocuments: true, prepareGate(input) { evidence.push(encode(f.map, input.transition)); } });
    await locus.stage(writer => insert(writer));
    const initial = f.a.scopedDocumentState(f.library), retained = JSON.stringify(evidence[0]);
    await locus.stage(writer => replace(writer)); await locus.stage(writer => replace(writer));
    assert.ok(equal(initial, f.a.scopedDocumentState(f.library)));
    assert.deepEqual(evidence.map(batch => [batch.prevRev, batch.rev]), [[0, 1], [1, 2], [2, 3]]);
    for (const batch of evidence.slice(1)) {
      const entry = batch.operations[0]!; assert.equal(entry.domain, "document");
      if (entry.domain !== "document" || !("retired" in entry.effect)) throw Error();
      assert.equal(entry.effect.retired.length, 2); assert.equal(entry.effect.created.length, 2);
      assert.equal(entry.effect.before, entry.effect.after); assert.equal(entry.effect.styles.length, 2);
    }
    assert.equal(JSON.stringify(evidence[0]), retained); locus.dispose();
  });
  await check("interleaved document Libraries keep distinct ownership and per-Library ordinals", async () => {
    const map = hsonLiveMap.fromLibraries({ parts: { parts: { plain: { kind: "document", document: '<i @:root/>' } } },
      page: { document: '<main <footer/>/>' }, second: { document: '<main <footer/>/>' } });
    const a = authority(map);
    const locus = create({ map, scopedDocuments: true, prepareGate(input) {
      const entries = encode(map, input.transition).operations;
      assert.deepEqual(entries.map(entry => [entry.library, entry.domain === "document" && "ordinal" in entry.effect ? entry.effect.ordinal : -1]),
        [["page", 0], ["second", 0], ["page", 1]]);
    } });
    await locus.stage(writer => {
      insert(writer, 0, "plain");
      const second = writer.doc.must("second"); if (second.mode !== "document") throw Error();
      second.content.insert({ kind: "path", path: path([0, 0]) }, 0, connector("plain"));
      insert(writer, 1, "plain");
    });
    assert.equal(a.scopedDocumentState(a.libraries()[1]!).scopes.occurrences.length, 2);
    assert.equal(a.scopedDocumentState(a.libraries()[2]!).scopes.occurrences.length, 1);
    locus.dispose();
  });
  await check("public managed Part delivery remains blocked while ordinary hosted commits remain available", async () => {
    const f = fixture(); let gates = 0;
    const locus = create({ map: f.map, gate() { gates++; } });
    await assert.rejects(locus.stage(writer => insert(writer, 0, "plain")), /scoped evidence.*Echo/);
    assert.equal(f.map.rev, 0); assert.equal(gates, 0);
    const accepted = await locus.stage(writer => document(writer).attrs.set({ kind: "path", path: path([0]) }, "title", "ordinary"));
    assert.ok(make_portable_aggregate_commit(accepted!)); assert.equal(gates, 1);
    locus.dispose();
  });
}
