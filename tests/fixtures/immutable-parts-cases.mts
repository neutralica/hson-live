import assert from "node:assert/strict";
import { hsonLiveMap } from "../../src/api/livemap/index.js";
import { internal_livemap_aggregate_authority as owner } from "../../src/api/livemap/livemap.internal.js";
import { require_livemap_library_internal, make_livemap_client_composition_from_portable_aggregate_internal } from "../../src/api/livemap/livemap.libraries.js";
import { encode_hosted_root, make_portable_aggregate_snapshot, make_portable_aggregate_commit } from "../../src/api/livemap/livemap.hosted.js";
import { projected_value_to_hson_root } from "../../src/core/projected-value-graph.js";
import { admit_projected_value } from "../../src/core/projected-value-admission.js";
import { mint_hson_node_quid } from "../../src/core/hson-node-quid.js";
import { validate_document_path } from "../../src/api/livemap/livemap.document.path.js";
import { resume_registry_locus } from "../../src/api/locus/locus.registry.persistence.js";
import { enable_interactions } from "../../src/api/interactions/interactions.js";
import { locus_map_internal } from "../../src/internal/governor-maps.js";
import { MemoryCheckpointAdapter } from "../helpers/memory-checkpoint-adapter.mts";
import { admit_part_library, PART_COLLECTION_VALIDATION } from "../../src/api/livemap/livemap.parts.js";
import { make_livemap_registry_authority } from "../../src/api/livemap/livemap.core.js";
import type { LiveMapAggregateWrite } from "../../src/api/livemap/livemap.library.js";

const part = { kind: "document", document: '<p hson:part @:label "%{text}"/>',
  css: { "@:label": { color: "red" } }, stylesheet: "p{display:block}" } as const;
const other = { kind: "document", document: '<aside hson:part "Other"/>' } as const;
const graph = (value: unknown) => projected_value_to_hson_root(admit_projected_value(value));
const snapshotFixture = () => hsonLiveMap.fromLibraries({ parts: { parts: { p: part } }, state: { json: { count: 1 } },
  page: { document: "<main/>" } });
const fixture = () => hsonLiveMap.fromLibraries({ parts: { parts: { p: part } }, state: { json: { count: 1 } },
  page: { document: '<html <head/> <body <main <hson-part lib="parts" at="p" text="Existing"/>/>/>/>' } });

/** Include identity, history, occurrence and notification effects in every rejection probe. */
function rejection(map: ReturnType<typeof fixture> | ReturnType<typeof snapshotFixture>, run: () => unknown,
  pattern: RegExp | ((error: unknown) => boolean) = /Immutable Part.*parts.*p/) {
  const authority = owner(map), before = authority.captureSemanticCheckpoint(), ledger = authority.identityEpoch().issued();
  const epoch = authority.identityEpoch().current(), stats = authority.telemetry();
  const occurrence = map.doc.page.root(), css = map.doc.page.css.snapshot();
  const identity = authority.libraries()[0]!, overlay = authority.projectedOverlay(identity);
  let publications = 0;
  const stops = [map.commits.observe(() => publications++), authority.observe(() => publications++),
    authority.observeRestore(() => publications++), authority.observeAuthorityPosition(() => publications++),
    map.parts.parts.at([]).watch(() => publications++), map.parts.parts.p.feed(() => publications++)];
  try { assert.throws(run, pattern); } finally { stops.forEach(stop => stop()); }
  assert.deepEqual(authority.captureSemanticCheckpoint(), before); assert.equal(authority.identityEpoch().issued(), ledger);
  assert.equal(authority.identityEpoch().current(), epoch); assert.equal(authority.projectedOverlay(identity), overlay);
  assert.equal(authority.telemetry().acceptedTransitions, stats.acceptedTransitions);
  assert.equal(authority.telemetry().aggregatePublications, stats.aggregatePublications);
  assert.deepEqual(map.doc.page.root(), occurrence); assert.equal(map.doc.page.css.snapshot(), css);
  assert.equal(publications, 0);
}

