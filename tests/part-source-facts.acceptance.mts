import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { tmpdir } from "node:os";
import { collect_part_source_facts, static_part_inventory, type PartSourceLocation } from "../src/internal/hson-schema/part-source.ts";
import { static_schema_candidate_diagnostics } from "../src/internal/hson-schema/candidate-diagnostics.ts";
import { discover_hson_schema_declarations } from "../src/internal/hson-schema/schema-discovery.ts";
import { library_source_definitions } from "../src/internal/hson-schema/library-source.ts";
import { read_supported_hson_import_symbols } from "../src/internal/embedded-hson/discover-hson-tagged-templates.ts";
import { query_hson_part_source } from "../src/internal/editor-introspection/query.ts";
import { part_data_contexts, part_data_projection } from "../src/internal/editor-introspection/part-data-evidence.ts";
import { OBJECT_VALUE, schema_projection_description } from "../src/internal/hson-schema/data-projection.ts";
import { forwarding_fixture, write_fixture } from "./fixtures/part-forwarding-cases.mts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({ id: "part-source-facts", title: "Compiler-owned Part source facts", category: "Tooling", runtime: "node", tags: Object.freeze(["parts", "source-evidence", "typescript", "provenance"]) });
const events = create_test_event_emitter(HSON_LIVE_TEST_METADATA.id);
function check(name: string, run: () => void): void {
  events.case_begin(name, name);
  try { run(); events.case_end(name, "pass"); }
  catch (error) { events.diagnostic(name, "assertion", String(error)); events.case_end(name, "fail"); events.terminal("fail"); throw error; }
}
const root = resolve(import.meta.dirname, "..");
const directory = mkdtempSync(join(tmpdir(), "part-source-facts-"));
process.once("exit", () => rmSync(directory, { recursive: true, force: true }));
writeFileSync(join(directory, "package.json"), '{"type":"module"}');
const source = String.raw`
import { Hson as Text, hson as kit, hsonLiveMap as maps } from "hson-live";
import { hsonLiveMap as submap } from "hson-live/livemap";
import * as namespace from "hson-live/livemap";
import { parts as importedParts, definitions } from "./definitions.js";
declare const dynamic: any, key: string, condition: boolean;
const Page = Text.schema\`<type "document" tag "main" content <sequence «<tag "h1">»>>\`;
const Shared = Text.document\`<main <hson-part lib="components" at="heading" content="hello" mixed-Case="x"/>/>\`;
const deck = kit.liveMap.locus.create({ components: { parts: importedParts } });
const fresh = maps.fromLibraries({ page: { document: Shared, schema: Page }, components: { parts: {
  heading: { kind: "document", document: Text.document\`<h1 hson:part title="%{mixed-Case}" "%{content} %{content}"/>\` },
  "a.b": { kind: "document", document: "<p hson:part/>" },
} } });
const reverse = kit.liveMap.locus.create({ components: { parts: { heading: { kind: "document", document: "<h1 hson:part/>" } } }, page: { document: Shared } });
const lines = Text.document\`<main
  <hson-part lib="components" at="heading"/>
/>\`;
const escaped = Text.document\`<p "%\u007bMixed-name}"/>\`;
const nested = Text.document\`<div <hson-part lib="components" at="a.b" mixed-Case="v"/>/>\`;
const another = maps.fromLibraries({ components: { parts: { different: { kind: "document", document: "<p hson:part/>" } } } });
const later = deck.admit({ page: { document: Shared } });
const added = fresh.addLibraries({ next: { document: Shared } });
const resumed = kit.liveMap.locus.resume({ components: { parts: { heading: { kind: "document", document: "<h1 hson:part/>" } } } }, dynamic);
const sub = submap.locus.create({ components: { parts: { heading: { kind: "document", document: "<h1 hson:part/>" } } } });
const ns = namespace.locus.create({ components: { parts: { heading: { kind: "document", document: "<h1 hson:part/>" } } } });
const subLocal = namespace.fromLibraries({ components: { parts: { heading: { kind: "document", document: "<h1 hson:part/>" } } } });
const umbrellaLocal = kit.liveMap.fromLibraries({ components: { parts: { heading: { kind: "document", document: "<h1 hson:part/>" } } } });
const literalName = maps.fromLibraries({ "mixed-Library": { parts: { heading: { kind: "document", document: "<h1 hson:part/>" } } } });
const computed = maps.fromLibraries({ [key]: { parts: { heading: { kind: "document", document: "<h1 hson:part/>" } } } });
const computedLiteral = maps.fromLibraries({ ["components"]: { parts: { heading: { kind: "document", document: "<h1 hson:part/>" } } } });
const partial = maps.fromLibraries({ ...dynamic, components: { parts: { heading: { kind: "document", document: "<h1 hson:part/>" }, ...dynamic } } });
const opaque = maps.fromLibraries(dynamic);
const alias = maps.fromLibraries(definitions);
const conditional = maps.fromLibraries({ page: { document: condition ? Shared : Text.document\`<aside/>\` } });
const badEscape = maps.fromLibraries({ components: { parts: { heading: { kind: "document", document: Text.document\`// \8
<h1/>\` } } } });
const optionalTag = maps.fromLibraries({ components: { parts: { heading: { kind: "document", document: Text?.document\`<h1 hson:part/>\` } } } });
const wrongProducer = maps.fromLibraries({ components: { parts: { heading: { kind: "document", document: Text.canonical\`<h1/>\` } } } });
const invalidRoot = maps.fromLibraries({ components: { parts: { heading: { kind: "document", document: Text.document\`<h1 hson:part/><p/>\` } } } });
const invalidSibling = maps.fromLibraries({ components: { parts: { heading: { kind: "document", document: "<h1 hson:part/>" }, bad: { kind: "document", document: "<p" } } } });
const parameterBad = maps.fromLibraries({ components: { parts: { heading: { kind: "document", document: Text.document\`<h1 hson:part onclick="%{bad}" "%{good}"/>\` } } } });
const structuredBad = maps.fromLibraries({ components: { parts: { heading: { kind: "document", document: Text.document\`<h1 hson:part style="color:%{bad}"/>\` } } } });
const scriptBad = maps.fromLibraries({ components: { parts: { heading: { kind: "document", document: Text.document\`<script hson:part "%{bad}"/>\` } } } });
const malformedPlaceholder = maps.fromLibraries({ components: { parts: { heading: { kind: "document", document: Text.document\`<h1 hson:part "%{broken!}"/>\` } } } });
const unfinished = Text.document\`<main <hson-part lib="components" at="hea\`;
const malformed = Text.document\`<main <hson-part lib="components" at="heading"/> <bad attr="\`;
const dynamicCoordinate = Text.document\`<hson-part lib="\${key}" at="heading" content="\${dynamic}"/>\`;
const partialQuoted = Text.document\`<main title="%{pre\${key}fix}" "%{pre\${key}fix}" <hson-part lib="co\${key}mponents" at="head\${key}ing"/><hson-part lib="components" at="heading"/>/>\`;
const placeholderCoordinate = Text.document\`<hson-part lib="%{Library}" at="%{Member}"/>\`;
const ordinaryString = maps.fromLibraries({ page: { document: '<hson-part lib="mixed-Library" at="\u0061.b"/>' } });
const mismatch = kit.liveMap.locus.create({ page: { document: Shared, schema: Page }, components: { parts: { heading: { kind: "document", document: "<p hson:part \"%{content} %{mixed-Case}\"/>" } } } });
const independent = Page.certify(Text.document\`<aside/>\`);
const placementGood = Text.document\`<main <script src="/app.js" type="%{Script-Attr}"/> <style media=%{Style-Attr}/>/>\`;
const placementBad = Text.document\`<main title="%{Good-name}" <script title="%{Own-attr}" <span title="%{Bad-attr}" "%{Bad-text}"/>/> <style <p id=%{Bad-style}/>/>/>\`;
const fake = { liveMap: { locus: { create: (x: unknown) => x } } };
fake.liveMap.locus.create({ wrong: { parts: {} } });
const fakeMaps: typeof maps = dynamic;
fakeMaps.locus.create({ wrong: { parts: {} } });
function shadow(kit: typeof import("hson-live").hson, Text: typeof import("hson-live").Hson) {
  kit.liveMap.locus.create({ wrong: { parts: {} } });
  return Text.document\`<hson-part lib="wrong" at="wrong"/>\`;
}
`.replaceAll('\\`', '`').replaceAll('\\${', '${');
// CRLF before and inside tagged source must map through normalized template raw bytes.
const withCrlf = source.replaceAll("\n", "\r\n");
writeFileSync(join(directory, "index.ts"), withCrlf);
writeFileSync(join(directory, "definitions.ts"), 'import { Hson } from "hson-live/hson";\n'
  + 'const heading = Hson.document`<h1 hson:part "%{content}"/>`;\n'
  + 'export const parts = { heading: { kind: "document", document: heading } } as const;\n'
  + 'export const definitions = { components: { parts } };\n');
