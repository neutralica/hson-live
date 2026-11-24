import { locus_map_internal } from "../src/internal/governor-maps.js";
import assert from "node:assert/strict";
import { Hson, hsonLiveMap, type InteractionDescriptor } from "../src/index.ts";
import { MemoryCheckpointAdapter } from "./helpers/memory-checkpoint-adapter.mts";
import { node_to_json_value } from "../src/api/livemap/livemap.editor.ts";
import { decode_hosted_root } from "../src/api/livemap/livemap.hosted.ts";
import { authority_definitions_from_catalog_fixture, create_locus_fixture } from "./helpers/locus-definition-fixture.mts";
import { structured_css_fixture } from "./helpers/structured-css-fixture.mts";

const Count = Hson.schema`<type "data" root <object <value "number">>>`;
const Secret = Hson.schema`<type "data" root <object <token "string">>>`;
const listener = { event: "click", target: "element", capture: false, once: false, passive: false,
  missingTarget: "ignore", preventDefault: false, stopPropagation: false, stopImmediatePropagation: false } as const;
const descriptor: InteractionDescriptor = { id: "save", kind: "browser", key: "save", args: null,
  subject: { library: "page", path: [0, 0, 1, 0, 0] }, listener };
const css: string = "main { color: red; }";
const structuredRecord = structured_css_fixture(".fixture-fidelity{color:teal}");
const fidelityLocus = create_locus_fixture({ ...authority_definitions_from_catalog_fixture([
  { name: "page", ownership: "shared", definition: { document: "<main/>" }, css: structuredRecord },
] as const), logicalMapId: "structured-css-fixture-map", interactions: [descriptor] });
const fidelityPage = locus_map_internal(fidelityLocus).capture().libraries.find(entry => entry.name === "page");
assert.ok(fidelityPage?.css?.order.some(entry => entry.kind === "rule"), "Fixture transport keeps structured CSS rules structured");
assert.deepEqual(fidelityPage?.css, structuredRecord, "Fixture transport preserves the canonical structured CSS record");
assert.equal(fidelityLocus.logicalMapId, "structured-css-fixture-map");
assert.equal(fidelityLocus.rev, 1, "Initial structured CSS stays at revision zero and the interaction is one transition");
fidelityLocus.dispose();
const definition = [{ "secret": { json: { token: "hidden" }, schema: Secret, access: "private" }, "count": { json: { value: 1 }, schema: Count, access: "shared" }, "page": { document: "<main <button/>/>", access: "shared" } }, { local: [{ name: "ui", initializer: { json: { selected: false } } }], defaultProjection: { libraries: ["count", "page", "ui"] }, authorizeProjection: () => ({ libraries: ["count", "page", "ui"] }) }] as const;
const locus = hsonLiveMap.locus.create({ ...definition[0] }, { ...definition[1], interactions: [descriptor] });
assert.deepEqual(locus_map_internal(locus).capture().registry.libraries.filter((entry) => entry.scope !== "hson-internal").map((entry) => entry.name),
  ["secret", "count", "page"]);
assert.throws(() => locus.data.must("ui"), /Unknown LiveMap Library/);
assert.ok(locus_map_internal(locus).capture().registry.libraries.some((entry) => entry.scope === "hson-internal"));
assert.equal("map" in locus, false);
assert.equal("lib" in locus.stage, false);
assert.equal("addLibraries" in locus.stage, false);
const authorityCommits: number[] = [];
const stopAuthorityCommits = locus.commits.observe((commit) => authorityCommits.push(commit.rev));
await locus.data.must("count").at(["value"]).set(2);
await locus.stage((loc) => { loc.data.must("count").at(["value"]).set(3); });
const page = locus.doc.must("page");
await page.at([1, 0]).asElement()!.attrs.set("title", "owned");
assert.equal(page.at([1, 0]).asElement()!.attrs.get("title"), "owned");
assert.deepEqual(authorityCommits, [2, 3, 4]);
stopAuthorityCommits();
assert.deepEqual(locus.cut().libs.libraries.map((entry) => entry.name),
  ["secret", "count", "page", "@hson/canonical-interactions"]);
assert.equal(Hson.data.fromSource((locus.data.must("count").at(["value"]).hson()!)).materialize(), 3);
const session = await locus.session.create({ libraries: ["count", "page", "secret", "ui"] });
assert.deepEqual(session.now().libs.libraries.map((entry) => entry.name), ["count", "page"]);
assert.deepEqual(session.now().local.map((entry) => entry.name), ["ui"]);
await assert.rejects(hsonLiveMap.locus.checkpoint(locus), /no durable backing/i);
locus.dispose();

