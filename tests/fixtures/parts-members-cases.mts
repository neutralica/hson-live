import assert from "node:assert/strict";
import { Hson, hsonLiveMap, bind_locus_http } from "../../src/index.js";
import { internal_livemap_aggregate_authority } from "../../src/api/livemap/livemap.internal.js";
import { enumerate_livemap_issued_quids } from "../../src/api/livemap/livemap.identity-epoch.js";
import { make_livemap_client_composition_from_portable_aggregate_internal } from "../../src/api/livemap/livemap.libraries.js";
import { make_portable_aggregate_snapshot, make_portable_aggregate_commit } from "../../src/api/livemap/livemap.hosted.js";
import { PARTS_FACADE_RESERVED } from "../../src/internal/parts-facade.js";

const heading = { kind: "document", document: Hson.document`<h1 "Initial"/>`, css: "h1{color:red}" } as const;
const replacement = { kind: "document", document: '<h2 "Replacement"/>', css: "h2{color:blue}" } as const;
const definitions = { components: { parts: { heading, submit: { kind: "document" as const, document: "<button/>" } } } };

export async function parts_member_cases() {
  const map = hsonLiveMap.fromLibraries(definitions), parts = map.parts.components;
  const aggregate = internal_livemap_aggregate_authority(map);
  const before = map.capture(), issued = enumerate_livemap_issued_quids(aggregate.identityEpoch().issued());
  let commits = 0;
  const stopCommits = map.commits.observe(() => commits++);
  const member = parts.heading, explicit = parts.at(["heading"]);
  assert.deepEqual(member.path(), ["heading"]);
  assert.deepEqual(member.snap(), explicit.snap());
  assert.equal(member.hson(), explicit.hson());
  assert.equal(member.kind(), "object");
  assert.equal("render" in member, false); assert.equal("schema" in member, false);
  assert.equal("q" in member, false); assert.equal("template" in member, false);
  const detached = member.snap()!;
  Reflect.set(detached, "document", "<aside/>");
  assert.equal(member.snap()?.document, heading.document);
  assert.equal(parts.at, parts.at); assert.equal(parts.snap, parts.snap);
  assert.equal(Object.isFrozen(parts), true);
  assert.equal(Object.hasOwn(parts, "heading"), false); assert.equal("heading" in parts, false);
  assert.equal(Object.getOwnPropertyDescriptor(parts, "heading"), undefined);
  assert.equal(Reflect.get(parts, Symbol.iterator), undefined);
  assert.equal(await Promise.resolve(parts), parts);
  assert.doesNotThrow(() => JSON.stringify(parts));
  assert.throws(() => Reflect.get(parts, "missing"), /Unknown Part member/);
  assert.equal(parts.at(["missing"]).snap(), undefined);
  assert.equal(map.batch(writer => { assert.equal("replace" in writer.parts.components.heading, true); }).changed, false);
  assert.deepEqual(map.capture(), before); assert.equal(commits, 0);
  assert.deepEqual(enumerate_livemap_issued_quids(aggregate.identityEpoch().issued()), issued);

  const watched: unknown[] = [], fed: unknown[] = [];
  const unwatch = member.watch(value => watched.push(value));
  const unfeed = member.feed(event => fed.push(event.value));
  member.delete();
  assert.equal(member.snap(), undefined); assert.equal(member.hson(), undefined);
  assert.equal(member.at(["document"]).snap(), undefined);
  assert.throws(() => parts.heading, /Unknown Part member/);
  parts.at([]).object.setKey("heading", replacement);
  assert.deepEqual(member.snap(), replacement);
  parts.heading.replace(heading);
  assert.deepEqual(member.snap(), heading);
  assert.deepEqual(watched, [undefined, replacement, heading]);
  assert.deepEqual(fed, watched);
  const captured = map.capture();
  member.delete(); map.restore(captured);
  assert.deepEqual(member.snap(), heading); assert.deepEqual(watched.at(-1), heading);
  unwatch(); unfeed(); stopCommits();

  const replaySource = hsonLiveMap.fromLibraries(definitions);
  const replayAuthority = internal_livemap_aggregate_authority(replaySource);
  const snapshot = make_portable_aggregate_snapshot(replayAuthority.captureHosted());
  const replay = make_livemap_client_composition_from_portable_aggregate_internal(snapshot);
  const retainedReplay = Reflect.get(replay.parts.must("components"), "heading");
  const receiver = internal_livemap_aggregate_authority(replay), manager = {};
  receiver.claimManagement(manager);
  try {
    const record = replayAuthority.commit([{ target: replayAuthority.target(replayAuthority.libraries()[0]!, ["heading", "document"]),
      kind: "set", value: replacement.document }]);
    receiver.replayClientHostedManaged(manager, make_portable_aggregate_commit(record.hosted!)!, snapshot.revision);
    assert.equal(retainedReplay.snap().document, replacement.document);
  } finally { receiver.releaseManagement(manager); }

  for (const invalid of [
    { kind: "data", document: "<p/>" }, { kind: "document", document: 3 },
    { kind: "document", document: "<p/><p/>" }, { kind: "document", document: "<p" },
    { kind: "document", document: "<p/>", css: 1 },
    { kind: "document", document: "<p/>", css: "p {" },
    { kind: "document", document: "<p/>", schema: undefined },
  ]) {
    const capture = map.capture();
    assert.throws(() => Reflect.apply(member.replace, undefined, [invalid]));
    assert.deepEqual(map.capture(), capture);
    assert.throws(() => map.batch(writer => {
      writer.parts.components.submit.set({ document: '<button "valid prefix"/>' });
      Reflect.apply(writer.parts.components.heading.replace, undefined, [invalid]);
    }));
    assert.deepEqual(map.capture(), capture);
  }
  let expired: (() => unknown)[] = [];
  const revision = map.rev;
  map.batch(writer => {
    const library = writer.parts.components, location = library.heading;
    assert.equal("snap" in location, false);
    assert.throws(() => Reflect.get(library, "missing"), /Unknown Part member/);
    location.set({ css: "h2{color:green}" });
    writer.parts.components.submit.set({ document: '<button "Changed"/>' });
    expired = [() => library.heading, () => location.delete(), () => location.at(["document"])];
  });
  assert.equal(map.rev, revision + 1);
  for (const operation of expired) assert.throws(operation, /Expired/);

  // No registry of names: path writes immediately affect subsequent named selection.
  parts.at([]).object.setKey("later", heading);
  assert.deepEqual(Reflect.get(parts, "later").snap(), heading);
  parts.at(["later"]).delete();
  assert.throws(() => Reflect.get(parts, "later"), /Unknown Part member/);
  const ownKeys = Reflect.ownKeys(parts);
  for (const key of PARTS_FACADE_RESERVED) {
    const capability = key === "css" ? undefined : Reflect.get(parts, key);
    parts.at([]).object.setKey(key, heading);
    assert.deepEqual(parts.at([key]).snap(), heading);
    if (key === "css") assert.throws(() => Reflect.get(parts, key), /CSS is unavailable/);
    else if (key === "rev") assert.equal(Reflect.get(parts, key), map.rev);
    else assert.equal(Reflect.get(parts, key), capability, key);
  }
  assert.deepEqual(Reflect.ownKeys(parts), ownKeys);
  assert.equal(await Promise.resolve(parts), parts);
  for (const key of ["name", "length", "call", "apply", "bind", "prototype", "arguments", "caller"]) {
    parts.at([]).object.setKey(key, heading);
    assert.deepEqual(Reflect.get(parts, key).snap(), heading, key);
  }

  // Composition is unchanged: existing occurrences are independent; new admissions read current source.
  const composition = hsonLiveMap.fromLibraries({ ...definitions,
    page: { document: '<main <hson-part lib="components" at="heading"/>/>' } });
  const oldRoot = composition.doc.page.root(), oldCss = composition.doc.page.css.snapshot();
  composition.parts.components.heading.replace(replacement);
  composition.addLibraries({ laterPage: { document: '<main <hson-part lib="components" at="heading"/>/>' } });
  assert.deepEqual(composition.doc.page.root(), oldRoot);
  assert.equal(composition.doc.page.css.snapshot(), oldCss);
  assert.match(JSON.stringify(composition.doc.must("laterPage").root()), /Replacement/);
  assert.match(composition.doc.must("laterPage").css.snapshot(), /blue/);

  let retainedRead: { snap(): unknown } | undefined;
  const locus = hsonLiveMap.locus.create(definitions, { actions: { inspect(context) {
    const location = context.parts.components.heading;
    retainedRead = location;
    assert.deepEqual(location.snap(), heading);
    assert.equal("set" in location, false); assert.equal("delete" in location, false);
    assert.equal("setMany" in location.asObject()!.object, false);
    assert.equal("schema" in location, false);
    context.stage.parts.components.submit.set({ document: '<button "Action"/>' });
  } } });
  try {
    assert.equal((await locus.dispatchAction({ type: "action", id: "inspect", name: "inspect" })).type, "ack");
    const location = locus.parts.components.heading;
    await location.delete(); assert.equal(location.snap(), undefined); assert.equal(retainedRead!.snap(), undefined);
    assert.throws(() => locus.parts.components.heading, /Unknown Part member/);
    await locus.parts.components.at([]).object.setKey("heading", replacement);
    assert.deepEqual(location.snap(), replacement); assert.deepEqual(retainedRead!.snap(), replacement);
    const capture = locus.cut().libs;
    await assert.rejects(locus.stage(writer => {
      writer.parts.components.submit.set({ document: "<button/>" });
      Reflect.apply(writer.parts.components.heading.set, undefined, [{ kind: "data" }]);
    }));
    assert.deepEqual(locus.cut().libs, capture);
    await locus.stage(writer => {
      const selected = writer.parts.components.heading;
      expired = [() => selected.delete(), () => writer.parts.components.heading];
      selected.replace(heading);
    });
    for (const operation of expired) assert.throws(operation, /Expired/);
  } finally { locus.dispose(); }
}