writeFileSync(join(directory, "umbrella-only.ts"), 'import { Hson, hson, ANY_DOCUMENT } from "hson-live";\n'
  + 'const S = Hson.schema`<type "document" tag "article">`;\n'
  + 'const loc = hson.liveMap.fromLibraries({ page: { document: "<aside/>", schema: S } });\n'
  + 'const advisory = hson.liveMap.fromLibraries({ page: { document: "<aside/>", schema: ANY_DOCUMENT } });\n'
  + 'advisory.doc.must("page").schema.use(S);\n');
const options: ts.CompilerOptions = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
  strict: true, skipLibCheck: true, noEmit: true, baseUrl: root, paths: {
    "hson-live": ["src/index.ts"], "hson-live/hson": ["src/hson-authoring.ts"], "hson-live/livemap": ["src/api/livemap/index.ts"],
  } };
const program = ts.createProgram([join(directory, "index.ts"), join(directory, "umbrella-only.ts")], options);
const facts = collect_part_source_facts(ts, program);
const batch = (name: string) => {
  const found = facts.batches.find(item => ts.isVariableDeclaration(item.call.parent) && item.call.parent.name.getText() === name);
  assert.ok(found, `Missing batch ${name}`); return found;
};
const library = (name: string) => { const found = batch(name).libraries.find(item => item.family === "parts"); assert.ok(found, name); return found; };
const doc = (name: string) => {
  const found = facts.documents.find(item => ts.isVariableDeclaration(item.producer.parent) && item.producer.parent.name.getText() === name);
  assert.ok(found, `Missing document ${name}`); return found;
};
const slice = (where: PartSourceLocation) => program.getSourceFile(where.file)!.text.slice(where.start, where.end);

check("official umbrella, subpath, namespace imports and aliases retain exported value identity", () => {
  for (const name of ["deck", "fresh", "reverse", "sub", "ns", "subLocal", "umbrellaLocal"]) assert.equal(batch(name).inventoryCompleteness, "complete", name);
  assert.equal(batch("resumed").receivingInventory, "open");
  assert.equal(batch("later").operation, "admit");
  assert.equal(batch("added").operation, "addLibraries");
  assert.ok(!facts.batches.some(item => item.call.getText().includes("wrong")));
  assert.ok(!facts.documents.some(item => item.producer.getText().includes('lib="wrong"')));
});
check("admitted names differ from identifiers; known members and parameters preserve spelling", () => {
  assert.equal(library("deck").name, "components");
  assert.deepEqual(library("deck").members.map(item => item.name), ["heading"]);
  assert.equal(library("deck").memberCompleteness, "partial");
  assert.equal(library("deck").members[0]!.certainty, "possible");
  const heading = library("fresh").members[0]!;
  assert.equal(library("fresh").memberCompleteness, "complete");
  assert.equal(heading.certainty, "certain");
  assert.deepEqual(heading.documents[0]!.parameters.map(item => item.name).sort(), ["content", "mixed-Case"]);
  assert.equal(heading.documents[0]!.parameters.find(item => item.name === "content")!.uses.length, 2);
  assert.equal(library("fresh").members[1]!.name, "a.b");
  assert.equal(doc("nested").connectors[0]!.attributes.find(item => item.name === "at")!.value, "a.b");
});
check("complete same-batch forward references are independent of field order", () => {
  for (const name of ["fresh", "reverse"]) {
    const found = doc("Shared").receivers.find(item => item.batch === batch(name).call);
    assert.equal(found?.certainty, "certain"); assert.equal(found?.library?.name, "page");
  }
  assert.equal(batch("later").receivingInventory, "open");
  assert.equal(batch("later").libraries.some(item => item.name === "components"), false);
});
check("partial quoted source stays opaque without hiding later literal facts", () => {
  const found = doc("partialQuoted");
  assert.equal(found.parameterCompleteness, "unknown");
  assert.deepEqual(found.parameters, []);
  assert.deepEqual(found.connectors[0]!.attributes.map(attr => attr.value), [undefined, undefined]);
  assert.deepEqual(found.connectors[1]!.attributes.map(attr => attr.value), ["components", "heading"]);
});
check("partial, dynamic, computed and aliased inventories retain uncertainty", () => {
  assert.equal(library("literalName").name, "mixed-Library");
  for (const name of ["computed"]) {
    assert.equal(library(name).name, undefined); assert.equal(batch(name).inventoryCompleteness, "partial");
    assert.equal(library(name).certainty, "possible");
  }
  assert.equal(library("computedLiteral").name, "components");
  assert.equal(batch("computedLiteral").inventoryCompleteness, "complete");
  assert.equal(library("computedLiteral").certainty, "certain");
  assert.equal(batch("opaque").inventoryCompleteness, "unknown");
  assert.equal(batch("partial").inventoryCompleteness, "partial");
  assert.equal(library("partial").memberCompleteness, "partial");
  assert.equal(batch("alias").inventoryCompleteness, "partial");
  assert.equal(library("alias").certainty, "possible");
  assert.equal(doc("Shared").receivers.find(item => item.batch === batch("conditional").call)?.certainty, "possible");
});
check("candidate receivers and similarly named Libraries remain separate", () => {
  const possible = doc("nested").receivers;
  assert.ok(possible.length > 1 && possible.every(item => item.certainty === "possible" && item.library === undefined));
  assert.notEqual(library("fresh"), library("another"));
  assert.deepEqual(library("another").members.map(item => item.name), ["different"]);
  assert.ok(possible.some(item => item.batch === batch("fresh").call));
  assert.ok(possible.some(item => item.batch === batch("another").call));
  assert.equal(library("fresh").members[0]!.documents[0], facts.documents.find(item => item.producer === library("fresh").members[0]!.documents[0]!.producer));
});
check("rejected or unsupported producers never establish authoritative Part inventories", () => {
  for (const name of ["badEscape", "optionalTag", "wrongProducer", "invalidRoot", "invalidSibling"]) {
    assert.notEqual(library(name).memberCompleteness, "complete", name);
    const definitions = batch(name).call.arguments[0]!; assert.ok(ts.isObjectLiteralExpression(definitions));
    assert.equal(static_part_inventory(ts, program.getTypeChecker(), definitions).size, 0, name);
  }
  for (const name of ["parameterBad", "structuredBad", "scriptBad", "malformedPlaceholder"]) {
    const document = library(name).members[0]!.documents[0]!;
    assert.equal(document.parameterCompleteness, "unknown", name); assert.deepEqual(document.parameters, [], name);
  }
});
check("production scanner preserves safe incomplete-header facts and stops at malformed source", () => {
  const incomplete = doc("unfinished");
  assert.equal(incomplete.admission, "unknown"); assert.equal(incomplete.parameterCompleteness, "unknown");
  assert.equal(incomplete.connectors[0]!.headerComplete, false);
  assert.equal(incomplete.connectors[0]!.attributes.find(item => item.name === "lib")?.value, "components");
  assert.equal(incomplete.connectors[0]!.attributes.some(item => item.name === "at"), false);
  assert.equal(doc("malformed").admission, "unknown"); assert.equal(doc("malformed").connectors[0]!.headerComplete, true);
  assert.equal(doc("dynamicCoordinate").connectors[0]!.attributes.find(item => item.name === "lib")?.value, undefined);
  assert.equal(doc("dynamicCoordinate").connectors[0]!.attributes.find(item => item.name === "at")?.value, "heading");
  assert.equal(doc("placeholderCoordinate").connectors[0]!.attributes.find(item => item.name === "lib")?.value, undefined);
});
check("advisory spelling and individual member admission never upgrade collection evidence", () => {
  assert.equal(library("fresh").members[0]!.admission, "qualified");
  assert.equal(library("partial").members[0]!.admission, "qualified");
  assert.equal(library("partial").memberCompleteness, "partial");
  for (const name of ["badEscape", "optionalTag", "wrongProducer", "invalidRoot"]) assert.equal(library(name).members[0]!.admission, "unknown", name);
  assert.deepEqual(library("parameterBad").members[0]!.documents[0]!.parameterSpellings.map(item => item.name), ["good"]);
  for (const name of ["structuredBad", "scriptBad"]) assert.deepEqual(library(name).members[0]!.documents[0]!.parameterSpellings, [], name);
});
check("shared placement excludes descendant vocabulary while retaining script/style own attributes", () => {
  assert.equal(doc("placementGood").parameterCompleteness, "complete");
  assert.deepEqual(doc("placementGood").parameters.map(item => item.name).sort(), ["Script-Attr", "Style-Attr"]);
  assert.deepEqual(doc("placementGood").parameterSpellings.map(item => item.name).sort(), ["Script-Attr", "Style-Attr"]);
  const rejected = doc("placementBad");
  assert.equal(rejected.parameterCompleteness, "unknown"); assert.deepEqual(rejected.parameters, []);
  assert.deepEqual(rejected.parameterSpellings.map(item => item.name).sort(), ["Good-name", "Own-attr"]);
  assert.ok(rejected.parameterSpellings.flatMap(item => item.uses).every(use => !slice(use.location).includes("Bad-")));
});
check("declaration, attribute and placeholder ranges stay in original host coordinates", () => {
  const heading = library("fresh").members[0]!;
  assert.ok(slice(heading.declaration).startsWith("heading:"));
  assert.equal(slice(library("fresh").nameLocation!), "components");
  for (const use of heading.documents[0]!.parameters.flatMap(item => item.uses)) assert.ok(slice(use.location).includes("%{"));
  const normalizedAttr = doc("lines").connectors[0]!.attributes.find(item => item.name === "lib")!;
  assert.equal(slice(normalizedAttr.valueLocation!), '"components"');
  assert.equal(doc("escaped").parameters[0]!.name, "Mixed-name");
  assert.ok(slice(doc("escaped").parameters[0]!.uses[0]!.location).includes("\\u007b"));
  const attr = doc("Shared").connectors[0]!.attributes.find(item => item.name === "lib")!;
  assert.equal(slice(attr.nameLocation), "lib"); assert.equal(slice(attr.valueLocation!), '"components"');
  const ordinary = batch("ordinaryString").libraries[0]!;
  const stringDoc = facts.documents.find(item => item.receivers.some(receiver => receiver.library === ordinary))!;
  assert.ok(stringDoc.connectors[0]);
  const stringAttr = stringDoc.connectors[0]!.attributes.find(item => item.name === "at")!;
  assert.equal(slice(stringAttr.valueLocation!), '"\\u0061.b"');
  const queried = query_hson_part_source(facts, attr.nameLocation.file, attr.nameLocation.start);
  assert.equal(queried?.document, doc("Shared")); assert.equal(queried?.connector, doc("Shared").connectors[0]);
  assert.equal(query_hson_part_source(facts, attr.nameLocation.file, -1), undefined);
});
check("Schema candidates still expand complete Parts and preserve independent diagnostic ranges", () => {
  const diagnostics = static_schema_candidate_diagnostics(ts, program);
  assert.equal(diagnostics.length, 3, JSON.stringify(diagnostics));
  assert.ok(diagnostics.every(item => item.code === "INVALID_LITERAL"));
  const umbrella = diagnostics.filter(item => item.file.endsWith("/umbrella-only.ts"));
  assert.equal(umbrella.length, 1, "post-admission schema.use cannot govern the advisory Library");
  assert.equal(program.getSourceFile(umbrella[0]!.file)!.text.slice(umbrella[0]!.start, umbrella[0]!.end), '"<aside/>"');
  assert.ok(diagnostics.some(item => item.file.endsWith("/umbrella-only.ts") && item.message.includes('received "aside"')));
  assert.ok(diagnostics.some(item => withCrlf.slice(item.start, item.end) === "aside"));
  assert.ok(diagnostics.some(item => item.message.includes('received "p"')));
  assert.ok(!diagnostics.some(item => item.message.includes('received "hson-part"')));
});
// Independent source files keep malformed producers from invalidating unrelated candidates.
function evidenceProject(name: string, files: Readonly<Record<string, string>>) {
  const folder = join(directory, name); mkdirSync(folder);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(folder, name), text);
  const program = ts.createProgram(Object.keys(files).map(name => join(folder, name)), options);
  const facts = collect_part_source_facts(ts, program);
  const batch = (name: string) => {
    const found = facts.batches.find(item => ts.isVariableDeclaration(item.call.parent) && item.call.parent.name.getText() === name);
    assert.ok(found, `Missing batch ${name}`); return found;
  };
  const library = (name: string) => { const found = batch(name).libraries.find(item => item.family === "parts"); assert.ok(found, name); return found; };
  const document = (name: string) => {
    const found = facts.documents.find(item => ts.isVariableDeclaration(item.producer.parent) && item.producer.parent.name.getText() === name);
    assert.ok(found, `Missing document ${name}`); return found;
  };
  const slice = (location: PartSourceLocation) => program.getSourceFile(location.file)!.text.slice(location.start, location.end);
  return { program, facts, batch, library, document, slice };
}
const imports = 'import { Hson as Text, hson as kit, hsonLiveMap as maps } from "hson-live";\n';

