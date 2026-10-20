import { locus_map_internal } from "../src/internal/governor-maps.js";
import assert from "node:assert/strict";
import { Hson, hsonLiveMap, type InteractionDescriptor } from "../src/index.ts";
import { MemoryCheckpointAdapter } from "./helpers/memory-checkpoint-adapter.mts";
import { node_to_json_value } from "../src/api/livemap/livemap.editor.ts";
import { decode_hosted_root } from "../src/api/livemap/livemap.hosted.ts";

const Count = Hson.schema`<type "data" content <value "number">>`;
const Secret = Hson.schema`<type "data" content <token "string">>`;
const listener = { event: "click", target: "element", capture: false, once: false, passive: false,
  missingTarget: "ignore", preventDefault: false, stopPropagation: false, stopImmediatePropagation: false } as const;
const descriptor: InteractionDescriptor = { id: "save", kind: "browser", key: "save", args: null,
  subject: { library: "page", path: [0] }, listener };
const css: string = "main { color: red; }";
const definition = [{ "secret": { data: { token: "hidden" }, schema: Secret, access: "private" }, "count": { data: { value: 1 }, schema: Count, access: "shared" }, "page": { document: "<main <button/>/>", access: "shared" } }, { local: [{ name: "ui", initializer: { data: { selected: false } } }], defaultProjection: { libraries: ["count", "page", "ui"] }, authorizeProjection: () => ({ libraries: ["count", "page", "ui"] }) }] as const;
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
await page.at([]).asElement()!.attrs.set("title", "owned");
assert.equal(page.at([]).asElement()!.attrs.get("title"), "owned");
assert.deepEqual(authorityCommits, [2, 3, 4]);
stopAuthorityCommits();
assert.deepEqual(locus.cut().libs.libraries.map((entry) => entry.name),
  ["secret", "count", "page", "@hson/canonical-interactions"]);
assert.equal(Hson.data.materialize(locus.data.must("count").at(["value"]).data()!), 3);
const session = await locus.session.create({ libraries: ["count", "page", "secret", "ui"] });
assert.deepEqual(session.now().libs.libraries.map((entry) => entry.name), ["count", "page"]);
assert.deepEqual(session.now().local.map((entry) => entry.name), ["ui"]);
await assert.rejects(hsonLiveMap.locus.checkpoint(locus), /no durable backing/i);
locus.dispose();

const pathAuthority = hsonLiveMap.locus.create({ "page": { document: "<main <p/>/>", access: "shared" } });
await pathAuthority.doc.must("page").at([0]).replace({ $_tag: "p", $_attrs: { title: "replaced" }, $_content: [] });
assert.equal(pathAuthority.doc.must("page").at([0]).asElement()!.attrs.get("title"), "replaced");
pathAuthority.dispose();

const styled = hsonLiveMap.locus.create({ "page": { document: "<main/>", css, access: "shared" } }, { logicalMapId: "styled-authority" });
assert.match(styled.doc.must("page").css.snapshot(), /color:red/);
styled.dispose();
const combinedDefinition = [{ "page": { document: "<main <button/>/>", css, access: "shared" } }, { interactions: [descriptor], logicalMapId: "combined-interactions-css" }] as const;
const combined = hsonLiveMap.locus.create(combinedDefinition[0], combinedDefinition[1]);
assert.equal(combined.rev, 1); // Initial CSS is admitted at revision zero; the descriptor creates one transition.
assert.match(combined.doc.must("page").css.snapshot(), /color:red/);
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
assert.match(combinedRestored.doc.must("page").css.snapshot(), /color:red/);
const restoredSystem = locus_map_internal(combinedRestored).capture().libraries.find((entry) => entry.name === "@hson/canonical-interactions");
assert.ok(restoredSystem);
const restoredValue = node_to_json_value(decode_hosted_root(restoredSystem.root));
if (typeof restoredValue !== "object" || restoredValue === null || Array.isArray(restoredValue)
  || !Array.isArray(restoredValue.descriptors)) throw new Error("Restored interaction descriptors are missing.");
