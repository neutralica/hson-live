import assert from "node:assert/strict";
import { hsonLiveMap } from "../../src/api/livemap/index.js";
import { locus_map_internal } from "../../src/internal/governor-maps.js";
import { internal_livemap_aggregate_authority } from "../../src/api/livemap/livemap.internal.js";
import { make_portable_aggregate_commit, make_portable_aggregate_snapshot } from "../../src/api/livemap/livemap.hosted.js";
import { make_livemap_client_composition_from_portable_aggregate_internal, reconcile_client_projection_snapshot_internal } from "../../src/api/livemap/livemap.libraries.js";
import { read_document_quad } from "../../src/internal/governed-document.js";
import { enumerate_livemap_issued_quids } from "../../src/api/livemap/livemap.identity-epoch.js";
import { live_subscription, read_data_location } from "../../src/internal/library-observation.js";
import { admit_authority_projection_snapshot as admit, encode_authority_projection_snapshot as encode,
  decode_authority_projection_snapshot as decode } from "../../src/api/locus/locus.authority-projection-snapshot.js";
import { install_client_local_initializers_internal } from "../../src/api/locus/locus.local-initializer.js";
import { encode_portable_document_stylesheet } from "../../src/internal/css/portable-document-stylesheet.js";
import { merge_part_stylesheets } from "../../src/internal/css/part-stylesheet.js";
import { local_initializers } from "../helpers/client-projection.mts";
import { structured_css_fixture } from "../helpers/structured-css-fixture.mts";
import { MemoryCheckpointAdapter } from "../helpers/memory-checkpoint-adapter.mts";
import type { DocumentCssRecord } from "../../src/types/document-css.types.js";

const part = { kind: "document", document: '<p hson:part "Private"/>' } as const;
const disposed = { name: "Error", message: "Disposed Locus authority." };