check("recovered TypeScript never qualifies a producer or establishes complete Parts evidence", () => {
  const malformed = imports + String.raw`
const valid = maps.fromLibraries({ components: { parts: { heading: { kind: "document", document: "<h1 hson:part/>" } } } });
const recovered = '<main <hson-part lib="components" at="heading"/> // \8\n/>';
const broken = maps.fromLibraries({ components: { parts: { heading: { kind: "document", document: recovered } } } });
const invalidTemplate = maps.fromLibraries({ components: { parts: { heading: { kind: "document", document: Text.document\`// \8
<h1/>\` } } } });
`.replaceAll('\\`', '`');
  const eof = imports + 'const eof = maps.fromLibraries({ components: { parts: { heading: { kind: "document", document: "<h1 hson:part/>';
  const newline = imports + 'const newline = maps.fromLibraries({ components: { parts: { heading: { kind: "document", document: "<h1 hson:part/>\n} } } });';
  const test = evidenceProject("syntax-recovery", { "index.ts": malformed, "eof.ts": eof, "newline.ts": newline });
  assert.ok(test.program.getSyntacticDiagnostics().length > 0);
  for (const name of ["broken", "invalidTemplate", "eof", "newline"]) {
    assert.notEqual(test.library(name).memberCompleteness, "complete", name);
    assert.equal(test.library(name).certainty, "possible", name);
    assert.ok(test.library(name).members.every(member => member.certainty === "possible"), name);
    const definitions = test.batch(name).call.arguments[0]!; assert.ok(ts.isObjectLiteralExpression(definitions));
    assert.equal(static_part_inventory(ts, test.program.getTypeChecker(), definitions).size, 0, name);
  }
  assert.equal(test.library("valid").memberCompleteness, "complete");
  assert.equal(test.library("valid").members[0]!.certainty, "certain");
  assert.equal(test.batch("valid").inventoryCompleteness, "complete");
  const observed = test.document("recovered");
  assert.equal(observed.admission, "unknown"); assert.equal(observed.parameterCompleteness, "unknown");
  assert.ok(observed.receivers.every(receiver => receiver.certainty === "possible"));
  const lib = observed.connectors[0]!.attributes.find(attribute => attribute.name === "lib")!;
  assert.equal(lib.value, "components"); assert.equal(test.slice(lib.valueLocation!), '"components"');
  assert.equal(query_hson_part_source(test.facts, lib.nameLocation.file, lib.nameLocation.start)?.document, observed);
});

check("complete member enumeration agrees with collection validation for every static kind carrier", () => {
  const text = imports + [
    'const kind = "document";',
    'const complete = maps.fromLibraries({ page: { document: Text.document`<hson-part lib="components" at="template"/>` }, components: { parts: {',
    '  literal: { kind: "document", document: Text.document`<p hson:part "%{mixed-Case}"/>` },',
    '  template: { kind: `document`, document: "<p hson:part/>" },',
    '  alias: { kind: kind, document: "<p hson:part/>" },',
    '  shorthand: { kind, document: "<p hson:part/>" },',
    '} } });',
    'declare const unknownKind: string;',
    'const partialKinds = maps.fromLibraries({ components: { parts: { known: { kind, document: "<p hson:part/>" }, unknown: { kind: unknownKind, document: "<p hson:part/>" } } } });',
  ].join("\r\n");
  const test = evidenceProject("kind-carriers", { "index.ts": text });
  const library = test.library("complete");
  assert.equal(library.memberCompleteness, "complete");
  assert.deepEqual(library.members.map(member => member.name), ["literal", "template", "alias", "shorthand"]);
  const definitions = test.batch("complete").call.arguments[0]!; assert.ok(ts.isObjectLiteralExpression(definitions));
  const inventory = static_part_inventory(ts, test.program.getTypeChecker(), definitions);
  assert.deepEqual(Object.keys(inventory.get("components")!), library.members.map(member => member.name));
  for (const member of library.members) {
    assert.equal(member.certainty, "certain"); assert.equal(member.documents[0]!.admission, "qualified");
    assert.equal(member.documents[0]!.receivers.find(receiver => receiver.library === library)?.batch, test.batch("complete").call);
    assert.equal(member.documents[0]!.receivers.find(receiver => receiver.library === library)?.certainty, "certain");
  }
  assert.equal(library.members[0]!.documents[0]!.parameters[0]!.name, "mixed-Case");
  assert.equal(test.library("partialKinds").memberCompleteness, "partial");
  assert.deepEqual(test.library("partialKinds").members.map(member => member.name), ["known", "unknown"]);
  assert.ok(test.library("partialKinds").members.every(member => member.certainty === "possible"));
});