const pathAuthority = hsonLiveMap.locus.create({ "page": { document: "<main <p/>/>", access: "shared" } });
await pathAuthority.doc.must("page").at([1, 0, 0]).replace({ $_tag: "p", $_attrs: { title: "replaced" }, $_content: [] });
assert.equal(pathAuthority.doc.must("page").at([1, 0, 0]).asElement()!.attrs.get("title"), "replaced");
pathAuthority.dispose();

function changing_child_index(first: number, later: number, onFirst = () => {}) {
  const path = [first];
  let reads = 0;
  Object.defineProperty(path, "0", { get() {
    if (reads++ !== 0) return later;
    onFirst();
    return first;
  } });
  return { path, reads: () => reads };
}

{
  const document = '<main <p/> "second" <section id="one" <b id="one-child"/>/> <section id="two" <b id="two-child"/>/>/>';
  const definitions = { page: { document, access: "shared" } } as const;
  const persistence = new MemoryCheckpointAdapter();
  const options = { logicalMapId: "relative-document-location", persistence };
  const authority = await hsonLiveMap.locus.resume(definitions, options);
  const page = authority.doc.must("page");
  const main = page.at([1, 0]);
  const standalone = hsonLiveMap.fromLibraries({ page: { document } }).doc.must("page");
  const standaloneMain = standalone.at([1, 0]);
  const publications: { revision: number; durableRevision: number | undefined; hson: string }[] = [];
  const stopCommits = authority.commits.observe(commit => publications.push({
    revision: commit.rev,
    durableRevision: persistence.state(options.logicalMapId)?.commits.at(-1)?.commit.rev,
    hson: page.hson(),
  }));
  let watches = 0;
  const stopWatch = main.watch(() => { watches += 1; });
  const state = () => ({
    map: locus_map_internal(authority).capture(),
    revision: authority.rev,
    publications: publications.length,
    watches,
    appends: persistence.appendCalls.length,
  });
  let saved: ReturnType<typeof state>;
  try {
    const initial = state();
    const originalPath = changing_child_index(0, 1);
    const standalonePath = changing_child_index(0, 1);
    const selected = main.at(originalPath.path);
    const standaloneSelected = standaloneMain.at(standalonePath.path);
    assert.deepEqual(selected.path(), [1, 0, 0]);
    assert.deepEqual(selected.path(), standaloneSelected.path());
    assert.equal(selected.snap(), "<p></p>");
    assert.equal(selected.asText(), undefined);
    assert.equal(standaloneSelected.asText(), undefined);
    assert.equal(originalPath.reads(), 1);
    assert.equal(standalonePath.reads(), 1);
    assert.deepEqual(state(), initial);

    const textPath = changing_child_index(1, 0);
    const standaloneTextPath = changing_child_index(1, 0);
    const text = main.at(textPath.path).asText()!;
    const standaloneText = standaloneMain.at(standaloneTextPath.path).asText()!;
    assert.equal(text.snap(), "second");
    assert.deepEqual(text.path(), standaloneText.path());
    await text.replace("updated");
    standaloneText.replace("updated");
    assert.equal(textPath.reads(), 1);
    assert.equal(standaloneTextPath.reads(), 1);
    assert.equal(main.at([0]).snap(), "<p></p>");
    assert.equal(main.at([1]).snap(), "updated");
    assert.equal(page.hson(), standalone.hson());

    let reentrant: Promise<void> | undefined;
    const parentPath = changing_child_index(2, 3, () => {
      reentrant = main.at([0]).asElement()!.attrs.set("title", "first");
    });
    const child = main.asElement()!.at(parentPath.path).asElement()!.at([0]).present()!.asElement()!;
    assert.deepEqual(child.path(), [1, 0, 2, 0]);
    assert.equal(child.attrs.get("id"), "one-child");
    assert.ok(reentrant);
    await Promise.all([reentrant, child.attrs.set("title", "selected")]);
    assert.equal(parentPath.reads(), 1);
    assert.equal(main.at([2, 0]).asElement()!.attrs.get("title"), "selected");
    assert.equal(main.at([3, 0]).asElement()!.attrs.get("title"), undefined);
    assert.match(publications[1]!.hson, /title="first"/);
    assert.doesNotMatch(publications[1]!.hson, /title="selected"/);
    assert.match(publications[2]!.hson, /title="selected"/);

    const deletePath = changing_child_index(3, 2);
    const removed = main.at(deletePath.path).asElement()!;
    assert.equal(removed.attrs.get("id"), "two");
    await removed.delete();
    assert.equal(deletePath.reads(), 1);
    assert.equal(main.at([2]).asElement()!.attrs.get("id"), "one");
    assert.equal(main.at([3]).present(), undefined);

    const beforeInvalid = state();
    const invalidPath = changing_child_index(-1, 0);
    assert.throws(() => main.at(invalidPath.path), { code: "INVALID_DOCUMENT_PATH_INDEX" });
    assert.equal(invalidPath.reads(), 1);
    const missingPath = changing_child_index(99, 0);
    const missing = main.at(missingPath.path);
    assert.equal(missing.present(), undefined);
    await assert.rejects(missing.delete(), { code: "CONTENT_INDEX_OUT_OF_RANGE" });
    assert.equal(missingPath.reads(), 1);
    await assert.rejects(authority.stage(draft => {
      const candidate = draft.doc.must("page").at([1, 0]);
      candidate.at([0]).asElement().attrs.set("title", "rollback");
      candidate.at([99]).delete();
    }), { code: "CONTENT_INDEX_OUT_OF_RANGE" });
    assert.deepEqual(state(), beforeInvalid);

    const retainedPath = changing_child_index(1, 0);
    const retainedText = main.at(retainedPath.path).asText()!;
    const preceding = main.at([1]).replace({ $_tag: "em", $_content: [] });
    const rejected = assert.rejects(retainedText.delete(), /Document location is not text/);
    assert.equal(retainedText.snap(), "updated");
    await preceding;
    const afterPreceding = state();
    await rejected;
    assert.equal(retainedPath.reads(), 1);
    assert.equal(retainedText.snap(), undefined);
    assert.equal(main.at([1]).snap(), "<em></em>");
    assert.deepEqual(state(), afterPreceding);

    assert.deepEqual(publications.map(({ revision, durableRevision }) => [revision, durableRevision]),
      [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5]]);
    assert.equal(watches, 5);
    assert.equal(persistence.appendCalls.length, 5);
    saved = state();
  } finally {
    stopWatch();
    stopCommits();
    authority.dispose();
  }
  const recovered = await hsonLiveMap.locus.resume(definitions, options);
  try {
    assert.equal(recovered.rev, saved.revision);
    assert.equal(recovered.doc.must("page").hson(), publications.at(-1)!.hson);
    assert.equal(persistence.appendCalls.length, saved.appends);
  } finally {
    recovered.dispose();
  }
}