export async function locus_observation_lifetime_cases() {
  await quad_subscription_lifetime_cases();
  await data_watch_preparation_cases();
  const actionReads: (() => unknown)[] = [];
  const loc = hsonLiveMap.locus.create({ parts: { parts: { p: part } },
    data: { json: { nested: { items: [{ n: 1 }, { n: 2 }] } } },
    page: { document: '<main title="Visible" <b "Text"/>/>', stylesheet: 'main{color:red}' },
  }, { actions: { inspect(context) {
    const library = context.parts.parts, member = library.p, object = member.asObject()!.object;
    const array = context.data.data.at(["nested", "items"]).asArray()!.array;
    const page = context.doc.page, element = page.at([1, 0]).asElement()!;
    actionReads.push(() => library.root(), () => library.p, () => member.kind(), () => member.path(),
      () => member.rev, () => member.present(), () => member.at([]), () => member.asObject(),
      () => object.toObject(), () => object.getKey("document"), () => array.toArray(), () => array.first(),
      () => array.map(value => value), () => page.root(), () => page.render(), () => page.css.snapshot(),
      () => page.document.content(), () => page.schema.get(), () => element.attrs.get("title"),
      () => element.flags.has("hidden"), () => element.kind(), () => element.at([]));
  } } });
  try {
    await loc.dispatchAction({ type: "action", id: "inspect-lifetime", name: "inspect" });
    const library = loc.parts.parts, member = library.p, object = member.asObject()!.object;
    const nested = loc.data.data.at(["nested"]).asObject()!, arrayLocation = nested.at(["items"]).asArray()!;
    const array = arrayLocation.array, item = arrayLocation.at([0]).asObject()!.object;
    const page = loc.doc.page, element = page.at([1, 0]).asElement()!;
    const reads: (() => unknown)[] = [
      () => loc.parts.parts, () => loc.parts("missing"), () => loc.data.data, () => loc.doc.page,
      () => library.p, () => library.at(["p"]), () => library.root(), () => library.rev, () => library.schema.get(),
      () => member.kind(), () => member.path(), () => member.rev, () => member.present(), () => member.asObject(),
      () => member.asArray(), () => member.asScalar(), () => member.at([]), () => member.snap(), () => member.hson(),
      () => member.write(), () => object.getKey("document"), () => object.toObject(), () => object.keys(),
      () => object.values(), () => object.entries(), () => object.pick(["document"]), () => object.omit(["document"]),
      () => object.hasKey("document"), () => object.size(), () => object.isEmpty(),
      () => nested.object.toObject(), () => nested.at(["items"]), () => arrayLocation.present(), () => item.getKey("n"),
      () => array.toArray(), () => array.slice(0, 1), () => array.take(1), () => array.drop(1),
      () => array.takeLast(1), () => array.dropLast(1), () => array.map(value => value), () => array.length(),
      () => array.isEmpty(), () => array.at(0), () => array.first(), () => array.last(),
      () => array.includes({ n: 1 }), () => array.indexOf({ n: 2 }),
      () => page.root(), () => page.render(), () => page.document.root(), () => page.document.content(),
      () => page.css.snapshot(), () => page.css.list(), () => page.css.var.list(), () => page.schema.get(),
      () => page.at([1, 0]), () => element.attrs.get("title"), () => element.attrs.keys(),
      () => element.attrs.must.get("title"), () => element.flags.has("hidden"), () => element.kind(),
      () => element.present(), () => element.asElement(), () => element.id("missing"), () => element.at([]),
      ...actionReads,
    ];
    assert.equal(object.getKey("document"), part.document);
    assert.equal(item.getKey("n"), 1);
    assert.equal(element.attrs.get("title"), "Visible");
    for (const read of reads) read();
    const captured = object.toObject(), capturedArray = array.toArray(), capturedRoot = library.root();
    const authority = internal_livemap_aggregate_authority(locus_map_internal(loc));
    const before = authority.captureSemanticCheckpoint(), issued = authority.identityEpoch().issued();
    loc.dispose();
    for (const read of reads) assert.throws(read, disposed);
    for (const subscribe of [() => member.watch(() => {}), () => page.watch(() => {}),
      () => page.commits.observe(() => {}), () => element.watch(() => {})]) assert.throws(subscribe, disposed);
    assert.deepEqual(captured, part); assert.deepEqual(capturedArray, [{ n: 1 }, { n: 2 }]);
    assert.equal(Reflect.set(captured, "document", "detached"), true);
    assert.equal(Reflect.set(capturedArray[0]!, "n", 99), true);
    assert.equal(Reflect.set(capturedRoot, "$_content", []), true);
    assert.deepEqual(authority.captureSemanticCheckpoint(), before);
    assert.equal(authority.identityEpoch().issued(), issued);
  } finally { loc.dispose(); }

  const callbackOwner = hsonLiveMap.locus.create({ data: { json: [1, 2] } });
  const array = callbackOwner.data.data.at([]).asArray()!.array;
  assert.throws(() => array.map(value => { callbackOwner.dispose(); return value; }), disposed,
    "a callback cannot return a successful live observation after disposal");

  const source = hsonLiveMap.fromLibraries({ data: { json: [1] } });
  const snapshot = make_portable_aggregate_snapshot(internal_livemap_aggregate_authority(source).captureHosted());
  const client = make_livemap_client_composition_from_portable_aggregate_internal(snapshot);
  const authority = internal_livemap_aggregate_authority(client), manager = {};
  const empty = hsonLiveMap.create(), emptyAuthority = internal_livemap_aggregate_authority(empty);
  emptyAuthority.setInitialHostedAuthority(snapshot.authority);
  const withdrawn = make_portable_aggregate_snapshot(emptyAuthority.captureHosted());
  const retained = read_data_location(client.data.must("data").at([])).asArray()!.array;
  authority.claimManagement(manager);
  try {
    assert.throws(() => retained.map(value => {
      reconcile_client_projection_snapshot_internal(client, manager, withdrawn);
      return value;
    }), /another map authority/, "withdrawal during a callback fences the returned observation");
    assert.equal(client.data("data"), undefined, "the accepted withdrawal is preserved");
    reconcile_client_projection_snapshot_internal(client, manager, snapshot);
    assert.throws(() => retained.toArray(), /another map authority/);
    assert.deepEqual(read_data_location(client.data.must("data").at([])).asArray()!.array.toArray(), [1]);
  } finally { authority.releaseManagement(manager); }
}