check("receiving admission provenance rejects Pick impostors and preserves genuine aliases", () => {
  const text = imports + [
    'import { receiver as importedReceiver } from "./owners.js";',
    'const S = Text.schema`<type "document" tag "main">`;',
    'const real = kit.liveMap.locus.create({}); const alias = real; const alias2 = alias;',
    'const fake: Pick<typeof real, "admit"> = { admit: (...args) => real.admit(...args) };',
    'const impostor = fake.admit({ page: { document: Text.document`<aside/>`, schema: S }, components: { parts: {} } });',
    'const genuine = alias2.admit({ page: { document: Text.document`<main/>`, schema: S }, components: { parts: {} } });',
    'const imported = importedReceiver.admit({ page: { document: Text.document`<main/>` } });',
    'const local = maps.create(); const localAlias = local;',
    'const fakeLocal: Pick<typeof local, "addLibraries"> = { addLibraries: (...args) => local.addLibraries(...args) };',
    'const localImpostor = fakeLocal.addLibraries({ page: { document: Text.document`<aside/>`, schema: S } });',
    'const genuineLocal = localAlias.addLibraries({ page: { document: Text.document`<main/>`, schema: S } });',
    'const literalLocal = maps.fromLibraries({}); const literalAlias = literalLocal;',
    'const genuineLiteralLocal = literalAlias.addLibraries({ page: { document: Text.document`<main/>` } });',
    'const direct = kit.liveMap.locus.create({}).admit({ page: { document: Text.document`<main/>` } });',
    'declare const onlyTyped: typeof real;',
    'const unknownOwner = onlyTyped.admit({ page: { document: Text.document`<aside/>`, schema: S } });',
    'async function restore(configuration: Parameters<typeof kit.liveMap.locus.resume>[1]) { const restored = await kit.liveMap.locus.resume({}, configuration);',
    'const resumedAdmission = restored.admit({ page: { document: Text.document`<main/>` } }); }',
    'const actualFailure = alias.admit({ page: { document: Text.document`<aside/>`, schema: S } });',
  ].join("\n");
  const test = evidenceProject("receiver-provenance", { "index.ts": text,
    "owners.ts": 'import { hsonLiveMap as api } from "hson-live/livemap"; export const receiver = api.locus.create({});' });
  for (const name of ["impostor", "localImpostor", "unknownOwner"]) assert.ok(!test.facts.batches.some(batch => ts.isVariableDeclaration(batch.call.parent) && batch.call.parent.name.getText() === name), name);
  for (const name of ["genuine", "imported", "genuineLocal", "genuineLiteralLocal", "direct", "resumedAdmission"]) {
    const batch = test.batch(name); assert.equal(batch.inventoryCompleteness, "complete", name);
    const related = test.facts.documents.filter(document => document.receivers.some(receiver => receiver.batch === batch.call));
    assert.ok(related.some(document => document.receivers.some(receiver => receiver.batch === batch.call && receiver.certainty === "certain")), name);
  }
  const diagnostics = static_schema_candidate_diagnostics(ts, test.program);
  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
  assert.ok(diagnostics[0]!.message.includes('received "aside"'));
});

check("filtering direct, aliased and nested alternatives cannot upgrade receiving certainty", () => {
  const text = imports + [
    'declare const condition: boolean, dynamic: unknown;',
    'const known = Text.document`<main <hson-part lib="components" at="heading"/>/>`;',
    'const selection = condition ? known : Text.canonical`<p/>`;',
    'const selectionAlias = selection;',
    'const nestedSelection = condition ? selectionAlias : (condition ? dynamic : known);',
    'const directChoice = maps.fromLibraries({ page: { document: condition ? known : Text.canonical`<p/>` } });',
    'const aliasChoice = maps.fromLibraries({ page: { document: selectionAlias } });',
    'const nestedChoice = maps.fromLibraries({ page: { document: nestedSelection } });',
    'const uncertainChoice = maps.fromLibraries({ page: { document: condition ? known : dynamic } });',
    'const certainChoice = maps.fromLibraries({ page: { document: known }, components: { parts: { heading: { kind: "document", document: "<h1 hson:part/>" } } } });',
  ].join("\n");
  const test = evidenceProject("alternative-certainty", { "index.ts": text });
  const known = test.document("known"); assert.equal(known.admission, "qualified");
  for (const name of ["directChoice", "aliasChoice", "nestedChoice", "uncertainChoice"]) {
    const associations = known.receivers.filter(receiver => receiver.batch === test.batch(name).call);
    assert.ok(associations.length > 0, name); assert.ok(associations.every(receiver => receiver.certainty === "possible"), name);
    assert.ok(associations.every(receiver => receiver.library?.name === "page"), name);
    assert.ok(associations.every(receiver => receiver.library?.certainty === "possible"), name);
  }
  assert.equal(known.receivers.find(receiver => receiver.batch === test.batch("certainChoice").call)?.certainty, "certain");
});

check("nested source queries choose the innermost authored segment and exclude expression gaps", () => {
  const text = imports + [
    'declare const key: string;',
    'const outer = Text.document`<main',
    '  ${Text.document`<div ${Text.document`<hson-part lib="inner" at="inside"/>`} <hson-part lib="middle" at="between"/>/>`}',
    '  <hson-part lib="outer" at="outside"/>',
    '/>`;',
    'const coordinate = Text.document`<hson-part lib="${key}" at="heading"/>`;',
  ].join("\r\n");
  const test = evidenceProject("nested-regions", { "index.ts": text });
  const file = test.document("outer").location.file;
  for (const [lib, at] of [["inner", "inside"], ["middle", "between"], ["outer", "outside"]]) {
    for (const spelling of [`lib="${lib}"`, `at="${at}"`]) {
      const context = query_hson_part_source(test.facts, file, text.indexOf(spelling) + 2)!;
      assert.ok(context, spelling); assert.equal(context.connector?.attributes.find(attribute => attribute.name === "lib")?.value, lib);
      assert.equal(context.connector?.attributes.find(attribute => attribute.name === "at")?.value, at);
      assert.ok(context.document.authoredRanges.some(range => range.start <= text.indexOf(spelling) && range.end > text.indexOf(spelling)));
      assert.equal(test.slice(context.connector!.attributes.find(attribute => attribute.name === "lib")!.valueLocation!), `"${lib}"`);
      if (lib === "inner") assert.notEqual(context.document, test.document("outer"));
    }
  }
  const expression = text.indexOf('${key}') + 2;
  assert.equal(query_hson_part_source(test.facts, file, expression), undefined);
  assert.equal(query_hson_part_source(test.facts, file, text.indexOf('${Text.document') + 2), undefined);
  const coordinate = test.document("coordinate"); assert.equal(coordinate.admission, "unknown");
  assert.ok(coordinate.receivers.every(receiver => receiver.certainty === "possible"));
  assert.equal(query_hson_part_source(test.facts, file, text.indexOf('at="heading"') + 2)?.document, coordinate);
});
check("malformed constructor and alias dependencies withdraw admission authority locally", () => {
  const text = imports + [
    'const S = Text.schema`<type "document" tag "main">`;',
    'const observed = Text.document`<aside <hson-part lib="bits" at="heading"/>/>`;',
    'const brokenOwner = kit.liveMap.locus.create({ broken: });',
    'const brokenAlias = brokenOwner; const brokenAlias2 = brokenAlias;',
    'const brokenAdmission = brokenAlias2.admit({ page: { document: observed, schema: S }, bits: { parts: { heading: { kind: "document", document: "<h1 hson:part/>" } } } });',
    'const brokenLocal = maps.fromLibraries({ broken: }); const localAlias = brokenLocal;',
    'const brokenAddition = localAlias.addLibraries({ bits: { parts: { heading: { kind: "document", document: "<h1 hson:part/>" } } }, page: { document: observed, schema: S } });',
    'const validOwner = kit.liveMap.locus.create({});',
    'const validAdmission = validOwner.admit({ page: { document: observed, schema: S }, bits: { parts: { heading: { kind: "document", document: "<h1 hson:part/>" } } } });',
    'const validSibling = maps.fromLibraries({ page: { document: "<main/>", schema: S }, bits: { parts: {} } });',
  ].join("\r\n");
  const test = evidenceProject("constructor-dependencies", { "index.ts": text });
  assert.equal(test.program.getSyntacticDiagnostics().length, 2);
  const source = test.program.getSourceFile(test.batch("brokenAdmission").location.file)!;
  const checker = test.program.getTypeChecker(), symbols = read_supported_hson_import_symbols(source, checker, [], "hsonLiveMap", ts);
  for (const name of ["brokenAdmission", "brokenAddition"]) {
    const batch = test.batch(name), library = test.library(name);
    assert.equal(batch.eligible, false, name); assert.equal(batch.inventoryCompleteness, "partial", name);
    assert.equal(library.certainty, "possible", name); assert.equal(library.memberCompleteness, "partial", name);
    assert.equal(library.members[0]!.certainty, "possible", name);
    assert.equal(library_source_definitions(batch.call, checker, symbols, false, ts), undefined, name);
    const receiving = test.document("observed").receivers.find(receiver => receiver.batch === batch.call)!;
    assert.equal(receiving.certainty, "possible"); assert.equal(receiving.library?.name, "page");
  }
  assert.equal(test.document("observed").admission, "qualified");
  for (const name of ["validAdmission", "validSibling"]) {
    assert.equal(test.batch(name).eligible, true); assert.equal(test.batch(name).inventoryCompleteness, "complete");
    assert.equal(test.library(name).certainty, "certain"); assert.equal(test.library(name).memberCompleteness, "complete");
  }
  assert.equal(test.document("observed").receivers.find(receiver => receiver.batch === test.batch("validAdmission").call)?.certainty, "certain");
  const diagnostics = static_schema_candidate_diagnostics(ts, test.program);
  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
  assert.equal(diagnostics[0]!.start, test.document("observed").location.start);
  assert.equal(diagnostics[0]!.end, test.document("observed").location.end);
});