const styled = hsonLiveMap.locus.create({ "page": { document: "<main/>", stylesheet: css, access: "shared" } }, { logicalMapId: "styled-authority" });
assert.equal(styled.doc.must("page").css.snapshot(), css);
styled.dispose();
const combinedDefinition = [{ "page": { document: "<main <button/>/>", stylesheet: css, access: "shared" } }, { interactions: [descriptor], logicalMapId: "combined-interactions-css" }] as const;
const combined = hsonLiveMap.locus.create(combinedDefinition[0], combinedDefinition[1]);
assert.equal(combined.rev, 1); // Initial CSS is admitted at revision zero; the descriptor creates one transition.
assert.equal(combined.doc.must("page").css.snapshot(), css);
const combinedSystem = locus_map_internal(combined).capture().libraries.find((entry) => entry.name === "@hson/canonical-interactions");
assert.ok(combinedSystem);
const combinedValue = node_to_json_value(decode_hosted_root(combinedSystem.root));
if (typeof combinedValue !== "object" || combinedValue === null || Array.isArray(combinedValue)
  || !Array.isArray(combinedValue.descriptors)) throw new Error("Initial interaction descriptors are missing.");
assert.equal(combinedValue.descriptors.length, 1);
  assert.equal(typeof combined.doc.must("page").css.clearAll, "function");
