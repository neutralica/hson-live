import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "hson-schema-public-declarations",
  title: "External Worker Schema declarations",
  category: "Schema",
  runtime: "node",
  tags: Object.freeze(["schema", "typescript", "declarations", "worker", "public-api"]),
});
const events = create_test_event_emitter(HSON_LIVE_TEST_METADATA.id);
const root = resolve(import.meta.dirname, "..");
mkdirSync(join(root, "tmp"), { recursive: true });
const temporary = mkdtempSync(join(root, "tmp/schema-public-declarations-"));
process.once("exit", () => rmSync(temporary, { recursive: true, force: true }));
const installed = join(temporary, "node_modules/hson-live");
mkdirSync(installed, { recursive: true });
cpSync(join(root, "package.json"), join(installed, "package.json"));
cpSync(join(root, "dist"), join(installed, "dist"), { recursive: true });
// The CLI fingerprints its packaged source/build inputs when certifying evidence.
cpSync(join(root, "src"), join(installed, "src"), { recursive: true });
mkdirSync(join(installed, "scripts"));
for (const file of ["scripts/hson-schema.mts", "scripts/build-hson-schema-cli.mjs", "tsconfig.json"]) {
  cpSync(join(root, file), join(installed, file));
}
const producer = join(temporary, "producer");
const consumer = join(temporary, "consumer");
const options = {
  strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true, noPropertyAccessFromIndexSignature: true,
  target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext",
  lib: ["ESNext", "WebWorker"], types: [], skipLibCheck: false,
  declaration: true, outDir: "out",
};
function project(directory, source, compilerOptions = options) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "package.json"), '{"type":"module"}\n');
  writeFileSync(join(directory, "tsconfig.json"), JSON.stringify({ compilerOptions, files: ["index.ts"] }));
  writeFileSync(join(directory, "index.ts"), source);
}
function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: temporary, encoding: "utf8", timeout: 120_000 });
  assert.equal(result.status, 0, result.stdout + result.stderr + (result.error?.message ?? ""));
  return result.stdout;
}
function check(name, body) {
  events.case_begin(name, name);
  try { body(); events.case_end(name, "pass"); }
  catch (error) { events.diagnostic(name, "assertion", String(error)); events.case_end(name, "fail"); events.terminal("fail"); throw error; }
}
function declarations(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? declarations(join(directory, entry.name))
    : entry.name.endsWith(".d.ts") ? [readFileSync(join(directory, entry.name), "utf8")] : []);
}