/** Retired subscriptions must be filtered before preparing ordinary Data events. */
export async function data_watch_preparation_cases() {
  const previousReporter = Object.getOwnPropertyDescriptor(globalThis, "reportError");
  try {
    for (const reporter of [true, false]) {
      const reports: unknown[] = [];
      if (reporter) Object.defineProperty(globalThis, "reportError", {
        configurable: true, value: (error: unknown) => reports.push(error),
      });
      else Reflect.deleteProperty(globalThis, "reportError");
      for (const withdrawal of ["before", "unrelated-listener", "affected-listener", "affected-regrant-listener"] as const) {
        const affected = withdrawal === "affected-listener" || withdrawal === "affected-regrant-listener";
        const source = hsonLiveMap.fromLibraries({ data: { json: { n: 0 } } });
        const sourceAuthority = internal_livemap_aggregate_authority(source);
        const snapshot = make_portable_aggregate_snapshot(sourceAuthority.captureHosted());
        const client = make_livemap_client_composition_from_portable_aggregate_internal(snapshot);
        install_client_local_initializers_internal(client, local_initializers({
          local: { json: { n: 0 } },
          page: { document: '<main @:kept title="unchanged"/>' },
        }));
        const authority = internal_livemap_aggregate_authority(client), manager = {};
        const empty = hsonLiveMap.create();
        internal_livemap_aggregate_authority(empty).setInitialHostedAuthority(snapshot.authority);
        const withdrawn = make_portable_aggregate_snapshot(internal_livemap_aggregate_authority(empty).captureHosted());
        const retained = client.data.must("data").at(["n"]), local = client.data.must("local").at(["n"]);
        const page = client.doc.must("page").root();
        const issued = enumerate_livemap_issued_quids(authority.identityEpoch().issued());
        const before = authority.telemetry(), revision = client.rev;
        const retiredValues: unknown[] = [], retiredFeeds: unknown[] = [], localValues: unknown[] = [];
        const localFeeds: unknown[] = [], publications: number[] = [], order: string[] = [];
        const stops: (() => void)[] = [];
        let revoked = false;
        const reconcile = (value: typeof snapshot) => {
          authority.claimManagement(manager);
          try { reconcile_client_projection_snapshot_internal(client, manager, value); }
          finally { authority.releaseManagement(manager); }
        };
        const revoke = () => { revoked = true; reconcile(withdrawn); };
        const replay = (value: number) => {
          const commit = sourceAuthority.commit([{ target: sourceAuthority.target(sourceAuthority.libraries()[0]!, ["n"]),
            kind: "set", value }]);
          const portable = make_portable_aggregate_commit(commit.hosted!);
          assert.ok(portable);
          authority.claimManagement(manager);
          try { authority.replayClientHostedManaged(manager, portable, portable.prevRev); }
          finally { authority.releaseManagement(manager); }
        };
        try {
          if (withdrawal === "unrelated-listener") stops.push(local.watch(value => {
            order.push(`earlier:${value}`);
            if (!revoked) revoke();
          }));
          if (affected) stops.push(read_data_location(retained).watch(value => {
            assert.equal(value, 1);
            assert.equal(retained.snap(), 1, "the mutation was accepted before withdrawal");
            revoke();
            if (withdrawal === "affected-regrant-listener") reconcile(make_portable_aggregate_snapshot(sourceAuthority.captureHosted()));
          }));
          stops.push(read_data_location(retained).watch(value => retiredValues.push(value)));
          stops.push(retained.feed(event => retiredFeeds.push(event.value)));
          stops.push(local.watch(value => { localValues.push(value); order.push(`watch:${value}`); }));
          stops.push(local.feed(event => {
            localFeeds.push(event.value); order.push(`feed:${event.value}`);
            assert.deepEqual(event.path, ["n"]);
            assert.equal(event.ops.length, 1);
            assert.equal(event.op, event.ops[0]);
          }));
          stops.push(client.commits.observe(commit => { publications.push(commit.rev); order.push("commit"); }));
          if (withdrawal === "before") revoke();
          if (affected) replay(1);
          order.length = 0;
          local.set(1); local.set(2);
          assert.equal(revoked, true);
          assert.deepEqual(retiredValues, []); assert.deepEqual(retiredFeeds, []);
          assert.deepEqual(localValues, [1, 2]); assert.deepEqual(localFeeds, [1, 2]);
          assert.deepEqual(order, [1, 2].flatMap(value => [
            ...(withdrawal === "unrelated-listener" ? [`earlier:${value}`] : []),
            `watch:${value}`, `feed:${value}`, "commit",
          ]));
          assert.deepEqual(reports, [], `${withdrawal}: retired preparation must be silent`);

          // Regrant allocates a new Library identity; old watch/feed records stay retired.
          reconcile(make_portable_aggregate_snapshot(sourceAuthority.captureHosted()));
          assert.throws(() => retained.watch(() => {}), /another map authority/);
          const fresh = client.data.must("data").at(["n"]), freshValues: unknown[] = [], freshFeeds: unknown[] = [];
          stops.push(read_data_location(fresh).watch(value => freshValues.push(value)));
          stops.push(fresh.feed(event => freshFeeds.push(event.value)));
          replay(2);
          assert.deepEqual(freshValues, [2]); assert.deepEqual(freshFeeds, [2]);
          assert.deepEqual(retiredValues, []); assert.deepEqual(retiredFeeds, []);
          assert.deepEqual(localValues, [1, 2]); assert.deepEqual(localFeeds, [1, 2]);
          assert.equal(fresh.snap(), 2); assert.equal(local.snap(), 2);
          assert.deepEqual(client.doc.must("page").root(), page);
          assert.deepEqual(enumerate_livemap_issued_quids(authority.identityEpoch().issued()), issued);
          const accepted = affected ? 4 : 3;
          assert.equal(publications.length, accepted);
          assert.ok(publications.every((rev, index) => index === 0 || rev > publications[index - 1]!));
          assert.equal(client.rev, revision + accepted + 2, "only accepted writes, withdrawal and regrant advance revision");
          assert.equal(authority.telemetry().acceptedTransitions, before.acceptedTransitions + accepted);
          assert.equal(authority.telemetry().aggregatePublications, before.aggregatePublications + accepted);
          const checkpoint = authority.captureSemanticCheckpoint();
          // With no reporter or uncaught handler, a spurious queued failure would terminate Node/Worker here.
          await new Promise<void>(resolve => setTimeout(resolve, 0));
          assert.deepEqual(reports, []);
          for (const stop of stops) { stop(); stop(); }
          assert.deepEqual(authority.captureSemanticCheckpoint(), checkpoint);
        } finally { for (const stop of stops) stop(); }
      }

      // Locus revocation and genuine listener failures retain the existing delivery boundary.
      for (const action of [false, true]) {
        let actionWatch: ((listener: (value: unknown) => void) => () => void) | undefined;
        const persistence = new MemoryCheckpointAdapter(), logicalMapId = "data-watch-preparation";
        const definitions = { data: { json: { n: 0 } } };
        const loc = await hsonLiveMap.locus.resume(definitions, {
          persistence, logicalMapId,
          actions: { inspect(ctx) { actionWatch = ctx.data.data.at(["n"]).watch; } },
        });
        if (action) await loc.dispatchAction({ type: "action", id: "data-watch", name: "inspect" });
        const map = locus_map_internal(loc), authority = internal_livemap_aggregate_authority(map);
        const before = authority.telemetry(), revision = map.rev;
        const issued = enumerate_livemap_issued_quids(authority.identityEpoch().issued());
        const values: unknown[] = [], unaffected: unknown[] = [], publications: number[] = [];
        const watch = actionWatch ?? loc.data.data.at(["n"]).watch;
        const stops = [watch(value => { values.push(value); loc.dispose(); }), watch(value => values.push(value)),
          map.data.must("data").at(["n"]).watch(value => unaffected.push(value)),
          map.commits.observe(commit => publications.push(commit.rev))];
        try {
          await loc.data.data.at(["n"]).set(1);
          assert.deepEqual(values, [1]); assert.deepEqual(unaffected, [1]);
          assert.deepEqual(publications, [revision + 1]); assert.equal(map.rev, revision + 1);
          assert.equal(map.data.must("data").at(["n"]).snap(), 1);
          assert.deepEqual(enumerate_livemap_issued_quids(authority.identityEpoch().issued()), issued);
          assert.equal(authority.telemetry().acceptedTransitions, before.acceptedTransitions + 1);
          assert.equal(authority.telemetry().aggregatePublications, before.aggregatePublications + 1);
          assert.equal(persistence.appendCalls.length, 1);
          assert.equal(persistence.appendCalls[0]!.commit.rev, revision + 1);
          const persisted = persistence.state(logicalMapId);
          await new Promise<void>(resolve => setTimeout(resolve, 0));
          assert.deepEqual(reports, []);
          const restarted = await hsonLiveMap.locus.resume(definitions, { persistence, logicalMapId });
          try { assert.equal(restarted.data.data.at(["n"]).snap(), 1); }
          finally { restarted.dispose(); }
          assert.deepEqual(persistence.state(logicalMapId), persisted);
        } finally { for (const stop of stops) stop(); loc.dispose(); }
      }
      if (reporter) {
        const map = hsonLiveMap.fromLibraries({ data: { json: { n: 0 } } });
        const authority = internal_livemap_aggregate_authority(map), before = authority.telemetry();
        const location = map.data.must("data").at(["n"]), values: unknown[] = [];
        const watchError = new Error("watch callback"), feedError = new Error("feed callback");
        const stops = [read_data_location(location).watch(() => { throw watchError; }),
          location.watch(value => values.push(value)), location.feed(() => { throw feedError; })];
        try {
          location.set(1);
          assert.deepEqual(values, [1]); assert.equal(location.snap(), 1); assert.equal(map.rev, 1);
          assert.equal(reports.length, 2);
          for (const [index, cause] of [watchError, feedError].entries()) {
            const report = reports[index]; assert.ok(report instanceof Error); assert.equal(report.cause, cause);
          }
          assert.equal(authority.telemetry().acceptedTransitions, before.acceptedTransitions + 1);
          assert.equal(authority.telemetry().aggregatePublications, before.aggregatePublications + 1);
        } finally { for (const stop of stops) stop(); }
      }
    }
  } finally {
    if (previousReporter) Object.defineProperty(globalThis, "reportError", previousReporter);
    else Reflect.deleteProperty(globalThis, "reportError");
  }
}