export async function parts_member_echo_cases() {
  const locus = hsonLiveMap.locus.create({ components: { ...definitions.components, access: "shared" }, page: { document: '<main <b "text"/>/>', access: "shared" } }, {
    local: [{ name: "widgets", initializer: definitions.components }, { name: "localPage", initializer: { document: '<main <i "local"/>/>' } }],
    authorizeProjection: () => ({ libraries: ["components", "widgets", "page", "localPage"] }),
  });
  const session = await locus.session.create({ libraries: ["components", "widgets", "page", "localPage"] });
  const binding = bind_locus_http(locus, { endpoint: "/parts" });
  const transport = hsonLiveMap.echo.transport.http({ endpoint: "http://parts.test/parts",
    fetch: (input, init) => binding.handle(new Request(input, init), {}) });
  const echo = await hsonLiveMap.echo.create({ now: session.now(), credential: session.credential!, transport });
  try {
    const parts = echo.parts.must("components"), widgets = echo.parts.must("widgets");
    const document = echo.doc.must("page"), documentMust = document.must, fragmentMust = document.at([0]).must;
    assert.equal(documentMust.snap(), "<main><b>text</b></main>"); assert.equal(fragmentMust.snap(), "<b>text</b>");
    assert.equal(fragmentMust.hson(), Hson.document`<b "text"/>`);
    const localDocument = echo.doc.must("localPage"), localDocumentMust = localDocument.at([0]).must;
    if (localDocument.source !== "client-local") throw Error("Expected client-local document");
    assert.equal(localDocumentMust.snap(), "<i>local</i>");
    localDocument.at([0]).replace("changed");
    assert.equal(localDocumentMust.snap(), "changed"); assert.equal(localDocumentMust.hson(), Hson.document`"changed"`);
    const element = document.at([0]).asElement()!, elementMust = element.must;
    await locus.doc.page.at([0]).replace("after");
    await until(() => fragmentMust.snap() === "after");
    assert.equal(element.snap(), undefined); assert.throws(elementMust.snap);

    const projected = Reflect.get(parts, "heading"), local = Reflect.get(widgets, "heading");
    assert.equal(parts.source, "authority-projected"); assert.equal(widgets.source, "client-local");
    assert.equal("set" in projected, false); assert.equal("setMany" in projected.asObject().object, false);
    assert.equal("schema" in projected, false); assert.equal("schema" in local, false);
    const projectedMust = projected.must, localMust = local.must;
    assert.deepEqual(projectedMust.snap(), heading); assert.deepEqual(localMust.snap(), heading);
    assert.equal(projectedMust.hson(), projected.hson());
    assert.equal("replace" in projectedMust, false);
    local.replace(replacement); assert.deepEqual(local.snap(), replacement);
    assert.throws(() => local.set({ document: "<p/><p/>" }));
    const changes: unknown[] = [], stop = projected.watch((value: unknown) => changes.push(value));
    await locus.parts.components.heading.delete();
    await until(() => projected.snap() === undefined);
    assert.throws(projectedMust.snap); assert.throws(projectedMust.hson);
    assert.throws(() => Reflect.get(parts, "heading"), /Unknown Part member/);
    await locus.parts.components.at([]).object.setKey("heading", replacement);
    await until(() => projected.snap()?.document === replacement.document);
    assert.deepEqual(changes, [undefined, replacement]); stop();
    assert.deepEqual(projectedMust.snap(), replacement); assert.deepEqual(localMust.snap(), replacement);
    await session.update({ libraries: ["widgets"] });
    await until(() => echo.parts("components") === undefined);
    assert.throws(documentMust.snap); assert.throws(fragmentMust.hson);
    assert.throws(() => projected.snap()); assert.throws(projectedMust.snap); assert.throws(projectedMust.hson); assert.throws(() => Reflect.get(parts, "heading"));
    await session.update({ libraries: ["components", "widgets", "page", "localPage"] });
    await until(() => echo.parts("components") !== undefined);
    assert.notEqual(echo.parts.must("components"), parts);
    assert.deepEqual(Reflect.get(echo.parts.must("components"), "heading").snap(), replacement);
    assert.throws(documentMust.snap); assert.throws(fragmentMust.hson);
    assert.throws(() => projected.snap()); assert.throws(projectedMust.snap); assert.throws(projectedMust.hson); assert.throws(() => Reflect.get(parts, "heading"));
    assert.equal(echo.parts.must("widgets"), widgets); assert.deepEqual(local.snap(), replacement);
    const activeDocument = echo.doc.must("page"), activeFragment = activeDocument.at([0]);
    const activeProjected = Reflect.get(echo.parts.must("components"), "heading").must;
    const activeLocalDocument = echo.doc.must("localPage"), activeLocalFragment = activeLocalDocument.at([0]);
    assert.equal(session.revoke(), true);
    echo.disconnect(); await until(() => echo.session.status !== "attached");
    await assert.rejects(echo.session.reattach());
    const retained = Reflect.get(echo.parts.must("widgets"), "heading").must;
    echo.dispose();
    assert.throws(retained.snap, /disposed/i);
    assert.throws(retained.hson, /disposed/i);
    for (const read of [activeDocument.snap, activeDocument.must.hson, activeFragment.must.snap,
      activeProjected.snap, activeProjected.hson, activeLocalDocument.must.snap, activeLocalFragment.hson,
      activeLocalFragment.must.snap]) assert.throws(read, /disposed/i);
  } finally { echo.dispose(); transport.dispose(); binding.dispose(); locus.dispose(); }
}

async function until(test: () => boolean) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (test()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail("Echo did not observe Parts transition");
}