check("malformed official imports retain observations but cannot authorize Part or Schema evidence", () => {
  const badHson = imports + [
    'import { Hson as BrokenText, type HsonDocument as BrokenDocument } from "hson-live',
    'const S = Text.schema`<type "document" tag "main">`;',
    'const RecoveredSchema = BrokenText.schema`<type "document" tag "main">`;',
    'const observed = BrokenText.document`<aside <hson-part lib="bits" at="heading"/> "%{mixed-Case}"/>`;',
    'const docAlias = observed; const nextAlias = docAlias;',
    'const badDocument = maps.fromLibraries({ page: { document: nextAlias, schema: S }, bits: { parts: { heading: { kind: "document", document: observed } } } });',
    'const badContract = maps.fromLibraries({ page: { document: "<aside/>", schema: RecoveredSchema } });',
    'const badAnnotation: BrokenDocument<typeof S> = Text.document`<aside/>`;',
    'const validSibling = maps.fromLibraries({ page: { document: Text.document`<aside/>`, schema: S }, bits: { parts: {} } });',
  ].join("\r\n");
  const badMaps = imports + [
    'import { hson as brokenKit, hsonLiveMap as brokenMaps } from "hson-live',
    'const S = Text.schema`<type "document" tag "main">`;',
    'const observedMap = Text.document`<aside <hson-part lib="bits" at="heading"/>/>`;',
    'const badUmbrella = brokenKit.liveMap.locus.create({ page: { document: observedMap, schema: S }, bits: { parts: {} } });',
    'const badDirect = brokenMaps.fromLibraries({ page: { document: observedMap, schema: S }, bits: { parts: {} } });',
    'const ownerAlias = badUmbrella; const badAdmit = ownerAlias.admit({ bits: { parts: {} }, page: { document: observedMap, schema: S } });',
    'const localAlias = badDirect; const badAdd = localAlias.addLibraries({ bits: { parts: {} }, page: { document: observedMap, schema: S } });',
    'const validMapSibling = kit.liveMap.locus.create({ page: { document: "<main/>", schema: S }, bits: { parts: {} } });',
  ].join("\r\n");
  const test = evidenceProject("import-dependencies", { "hson.ts": badHson, "maps.ts": badMaps });
  assert.equal(test.program.getSyntacticDiagnostics().length, 2);
  const observed = test.document("observed");
  assert.equal(observed.admission, "unknown"); assert.equal(observed.parameterCompleteness, "unknown");
  assert.deepEqual(observed.parameters, []);
  const lib = observed.connectors[0]!.attributes.find(attribute => attribute.name === "lib")!;
  assert.equal(test.slice(lib.valueLocation!), '"bits"');
  assert.equal(query_hson_part_source(test.facts, lib.nameLocation.file, lib.nameLocation.start)?.document, observed);
  assert.equal(test.batch("badDocument").eligible, true); // The map provenance is independently valid.
  assert.equal(test.library("badDocument").memberCompleteness, "partial");
  assert.equal(test.library("badDocument").certainty, "possible");
  assert.ok(observed.receivers.every(receiver => receiver.certainty === "possible"));
  for (const name of ["badUmbrella", "badDirect", "badAdmit", "badAdd"]) {
    assert.equal(test.batch(name).eligible, false, name);
    assert.equal(test.batch(name).inventoryCompleteness, "partial", name);
    assert.equal(test.library(name).memberCompleteness, "partial", name);
    assert.equal(test.library(name).certainty, "possible", name);
    assert.equal(test.document("observedMap").receivers.find(receiver => receiver.batch === test.batch(name).call)?.certainty, "possible", name);
  }
  const checker = test.program.getTypeChecker();
  const source = test.program.getSourceFile(observed.location.file)!;
  const schemas = discover_hson_schema_declarations(ts, source, checker);
  assert.equal(schemas.find(schema => schema.name === "S")?.eligible, true);
  assert.equal(schemas.find(schema => schema.name === "RecoveredSchema")?.eligible, false);
  for (const name of ["validSibling", "validMapSibling"]) {
    assert.equal(test.batch(name).eligible, true); assert.equal(test.batch(name).inventoryCompleteness, "complete");
    assert.equal(test.library(name).certainty, "certain"); assert.equal(test.library(name).memberCompleteness, "complete");
  }
  const diagnostics = static_schema_candidate_diagnostics(ts, test.program);
  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
  assert.equal(diagnostics[0]!.file, source.fileName);
  assert.equal(source.text.slice(diagnostics[0]!.start, diagnostics[0]!.end), "aside");
});

check("imported immutable values validate every provenance hop without rejecting siblings", () => {
  const text = imports + [
    'import { receiver as validReceiver } from "./owners.js";',
    'import { receiver as bridgedReceiver } from "./bridge.js";',
    'import { receiver as starReceiver } from "./star.js";',
    'import { receiver as validStarReceiver } from "./valid-star.js";',
    'import { receiver, document as importedDocument, schema as importedSchema } from "./owners.js',
    'const alias = receiver;',
    'const badImported = alias.admit({ bits: { parts: {} } });',
    'const badDocumentAlias = importedDocument;',
    'const S = Text.schema`<type "document" tag "main">`;',
    'const badImportedDocument = maps.fromLibraries({ page: { document: badDocumentAlias, schema: S } });',
    'const badImportedSchema = maps.fromLibraries({ page: { document: "<aside/>", schema: importedSchema } });',
    'const valid = maps.fromLibraries({ bits: { parts: {} } });',
    'const validImported = validReceiver.admit({ bits: { parts: {} } });',
    'const badBridge = bridgedReceiver.admit({ bits: { parts: {} } });',
    'const badStar = starReceiver.admit({ bits: { parts: {} } });',
    'const validStar = validStarReceiver.admit({ bits: { parts: {} } });',
  ].join("\n");
  const test = evidenceProject("imported-alias-dependencies", { "index.ts": text,
    "owners.ts": imports + 'export const receiver = maps.locus.create({}); export const document = Text.document`<aside/>`; export const schema = Text.schema`<type "document" tag "main">`;\nconst unrelated = ;',
    "bridge.ts": 'import { receiver as recovered } from "./owners.js\nexport { recovered as receiver };',
    "star.ts": 'export * from "./owners.js\n',
    "valid-star.ts": 'export * from "./owners.js";' });
  assert.equal(test.program.getSyntacticDiagnostics().length, 4);
  assert.equal(test.batch("badImported").eligible, false);
  assert.equal(test.batch("badImported").inventoryCompleteness, "partial");
  assert.equal(test.library("badImported").certainty, "possible");
  assert.equal(test.library("badImported").memberCompleteness, "partial");
  const document = test.document("document"); assert.equal(document.admission, "qualified");
  assert.equal(document.receivers.find(receiver => receiver.batch === test.batch("badImportedDocument").call)?.certainty, "possible");
  assert.equal(test.batch("valid").eligible, true); assert.equal(test.library("valid").memberCompleteness, "complete");
  assert.equal(test.batch("validImported").eligible, true); assert.equal(test.library("validImported").memberCompleteness, "complete");
  assert.equal(test.batch("badBridge").eligible, false); assert.equal(test.library("badBridge").memberCompleteness, "partial");
  assert.equal(test.batch("badStar").eligible, false); assert.equal(test.library("badStar").memberCompleteness, "partial");
  assert.equal(test.batch("validStar").eligible, true); assert.equal(test.library("validStar").memberCompleteness, "complete");
  assert.deepEqual(static_schema_candidate_diagnostics(ts, test.program), []);
});