combined.dispose();
const combinedStorage = new MemoryCheckpointAdapter();
const combinedDurable = await hsonLiveMap.locus.resume({ ...combinedDefinition[0] }, { ...combinedDefinition[1], persistence: combinedStorage });
assert.equal(combinedDurable.rev, 1);
combinedDurable.dispose();
const combinedRestored = await hsonLiveMap.locus.resume({ ...combinedDefinition[0] }, { ...combinedDefinition[1], persistence: combinedStorage });
assert.equal(combinedRestored.rev, 1);
assert.equal(combinedRestored.doc.must("page").css.snapshot(), css);
const restoredSystem = locus_map_internal(combinedRestored).capture().libraries.find((entry) => entry.name === "@hson/canonical-interactions");
assert.ok(restoredSystem);
const restoredValue = node_to_json_value(decode_hosted_root(restoredSystem.root));
if (typeof restoredValue !== "object" || restoredValue === null || Array.isArray(restoredValue)
  || !Array.isArray(restoredValue.descriptors)) throw new Error("Restored interaction descriptors are missing.");
assert.equal(restoredValue.descriptors.length, 1);
combinedRestored.dispose();
const storage = new MemoryCheckpointAdapter();
const durable = await hsonLiveMap.locus.resume({ "page": { document: "<main/>", stylesheet: css, access: "shared" } }, { logicalMapId: "styled-durable", persistence: storage });
const revision = durable.rev;
durable.dispose();
const restored = await hsonLiveMap.locus.resume({ "page": { document: "<main/>", stylesheet: css, access: "shared" } }, { logicalMapId: "styled-durable", persistence: storage });
assert.equal(restored.rev, revision);
assert.equal(restored.doc.must("page").css.snapshot(), css);
restored.dispose();