export async function projection_snapshot_integrity_cases() {
  const extra = structured_css_fixture('@property --tone{syntax:"<color>";inherits:false;initial-value:red}'
    + '@keyframes pulse{from{opacity:0}to{opacity:1}}@layer base{@media screen{main{color:red}}}');
  const mutations: readonly [string, (css: DocumentCssRecord) => boolean][] = [
    ["CSS field", css => Reflect.set(css, "rules", [])],
    ["rule array", css => Reflect.set(css.rules, 0, {})],
    ["rule record", css => Reflect.set(css.rules[0]!, "selector", "")],
    ["scope array", css => Reflect.set(css.rules[0]!.scopes, 0, 7)],
    ["declaration array", css => Reflect.set(css.rules[0]!.declarations, 0, ["color"])],
    ["declaration pair", css => Reflect.set(css.rules[0]!.declarations[0]!, 1, 7)],
    ["property record", css => Reflect.set(css.properties[0]!, "inh", "invalid")],
    ["keyframe record", css => Reflect.set(css.keyframes[0]!, "name", "")],
    ["keyframe step", css => Reflect.set(css.keyframes[0]!.steps[0]!, "at", "invalid")],
    ["keyframe declarations", css => Reflect.set(css.keyframes[0]!.steps[0]!.declarations[0]!, 1, 7)],
    ["order array", css => Reflect.set(css.order, css.order.length, { kind: "invalid" })],
    ["nested order", css => {
      const group = css.order.find(entry => entry.kind === "group")!;
      assert.equal(group.kind, "group");
      return Reflect.set(group.entries, group.entries.length, { kind: "invalid" });
    }],
  ];
  for (const scoped of [false, true]) {
    const loc = hsonLiveMap.locus.create({ parts: { parts: { p: { ...part, stylesheet: "p{color:blue}" } } },
      page: { document: scoped ? '<main <hson-part lib="parts" at="p"/>/>' : '<main/>',
        stylesheet: 'main{display:block}', access: "shared" },
    }, { authorizeProjection: () => ({ libraries: ["page"] }) });
    try {
      const session = await loc.session.create({ libraries: ["page"] });
      const publicSnapshot = session.now().libs, publicCss = publicSnapshot.libraries[0]!.css!;
      const publicBytes = JSON.stringify(publicSnapshot);
      assert.throws(() => Reflect.apply(Array.prototype.push, publicCss.order, [{ kind: "invalid" }]), TypeError);
      assert.equal(Reflect.set(publicCss.order, publicCss.order.length, { kind: "invalid" }), false);
      assert.equal(admit(publicSnapshot, true), publicSnapshot);
      assert.equal(JSON.stringify(admit(publicSnapshot, true)), publicBytes);

      const supplied = structuredClone(publicSnapshot), entry = supplied.libraries[0]!;
      Reflect.set(entry, "css", encode_portable_document_stylesheet(merge_part_stylesheets([entry.css!, extra])));
      const owned = admit(supplied, scoped), css = owned.libraries[0]!.css!, encoded = JSON.stringify(owned);
      assert.equal(admit(owned, scoped), owned);
      assert.deepEqual(admit(structuredClone(owned), scoped), owned);
      if (!scoped) assert.deepEqual(decode(encode(owned)), owned);
      for (const [name, mutate] of mutations) {
        assert.equal(mutate(css), false, name);
        assert.equal(JSON.stringify(admit(owned, scoped)), encoded, name);
        if (!scoped) assert.equal(encode(owned), encoded, name);
        const invalid = structuredClone(owned);
        assert.equal(mutate(invalid.libraries[0]!.css!), true, name);
        assert.throws(() => admit(invalid, scoped), /Authority projection snapshot is malformed/, name);
        assert.throws(() => JSON.stringify(admit(invalid, scoped)), /malformed/, name);
        if (!scoped) assert.throws(() => encode(invalid), /malformed/, name);
      }
      // Callers can still edit their detached inputs; admission owns a fresh copy.
      assert.equal(Reflect.set(entry.css!.rules[0]!.declarations[0]!, 1, "blue"), true);
      const changed = admit(supplied, scoped);
      assert.equal(changed.libraries[0]!.css!.rules[0]!.declarations[0]![1], "blue");
      assert.equal(JSON.stringify(owned), encoded);
      assert.equal(JSON.stringify(session.now().libs), publicBytes);
    } finally { loc.dispose(); }
  }
}