check("awaited resume aliases retain context while unsupported receiving transformations stay unproven", () => {
  const text = imports + [
    'async function restore(configuration: Parameters<typeof maps.locus.resume>[1]) {',
    '  const directOwner = await maps.locus.resume({}, configuration);',
    '  const pending = maps.locus.resume({}, configuration); const pendingAlias = pending;',
    '  const restored = await (pendingAlias); const restoredAlias = restored;',
    '  const observed = Text.document`<main <hson-part lib="bits" at="heading"/>/>`;',
    '  const direct = directOwner.admit({ page: { document: observed }, bits: { parts: { heading: { kind: "document", document: "<h1 hson:part/>" } } } });',
    '  const aliased = restoredAlias.admit({ page: { document: observed }, bits: { parts: { heading: { kind: "document", document: "<h1 hson:part/>" } } } });',
    '  const awaitedReceiver = (await pendingAlias).admit({ bits: { parts: {} } });',
    '  let mutablePending = pending; const mutableOwner = await mutablePending;',
    '  const mutable = mutableOwner.admit({ bits: { parts: {} } });',
    '  const fake: Pick<typeof restored, "admit"> = { admit: (...args) => restored.admit(...args) };',
    '  const impostor = fake.admit({ bits: { parts: {} } });',
    '  const typedOwner = null as unknown as typeof restored;',
    '  const typed = typedOwner.admit({ bits: { parts: {} } });',
    '  const wrapped = await Promise.resolve(pending);',
    '  const arbitraryPromise = wrapped.admit({ bits: { parts: {} } });',
    '}',
  ].join("\n");
  const test = evidenceProject("awaited-aliases", { "index.ts": text });
  assert.deepEqual(test.program.getSyntacticDiagnostics(), []);
  const observed = test.document("observed"); assert.equal(observed.admission, "qualified");
  for (const name of ["direct", "aliased", "awaitedReceiver"]) {
    const batch = test.batch(name);
    assert.equal(batch.eligible, true, name); assert.equal(batch.operation, "admit");
    assert.equal(batch.inventoryCompleteness, "complete"); assert.equal(batch.receivingInventory, "open");
    assert.equal(test.library(name).certainty, "certain"); assert.equal(test.library(name).memberCompleteness, "complete");
    if (name !== "awaitedReceiver") {
      const receiver = observed.receivers.find(receiver => receiver.batch === batch.call)!;
      assert.equal(receiver.certainty, "certain"); assert.equal(receiver.library?.name, "page");
      assert.equal(test.library(name).members[0]!.certainty, "certain");
    }
  }
  assert.notEqual(test.batch("direct").call, test.batch("aliased").call);
  for (const name of ["mutable", "impostor", "typed", "arbitraryPromise"]) {
    assert.ok(!test.facts.batches.some(batch => ts.isVariableDeclaration(batch.call.parent) && batch.call.parent.name.getText() === name), name);
  }
});
check("structured arguments expose root names, selector spellings and whole forwarding without scanning data", () => {
  const template = '<section hson:part data:slide="%{payload}" title="^{slide.title}" <hson-part at="child" payload:data="^{slide.details}" literal:data="\\\"%{phantom}\\\""/> <b ' + JSON.stringify('^{slide["odd}key"]}') + '/>/>';
  const text = 'import { Hson, hsonLiveMap as maps } from "hson-live";\nconst definition = ' + JSON.stringify(template)
    + ';\nconst map = maps.fromLibraries({ components: { parts: { x: {kind:"document", document:definition} } } });';
  const test = evidenceProject("structured-arguments", { "index.ts": text });
  const definition = test.document("definition");
  assert.equal(definition.parameterCompleteness, "complete");
  assert.deepEqual(definition.parameters.map(parameter => parameter.name), ["payload"]);
  assert.deepEqual(definition.receivingDeclarations.map(({name, incoming}) => ({name, incoming})), [{name:"slide", incoming:"payload"}]);
  assert.equal(test.slice(definition.receivingDeclarations[0]!.location), JSON.stringify('"%{payload}"').slice(1, -1));
  assert.deepEqual(definition.referenceIssues, []);
  const uses = definition.parameters[0]!.uses;
  assert.deepEqual(uses.map(use => use.reference).sort(), ['slide.details', 'slide.title', 'slide["odd}key"]']);
  assert.ok(uses.every(use => use.structured && use.location.precision === "exact"));
  assert.ok(uses.every(use => test.slice(use.location).includes("^{")));
  assert.equal(definition.parameterSpellings.some(parameter => parameter.name === "phantom"), false);
});
check("old hash spellings are invalid source facts rather than local uses", () => {
  const template = '<p hson:part data:d="%{payload}" "#{d.title}"/>';
  const text = imports + 'const definition=Text.document`' + template + '`;'
    + 'const map=maps.fromLibraries({components:{parts:{x:{kind:"document",document:definition}}}});';
  const test = evidenceProject('old-local-reference', { 'index.ts': text });
  const definition = test.document('definition');
  assert.equal(definition.parameterCompleteness, 'unknown');
  assert.ok(definition.referenceIssues.some(issue => issue.message.includes('Local Part references use ^{')));
  assert.ok(definition.parameterSpellings.every(parameter => parameter.uses.every(use => use.namespace !== 'local')));
  assert.ok(definition.referenceIssues.some(issue => test.slice(issue.location).includes('#{d.title}')));
});
check("optional source facts count authored values, excluding declarations and serialized data", () => {
  const template = '<section hson:part part:optional data:d="%{payload}" <p part:optional "^{d.title}"/> <aside part:optional "Static"/> <hson-part part:optional at="leaf" payload:data="^{d.child}"/> <hson-part part:optional at="leaf" payload:data="\\\"%{literal}\\\""/>/>';
  const text = 'import { Hson, hsonLiveMap as maps } from "hson-live";\nconst definition = ' + JSON.stringify(template)
    + ';\nconst map = maps.fromLibraries({ components: { parts: { x: {kind:"document", document:definition}, leaf:{kind:"document",document:"<p hson:part/>"} } } });';
  const test = evidenceProject("optional-facts", { "index.ts": text });
  const definition = test.document("definition");
  assert.equal(definition.parameterCompleteness, "complete");
  assert.equal(definition.partDeclarations.length, 1);
  assert.equal(definition.partDeclarations[0]!.root, true);
  assert.equal(test.slice(definition.partDeclarations[0]!.location), 'hson:part');
  assert.ok(definition.definitionRoot);
  assert.deepEqual(definition.optionalStructures.map(flag => [flag.root, flag.references]), [[true, 2], [false, 1], [false, 0], [false, 1], [false, 0]]);
  for (const flag of definition.optionalStructures) assert.equal(test.slice(flag.location), 'part:optional');
  assert.deepEqual(definition.parameterSpellings.map(parameter => parameter.name), ['d']);
});