project(producer, `
import { Hson } from "hson-live/hson";
import { hsonLiveMap, type LiveMap } from "hson-live/livemap";
import type { LocusActionContext } from "hson-live/locus";
import type { Echo } from "hson-live/echo";
export const S = Hson.schema\`<type "data" content <name "string" format <union [<exact "hson">, <exact "html">]>>>\`;
export const Page = Hson.schema\`<type "document" tag "main" content "string">\`;
export const Any = Hson.schema\`<type "data">\`;
export const AnyPage = Hson.schema\`<type "document">\`;
export const Twin = Hson.schema\`<type "data" content <name "string" format <union [<exact "hson">, <exact "html">]>>>\`;
export const Tree = Hson.schema\`<type "data" defs <Node <content <value "string" children <array <ref "Node">>>>> content <ref "Node">>\`;
export const certificate = S.certify(Hson.data\`<name "Ada" format "hson">\`);
export const authoredPlain = Hson.document\`<main "body"/>\`;
export const authoredNamed = Hson.document\`<main @:main "body"/>\`;
export const documentCertificate = Page.certify(Hson.document\`<main "body"/>\`);
export function getCertificate() { return certificate; }
export const certificates = [certificate];
export const certificateObject = { certificate };
export class Certificates {
  value = certificate;
  get document() { return documentCertificate; }
  getValue() { return certificate; }
}
export const map = hsonLiveMap.fromLibraries({
  main: { data: certificate, schema: S },
  tree: { data: { value: "root", children: [] }, schema: Tree },
  page: { document: documentCertificate, schema: Page },
});
export function getMap() { return map; }
export const treeLibrary = map.data.must("tree");
export const snapshot = map.data.must("main").snap();
export const treeValue = map.data.must("tree").at(["children", 0, "value"]).snap();
export const alias = S;
export const pageAlias = Page;
const attached = hsonLiveMap.fromLibraries({ main: { data: { name: "Ada", format: "hson" } }, page: { document: '<main "body"/>' } });
attached.data["main"].schema.use(S);
attached["doc"].page.schema.use(Page);
export const library = attached.data["main"];
export const page = attached.doc["page"];
export const text = attached.doc.page.at([0]);
export function getText() { attached.doc.page.schema.use(Page); return attached.doc.page.at([0]); }
export const checked = map.data.must("main", S);
export const optional = map.data("main", S);
export const loc = hsonLiveMap.locus.create({
  deck: { data: certificate, schema: S },
  page: { document: documentCertificate, schema: Page, access: "shared" },
  components: { parts: { submit: { kind: "document", document: Hson.document\`<button/>\` } } },
});
export const governed = loc.data.must("deck", S);
export const governedPage = loc.doc.page;
export const part = loc.parts.components.submit;
export const required = loc.data.deck.at(["name"]).must;
export function getLocus() { return loc; }
export function getGoverned() { return loc.data.must("deck", S); }
export function getIncoming(name: string) { return loc.data.must(name, S); }
export function findIncoming(name: string) { return loc.data(name, S); }
export function getRead(ctx: LocusActionContext) { return ctx.data.must("incoming", S); }
export function getStaged(ctx: LocusActionContext) { const stage = ctx.stage; return stage.data.must("incoming", S); }
export function getEcho(echo: Echo<LiveMap>) { return echo.data.must("incoming", S); }
export function lookupWrongFamily() { return loc.doc("page", S); }
declare const optionalDefinitions: { deck?: { data: { name: string; format: "hson" | "html" }; schema: typeof S } };
export const uncertainMap = hsonLiveMap.fromLibraries(optionalDefinitions);
export const uncertain = uncertainMap.data.deck;
const privateLocus = hsonLiveMap.locus.create({ deck: { data: certificate, schema: S },
  components: { parts: { submit: { kind: "document", document: Hson.document\`<button/>\` } } } });
export const privatePart = privateLocus.parts.components.submit;
export const privateGoverned = privateLocus.data.deck;
`);
check("Worker producer generates evidence and emits public declarations", () => {
  const before = readFileSync(join(producer, "index.ts"), "utf8");
  for (const action of ["generate", "build"]) run([join(installed, "dist/hson-schema.mjs"), action, "--project", join(producer, "tsconfig.json")]);
  assert.equal(readFileSync(join(producer, "index.ts"), "utf8"), before);
  const publicDeclaration = readFileSync(join(producer, "out/index.d.ts"), "utf8");
  assert.doesNotMatch(publicDeclaration, /HSON_SCHEMA_PROOF|HSON_DATA_BRAND|HSON_DOCUMENT_BRAND|LiveMapKnownDefinitions|liveMapLibrariesType/);
  assert.match(publicDeclaration, /certificate: import\("hson-live\/hson"\)\.HsonData</);
  assert.match(publicDeclaration, /map: import\("hson-live\/livemap"\)\.LiveMap</);
  for (const declaration of declarations(join(producer, "out"))) {
    assert.doesNotMatch(declaration, /["']hson-live["']|\.hson\/|__hson_assert_library_schema/);
  }
});
check("isolated stock TypeScript consumes only published Worker declarations", () => {
  // Copy the publication to a package. Neither authored inputs nor .hson evidence
  // trees are available through its exports or TypeScript path mappings.
  const published = join(consumer, "node_modules/schema-producer");
  mkdirSync(published, { recursive: true });
  cpSync(join(producer, "out"), join(published, "dist"), { recursive: true });
  writeFileSync(join(published, "package.json"), JSON.stringify({ name: "schema-producer", type: "module", exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } } }));
  project(consumer, `
import { authoredPlain, authoredNamed, S, Twin, Tree, alias, Page, pageAlias, library, page, text, getText, certificate, documentCertificate, getCertificate, certificates, certificateObject, Certificates, map, getMap, snapshot, treeValue, treeLibrary, checked, optional, loc, governed, governedPage, part, required, getLocus, getGoverned, privateGoverned, getIncoming, findIncoming, getRead, getStaged, getEcho, lookupWrongFamily, uncertain } from "schema-producer";
import type { HsonAuthored, HsonDocument, HsonCanonical, JsonValue, JsonFromSchema, HsonFromSchema } from "hson-live/hson";
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type Shape = { readonly name: string; readonly format: "hson" | "html" };
type Exact = Assert<Equal<JsonFromSchema<typeof S>, Shape>>;
type Certificate = Assert<Equal<typeof certificate, HsonFromSchema<typeof S>>>;
type AuthoredPlain = Assert<Equal<typeof authoredPlain, HsonAuthored>>;
type AuthoredNamed = Assert<Equal<typeof authoredNamed, HsonAuthored>>;
// @ts-expect-error Published authoring has no canonical proof.
const falseCanonical: HsonCanonical = authoredPlain;
// @ts-expect-error Declarations cannot promote authored names to canonical documents.
const falseDocument: HsonDocument = authoredNamed;
type DocumentCertificate = Assert<Equal<typeof documentCertificate, HsonFromSchema<typeof Page>>>;
const returnedCertificate: HsonFromSchema<typeof S> = getCertificate();
const arrayCertificate: HsonFromSchema<typeof S> | undefined = certificates[0];
const propertyCertificate: HsonFromSchema<typeof S> = certificateObject.certificate;
const fieldCertificate: HsonFromSchema<typeof S> = new Certificates().value;
const getterCertificate: HsonFromSchema<typeof Page> = new Certificates().document;
const methodCertificate: HsonFromSchema<typeof S> = new Certificates().getValue();
export const mapValue = map.data.must("main").snap();
export const returnedMapValue = getMap().data.must("main").snap();
// Consume recursive reads structurally; publishing a new recursive alias is a separate public naming contract.
const branchValue = map.data.must("tree").at(["children", 0]).snap();
type MapRead = Assert<Equal<typeof mapValue, Shape>>;
type ReturnedMapRead = Assert<Equal<typeof returnedMapValue, Shape>>;
const libraryBranch = treeLibrary.at(["children", 0]).snap();
type LibraryBranch = Assert<Equal<typeof libraryBranch, JsonFromSchema<typeof Tree> | undefined>>;
type BranchRead = Assert<Equal<typeof branchValue, JsonFromSchema<typeof Tree> | undefined>>;
type Snapshot = Assert<Equal<typeof snapshot, Shape>>;
type RecursiveLeaf = Assert<Equal<typeof treeValue, string | undefined>>;
const certifiedPageText: string = map.doc.must("page").at([0]).snap();
const storedSchema: typeof S = map.data.must("main").schema.get();
// @ts-expect-error Identical structural projections do not merge certification identity.
const otherCertificate: HsonFromSchema<typeof Twin> = certificate;
// @ts-expect-error Raw strings never acquire certification proof.
const rawCertificate: typeof certificate = '<name "Ada" format "hson">';
// @ts-expect-error Certificate families stay separate.
const wrongFamily: HsonFromSchema<typeof Page> = certificate;
// @ts-expect-error Governed map reads retain the declared literal union.
const wrongFormat: "json" = mapValue.format;
// @ts-expect-error Governed maps reject unknown paths.
map.data.must("main").at(["missing"]);
// @ts-expect-error Recursive writes retain primitive types.
map.data.must("tree").at(["children", 0, "value"]).set(3);
// @ts-expect-error Document maps retain text-only replacements.
map.doc.must("page").at([0]).replace(42);
const same: typeof S = alias;
const samePage: typeof Page = pageAlias;
export const value = library.snap();
type Read = Assert<Equal<typeof value, Shape>>;
const body: string = text.snap();
const returned: string = getText().snap();
const schema: typeof S = library.schema.get();
const pageSchema: typeof Page = page.schema.get();
const checkedValue: Shape = checked.snap();
const optionalValue: Shape | undefined = optional?.snap();
const governedValue: Shape = governed.snap();
const returnedGoverned: Shape = getGoverned().snap();
const returnedLocus: Shape = getLocus().data.deck.snap();
const privateOwnerValue: Shape = privateGoverned.snap();
const dynamicValue: Shape = getIncoming("incoming").snap();
const dynamicOptional: Shape | undefined = findIncoming("incoming")?.snap();
// @ts-expect-error Dynamic callable selection still needs a presence check.
findIncoming("incoming").snap();
declare const read: ReturnType<typeof getRead>;
const readValue: Shape = read.snap();
// @ts-expect-error Read contexts cannot mutate data.
read.at(["name"]).set("new");
declare const staged: ReturnType<typeof getStaged>;
staged.at(["name"]).set("new");
// @ts-expect-error Staging does not acquire read capability.
staged.snap();
declare const echo: ReturnType<typeof getEcho>;
const echoValue: Shape = echo.snap();
if (echo.source === "authority-projected") {
  // @ts-expect-error Projected Echo data is read-only.
  echo.at(["name"]).set("new");
}
const mismatchedDocument: string | undefined = lookupWrongFamily()?.snap();
const uncertainValue: JsonValue | undefined = uncertain?.snap();
// @ts-expect-error Optional construction membership remains uncertain in publication.
uncertain.snap();
const requiredValue: string = required.snap();
const governedMarkup: string = governedPage.snap();
const completeMarkup: string = governedPage.render();
const governedHson: HsonDocument = governedPage.hson();
const partDefinition = part.snap();
// @ts-expect-error Parts are source definitions with no standalone renderer.
part.render();
// @ts-expect-error Locus retains its authority-specific Schema restrictions.
governed.schema.use(S);
// @ts-expect-error Optional checked selection does not become a required read.
optional.snap();
// @ts-expect-error Locus has no legacy selector.
loc.lib;
// @ts-expect-error Parts cannot attach supplemental Schema.
loc.parts.components.schema.use(S);
// @ts-expect-error Structural projections reject invalid literals.
const invalid: JsonFromSchema<typeof S> = { name: "Ada", format: "json" };
// @ts-expect-error Reads retain precise property names.
value.missing;
// @ts-expect-error Governed writes retain literal domains.
library.at(["format"]).set("json");
// @ts-expect-error Document paths retain bounds.
page.at([1]);
// @ts-expect-error Text endpoints have no attribute API.
text.attrs;
`);
  for (const exact of ["false", "true"]) {
    const output = run([join(root, "node_modules/typescript/bin/tsc"), "-p", join(consumer, "tsconfig.json"), "--exactOptionalPropertyTypes", exact, "--pretty", "false", "--listFiles"]);
    assert.doesNotMatch(output, /lib\.dom\.|@types\/|producer\/\.hson|producer\/index\.ts|hson-live\/src\//);
  }
  const declaration = readFileSync(join(consumer, "out/index.d.ts"), "utf8");
  assert.doesNotMatch(declaration, /Evidence|Proof|__Identity|__Value|Definition\d|HSON_|MutationCandidate|internal\//);
  assert.match(declaration, /readonly format: \(?"hson"\)? \| \(?"html"\)?/);
});
check("existing root imports publish the same inferred public types", () => {
  const rootProducer = join(temporary, "root-producer");
  const source = `
import { Hson, hsonLiveMap } from "hson-live";
export const S = Hson.schema\`<type "data" content <values <array "string">>>\`;
export const certificate = S.certify(Hson.data\`<values []>\`);
export const map = hsonLiveMap.fromLibraries({ state: { data: { values: [] }, schema: S } });
export const library = map.data.must("state");
`;
  // An explicitly authored root import has its existing DOM dependency. Only
  // this producer needs DOM; its emitted declaration references remain narrow.
  project(rootProducer, source, { ...options, lib: ["ESNext", "DOM"] });
  for (const action of ["generate", "build"]) run([join(installed, "dist/hson-schema.mjs"), action, "--project", join(rootProducer, "tsconfig.json")]);
  const declaration = readFileSync(join(rootProducer, "out/index.d.ts"), "utf8");
  assert.match(declaration, /map: import\("hson-live\/livemap"\)\.LiveMap</);
  assert.match(declaration, /certificate: import\("hson-live\/hson"\)\.HsonData</);
  assert.doesNotMatch(declaration, /["']hson-live["']|HSON_SCHEMA_PROOF|LiveMapKnownDefinitions/);
  const rootConsumer = join(temporary, "root-consumer");
  project(rootConsumer, `
import { S, certificate, map, library } from "../root-producer/out/index.js";
import type { HsonFromSchema } from "hson-live/hson";
const proof: HsonFromSchema<typeof S> = certificate;
export const values = map.data.must("state").snap().values;
const sameValues: readonly string[] = library.snap().values;
// @ts-expect-error The published root-import map still rejects invalid items.
map.data.must("state").at(["values"]).replace([42]);
`);
  const files = run([join(root, "node_modules/typescript/bin/tsc"), "-p", join(rootConsumer, "tsconfig.json"), "--pretty", "false", "--listFiles"]);
  assert.doesNotMatch(files, /lib\.dom\.|@types\//);
});
check("async and generator returns and required callable Parts publish through source and packaged tooling", () => {
  const source = `
import { Hson } from "hson-live/hson";
import { hsonLiveMap } from "hson-live/livemap";
export const S = Hson.schema\`<type "data" content <name "string">>\`;
export const value = 1;
export const promised = Promise.resolve(value);
export async function load() { return value; }
export async function loadPromise() { return promised; }
export function* generate() { yield "first"; return value; }
export async function* generateAsync() { yield "first"; return value; }
export class Loader {
  async load() { return value; }
  *generate() { yield "first"; return value; }
  async *generateAsync() { yield "first"; return value; }
}
export const loc = hsonLiveMap.locus.create({ components: { parts: {
  submit: { kind: "document", document: Hson.document\`<button/>\` },
} } });
export const direct = loc.parts.components.submit;
export const requiredPart = loc.parts.must("components").submit;
export const bracketPart = loc["parts"]["must"]("components")["submit"];
const privateLoc = hsonLiveMap.locus.create({ components: { parts: {
  submit: { kind: "document", document: Hson.document\`<button/>\` },
} } });
export const privateRequiredPart = privateLoc.parts.must("components").submit;
`;
  for (const [name, cli] of [
    ["source", ["--import", join(root, "node_modules/tsx/dist/loader.mjs"), join(root, "scripts/hson-schema.mts")]],
    ["package", [join(installed, "dist/hson-schema.mjs")]],
  ]) {
    const directory = join(temporary, `returns-${name}`);
    project(directory, source);
    for (const action of ["generate", "build"]) run([...cli, action, "--project", join(directory, "tsconfig.json")]);
    const declaration = readFileSync(join(directory, "out/index.d.ts"), "utf8");
    assert.match(declaration, /load\(\): Promise</);
    assert.doesNotMatch(declaration, /StaticPath|LIVEMAP_INVALID|hson-live[^"\n]*internal\/|__hson_assert|\.hson\//);
    const reader = join(temporary, `returns-consumer-${name}`);
    project(reader, `
import { value, load, loadPromise, generate, generateAsync, Loader, direct, requiredPart, bracketPart, privateRequiredPart } from "../returns-${name}/out/index.js";
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
const loaded: Promise<typeof value> = load();
const flattened: Promise<number> = loadPromise();
type GeneratorReturn = Assert<Equal<ReturnType<typeof generate>, Generator<string, number, unknown>>>;
type AsyncGeneratorReturn = Assert<Equal<ReturnType<typeof generateAsync>, AsyncGenerator<string, number, unknown>>>;
const method: Promise<typeof value> = new Loader().load();
const iterator: Generator<string, number, unknown> = new Loader().generate();
const asyncIterator: AsyncGenerator<string, number, unknown> = new Loader().generateAsync();
type RequiredPart = Assert<Equal<typeof direct, typeof requiredPart>>;
type BracketPart = Assert<Equal<typeof direct, typeof bracketPart>>;
type PrivatePart = Assert<Equal<typeof direct, typeof privateRequiredPart>>;
const definition: ReturnType<typeof direct.snap> = requiredPart.snap();
// @ts-expect-error A Part definition location is not a rendered occurrence.
requiredPart.render();
// @ts-expect-error Required Part selection does not grant supplemental Schema attachment.
requiredPart.schema.use();
`);
    for (const exact of ["false", "true"]) run([join(root, "node_modules/typescript/bin/tsc"), "-p", join(reader, "tsconfig.json"), "--exactOptionalPropertyTypes", exact, "--pretty", "false"]);
  }
});
check("Parts-only projects publish required and direct members without authored Schema origins", () => {
  const source = `
import { Hson } from "hson-live/hson";
import { hsonLiveMap } from "hson-live/livemap";
const loc = hsonLiveMap.locus.create({
  components: {
    parts: {
      submit: {
        kind: "document",
        document: Hson.document\`<button/>\`,
      },
    },
  },
});
export const part = loc.parts.must("components").submit;
export const direct = loc.parts.components.submit;
`;
  for (const [name, cli] of [
    ["source", ["--import", join(root, "node_modules/tsx/dist/loader.mjs"), join(root, "scripts/hson-schema.mts")]],
    ["package", [join(installed, "dist/hson-schema.mjs")]],
  ]) {
    const directory = join(temporary, `parts-only-${name}`);
    project(directory, source);
    for (const action of ["generate", "build"]) run([...cli, action, "--project", join(directory, "tsconfig.json")]);
    const manifest = JSON.parse(readFileSync(join(directory, ".hson/compiler-input/tsconfig.json/manifest.json"), "utf8"));
    assert.equal(manifest.sources.flatMap(record => record.schemas).length, 0, "The entire Parts fixture has no authored Schema origins");
    const declaration = readFileSync(join(directory, "out/index.d.ts"), "utf8");
    assert.doesNotMatch(declaration, /StaticPath|LIVEMAP_INVALID|hson-live[^"\n]*internal\/|__hson_assert|hson-schema\.generated/);
    const reader = join(temporary, `parts-only-consumer-${name}`);
    project(reader, `
import { part, direct } from "../parts-only-${name}/out/index.js";
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type SameDefinitionLocation = Assert<Equal<typeof part, typeof direct>>;
type NotAny = Assert<Equal<0 extends (1 & typeof part) ? true : false, false>>;
export const definition: ReturnType<typeof direct.snap> = part.snap();
export const canonical: ReturnType<typeof direct.hson> = part.hson();
// @ts-expect-error A Part definition does not acquire occurrence rendering.
part.render();
// @ts-expect-error Parts do not acquire supplemental Schema attachment.
part.schema.use();
// @ts-expect-error Inventory selection does not expose owner-level authority.
part.admit({});
`);
    for (const exact of ["false", "true"]) run([join(root, "node_modules/typescript/bin/tsc"), "-p", join(reader, "tsconfig.json"), "--exactOptionalPropertyTypes", exact, "--pretty", "false"]);
  }
});
events.terminal("pass");