export async function quad_subscription_lifetime_cases() {
  type Quad = import('../../src/types/livemap.types.js').AuthorityDocumentQuadLocation<never>;
  let actionQuad: Quad | undefined;
  const loc = hsonLiveMap.locus.create({ page: { document: '<main @:main title="private"/>' } }, {
    actions: { inspect(ctx) { actionQuad = ctx.doc.page.q('main'); } },
  });
  await loc.dispatchAction({ type: 'action', id: 'quad', name: 'inspect' });
  const quad = loc.doc.page.q('main')!;
  const handles = [quad, quad.at([]), actionQuad!, actionQuad!.at([])];
  const captured = quad.snap();
  const reads = handles.flatMap(q => [() => q.active, () => q.rev, () => q.path(), () => q.snap(),
    () => q.hson(), () => q.must.snap(), () => q.must.hson(), () => q.at([]),
    () => q.attrs.get('title'), () => q.attrs.has('title'), () => q.attrs.keys(),
    () => q.attrs.must.get('title'), () => q.flags.has('hidden')]);
  for (const read of reads) read();
  loc.dispose();
  for (const read of reads) assert.throws(read, disposed);
  assert.ok(captured); assert.doesNotThrow(() => JSON.stringify(captured));
  for (const q of handles) assert.doesNotThrow(() => q.dispose());

  for (const action of [false, true]) for (const kind of ['data', 'document', 'location', 'commits', 'aggregate'] as const) {
    const delivered: unknown[] = [], cleanup: (() => void)[] = [];
    let register: (listener: (value: unknown) => void) => () => void = () => { throw Error('unselected'); };
    const owner = hsonLiveMap.locus.create({ data: { json: { n: 0 } }, page: { document: '<main title="old"/>' } }, {
      actions: { inspect(ctx) {
        register = kind === 'data' ? ctx.data.data.at(['n']).watch : kind === 'document' ? ctx.doc.page.watch
          : kind === 'location' ? ctx.doc.page.at([1, 0]).watch : ctx.doc.page.commits.observe;
      } },
    });
    if (action && kind !== 'aggregate') await owner.dispatchAction({ type: 'action', id: 'subscription', name: 'inspect' });
    else register = kind === 'data' ? owner.data.data.at(['n']).watch : kind === 'document' ? owner.doc.page.watch
      : kind === 'location' ? owner.doc.page.at([1, 0]).watch : kind === 'aggregate' ? owner.commits.observe : owner.doc.page.commits.observe;
    const map = locus_map_internal(owner), authority = internal_livemap_aggregate_authority(map);
    const revision = map.rev, issued = authority.identityEpoch().issued();
    let publications = 0;
    const off = map.commits.observe(() => publications++);
    cleanup.push(register(value => { delivered.push(value); owner.dispose(); }));
    cleanup.push(register(value => delivered.push(value)));
    if (kind === 'data' || kind === 'aggregate') await owner.data.data.at(['n']).set(1);
    else await owner.doc.page.at([1, 0]).asElement()!.attrs.set('title', 'new');
    assert.equal(delivered.length, 1, `${action}/${kind}`);
    if (kind === 'data') assert.deepEqual(delivered, [1]);
    if (kind === 'document') assert.match(String(delivered[0]), /title="new"/);
    assert.equal(map.rev, revision + 1); assert.equal(publications, 1);
    assert.deepEqual(enumerate_livemap_issued_quids(authority.identityEpoch().issued()), enumerate_livemap_issued_quids(issued));
    if (kind === 'data' || kind === 'aggregate') assert.equal(map.data.must('data').at(['n']).snap(), 1);
    else assert.match(map.doc.must('page').render(), /title="new"/);
    for (const stop of [...cleanup, off]) assert.doesNotThrow(stop);
    owner.dispose();
  }

  const reports: unknown[] = [];
  const previousReporter = Object.getOwnPropertyDescriptor(globalThis, 'reportError');
  Object.defineProperty(globalThis, 'reportError', { configurable: true, value: (error: unknown) => reports.push(error) });
  try {
    for (const kind of ['data', 'document', 'commits'] as const) {
      const errors = hsonLiveMap.locus.create({ data: { json: { n: 0 } }, page: { document: '<main/>' } });
      const cause = new Error('listener identity'), delivered: unknown[] = [];
      const subscribe = kind === 'data' ? errors.data.data.at(['n']).watch : kind === 'document' ? errors.doc.page.watch : errors.doc.page.commits.observe;
      const stops = [subscribe(() => { throw cause; }), subscribe(value => delivered.push(value))];
      if (kind === 'data') await errors.data.data.at(['n']).set(1);
      else await errors.doc.page.at([1, 0]).asElement()!.attrs.set('title', 'new');
      assert.equal(delivered.length, 1);
      const report = reports.pop(); assert.ok(report instanceof Error); assert.equal(report.cause, cause);
      for (const stop of stops) stop(); errors.dispose();
    }
    for (const kind of ['data', 'document', 'commits'] as const) {
      const source = hsonLiveMap.fromLibraries({ data: { json: { n: 0 } }, page: { document: '<main @:main title="private"/>' } });
      const snapshot = make_portable_aggregate_snapshot(internal_livemap_aggregate_authority(source).captureHosted());
      const client = make_livemap_client_composition_from_portable_aggregate_internal(snapshot);
      const authority = internal_livemap_aggregate_authority(client), manager = {};
      const empty = hsonLiveMap.create(), emptyAuthority = internal_livemap_aggregate_authority(empty);
      emptyAuthority.setInitialHostedAuthority(snapshot.authority);
      const withdrawn = make_portable_aggregate_snapshot(emptyAuthority.captureHosted());
      const page = client.doc.must('page'), data = client.data.must('data').at(['n']);
      const quad = read_document_quad(page.q('main')!), child = quad.at([]);
      const subscribe = kind === 'data' ? read_data_location(data).watch
        : kind === 'document' ? live_subscription(page.watch.bind(page), () => { void page.rev; })
        : live_subscription(page.commits.observe, () => { void page.rev; });
      const delivered: unknown[] = [];
      authority.claimManagement(manager);
      const stops = [subscribe(value => {
        delivered.push(value);
        reconcile_client_projection_snapshot_internal(client, manager, withdrawn);
        reconcile_client_projection_snapshot_internal(client, manager, snapshot);
      }), subscribe(value => delivered.push(value))];
      source.data.must('data').at(['n']).set(1);
      source.doc.must('page').at([1, 0]).asElement()!.attrs.set('title', 'changed');
      reconcile_client_projection_snapshot_internal(client, manager,
        make_portable_aggregate_snapshot(internal_livemap_aggregate_authority(source).captureHosted()));
      assert.equal(delivered.length, 1, kind);
      for (const q of [quad, child]) {
        assert.equal(q.active, false);
        for (const read of [() => q.path(), () => q.rev, () => q.attrs.get('title'), () => q.at([])]) assert.throws(read);
        q.dispose();
      }
      assert.equal(read_document_quad(client.doc.must('page').q('main')!).attrs.get('title'), 'private');
      for (const stop of stops) stop(); authority.releaseManagement(manager);
      assert.deepEqual(reports, [], 'withdrawal must not report observer failures');
    }
  } finally {
    if (previousReporter) Object.defineProperty(globalThis, 'reportError', previousReporter);
    else Reflect.deleteProperty(globalThis, 'reportError');
  }

  const nested = hsonLiveMap.locus.create({ data: { json: { n: 0 } } });
  const values: unknown[] = [], pending: Promise<void>[] = [];
  const n = nested.data.data.at(['n']);
  const stopFirst = n.watch(value => { if (value === 1) pending.push(n.set(2)); });
  const stopSecond = n.watch(value => values.push(value));
  await n.set(1); await Promise.all(pending);
  assert.deepEqual(values, [1, 2]);
  stopFirst(); stopSecond(); nested.dispose();
}