export async function immutable_part_cases(check: (name: string, run: () => void | Promise<void>) => Promise<void>) {
  await check("Part admission keeps lexical and receiving analysis at use time", () => {
    for (const [document, message] of [
      ['<p hson:part "^{missing}"/>', 'Missing Part local declaration "missing".'],
      ['<p hson:part data:d="%{payload}" "%{payload}"/>', 'Conflicting Part input "payload".'],
    ]) {
      const definition = { kind: "document" as const, document };
      const map = hsonLiveMap.fromLibraries({ parts: { parts: { deferred: definition } } });
      assert.deepEqual(map.parts.parts.deferred.snap(), definition);
      assert.throws(() => map.parts.parts.deferred.write(), { name: "TypeError", message });
      const installed = snapshotFixture();
      installed.parts.parts.at([]).object.setKey("deferred", definition);
      rejection(installed, () => installed.addLibraries({ consumer: { document: '<hson-part lib="parts" at="deferred"/>' } }), new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  await check("completed new Parts may be temporarily malformed, while unused final additions retain source diagnostics", () => {
    const map = snapshotFixture();
    map.batch(writer => {
      writer.parts.parts.at([]).object.setKey("constructed", { kind: "document", document: "<broken" });
      writer.parts.parts.at(["constructed", "document"]).set(other.document);
      writer.parts.parts.at([]).object.setKey("discarded", { kind: "document", document: "<broken" });
      writer.parts.parts.at(["discarded"]).delete();
    });
    assert.deepEqual(map.parts.parts.at(["constructed"]).snap(), other);
    assert.equal(map.parts.parts.at(["discarded"]).snap(), undefined);
    const duplicate = { kind: "document" as const, document: '<p hson:part\n <b @:same/>\n <i @:same/>/>' };
    const diagnostics = (run: () => unknown) => {
      try { run(); } catch (error) {
        assert.ok(error instanceof Error);
        return { name: error.name, message: error.message, cause: error.cause, ...JSON.parse(JSON.stringify(error)) };
      }
      assert.fail("Expected source rejection");
    };
    const expected = diagnostics(() => hsonLiveMap.fromLibraries({ parts: { parts: { first: duplicate } } }));
    assert.deepEqual(diagnostics(() => hsonLiveMap.fromLibraries({ brokenDocument: { document: "<broken" },
      parts: { parts: { first: duplicate } } })), expected);
    assert.equal(expected.code, "HSON_LIBRARY_QUAD_DUPLICATE");
    assert.deepEqual(expected.source, { index: 30, line: 3, column: 5 });
    assert.deepEqual(expected.related, [{ role: "first-declaration", source: { index: 17, line: 2, column: 5 } }]);
    for (const consume of [false, true]) rejection(map, () => {
      const actual = diagnostics(() => map.batch(writer => {
        // A missing receiving argument must not hide an invalid unused addition
        // in the same completed collection, even when the consumer comes first.
        if (consume) writer.doc.page.graph({ domain: "graph", op: "insert-content",
          target: { kind: "path", path: validate_document_path([0, 0, 1, 0]) }, index: 1,
          content: { $_tag: "hson-part", $_attrs: { lib: "parts", at: "p" }, $_content: [] } });
        writer.parts.parts.at([]).object.setKey("first", duplicate);
        writer.parts.parts.at([]).object.setKey("second", { kind: "document", document: "<broken" });
      }));
      assert.deepEqual(actual, expected);
      throw new Error("verified source diagnostic");
    }, /verified source diagnostic/);
  });

  await check("Part, Document and replay diagnostics retain operation precedence and atomicity", () => {
    for (const competing of ["document", "replay", "consumer-before-replay"]) {
      const map = snapshotFixture(), authority = owner(map), [parts, data, page] = authority.libraries();
      const addition: LiveMapAggregateWrite = { target: authority.target(parts!, []), kind: "set-key", key: "invalid",
        value: admit_projected_value({ kind: "document", document: '<p hson:part\n <b @:same/>\n <i @:same/>/>' }) };
      const replay: LiveMapAggregateWrite = { target: authority.target(data!, ["count"]), kind: "replay-data",
        operation: { kind: "set", path: ["count"], prev: 999, next: 2 } };
      const consumer: LiveMapAggregateWrite = { target: authority.target(page!, []), kind: "graph", operation: {
        domain: "graph", op: "insert-content", target: { kind: "path", path: validate_document_path([0, 0, 1, 0]) }, index: 1,
        content: { $_tag: "hson-part", $_attrs: { lib: "parts", at: "p" }, $_content: [] } } };
      const broken: LiveMapAggregateWrite = { target: authority.target(page!, []), kind: "graph", operation: {
        domain: "graph", op: "insert-content", target: { kind: "path", path: validate_document_path([999]) }, index: 0, content: "x" } };
      rejection(map, () => authority.commit(competing === "document" ? [broken, addition]
        : competing === "replay" ? [replay, addition] : [consumer, replay, addition]), error => {
        assert.ok(error instanceof Error && "code" in error);
        assert.equal(error.code, competing === "document" ? "DOCUMENT_PATH_OUT_OF_RANGE"
          : competing === "replay" ? "REPLAY_CONFLICT" : "HSON_LIBRARY_QUAD_DUPLICATE");
        if (competing === "document") {
          assert.equal(error.name, "LiveMapDocumentMutationError");
          assert.ok(error.cause instanceof Error && "code" in error.cause);
          assert.equal(error.cause.code, "DOCUMENT_PATH_OUT_OF_RANGE");
        } else if (competing === "replay") assert.equal(error.name, "LiveMapReplayError");
        return true;
      });
    }
  });

  await check("queued Part admission owns source and structured CSS before returning to caller aliases", async () => {
    const loc = hsonLiveMap.locus.create({ state: { json: { count: 0 } } });
    try {
      const source = { kind: "document" as const, document: '<p hson:part @:root "Captured"/>', css: { "@:root": { color: "red" } } };
      const admitted = structuredClone(source);
      const pending = loc.admit({ parts: { parts: { p: source } } });
      source.document = "<broken"; source.css["@:root"].color = "blue";
      await pending;
      assert.deepEqual(loc.parts.must("parts").at(["p"]).snap(), admitted);
      assert.match(loc.parts.must("parts").at(["p"]).write(), /hson-part/);
    } finally { loc.dispose(); }
  });

  await check("independent raw admission cannot borrow an owned Part candidate from an extra input field", () => {
    const borrowed = admit_part_library({ valid: other });
    const raw = { root: graph({ invalid: { kind: "document", document: "<broken" } }), family: "data" as const,
      validation: PART_COLLECTION_VALIDATION, part: borrowed };
    assert.throws(() => make_livemap_registry_authority([raw]));
    const map = snapshotFixture(), authority = owner(map);
    rejection(map, () => authority.addLibraries([{ ...raw, name: "external", hsonSchema: map.parts.parts.schema.get() }]), /./);
  });

  await check("immutable Parts reject whole, descendant, helper, equal-value and retained-handle writes without effects", () => {
    const map = fixture(), library = map.parts.parts, member = library.p;
    const generic = require_livemap_library_internal(map, "parts");
    if (generic.mode === "document") throw Error("Expected data");
    const refined = member.present()!.asObject()!.at([]).asObject()!, root = library.at([]).asObject()!;
    const failures = [() => member.set(part), () => member.replace(part), () => member.delete(),
      () => member.update(value => value!), () => member.at(["document"]).set(part.document),
      () => refined.object.setKey("document", part.document), () => refined.object.setMany({ document: part.document }),
      () => refined.object.deleteMany(["kind"]), () => refined.object.renameKey("document", "kind"),
      () => refined.object.clear(), () => root.object.setKey("p", part), () => root.object.setMany({ p: part }),
      () => root.object.deleteKey("p"), () => root.object.deleteMany(["p"]), () => root.object.renameKey("p", "new"),
      () => root.object.clear(), () => root.replace({ p: part }), () => root.set({ p: part }),
      () => root.update(value => value), () => generic.at(["p", "document"]).replace(part.document)];
    for (const fail of failures) rejection(map, fail);
    const authority = owner(map), id = authority.libraries()[0]!;
    for (const path of [["p", "css", "@:label", "color"], ["p", "stylesheet"]]) {
      rejection(map, () => authority.commit([{ target: authority.target(id, path), kind: "set", value: "blue" }]));
    }
    assert.equal(root.object.deleteKey("absent").changed, false);
    assert.equal(root.object.renameKey("p", "p").changed, false);
    assert.equal(root.object.setMany({}).changed, false);
    map.data.state.at(["count"]).set(2); map.doc.page.at([]).asElement()!.attrs.set("title", "editable");
    assert.equal(map.data.state.snap(["count"]), 2); assert.match(map.doc.page.render(), /editable/);
  });

  await check("immutable Parts reject transient batch deletion, modification, renaming and identity demand", () => {
    const map = fixture(), authority = owner(map), id = authority.libraries()[0]!;
    for (const attempt of [
      () => map.batch(writer => { writer.parts.parts.p.delete(); writer.parts.parts.at([]).object.setKey("p", part); }),
      () => map.batch(writer => { writer.parts.parts.p.at(["document"]).set(other.document); writer.parts.parts.p.at(["document"]).set(part.document); }),
      () => map.batch(writer => { const root = writer.parts.parts.at([]).object; root.renameKey("p", "temporary"); root.renameKey("temporary", "p"); }),
      () => map.batch(writer => { writer.data.state.at(["count"]).set(3); writer.parts.parts.p.replace(part); }),
      () => authority.commit([{ target: authority.target(id, ["p"]), kind: "ensure-quid", quid: mint_hson_node_quid() }]),
      () => authority.commit([{ target: authority.target(id, ["new"]), kind: "ensure-quid", quid: mint_hson_node_quid() }]),
      () => authority.commit([{ target: authority.target(id, []), kind: "ensure-quid", quid: mint_hson_node_quid() }]),
      () => authority.commit([{ target: authority.target(id, []), kind: "set-key", key: "new", value: admit_projected_value(other) },
        { target: authority.target(id, ["new"]), kind: "ensure-quid", quid: mint_hson_node_quid() }]),
    ]) rejection(map, attempt, /Immutable Part/);
  });

  await check("new Part members construct atomically, preserve editable sources and resolve later nested dependencies", () => {
    const source = { kind: "document" as const, document: '<b hson:part "Authored"/>' };
    const map = fixture(), root = map.parts.parts.at([]);
    root.object.setKey("authored", source); source.document = '<i hson:part/>';
    assert.equal(root.at(["authored"]).snap()?.document, '<b hson:part "Authored"/>');
    const deferred = map.parts.parts.p.write({ text: "Deferred" });
    map.batch(writer => {
      const collection = writer.parts.parts.at([]).object;
      collection.setKey("constructed", { kind: "document", document: "<i hson:part/>" });
      writer.parts.parts.at(["constructed", "document"]).set('<strong hson:part "Final"/>');
      collection.setKey("parent", { kind: "document", document: '<section hson:part <hson-part lib="parts" at="later"/>/>' });
    });
    const before = owner(map).captureSemanticCheckpoint();
    assert.throws(() => map.addLibraries({ unavailable: { document: root.at(["parent"]).write() } }), /Unknown Part member/);
    assert.deepEqual(owner(map).captureSemanticCheckpoint(), before);
    // The receiving Document precedes dependency admission within this transaction.
    map.batch(writer => {
      writer.doc.page.graph({ domain: "graph", op: "insert-content", target: { kind: "path", path: validate_document_path([0, 0, 1, 0]) }, index: 1,
        content: { $_tag: "hson-part", $_attrs: { lib: "parts", at: "parent" }, $_content: [] } });
      writer.parts.parts.at([]).object.setKey("later", other);
    });
    assert.match(map.doc.page.render(), /Other/);
    map.addLibraries({ deferredPage: { document: '<html <head/> <body ' + deferred + '/>/>' } });
    assert.match(map.doc.must("deferredPage").render(), /Deferred/);
    assert.match(map.doc.must("deferredPage").css.snapshot(), /red/);
    assert.ok(owner(map).identityEpoch().issued().size > 0);
    rejection(map, () => root.object.setMany({ distinct: other, p: part }));
    rejection(map, () => map.batch(writer => { writer.parts.parts.at([]).object.setKey("valid", other);
      writer.parts.parts.at([]).object.setKey("invalid", { kind: "document", document: "<broken" }); }), /./);
    assert.equal(root.at(["valid"]).snap(), undefined);
  });

  await check("Part snapshot checkpoint and topology installation preserve existing baselines and reject rollback", () => {
    const map = snapshotFixture(), authority = owner(map), capture = map.capture(), checkpoint = authority.captureSemanticCheckpoint();
    const changed = capture.libraries.map(item => item.name === "parts" ? { ...item, root: encode_hosted_root(graph({ p: other })) } : item);
    rejection(map, () => map.restore({ ...capture, libraries: changed }));
    rejection(map, () => authority.installSemanticCheckpoint({ ...checkpoint, libraries: checkpoint.libraries.map(item =>
      item.name === "parts" ? { ...item, root: graph({ p: other }) } : item) }));
    const missing = hsonLiveMap.fromLibraries({ state: { json: {} } }).capture();
    rejection(map, () => authority.restoreLibraries(missing));
    const changedFamily = hsonLiveMap.fromLibraries({ parts: { document: "<main/>" } }).capture();
    rejection(map, () => authority.restoreLibraries(changedFamily));
    // A coherent installation may grow the baseline. An older snapshot then cannot erase it.
    const expanded = { ...capture, libraries: capture.libraries.map(item => item.name === "parts"
      ? { ...item, root: encode_hosted_root(graph({ p: part, expansion: other })) } : item) };
    map.restore(expanded);
    assert.deepEqual(map.parts.parts.at(["expansion"]).snap(), other);
    rejection(map, () => map.restore(capture), /Immutable Part.*expansion/);
    rejection(map, () => authority.installSemanticCheckpoint(checkpoint), /Immutable Part.*expansion/);
    const exactMap = snapshotFixture(), exactAuthority = owner(exactMap), exact = exactAuthority.captureHosted();
    exactMap.parts.parts.at([]).object.setKey("hostedNew", other);
    rejection(exactMap, () => exactAuthority.restoreHosted(exact), /Immutable Part.*hostedNew/);
  });

  await check("receiving reconciliation rejects same-owner Part rebinding and permits withdrawal and recovery", () => {
    const map = snapshotFixture(), snapshot = make_portable_aggregate_snapshot(owner(map).captureHosted());
    const client = make_livemap_client_composition_from_portable_aggregate_internal(snapshot), authority = owner(client), manager = {};
    authority.claimManagement(manager);
    try {
      const before = client.capture(), issued = authority.identityEpoch().issued(); let events = 0;
      const stop = authority.observeRestore(() => events++);
      assert.throws(() => authority.restoreClientHostedManaged(manager, { ...snapshot, libraries: snapshot.libraries.map(item =>
        item.name === "parts" ? { ...item, root: encode_hosted_root(graph({ p: other })) } : item) }), /Immutable Part/);
      const forgery = hsonLiveMap.fromLibraries({ parts: { json: { p: part } } }), sender = owner(forgery);
      sender.setInitialHostedAuthority(snapshot.authority);
      const target = sender.target(sender.libraries()[0]!, ["p", "document"]);
      const transient = sender.commit([{ target, kind: "set", value: other.document }, { target, kind: "set", value: part.document }]);
      const replay = make_portable_aggregate_commit(transient.hosted!)!;
      assert.throws(() => authority.replayClientHostedManaged(manager, { ...replay, registryDigest: snapshot.registry.digest },
        snapshot.revision), /Immutable Part.*replay set/);
      assert.deepEqual(client.capture(), before); assert.equal(authority.identityEpoch().issued(), issued); assert.equal(events, 0); stop();
      // Full session projection withdrawal/regrant is covered by parts_member_echo_cases.
    } finally { authority.releaseManagement(manager); }
  });

  await check("Locus immutable Part rejection preserves history, durable records and Document occurrences", async () => {
    const persistence = new MemoryCheckpointAdapter(), definitions = { parts: { parts: { p: part }, access: "shared" },
      page: { document: '<html <head/> <body <main <hson-part lib="parts" at="p" text="Existing"/>/>/>/>', access: "shared" } } as const;
    const options = { logicalMapId: "immutable-parts", persistence };
    const locus = await hsonLiveMap.locus.resume(definitions, options), map = locus_map_internal(locus);
    try {
      const before = owner(map).captureSemanticCheckpoint(), ledger = owner(map).identityEpoch().issued(), records = persistence.appendCalls.length;
      let notifications = 0; const stop = map.commits.observe(() => notifications++);
      await assert.rejects(locus.parts.parts.p.replace(part), /Immutable Part/);
      await assert.rejects(locus.stage(writer => { writer.parts.parts.p.delete(); writer.parts.parts.at([]).object.setKey("p", part); }), /Immutable Part/);
      assert.deepEqual(owner(map).captureSemanticCheckpoint(), before); assert.equal(owner(map).identityEpoch().issued(), ledger);
      assert.equal(persistence.appendCalls.length, records); assert.equal(notifications, 0); stop();
      await locus.parts.parts.at([]).object.setKey("new", other);
      await locus.admit({ runtime: { json: { count: 1 }, access: "shared" } });
      await hsonLiveMap.locus.checkpoint(locus);
    } finally { locus.dispose(); }
    const restarted = await hsonLiveMap.locus.resume(definitions, options);
    try { assert.deepEqual(restarted.parts.parts.at(["new"]).snap(), other);
      await assert.rejects(restarted.parts.parts.p.delete(), /Immutable Part/);
    } finally { restarted.dispose(); }
    const deployment = hsonLiveMap.fromLibraries({ parts: { parts: { p: other } }, page: { document: "<main/>" } });
    enable_interactions(deployment);
    const before = deployment.capture(), ledger = owner(deployment).identityEpoch().issued(), persisted = persistence.state(options.logicalMapId);
    await assert.rejects(resume_registry_locus({ ...options, map: deployment,
      libraries: [{ name: "parts", ownership: "shared" }, { name: "page", ownership: "shared" }] }), /Immutable Part.*durable resume/);
    assert.deepEqual(deployment.capture(), before); assert.equal(owner(deployment).identityEpoch().issued(), ledger);
    assert.deepEqual(persistence.state(options.logicalMapId), persisted);
    assert.equal(deployment.data("runtime"), undefined);
  });
}