assert.equal(restoredValue.descriptors.length, 1);
combinedRestored.dispose();
const storage = new MemoryCheckpointAdapter();
const durable = await hsonLiveMap.locus.resume({ "page": { document: "<main/>", css, access: "shared" } }, { logicalMapId: "styled-durable", persistence: storage });
const revision = durable.rev;
durable.dispose();
const restored = await hsonLiveMap.locus.resume({ "page": { document: "<main/>", css, access: "shared" } }, { logicalMapId: "styled-durable", persistence: storage });
assert.equal(restored.rev, revision);
assert.match(restored.doc.must("page").css.snapshot(), /color:red/);
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
  const governed = hsonLiveMap.locus.create({ "page": { document: "<main/>", css: first, access: "shared" } });
  bare.doc.must("page").css.stylesheet(first);
  assert.deepEqual(bare.capture().libraries[0]?.css, locus_map_internal(governed).capture().libraries[0]?.css);
  bare.doc.must("page").css.stylesheet(second);
  await governed.doc.must("page").css.stylesheet(second);
  assert.deepEqual(bare.capture().libraries[0]?.css, locus_map_internal(governed).capture().libraries[0]?.css);
  assert.deepEqual(bare.capture().libraries[0]?.css?.order.map((entry) => entry.kind),
    ["keyframes", "property", "rule", "rule"]);
  governed.dispose();
}
const authored = hsonLiveMap.locus.create({ "home": { document: '<html <head/> <body <main "Home"/>/>/>', schema: Hson.schema`<type "document">`, css: sheet, access: "shared" }, "slide01": { document: '<html <head/> <body <main "Slide"/>/>/>', schema: Hson.schema`<type "document">`, css: sheet, access: "shared" } });
assert.equal(authored.rev, 0);
assert.match(authored.doc.must("home").render(), /display:block/);
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
const beforeInvalid = authored.rev;
await assert.rejects(authored.doc.must("home").css.stylesheet("main { color: ; }"), /CSS|declaration|syntax/i);
assert.equal(authored.rev, beforeInvalid);
await authored.admit({ "staged": { document: "<main/>", css: sheet, access: "shared" } });
assert.equal(authored.rev, 4);
assert.deepEqual(locus_map_internal(authored).capture().libraries.find((entry) => entry.name === "staged")?.css, initialSheet);
await assert.rejects(authored.admit({ "bad": { document: "<main/>", css: "main { color: ; }", access: "shared" } }), /CSS|declaration|syntax/i);
assert.equal(authored.rev, 4);
assert.throws(() => hsonLiveMap.locus.create({ "bad": { document: "<main/>", css: "main { color: ; }", access: "shared" } }), /CSS|declaration|syntax/i);
// @ts-expect-error Data CSS remains invalid at runtime.
assert.throws(() => hsonLiveMap.locus.create({ "data": { data: 1, css: sheet, access: "shared" } }), /document/i);
authored.dispose();
const cssDurableStore = new MemoryCheckpointAdapter();
const cssDurableDefinition = [{ "page": { document: "<main/>", css: sheet, access: "shared" } }, { logicalMapId: "css-text-durable", persistence: cssDurableStore }] as const;
const cssDurable = await hsonLiveMap.locus.resume(cssDurableDefinition[0], cssDurableDefinition[1]);
assert.equal(cssDurable.rev, 0);
await cssDurable.admit({ "later": { document: "<main/>", css: sheet, access: "shared" } });
await cssDurable.doc.must("page").css.stylesheet("main { color: blue; }");
assert.equal(cssDurable.rev, 2);
cssDurable.dispose();
const cssResumed = await hsonLiveMap.locus.resume(cssDurableDefinition[0], cssDurableDefinition[1]);
assert.equal(cssResumed.rev, 2);
assert.match(cssResumed.doc.must("page").css.snapshot(), /color:blue/);
assert.deepEqual(locus_map_internal(cssResumed).capture().libraries.find((entry) => entry.name === "later")?.css, initialSheet);
cssResumed.dispose();
const localStyled = hsonLiveMap.locus.create({  }, { local: [{ name: "localPage", initializer: { document: "<html <head/> <body/>/>" }, css: sheet }], defaultProjection: { libraries: ["localPage"] }, authorizeProjection: () => ({ libraries: ["localPage"] }) });
const localSession = await localStyled.session.create({ libraries: ["localPage"] });
assert.ok(localSession.now().local.some((entry) => entry.name === "localPage" && entry.css?.rules.length === 1));
localStyled.dispose();

assert.throws(() => hsonLiveMap.locus.create({ "count": { data: { value: "wrong" }, schema: Count, access: "shared" } }),
  /Schema|invalid|mismatch/i);
console.log("ok - Locus flat construction, local initializers, CSS, and interactions");