check('C1 whole and subtree forwarding retain original evidence and exact invocation parents', () => {
  for (const [forward, path, expected] of [
    ['^{outer}', [], /string \(required\)/], ['^{outer.nested}', ['nested'], /number \(required\)/],
  ] as const) {
    const test = evidenceProject('c1-path-' + path.length, { 'index.ts': forwarding_fixture({ forward }) });
    const parent = part_data_contexts(test.facts, test.document('A'), 'incoming')[0]!;
    const child = part_data_contexts(test.facts, test.document('B'), 'payload')[0]!;
    assert.ok(child); assert.equal(child.evidence, parent.evidence); assert.equal(child.evidence?.strength, 'validated');
    assert.equal(child.parent, parent.invocation); assert.equal(child.root, parent.root); assert.notEqual(child.invocation, parent.invocation);
    assert.equal(child.receiving?.name, 'record'); assert.equal(parent.receiving?.name, 'outer');
    assert.deepEqual(child.path, path); assert.equal(child.executionCertain, false); assert.equal(parent.executionCertain, true);
    assert.match(schema_projection_description(part_data_projection(child.evidence!, [...child.path, 'title'])), expected);
    assert.equal(part_data_contexts(test.facts, test.document('B'), 'payload')[0], child, 'Program-owned contexts are cached');
  }
});
check('C1 multiple forwarding edges accumulate paths and qualified transitions change the enclosing Library', () => {
  const source = forwarding_fixture({ shape: '<nested <content <deep <content <title "number">>>>>', value: '<nested <deep <title 8>>>', forward: '^{outer.nested}',
    body: '<section hson:part data:record="%{payload}" <hson-part at="C" final:data="^{record.deep}"/>/>' })
    .replace('const page=', 'const C=Hson.document`<p hson:part data:leaf="%{final}" "^{leaf.title}"/>`;const page=')
    .replace('at="B"', 'at="other/B"')
    .replace('A:{kind:"document",document:A},B:{kind:"document",document:B}', 'A:{kind:"document",document:A}')
    .replace('},page:{document:page}', '},other:{parts:{B:{kind:"document",document:B},C:{kind:"document",document:C}}},page:{document:page}');
  const test = evidenceProject('c1-multiple-edges', { 'index.ts': source });
  const first = part_data_contexts(test.facts, test.document('A'), 'incoming')[0]!;
  const second = part_data_contexts(test.facts, test.document('B'), 'payload')[0]!;
  const third = part_data_contexts(test.facts, test.document('C'), 'final')[0]!;
  assert.equal(third.evidence, first.evidence); assert.equal(third.parent, second.invocation); assert.equal(third.root, first.root);
  assert.deepEqual(third.path, ['nested', 'deep']); assert.equal(second.library.name, 'other'); assert.equal(third.library.name, 'other');
  assert.match(schema_projection_description(part_data_projection(third.evidence!, [...third.path, 'title'])), /number/);
});
check('C1 shared connectors retain independent roots, argument correlations and batch Library authority', () => {
  const source = forwarding_fixture().replace('const page=',
    'const T=Hson.schema`<type "data" content <title "boolean">>`;const other:HsonDataValue<typeof T>=Hson.data.parse`<title true>`;const page=')
    .replace('<hson-part at="components/A" incoming:data="${input.toHson()}"/>',
      '<main <hson-part at="components/A" incoming:data="${input.toHson()}"/> <hson-part at="components/A" incoming:data="${other.toHson()}"/>/>');
  const test = evidenceProject('c1-independent', { 'index.ts': source });
  const contexts = part_data_contexts(test.facts, test.document('B'), 'payload');
  assert.equal(contexts.length, 2); assert.equal(contexts[0]!.connector, contexts[1]!.connector);
  assert.notEqual(contexts[0]!.root, contexts[1]!.root); assert.notEqual(contexts[0]!.parent, contexts[1]!.parent);
  assert.notEqual(contexts[0]!.evidence, contexts[1]!.evidence);
  assert.deepEqual(contexts.map(context => schema_projection_description(part_data_projection(context.evidence!, ['title']))), ['string (required)', 'boolean (required)']);
  const sameSource = source + '\nconst next=maps.fromLibraries({other:{parts:{A:{kind:"document",document:A},B:{kind:"document",document:B}}},page:{document:Hson.document`<hson-part at="other/A" incoming:data="${input.toHson()}"/>`}});';
  const batches = evidenceProject('c1-batches', { 'index.ts': sameSource });
  const children = part_data_contexts(batches.facts, batches.document('B'), 'payload');
  assert.equal(children.length, 3); assert.equal(children[0]!.definition, children[2]!.definition);
  assert.notEqual(children[0]!.batch, children[2]!.batch); assert.equal(children[2]!.parent?.library.name, 'other');
  assert.deepEqual(children.map(context => context.library.name), ['components', 'components', 'other']);
  const correlated = evidenceProject('c1-correlations', { 'index.ts': forwarding_fixture({
    intermediate: '<section hson:part data:outer="%{incoming}" data:second="%{extra}" <hson-part at="B" payload:data="^{second}"/>/>'
  }).replace('const page=', 'const T=Hson.schema`<type "data" content <title "boolean">>`;const other:HsonDataValue<typeof T>=Hson.data.parse`<title true>`;const page=')
    .replace('incoming:data="${input.toHson()}"', 'incoming:data="${input.toHson()}" extra:data="${other.toHson()}"') });
  const child = part_data_contexts(correlated.facts, correlated.document('B'), 'payload');
  assert.equal(child.length, 1, 'one frame per invocation, not per receiving argument');
  assert.match(schema_projection_description(part_data_projection(child[0]!.evidence!, ['title'])), /boolean/);
});
check('C1 existing iterator origins preserve array/object selectors, shadowing and optional uncertainty', () => {
  const cases = [
    { shape: '<rows <array <content <title "number">>>>', value: '<rows «»>', directive: 'for:outer="^{outer.rows}"', path: ['rows', null] },
    { shape: '<rows <content <one <content <title "number">>>>>', value: '<rows <one <title 1>>>', directive: 'per:key:outer="^{outer.rows}"', path: ['rows', OBJECT_VALUE] },
  ];
  for (const [index, item] of cases.entries()) {
    const source = forwarding_fixture({ shape: item.shape, value: item.value,
      intermediate: '<section hson:part data:outer="%{incoming}" <hson-part ' + item.directive + ' at="B" payload:data="^{outer}"/>/>' });
    const test = evidenceProject('c1-iteration-' + index, { 'index.ts': source });
    const child = part_data_contexts(test.facts, test.document('B'), 'payload')[0]!;
    assert.deepEqual(child.path, item.path); assert.equal(child.executionCertain, false); assert.ok(child.evidence);
    assert.match(schema_projection_description(part_data_projection(child.evidence!, [...child.path, 'title'])), /number/);
  }
  for (const [index, source] of [
    forwarding_fixture({ forward: '^{outer.nested?}' }).replace('%{incoming}', '%{incoming?}'),
    forwarding_fixture().replace(' incoming:data="${input.toHson()}"', '').replace('%{incoming}', '%{incoming?}'),
    forwarding_fixture().replace('${input.toHson()}', '${dynamic}'),
    forwarding_fixture({ forward: '%{incoming}' }),
  ].entries()) {
    const test = evidenceProject('c1-uncertainty-' + index, { 'index.ts': source });
    const child = part_data_contexts(test.facts, test.document('B'), 'payload')[0]!;
    assert.ok(child); assert.equal(child.executionCertain, false);
    if (index === 0) { assert.equal(child.evidence?.strength, 'validated'); assert.match(child.uncertainty.join(';'), /optional/); }
    else { assert.equal(child.evidence, undefined); assert.ok(child.uncertainty.length); }
  }
});
check('C1 cycles, unresolved inventories and traversal limits retain conservative boundaries', () => {
  const cyclic = evidenceProject('c1-cycle', { 'index.ts': forwarding_fixture({ body:
    '<section hson:part data:record="%{payload}" <hson-part at="A" incoming:data="^{record}"/>/>' }) });
  const roots = part_data_contexts(cyclic.facts, cyclic.document('A'), 'incoming');
  assert.equal(roots.length, 2); assert.equal(roots[1]!.evidence, undefined); assert.match(roots[1]!.uncertainty.join(';'), /cycle/);
  for (const [index, selector] of ['missing/B', 'components//B', 'Missing'].entries()) {
    const test = evidenceProject('c1-unresolved-' + index, { 'index.ts': forwarding_fixture().replace('at="B"', 'at="' + selector + '"') });
    assert.deepEqual(part_data_contexts(test.facts, test.document('B'), 'payload'), []);
    assert.match(part_data_contexts(test.facts, test.document('A'), 'incoming')[0]!.incomplete.join(';'), /unknown/);
  }
  const chain = Array.from({length: 19}, (_, index) => 'P' + index + ':{kind:"document",document:Hson.document`<section hson:part data:d="%{input}"'
    + (index < 18 ? ' <hson-part at="P' + (index + 1) + '" input:data="^{d}"/>' : ' "^{d.title}"') + '/>`}').join(',');
  const bounded = evidenceProject('c1-depth', { 'index.ts': forwarding_fixture().replace('A:{kind:"document",document:A},B:{kind:"document",document:B}', chain).replace('components/A', 'components/P0').replace('incoming:data', 'input:data') });
  const atDepth = (depth: number) => bounded.facts.documents.find(document => document.receivingDeclarations.length && document.connectors[0]?.attributes.some(attribute => attribute.value === 'P' + (depth + 1)))!;
  assert.equal(part_data_contexts(bounded.facts, atDepth(15), 'input')[0]!.evidence?.strength, 'validated');
  const terminal = part_data_contexts(bounded.facts, atDepth(16), 'input')[0]!;
  assert.equal(terminal.evidence, undefined); assert.match(terminal.uncertainty.join(';'), /depth limit \(16\)/);
  assert.deepEqual(part_data_contexts(bounded.facts, atDepth(17), 'input'), []);
  const fanout = '<section hson:part data:outer="%{incoming}" ' + Array.from({length: 270}, () => '<hson-part at="B" payload:data="^{outer}"/>').join(' ') + '/>';
  const wide = evidenceProject('c1-frames', { 'index.ts': forwarding_fixture({ intermediate: fanout }) });
  assert.equal(part_data_contexts(wide.facts, wide.document('B'), 'payload').length, 255);
  assert.match(part_data_contexts(wide.facts, wide.document('A'), 'incoming')[0]!.incomplete.join(';'), /frame limit \(256\)/);
});