const sheet: string = "main { display: block; } @keyframes pulse { from { opacity: 0; } to { opacity: 1; } }";
{
  const first = `main { color: red; --tone: red; }
    @property --tone { syntax: "<color>"; inherits: false; initial-value: red; }
    @keyframes pulse { from { opacity: 0; } to { opacity: 1; } }`;
  const second = `@keyframes pulse { from { opacity: .2; } to { opacity: .8; } }
    @property --tone { syntax: "<color>"; inherits: false; initial-value: blue; }
    main { color: blue; --tone: blue; }
    main { display: grid; }`;
  const bare = hsonLiveMap.fromLibraries({ page: { document: "<main/>" } });
  const governed = hsonLiveMap.locus.create({ "page": { document: "<main/>", stylesheet: first, access: "shared" } });
  bare.doc.must("page").css.stylesheet(first);
  assert.deepEqual(bare.capture().libraries[0]?.css, locus_map_internal(governed).capture().libraries[0]?.css);
  assert.deepEqual(bare.capture().libraries[0]?.css,
    { rules: [], properties: [], keyframes: [], order: [{ kind: "text", text: first }] });
  bare.doc.must("page").css.stylesheet(second);
  await governed.doc.must("page").css.stylesheet(second);
  assert.deepEqual(bare.capture().libraries[0]?.css, locus_map_internal(governed).capture().libraries[0]?.css);
  assert.deepEqual(bare.capture().libraries[0]?.css,
    { rules: [], properties: [], keyframes: [], order: [{ kind: "text", text: second }] });
  assert.equal(bare.doc.must("page").css.snapshot(), second);
  assert.equal(governed.doc.must("page").css.snapshot(), second);
  assert.deepEqual(governed.doc.must("page").css.list(), []);
  bare.doc.must("page").css.sel("main").setMany({ color: "green" });
  await governed.doc.must("page").css.sel("main").setMany({ color: "green" });
  assert.deepEqual(bare.capture().libraries[0]?.css, locus_map_internal(governed).capture().libraries[0]?.css);
  assert.deepEqual(bare.capture().libraries[0]?.css?.order.map((entry) => entry.kind),
    ["text", "rule"]);
  assert.deepEqual(bare.capture().libraries[0]?.css?.order[0], { kind: "text", text: second });
  assert.deepEqual(bare.capture().libraries[0]?.css?.rules.map((rule) => rule.declarations), [[["color", "green"]]]);
  assert.equal(bare.doc.must("page").css.snapshot(), `${second}\n\nmain{color:green;}`);
  assert.equal(governed.doc.must("page").css.snapshot(), bare.doc.must("page").css.snapshot());
  governed.dispose();
}
const authored = hsonLiveMap.locus.create({ "home": { document: '<html <head/> <body <main "Home"/>/>/>', schema: Hson.schema`<type "document">`, stylesheet: sheet, access: "shared" }, "slide01": { document: '<html <head/> <body <main "Slide"/>/>/>', schema: Hson.schema`<type "document">`, stylesheet: sheet, access: "shared" } });
assert.equal(authored.rev, 0);
assert.ok(authored.doc.must("home").render().includes(`>${sheet}</style>`));
const initialSheet = locus_map_internal(authored).capture().libraries.find((entry) => entry.name === "home")?.css;
assert.ok(initialSheet);
await authored.doc.must("home").css.stylesheet("main { color: red; }");
assert.equal(authored.rev, 1);
await authored.doc.must("home").css.stylesheet(sheet);
assert.deepEqual(locus_map_internal(authored).capture().libraries.find((entry) => entry.name === "home")?.css, initialSheet);
assert.equal(authored.rev, 2);
await authored.doc.must("slide01").css.stylesheet("");
assert.equal(authored.doc.must("slide01").css.snapshot(), "");
assert.equal(authored.rev, 3);
await authored.stage((draft) => { draft.doc.must("home").css.stylesheet(sheet); });
assert.equal(authored.rev, 3);
const malformedCss = "main { color: ; }";
await authored.doc.must("home").css.stylesheet(malformedCss);
assert.equal(authored.rev, 4);
assert.equal(authored.doc.must("home").css.snapshot(), malformedCss);
assert.equal(authored.doc.must("slide01").css.snapshot(), "");
const beforeInvalid = authored.rev;
await assert.rejects(authored.doc.must("home").css.sel("main").setMany({ color: "red; background: blue" }), /CSS|declaration|syntax/i);
assert.equal(authored.rev, beforeInvalid);
assert.equal(authored.doc.must("home").css.snapshot(), malformedCss);
await authored.admit({ "staged": { document: "<main/>", stylesheet: sheet, access: "shared" } });
assert.equal(authored.rev, 5);
assert.deepEqual(locus_map_internal(authored).capture().libraries.find((entry) => entry.name === "staged")?.css, initialSheet);
await authored.admit({ "bad": { document: "<main/>", stylesheet: malformedCss, access: "shared" } });
assert.equal(authored.rev, 6);
assert.equal(authored.doc.must("bad").css.snapshot(), malformedCss);
const opaqueStyled = hsonLiveMap.locus.create({ "bad": { document: "<main/>", stylesheet: malformedCss, access: "shared" } });
assert.equal(opaqueStyled.rev, 0);
assert.equal(opaqueStyled.doc.must("bad").css.snapshot(), malformedCss);
opaqueStyled.dispose();
// @ts-expect-error Data CSS remains invalid at runtime.
assert.throws(() => hsonLiveMap.locus.create({ "data": { json: 1, stylesheet: sheet, access: "shared" } }), /document/i);
authored.dispose();
const cssDurableStore = new MemoryCheckpointAdapter();
const cssDurableDefinition = [{ "page": { document: "<main/>", stylesheet: sheet, access: "shared" } }, { logicalMapId: "css-text-durable", persistence: cssDurableStore }] as const;
const cssDurable = await hsonLiveMap.locus.resume(cssDurableDefinition[0], cssDurableDefinition[1]);
assert.equal(cssDurable.rev, 0);
await cssDurable.admit({ "later": { document: "<main/>", stylesheet: sheet, access: "shared" } });
await cssDurable.doc.must("page").css.stylesheet("main { color: blue; }");
assert.equal(cssDurable.rev, 2);
cssDurable.dispose();
const cssResumed = await hsonLiveMap.locus.resume(cssDurableDefinition[0], cssDurableDefinition[1]);
assert.equal(cssResumed.rev, 2);
assert.equal(cssResumed.doc.must("page").css.snapshot(), "main { color: blue; }");
assert.deepEqual(locus_map_internal(cssResumed).capture().libraries.find((entry) => entry.name === "later")?.css, initialSheet);
cssResumed.dispose();
const localStyled = hsonLiveMap.locus.create({  }, { local: [{ name: "localPage", initializer: { document: "<html <head/> <body/>/>" }, stylesheet: sheet }], defaultProjection: { libraries: ["localPage"] }, authorizeProjection: () => ({ libraries: ["localPage"] }) });
const localSession = await localStyled.session.create({ libraries: ["localPage"] });
assert.deepEqual(localSession.now().local.find((entry) => entry.name === "localPage")?.css,
  { rules: [], properties: [], keyframes: [], order: [{ kind: "text", text: sheet }] });
localStyled.dispose();

assert.throws(() => hsonLiveMap.locus.create({ "count": { json: { value: "wrong" }, schema: Count, access: "shared" } }),
  /Schema|invalid|mismatch/i);
console.log("ok - Locus flat construction, local initializers, CSS, and interactions");
