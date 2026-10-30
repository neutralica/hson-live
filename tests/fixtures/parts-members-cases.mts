import assert from "node:assert/strict";
import { Hson, hsonLiveMap, bind_locus_http } from "../../src/index.js";
import { internal_livemap_aggregate_authority } from "../../src/api/livemap/livemap.internal.js";
import { enumerate_livemap_issued_quids } from "../../src/api/livemap/livemap.identity-epoch.js";
import { make_livemap_client_composition_from_portable_aggregate_internal } from "../../src/api/livemap/livemap.libraries.js";
import { make_portable_aggregate_snapshot, make_portable_aggregate_commit } from "../../src/api/livemap/livemap.hosted.js";
import { admit_projected_value } from "../../src/core/projected-value-admission.js";
import { PARTS_FACADE_RESERVED } from "../../src/internal/parts-facade.js";

const heading = { kind: "document", document: Hson.document`<h1 hson:part "Initial"/>`, stylesheet: "h1{color:red}" } as const;
const replacement = { kind: "document", document: '<h2 hson:part "Replacement"/>', stylesheet: "h2{color:blue}" } as const;
const definitions = { components: { parts: { heading, submit: { kind: "document" as const, document: "<button hson:part/>" } } } };

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
  for (const attempt of [() => member.delete(), () => member.replace(heading),
    () => parts.at([]).object.setKey("heading", replacement),
    () => member.at(["document"]).set(replacement.document)]) {
    assert.throws(attempt, /Immutable Part/);
    assert.deepEqual(member.snap(), heading);
    assert.deepEqual(map.capture(), before);
    assert.deepEqual(enumerate_livemap_issued_quids(aggregate.identityEpoch().issued()), issued);
  }
  assert.deepEqual(watched, []); assert.deepEqual(fed, []); assert.equal(commits, 0);
  unwatch(); unfeed(); stopCommits();

  const replaySource = hsonLiveMap.fromLibraries(definitions);
  const replayAuthority = internal_livemap_aggregate_authority(replaySource);
  const snapshot = make_portable_aggregate_snapshot(replayAuthority.captureHosted());
  const replay = make_livemap_client_composition_from_portable_aggregate_internal(snapshot);
  const retainedReplay = Reflect.get(replay.parts.must("components"), "heading");
  const receiver = internal_livemap_aggregate_authority(replay), manager = {};
  receiver.claimManagement(manager);
  try {
    const record = replayAuthority.commit([{ target: replayAuthority.target(replayAuthority.libraries()[0]!, []),
      kind: "set-key", key: "newName", value: admit_projected_value(replacement) }]);
    receiver.replayClientHostedManaged(manager, make_portable_aggregate_commit(record.hosted!)!, snapshot.revision);
    assert.deepEqual(retainedReplay.snap(), heading);
    assert.deepEqual(replay.parts.must("components").at(["newName"]).snap(), replacement);
  } finally { receiver.releaseManagement(manager); }

  for (const invalid of [
    { kind: "data", document: "<p/>" }, { kind: "document", document: 3 },
    { kind: "document", document: "<p hson:part/><p/>" }, { kind: "document", document: "<p" },
    { kind: "document", document: "<p hson:part/>", stylesheet: 1 },
    { kind: "document", document: "<p hson:part/>", schema: undefined },
  ]) {
    const capture = map.capture();
    assert.throws(() => Reflect.apply(member.replace, undefined, [invalid]));
    assert.deepEqual(map.capture(), capture);
    assert.throws(() => map.batch(writer => {
      writer.parts.components.submit.set({ document: '<button hson:part "valid prefix"/>' });
      Reflect.apply(writer.parts.components.heading.replace, undefined, [invalid]);
    }));
    assert.deepEqual(map.capture(), capture);
  }
  const opaqueStylesheet = hsonLiveMap.fromLibraries({ components: { parts: {
    malformedText: { kind: "document", document: "<p hson:part/>", stylesheet: "p {" },
  } } });
  assert.equal(opaqueStylesheet.parts.components.malformedText.snap()?.stylesheet, "p {");
  let expired: (() => unknown)[] = [];
  const revision = map.rev;
  map.batch(writer => {
    const library = writer.parts.components, location = library.heading;
    assert.equal("snap" in location, false);
    assert.throws(() => Reflect.get(library, "missing"), /Unknown Part member/);
    library.at([]).object.setKey("stagedNew", replacement);
    expired = [() => library.heading, () => location.delete(), () => location.at(["document"])];
  });
  assert.equal(map.rev, revision + 1);
  for (const operation of expired) assert.throws(operation, /Expired/);

  // New names become available immediately after admission.
  parts.at([]).object.setKey("later", heading);
  assert.deepEqual(Reflect.get(parts, "later").snap(), heading);
  assert.throws(() => parts.at(["later"]).delete(), /Immutable Part/);
  assert.deepEqual(Reflect.get(parts, "later").snap(), heading);
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
  assert.throws(() => composition.parts.components.heading.replace(replacement), /Immutable Part/);
  composition.addLibraries({ laterPage: { document: '<main <hson-part lib="components" at="heading"/>/>' } });
  assert.deepEqual(composition.doc.page.root(), oldRoot);
  assert.equal(composition.doc.page.css.snapshot(), oldCss);
  assert.match(JSON.stringify(composition.doc.must("laterPage").root()), /Initial/);
  assert.match(composition.doc.must("laterPage").css.snapshot(), /red/);

  let retainedRead: { snap(): unknown } | undefined;
  const locus = hsonLiveMap.locus.create(definitions, { actions: { inspect(context) {
    const location = context.parts.components.heading;
    retainedRead = location;
    assert.deepEqual(location.snap(), heading);
    assert.equal("set" in location, false); assert.equal("delete" in location, false);
    assert.equal("setMany" in location.asObject()!.object, false);
    assert.equal("schema" in location, false);
    context.stage.parts.components.at([]).object.setKey("actionNew", replacement);
  } } });
  try {
    assert.equal((await locus.dispatchAction({ type: "action", id: "inspect", name: "inspect" })).type, "ack");
    const location = locus.parts.components.heading;
    await assert.rejects(location.delete(), /Immutable Part/);
    await assert.rejects(locus.parts.components.at([]).object.setKey("heading", replacement), /Immutable Part/);
    assert.deepEqual(location.snap(), heading); assert.deepEqual(retainedRead!.snap(), heading);
    const capture = locus.cut().libs;
    await assert.rejects(locus.stage(writer => {
      writer.parts.components.submit.set({ document: "<button hson:part/>" });
      Reflect.apply(writer.parts.components.heading.set, undefined, [{ kind: "data" }]);
    }));
    assert.deepEqual(locus.cut().libs, capture);
    await locus.stage(writer => {
      const selected = writer.parts.components.heading;
      expired = [() => selected.delete(), () => writer.parts.components.heading];
      writer.parts.components.at([]).object.setKey("stageNew", replacement);
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
    for (const library of [parts, widgets]) {
      assert.equal(library.snap(["heading", "document"]), heading.document);
      assert.deepEqual(library.at([]).snap(), library.snap());
      assert.deepEqual(Reflect.apply(library.at([]).snap, undefined, [["heading", "document"]]), library.snap());
    }
    const document = echo.doc.must("page"), documentMust = document.must, fragmentMust = document.at([1, 0, 0]).must;
    assert.equal(documentMust.snap(), "<html><head></head><body><main><b>text</b></main></body></html>"); assert.equal(fragmentMust.snap(), "<b>text</b>");
    assert.equal(fragmentMust.hson(), Hson.document`<b "text"/>`);
    const localDocument = echo.doc.must("localPage"), localDocumentMust = localDocument.at([1, 0, 0]).must;
    if (localDocument.source !== "client-local") throw Error("Expected client-local document");
    assert.equal(localDocumentMust.snap(), "<i>local</i>");
    localDocument.at([1, 0, 0]).replace("changed");
    assert.equal(localDocumentMust.snap(), "changed"); assert.equal(localDocumentMust.hson(), Hson.document`"changed"`);
    const element = document.at([1, 0, 0]).asElement()!, elementMust = element.must;
    await locus.doc.page.at([1, 0, 0]).replace("after");
    await until(() => fragmentMust.snap() === "after");
    assert.equal(element.snap(), undefined); assert.throws(elementMust.snap);

    const projected = Reflect.get(parts, "heading"), local = Reflect.get(widgets, "heading");
    for (const library of [parts, widgets]) {
      const member = library.at(["heading"]);
      assert.throws(() => library.snap(["heading", "stylesheet"] as never), /field access/);
      assert.throws(() => member.at([]).asObject()!.at(["css"] as never), /field access/);
      assert.throws(() => member.asObject()!.object.getKey("stylesheet" as never), /field access/);
    }
    const projectedWrite = projected.write, localWrite = local.write;
    const revision = parts.rev;
    assert.equal(projectedWrite(), Reflect.get(parts.at(["heading"]), "write")());
    assert.equal(localWrite(), Reflect.get(widgets.at(["heading"]), "write")());
    assert.equal(projectedWrite(), Hson.document`<hson-part lib="components" at="heading"/>`);
    assert.equal(localWrite(), Hson.document`<hson-part lib="widgets" at="heading"/>`);
    assert.equal(parts.rev, revision);
    assert.equal("write" in parts, false); assert.equal("write" in projected.at(["document"]), false);
    assert.equal(parts.source, "authority-projected"); assert.equal(widgets.source, "client-local");
    assert.equal("set" in projected, false); assert.equal("setMany" in projected.asObject().object, false);
    assert.equal("schema" in projected, false); assert.equal("schema" in local, false);
    const projectedMust = projected.must, localMust = local.must;
    assert.deepEqual(projectedMust.snap(), heading); assert.deepEqual(localMust.snap(), heading);
    assert.equal(projectedMust.hson(), projected.hson());
    assert.equal("replace" in projectedMust, false);
    assert.throws(() => local.replace(replacement), /Immutable Part/); assert.deepEqual(local.snap(), heading);
    assert.throws(() => local.set({ document: "<p/><p/>" }));
    const changes: unknown[] = [], stop = projected.watch((value: unknown) => changes.push(value));
    await assert.rejects(locus.parts.components.heading.delete(), /Immutable Part/);
    await assert.rejects(locus.parts.components.at([]).object.setKey("heading", replacement), /Immutable Part/);
    await locus.parts.components.at([]).object.setKey("expanded", replacement);
    await until(() => parts.at(["expanded"]).snap() !== undefined);
    assert.deepEqual(changes, []); stop();
    assert.deepEqual(projectedMust.snap(), heading); assert.deepEqual(localMust.snap(), heading);
    assert.equal(projectedWrite(), Hson.document`<hson-part lib="components" at="heading"/>`);
    await session.update({ libraries: ["widgets"] });
    await until(() => echo.parts("components") === undefined);
    assert.throws(projectedWrite);
    assert.throws(documentMust.snap); assert.throws(fragmentMust.hson);
    assert.throws(() => projected.snap()); assert.throws(projectedMust.snap); assert.throws(projectedMust.hson); assert.throws(() => Reflect.get(parts, "heading"));
    await session.update({ libraries: ["components", "widgets", "page", "localPage"] });
    await until(() => echo.parts("components") !== undefined);
    assert.notEqual(echo.parts.must("components"), parts);
    assert.throws(projectedWrite);
    assert.equal(Reflect.get(echo.parts.must("components").at(["heading"]), "write")(), Hson.document`<hson-part lib="components" at="heading"/>`);
    assert.deepEqual(Reflect.get(echo.parts.must("components"), "heading").snap(), heading);
    assert.throws(documentMust.snap); assert.throws(fragmentMust.hson);
    assert.throws(() => projected.snap()); assert.throws(projectedMust.snap); assert.throws(projectedMust.hson); assert.throws(() => Reflect.get(parts, "heading"));
    assert.equal(echo.parts.must("widgets"), widgets); assert.deepEqual(local.snap(), heading);
    const activeDocument = echo.doc.must("page"), activeFragment = activeDocument.at([1, 0, 0]);
    const activeProjected = Reflect.get(echo.parts.must("components"), "heading").must;
    const activeProjectedWrite = Reflect.get(echo.parts.must("components"), "heading").write;
    const activeLocalDocument = echo.doc.must("localPage"), activeLocalFragment = activeLocalDocument.at([1, 0, 0]);
    assert.equal(session.revoke(), true);
    echo.disconnect(); await until(() => echo.session.status !== "attached");
    await assert.rejects(echo.session.reattach());
    const retained = Reflect.get(echo.parts.must("widgets"), "heading").must;
    echo.dispose();
    assert.throws(localWrite, /disposed/i);
    assert.throws(activeProjectedWrite, /disposed/i);
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