check('C2a write facts preserve exact target, argument transport, provenance and receiving identities', () => {
  const source = write_fixture({}, 'const chosen=map.parts.components.A; const alias=chosen;\nalias.write({incoming:input});\nchosen.write({incoming:input});');
  const test = evidenceProject('c2a-facts', { 'index.ts': source });
  const writes = test.facts.writes;
  assert.equal(writes.length, 2);
  const parents = part_data_contexts(test.facts, test.document('A'), 'incoming');
  const children = part_data_contexts(test.facts, test.document('B'), 'payload');
  assert.equal(parents.length, 2); assert.equal(children.length, 2);
  for (const [index, write] of writes.entries()) {
    assert.equal(write.definition, test.document('A')); assert.equal(write.batch, test.batch('map'));
    assert.equal(write.library.name, 'components'); assert.equal(test.slice(write.location), write.call.getText());
    const argument = write.arguments[0]!, parent = parents[index]!, child = children[index]!;
    assert.equal(argument.name, 'incoming'); assert.equal(argument.kind, 'data'); assert.equal(argument.expression.getText(), 'input');
    assert.equal(test.slice(argument.nameLocation), 'incoming'); assert.equal(test.slice(argument.valueLocation), 'input');
    assert.equal(parent.argument, argument); assert.equal(parent.receiving?.name, 'outer');
    assert.equal(parent.receiving, test.document('A').bindingSources!.declarations.find(binding => binding.origin === 'receiving'));
    assert.equal(parent.evidence?.strength, 'validated'); assert.equal(child.evidence, parent.evidence);
    assert.equal(parent.evidence, argument.dataEvidence); assert.equal(child.parent, parent.invocation);
    assert.equal(parent.root.write, write); assert.equal(parent.connector, undefined); assert.equal(parent.executionCertain, false);
    assert.equal(child.executionCertain, false); assert.match(child.uncertainty.join(';'), /detached.*execution unknown/);
    assert.match(test.slice(parent.evidence!.annotationLocation), /HsonDataValue<typeof S>/);
    assert.match(test.slice(parent.evidence!.schemaLocation), /S=Hson.schema/);
    assert.match(test.slice(parent.evidence!.valueLocation), /Hson.data/);
  }
  assert.notEqual(parents[0]!.root, parents[1]!.root);
  assert.equal(parents[0]!.evidence, parents[1]!.evidence, 'same annotation reuses compiled evidence and projection cache');
  assert.equal(part_data_projection(parents[0]!.evidence!, ['title']), part_data_projection(parents[1]!.evidence!, ['title']));
});
check('C2a imported Part targets and annotated Data preserve declaration provenance across immutable aliases', () => {
  const definitions = write_fixture({}, 'export const selected=map.parts.components.A; export {input};');
  const test = evidenceProject('c2a-imports', { 'parts.ts': definitions, 'index.ts':
    'import {selected,input} from "./parts.js"; const alias=selected; alias.write({incoming:input});' });
  assert.equal(test.facts.writes.length, 1);
  const context = part_data_contexts(test.facts, test.document('A'), 'incoming')[0]!;
  assert.equal(context.evidence?.strength, 'validated'); assert.ok(context.evidence!.annotationLocation.file.endsWith('parts.ts'));
  assert.ok(context.root.write!.location.file.endsWith('index.ts'));
});
check('Data value evidence distinguishes literal strings, official source admission and unknown producers', () => {
  for (const [index, expression, strength] of [
    [0, '"<title \\"ok\\">"', 'advisory'],
    [1, 'Hson.data.from("<title \\"ok\\">")', 'advisory'],
    [2, 'Hson.data.fromSource("<title \\"ok\\">")', 'validated'],
    [3, 'Hson.data.fromSource(\'{"title":"ok"}\')', 'validated'],
    [4, 'Hson.data.parse`<title "ok">`', 'validated'],
    [5, 'dynamic', 'advisory'],
    [6, 'fake.data.fromSource("<title \\"ok\\">")', 'advisory'],
  ] as const) {
    const source = write_fixture({ shape: '<title "string">', value: '<title "ok">' })
      .replace('declare const dynamic:any;', 'declare const dynamic:any; declare const fake:typeof Hson;')
      .replace('Hson.data.parse`<title "ok">`', expression);
    const test = evidenceProject('data-value-' + index, { 'index.ts': source });
    assert.deepEqual(test.program.getSyntacticDiagnostics(), [], expression);
    const context = part_data_contexts(test.facts, test.document('A'), 'incoming')[0]!;
    assert.equal(context.evidence?.strength, strength, expression);
    assert.equal(context.executionCertain, false);
  }
  for (const [index, replacement] of ['input', 'dynamic.toHson()'].entries()) {
    const source = forwarding_fixture().replace('${input.toHson()}', '${' + replacement + '}');
    const test = evidenceProject('unqualified-serialization-' + index, { 'index.ts': source });
    assert.equal(part_data_contexts(test.facts, test.document('A'), 'incoming')[0]?.evidence, undefined,
      'Carrier interpolation and same-spelled serializers establish no authored transport proof');
  }
});
check('C2a advisory, unknown, mismatched and unsupported authoring never acquires execution proof', () => {
  for (const [index, expression, strength] of [
    [0, 'input', 'advisory'], [1, 'dynamic', undefined], [2, 'S.certify(input)', undefined],
    [3, 'Hson.data.from({title:"projected"})', undefined], [4, '({title:"projected"})', undefined],
  ] as const) {
    const test = evidenceProject('c2a-strength-' + index, { 'index.ts': write_fixture({ value: '<>' }, 'map.parts.components.A.write({incoming:' + expression + '});') });
    assert.equal(test.facts.writes.length, 1);
    const context = part_data_contexts(test.facts, test.document('A'), 'incoming')[0]!;
    assert.equal(context.evidence?.strength, strength); assert.equal(context.executionCertain, false);
  }
  for (const [index, call] of [
    'dynamic.write({incoming:input});', 'map.parts.components[dynamic].write({incoming:input});',
    'map.parts.components.A.write({...dynamic,incoming:input});', 'map.parts.components.A.write({["incoming"]:input});',
    'map.parts.components.A.write({get incoming(){return input;}});', 'map.parts.components.A.write({incoming:input,incoming:input});',
    'map.parts.components.A.write({incoming = input});',
    'map.parts.components.A.write({outer:input});', 'map.parts.components.A?.write({incoming:input});',
    'let alias=map.parts.components.A; alias.write({incoming:input});',
  ].entries()) {
    const test = evidenceProject('c2a-unsupported-' + index, { 'index.ts': write_fixture({}, call) });
    assert.deepEqual(test.facts.writes, [], call);
    assert.deepEqual(part_data_contexts(test.facts, test.document('A'), 'incoming'), [], call);
  }
  const prototype = evidenceProject('c2a-prototype-setter', { 'index.ts': write_fixture({
    intermediate: '<p hson:part data:outer="%{__proto__}" "^{outer.title}"/>'
  }, 'map.parts.components.A.write({__proto__:input});') });
  assert.equal(prototype.document('A').parameterCompleteness, 'complete');
  assert.deepEqual(prototype.facts.writes, [], 'a prototype setter does not supply an own receiving argument');
});

events.terminal("pass");
