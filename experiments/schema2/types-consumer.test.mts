import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import test from "node:test";
import { generate_hson_schema_evidence } from "../../src/internal/hson-schema/generated-evidence.js";
import { compile_schema_source } from "./compile-source.js";

const root = resolve(import.meta.dirname, "../..");
const temporary = mkdtempSync(join(tmpdir(), "hson-schema2-types-"));
process.once("exit", () => rmSync(temporary, { recursive: true, force: true }));
const installed = join(temporary, "node_modules/hson-live");
cpSync(join(root, "node_modules"), join(temporary, "node_modules"), {
  recursive: true, dereference: true, filter: path => !basename(path).startsWith("."),
});
mkdirSync(installed, { recursive: true });
// Exercise the published file list and entrypoints from a fresh build.
const packed = spawnSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", temporary], {
  cwd: root, encoding: "utf8", shell: process.platform === "win32",
});
assert.equal(packed.status, 0, [packed.stdout, packed.stderr, packed.error?.message].join("\n"));
const [{ filename }] = JSON.parse(packed.stdout);
const unpacked = spawnSync("tar", ["-xzf", join(temporary, filename), "-C", installed, "--strip-components", "1"], { encoding: "utf8" });
assert.equal(unpacked.status, 0, [unpacked.stdout, unpacked.stderr, unpacked.error?.message].join("\n"));
writeFileSync(join(temporary, "package.json"), '{"type":"module"}\n');

const compilerOptions = {
  strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true,
  noPropertyAccessFromIndexSignature: true, skipLibCheck: false,
  target: "ESNext", module: "NodeNext", lib: ["ESNext", "WebWorker"], types: [], outDir: "out",
};
const stockCompiler = join(temporary, "node_modules/typescript/bin/tsc");
const cli = join(installed, "dist/hson-schema.mjs");
function project(name: string, source: string): string {
  const directory = join(temporary, name);
  mkdirSync(directory);
  writeFileSync(join(directory, "index.ts"), source);
  writeFileSync(join(directory, "tsconfig.json"), JSON.stringify({ compilerOptions, files: ["index.ts"] }));
  return directory;
}
function run(...args: string[]): string {
  const result = spawnSync(process.execPath, args, { cwd: temporary, encoding: "utf8", timeout: 120_000 });
  assert.equal(result.status, 0, [args.join(" "), result.stdout, result.stderr, result.error?.message].join("\n"));
  return result.stdout;
}

function evidence(name: string, authored: string) {
  const result = compile_schema_source(authored);
  assert.ok(result.ok, result.ok ? undefined : JSON.stringify(result.issues));
  return {
    source: result.schema1Source,
    generated: generate_hson_schema_evidence(name, result.schema1Source, `index.ts#${name}`),
  };
}
function useEvidence(name: string, source: string): string {
  return `import type { Evidence as E${name} } from "./${name}.js";
const ${name} = Hson.schema\`${source}\` as HsonSchema<E${name}["value"], E${name}["mode"], E${name}["identity"], E${name}["proposal"]>;`;
}
const imports = 'import { Hson, type HsonSchema, type JsonFromSchema, type JsonValue } from "hson-live/hson";';

test("public materialized dynamic and optional reads require narrowing, including across references", () => {
  const names = ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__", "ordinary"];
  const optional = names.map(name => `'${name}' optional <ref "Numeric">`).join(" ");
  const required = names.map(name => `'${name}' <ref "Numeric">`).join(" ");
  const rows = evidence("Rows", `<data <defs <
    'Numeric' <number>
    'ExactRow' <object <${optional}>>
    'OpenRow' <object <${optional} any <number>>>
    'Required' <object <${required}>>
    'TaggedRow' <object <'kind' <exact "row"> ${optional}>>
  >> <object <
    'row' <ref "ExactRow"> 'open' <ref "OpenRow"> 'own' <ref "Required">
    'choice' <union [<ref "TaggedRow">, <object <'kind' <exact "other">>>]>
    'maybe' optional <ref "ExactRow">
    any <number>
  >>>`);
  const open = evidence("Open", "<data <object any <number>>>");
  const directory = project("reads", `
${imports}
${useEvidence("Rows", rows.source)}
${useEvidence("Open", open.source)}
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
function check(value: unknown, expected: unknown) {
  if (!Object.is(value, expected)) throw new Error("Unexpected read: " + String(value));
}
function dynamic(key: string) {
  const value = Open.certify(Hson.data.from({})).materialize();
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const picked = value[key];
    const named = value["constructor"];
    type ArbitraryRead = Assert<Equal<typeof picked, unknown>>;
    type InheritedRead = Assert<Equal<typeof named, unknown>>;
    return picked;
  }
  throw new Error("Expected an ordinary object");
}
function unsafe(key: string): JsonValue | undefined {
  const value = Open.certify({}).materialize();
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    // @ts-expect-error Control-flow narrowing must not bring back the JSON index signature.
    return value[key];
  }
}
check(dynamic("constructor"), Object);
check(dynamic("toString"), Object.prototype.toString);
check(dynamic("unlisted"), undefined);
const unbound = Hson.data.parse\`<>\`.materialize();
type Unbound = Assert<Equal<typeof unbound, unknown>>;
const own = Object.fromEntries(${JSON.stringify(names)}.map(name => [name, 7]));
const candidate = Hson.data.from({ row: {}, open: {}, own, choice: { kind: "row" } });
const certified = Rows.certify(candidate);
check(certified, candidate);
check(Hson.data.from(certified), certified);
const value: JsonFromSchema<typeof Rows> = Hson.data.from(certified).materialize();
function unsafeOptionals(row: typeof value.row) {
  // @ts-expect-error An absent own constructor resolves to a function.
  row.constructor?.toFixed();
  ${names.map(name => `// @ts-expect-error An optional own member can resolve to an inherited value.
  const ${name}: number | undefined = row[${JSON.stringify(name)}];`).join("\n  ")}
  // @ts-expect-error Guarding the value is required even with optional chaining on an open object.
  value.open.hasOwnProperty?.toFixed();
  // @ts-expect-error Optional references do not promise a structured JavaScript read.
  value.maybe?.ordinary;
  if (value.choice.kind === "row") {
    // @ts-expect-error Narrowing a union to its object branch still permits inherited reads.
    value.choice.constructor?.toFixed();
  }
  // @ts-expect-error Non-Data input remains excluded.
  Rows.certify({ callback: () => true });
  // @ts-expect-error Undefined is still excluded by ordinary Data qualification.
  Hson.data.from({ ordinary: undefined });
}
${names.map(name => `{
  const required: number = value.own[${JSON.stringify(name)}];
  check(required, 7);
  check(Object.hasOwn(value.own, ${JSON.stringify(name)}), true);
}`).join("\n")}
check(value.row.constructor, Object);
check(value.row.toString, Object.prototype.toString);
check(value.row.valueOf, Object.prototype.valueOf);
check(value.row.hasOwnProperty, Object.prototype.hasOwnProperty);
check(value.row.__proto__, Object.prototype);
check(value.open.__proto__, Object.prototype);
check(value.row.ordinary, undefined);
const inherited = () => "from prototype";
Object.defineProperty(Object.prototype, "ordinary", { value: inherited, configurable: true });
try {
  check(value.row.ordinary, inherited);
  check(value.open.ordinary, inherited);
  check(value.own.ordinary, 7);
  check(Object.hasOwn(value.row, "ordinary"), false);
  const present = Rows.certify({ row: { ...own }, open: { ...own, extra: 4 }, own, choice: { kind: "row" }, maybe: own }).materialize();
  check(present.row.constructor, 7);
  check(present.row.__proto__, 7);
  check(present.row.ordinary, 7);
  check(present.open.ordinary, 7);
  for (const name of Object.keys(own)) {
    let rejected = false;
    try { Rows.certify({ row: { [name]: "wrong" }, open: {}, own, choice: { kind: "row" } }); }
    catch (error) { if (!(error instanceof Error)) throw error; rejected = true; }
    check(rejected, true);
  }
} finally {
  Reflect.deleteProperty(Object.prototype, "ordinary");
}
`);
  writeFileSync(join(directory, "Open.d.ts"), open.generated.declaration);
  writeFileSync(join(directory, "Rows.d.ts"), rows.generated.declaration);
  run(stockCompiler, "-p", directory, "--pretty", "false");
  run(join(directory, "out/index.js"));
  run(stockCompiler, "-p", directory, "--pretty", "false", "--exactOptionalPropertyTypes", "false", "--noEmit");
});

test("packed Data reads, LiveMap projections and write proposals keep separate guarantees", () => {
  const schemas = {
    Broad: evidence("Broad", "<data <any>>"),
    Nested: evidence("Nested", "<data <object <'value' <any>>>>"),
    Open: evidence("Open", `<data <defs <
      'Child' <object <'name' <string> 'size' optional <number> 'children' optional <array <ref "Child">>>>
    >> <object <
      'id' <string> 'required' <number> 'size' optional <number> 'child' <ref "Child"> any <number>
    >>>`),
    Closed: evidence("Closed", "<data <object <'id' <string> 'toString' <number> 'size' optional <number>>>>"),
  };
  const directory = project("read-write", `
${imports}
import { ANY_DATA } from "hson-live/hson";
import { fromLibraries, type LivePath } from "hson-live/livemap";
${Object.entries(schemas).map(([name, generated]) => useEvidence(name, generated.source)).join("\n")}
function same(actual: unknown, expected: unknown) {
  if (!Object.is(actual, expected)) throw new Error("Unexpected read: " + String(actual));
}
function broadRead(value: JsonFromSchema<typeof ANY_DATA>, key: string) {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const picked = value[key];
    // @ts-expect-error Ordinary JavaScript reads can return inherited functions.
    const json: JsonValue | undefined = picked;
    // @ts-expect-error The admitted object may shadow the built-in method.
    if (false) value.toString();
    return picked;
  }
  throw new Error("Expected an object");
}
const bare: JsonFromSchema<typeof Broad> = Broad.certify({}).materialize();
same(broadRead(bare, "constructor"), Object);
same(broadRead(ANY_DATA.certify({}).materialize(), "toString"), Object.prototype.toString);
const nested = Nested.certify({value: {}}).materialize().value;
// @ts-expect-error Nested bare any retains the same read boundary.
const nestedJson: JsonValue = nested;
same(broadRead(nested, "missing"), undefined);
const inherited = () => 17;
Object.defineProperty(Object.prototype, "extraInherited", { value: inherited, configurable: true });
try { same(broadRead(bare, "extraInherited"), inherited); }
finally { Reflect.deleteProperty(Object.prototype, "extraInherited"); }
for (const scalar of [null, 3, false, "data"] as const) same(Broad.certify(scalar).materialize(), scalar);
const array = Broad.certify([{toString: 9}]).materialize();
if (!Array.isArray(array)) throw new Error("Expected an array");
// @ts-expect-error Array elements retain the conservative broad Data read type.
const wrongItem: JsonValue | undefined = array[0];
if (array[0] === undefined) throw new Error("Expected an item");
same(broadRead(array[0], "toString"), 9);

const input = { id: "before", required: 1, child: { name: "leaf" }, toString: 9 };
const map = fromLibraries({ broad: { json: { row: {} }, schema: Broad }, standard: { json: {}, schema: ANY_DATA },
  closed: { json: { id: "closed", toString: 4 }, schema: Closed } });
const broad = map.data.must("broad");
const standard = map.data.must("standard");
same(broadRead(standard.snap(), "constructor"), Object);
const refined = broad.at(["row"]).asObject();
if (refined === undefined) throw new Error("Expected an object location");
function snapRefined(key: string) {
  const snap = refined?.snap();
  const picked = snap?.[key];
  // @ts-expect-error Object refinement establishes no JSON index signature.
  const json: JsonValue | undefined = picked;
  return picked;
}
function snapDynamic(path: LivePath, key: string) {
  const snap = broad.snap(path);
  if (snap !== undefined && snap !== null && typeof snap === "object" && !Array.isArray(snap)) {
    const picked = snap[key];
    // @ts-expect-error A dynamic path cannot establish a JSON index signature.
    const json: JsonValue | undefined = picked;
    return picked;
  }
  throw new Error("Expected an object at the selected path");
}
same(snapRefined("constructor"), Object);
same(snapDynamic(["row"], "constructor"), Object);
same(refined.object.getKey("constructor"), undefined);

const library = fromLibraries({ open: { json: input, schema: Open } }).data.must("open");
const location = library.at([]);
const collection = location.object;
const knownPath: string = library.snap(["id"]);
const namedKey: number = collection.getKey("required");
const copied = collection.toObject();
const chosen = collection.pick(["id", "toString"]);
const omitted = collection.omit(["id"]);
const closedLocation = map.data.must("closed").at([]);
const closed = closedLocation.object;
function maybeSelect(keys: readonly ["id"] | readonly ["toString"]) {
  const selected = closed.pick(keys);
  // @ts-expect-error A union of key lists cannot guarantee either key.
  const required: string = selected.id;
  // @ts-expect-error An inherited method or own number can be observed here.
  selected.toString();
}
function rejectCollectionReads(key: string) {
  // @ts-expect-error Omit must not restore TypeScript's apparent Object methods.
  omitted.toString();
  // @ts-expect-error Pick must not restore TypeScript's apparent Object methods.
  chosen.toString();
  // @ts-expect-error toObject cannot promise JSON for arbitrary JavaScript reads.
  const json: JsonValue | undefined = copied[key];
  // @ts-expect-error A widened key list can remove a required field.
  const required: string = collection.omit([key]).id;
}
const pickedId: string = chosen.id;
const keptRequired: number = omitted.required;
same(knownPath, "before");
same(namedKey, 1);
same(pickedId, "before");
same(keptRequired, 1);
same(chosen.toString, 9);
same(omitted.toString, 9);
same(copied["constructor"], Object);
same(Reflect.get(closed.pick(["id"]), "toString"), Object.prototype.toString);

const candidate = { id: "after", required: 2, size: 3, child: { name: "first", children: [{ name: "second", size: 4 }] } } as const;
location.replace(candidate);
location.replace(Hson.data.fromSource(location.must.hson()));
collection.setKey("size", 5);
collection.setMany({ size: 6 });
location.at(["child", "children"]).asArray()?.array.push({ name: "third", size: 7 });
same(library.snap(["id"]), "after");
same(library.snap().size, 6);
function rejectProposals() {
  // @ts-expect-error A function cannot be an optional numeric proposal.
  location.replace({ ...candidate, size: () => 1 });
  // @ts-expect-error exactOptionalPropertyTypes excludes an explicitly undefined optional.
  closedLocation.replace({ id: "closed", toString: 4, size: undefined });
  // @ts-expect-error Named precedence retains the required numeric constraint.
  location.replace({ ...candidate, required: "wrong" });
  // @ts-expect-error Nested recursive proposal aliases retain the optional numeric constraint.
  location.replace({ ...candidate, child: { name: "first", children: [{ name: "second", size: "wrong" }] } });
  // @ts-expect-error Optional-member precision survives a selected path.
  location.at(["size"]).set("wrong");
  // @ts-expect-error Refining an optional array preserves its element proposal.
  location.at(["child", "children"]).asArray()?.array.push({ name: "bad", size: false });
  // @ts-expect-error Named write constraints also survive an open object patch.
  collection.setMany({ size: "wrong" });
  // @ts-expect-error Open replacement extras must still be Data candidates.
  location.replace({ ...candidate, extra: () => 1 });
}
for (const size of [() => 1, undefined, "wrong"]) {
  let rejected = false;
  try {
    // Exercise runtime validation independently from the negative static checks.
    Reflect.apply(location.replace, location, [{ ...candidate, size }]);
  } catch (error) { if (!(error instanceof Error)) throw error; rejected = true; }
  same(rejected, true);
  same(library.snap().size, 6);
}
`);
  for (const [name, generated] of Object.entries(schemas)) {
    writeFileSync(join(directory, `${name}.d.ts`), generated.generated.declaration);
  }
  for (const checked of ["true", "false"]) {
    run(stockCompiler, "-p", directory, "--pretty", "false", "--noUncheckedIndexedAccess", checked);
    run(join(directory, "out/index.js"));
  }
  const source = readFileSync(join(directory, "index.ts"), "utf8");
  // With the option disabled, TypeScript permits explicit undefined for a named optional field.
  writeFileSync(join(directory, "index.ts"), source.replace(/  \/\/ @ts-expect-error exactOptionalPropertyTypes[^\n]*\n/, ""));
  for (const checked of ["true", "false"]) {
    run(stockCompiler, "-p", directory, "--pretty", "false", "--exactOptionalPropertyTypes", "false", "--noUncheckedIndexedAccess", checked, "--noEmit");
  }

  let authored = source;
  for (const [name, generated] of Object.entries(schemas)) {
    authored = authored.replace(useEvidence(name, generated.source), `const ${name} = Hson.schema\`${generated.source}\`;`);
  }
  const compiledProject = project("packaged-read-write", authored);
  const config = join(compiledProject, "tsconfig.json");
  const summary = JSON.parse(run(cli, "generate", "--project", config));
  assert.equal(summary.schemas, Object.keys(schemas).length);
  run(cli, "check", "--project", config);
  run(stockCompiler, "-p", summary.project, "--pretty", "false", "--noEmit");
});

test("packed object projections and proposals distinguish definite keys and own candidate fields", () => {
  const schemas = {
    Exact: evidence("Exact", "<data <object <'id' <string> 'toString' <number> 'valueOf' <number> 'maybe' optional <number>>>>"),
    Open: evidence("Open", "<data <object <'id' <string> 'toString' <number> 'constructor' optional <number> any <number>>>>"),
    Empty: evidence("Empty", "<data <object>>"),
    State: evidence("State", `<data <defs <
      'Node' <object <'n' <number> 'constructor' optional <number> 'children' <array <ref "Node">>>>
    >> <object <
      'label' <string> 'toString' optional <number> 'count' optional <number>
      'node' <ref "Node"> 'pair' <tuple [<ref "Node">,<string>]>
      'empty' <object> 'items' <array <object>>
    >>>`),
  };
  const directory = project("projection-and-own-keys", `
${imports}
import { fromLibraries } from "hson-live/livemap";
${Object.entries(schemas).map(([name, schema]) => useEvidence(name, schema.source)).join("\n")}
function same(actual: unknown, expected: unknown) {
  if (!Object.is(actual, expected)) throw new Error("Unexpected result: " + String(actual));
}
function rejects(run: () => unknown) {
  try { run(); } catch (cause) {
    if (cause instanceof Error && "reasonCode" in cause && cause.reasonCode === "UNSUPPORTED_TYPE") return;
    throw cause;
  }
  throw new Error("Expected a Data admission failure");
}
const view = fromLibraries({
  exact: { json: {id:"literal", toString:9, valueOf:6}, schema:Exact },
  open: { json: {id:"open", toString:7, other:8}, schema:Open },
});
const exact = view.data.must("exact").at([]).object;
const open = view.data.must("open").at([]).object;
function projections(pattern: \`to\${string}\`, broad: string, slot: "toString" | "valueOf", lists: readonly ["id"] | readonly ["valueOf"]) {
  const pick = exact.pick([pattern]);
  const omit = exact.omit([pattern]);
  if (false) {
    // @ts-expect-error A pattern can pick an own numeric toString.
    pick.toString();
    // @ts-expect-error An unmatched pattern value can retain an own numeric toString.
    omit.toString();
    // @ts-expect-error Arbitrary keys cannot prove a required field survived.
    const required: string = exact.omit([broad]).id;
    // @ts-expect-error One union slot can select an own numeric valueOf.
    exact.pick([slot]).valueOf();
    // @ts-expect-error A union of lists can retain an own numeric valueOf.
    exact.omit(lists).valueOf();
    // @ts-expect-error The declared optional named field remains a conservative JavaScript read.
    const optional: number = exact.pick(["maybe"]).maybe;
    // @ts-expect-error Named wildcard fields with uncertain selection also read conservatively.
    open.omit([pattern]).toString();
  }
  const retained: number = omit.valueOf;
  const keptId: string = open.omit([pattern]).id;
  same(retained, 6);
  same(keptId, "open");
  return [pick.toString, omit.toString];
}
const [picked, omitted] = projections("toString", "id", "valueOf", ["id"]);
same(picked, 9);
same(omitted, Object.prototype.toString);
same(projections("toOther", "id", "valueOf", ["id"])[1], 9);
const known: number = exact.pick(["toString"]).toString;
const kept: number = exact.omit(["toString"]).valueOf;
same(known, 9);
same(kept, 6);
open.setMany({ id:"patched", other:12 });
same(open.getKey("id"), "patched");
function withSuffix(keys: readonly [...string[], "toString"]) {
  const present: number = exact.pick(keys).toString;
  same(present, 9);
}
withSuffix(["id", "toString"]);

const empty = fromLibraries({ e:{json:{},schema:Empty} }).data.must("e").at([]);
const emptyProposal: Parameters<typeof empty.replace>[0] = {};
empty.replace(emptyProposal);
const symbolMember = { [Symbol()]: 1 };
const node = { n:1, children:[{n:2, children:[]}] } as const;
interface ReadonlyNode { readonly n: number; readonly children: readonly ReadonlyNode[]; }
const annotated: ReadonlyNode = node;
const input = {label:"initial", node, pair:[node,"tuple"], empty:{}, items:[{}]} as const;
const map = fromLibraries({ s:{json:input,schema:State} });
const root = map.data.must("s").at([]);
root.replace({ ...input, label:"omitted" });
root.replace({ ...input, label:"supplied", toString:3, node:{...node, constructor:4} });
root.update(() => ({ label:"changed" }));
root.object.setMany({ node });
root.at(["node"]).replace(annotated);
root.at(["pair"]).replace([node,"updated"] as const);
root.at(["node", "children"]).array.insert(0, node);
root.at(["node", "children"]).array.pushMany([node, {...node, constructor:3}] as const);
root.at(["node", "children"]).array.splice(0, 1, node);
root.at(["empty"]).replace({});
root.at(["items"]).array.insert(0, {});
map.batch(writer => writer.data.must("s").at(["node"]).replace(node));
same(root.snap().label, "changed");
same(root.snap().node.children[0]?.n, 2);
same(root.snap().toString, 3);
same(root.snap().node.constructor, Object);
const before = root.must.hson();
const callback = () => 7;
rejects(() => Reflect.apply(empty.replace, undefined, [callback]));
rejects(() => Reflect.apply(root.at(["items"]).array.insert, undefined, [0, callback]));
const incompatible = {...input, toString:"wrong"};
const erased: typeof input = incompatible;
try {
  root.replace(erased);
  throw new Error("Expected Schema validation to check an erased key");
} catch (cause) {
  if (!(cause instanceof Error && "code" in cause && cause.code === "SCHEMA_VALIDATION")) throw cause;
}
same(root.must.hson(), before);

function invalid() {
  // @ts-expect-error Exact-empty root proposals cannot be functions.
  empty.replace(callback);
  // @ts-expect-error Arrays are not exact-empty objects.
  empty.replace([]);
  // @ts-expect-error Primitives are not exact-empty objects.
  empty.replace(7);
  // @ts-expect-error Date is not an exact-empty object.
  empty.replace(new Date());
  // @ts-expect-error Symbol keys are outside the ordinary Data object model.
  empty.replace(symbolMember);
  // @ts-expect-error Nested empty objects retain the proposal boundary.
  root.at(["empty"]).replace(callback);
  // @ts-expect-error An enclosing write cannot hide an invalid empty object.
  root.replace({...input, empty:callback});
  // @ts-expect-error Array insertion retains the empty-object boundary.
  root.at(["items"]).array.insert(0, callback);
  // @ts-expect-error Explicit incompatible values are still rejected.
  root.replace({...input, toString:callback});
  // @ts-expect-error Ordinary Data with an incompatible shadowing member is also rejected.
  root.replace(incompatible);
  // @ts-expect-error Ordinary optional numbers keep their constraints.
  root.replace({...input, count:"wrong"});
  // @ts-expect-error Required named members still have their declared types.
  root.replace({...input, label:1});
  // @ts-expect-error Recursive readonly proposals retain explicit shadowing types.
  root.at(["node"]).replace({...node, children:[{n:2, constructor:callback, children:[]}]});
  // @ts-expect-error Bulk helpers preserve explicit shadowing types.
  root.at(["node","children"]).array.pushMany([node,{...node, constructor:callback}]);
  // @ts-expect-error Strict optional members cannot be explicitly undefined.
  root.replace({...input, count:undefined});
}
void invalid;
`);
  for (const [name, schema] of Object.entries(schemas)) {
    writeFileSync(join(directory, `${name}.d.ts`), schema.generated.declaration);
  }
  const source = readFileSync(join(directory, "index.ts"), "utf8");
  for (const exact of ["true", "false"]) {
    if (exact === "false") writeFileSync(join(directory, "index.ts"), source.replace(
      /  \/\/ @ts-expect-error Strict optional members[^\n]*\n  root\.replace\(\{\.\.\.input, count:undefined\}\);\n/, "",
    ));
    for (const indexed of ["true", "false"]) {
      run(stockCompiler, "-p", directory, "--pretty", "false", "--exactOptionalPropertyTypes", exact, "--noUncheckedIndexedAccess", indexed);
      run(join(directory, "out/index.js"));
    }
  }
});

function chain(prefix: string, count: number, terminal: string): string {
  return Array.from({ length: count }, (_, index) =>
    `'${prefix}${index}' ${index + 1 === count ? terminal : `<ref "${prefix}${index + 1}">`}`).join(" ");
}

const count = 2400;
const authoredChain = `<data <defs <${chain("T", count, "<number>")}>> <object any <ref "T0">>>`;

test("stock TypeScript compiles a standalone generated declaration for 2,400 aliases", () => {
  const { source, generated } = evidence("Rows", authoredChain);
  assert.equal(generated.declaration.match(/^export type T\d+ = /gm)?.length, count);
  assert.match(generated.declaration, /^export type T0 = T2399;$/m);
  assert.match(generated.declaration, /^export type T2399 = number;$/m);
  assert.ok(generated.generatedBytes < count * 40, `${generated.generatedBytes} generated bytes`);
  const again = generate_hson_schema_evidence("Rows", source, "index.ts#Other");
  assert.equal(again.declaration, generated.declaration);
  const metadata = JSON.parse(generated.metadata);
  assert.equal(metadata.generatedDeclarationDigest, createHash("sha256").update(generated.declaration).digest("hex"));
  assert.equal(metadata.semanticGraphDigest, JSON.parse(again.metadata).semanticGraphDigest);
  assert.notEqual(metadata.declarationIdentity, JSON.parse(again.metadata).declarationIdentity);
  const directory = project("stock-chain", `
${imports}
${useEvidence("Rows", source)}
import type { T0, T2399 } from "./Rows.js";
import type { Evidence as Other } from "./Other.js";
const first: T0 = 1;
const last: T2399 = first;
const certified = Rows.certify({});
// @ts-expect-error A flattened alias retains its terminal value type.
const invalid: T0 = true;
// @ts-expect-error Equal shapes in separate evidence modules have distinct Schema identities.
const other: HsonSchema<Other["value"], Other["mode"], Other["identity"]> = Rows;
void [last, certified, invalid, other];
`);
  writeFileSync(join(directory, "Rows.d.ts"), generated.declaration);
  writeFileSync(join(directory, "Other.d.ts"), again.declaration);
  run(stockCompiler, "-p", directory, "--pretty", "false", "--noEmit");
});

test("stock TypeScript preserves terminal shapes, named aliases and productive recursion", () => {
  const { source, generated } = evidence("Shapes", `<data <defs <
    ${chain("Short", 3, '<ref "Leaf">')}
    ${chain("Medium", 192, '<ref "Leaf">')}
    ${chain("Independent", 4, "<boolean>")}
    'Leaf' <object <'text' <string>>>
    'Extra' <array <ref "Leaf">>
    'Again' <ref "Node">
    'Node' <object <'n' <number> 'children' <array <ref "Again">> any <ref "Again">>>
    'ListEntry' <ref "List">
    'List' <array <ref "ListEntry">>
    'Unused' <ref "Leaf">
  >> <object <
    'one' <ref "Short0"> 'many' <array <ref "Medium0">> 'flag' <ref "Independent0">
    'tree' <ref "Again"> 'list' <ref "ListEntry"> any <ref "Extra">
  >>>`);
  assert.match(generated.declaration, /export type Short0 = Leaf;/);
  assert.match(generated.declaration, /export type Medium0 = Leaf;/);
  assert.match(generated.declaration, /export type Independent0 = Independent3;/);
  assert.match(generated.declaration, /export type Extra = ReadonlyArray<Leaf>;/);
  assert.match(generated.declaration, /export type Again = Node;/);
  assert.match(generated.declaration, /readonly children: ReadonlyArray<Again>;/);
  assert.match(generated.declaration, /export type ListEntry = List;/);
  assert.doesNotMatch(generated.declaration, /export type Unused/);
  const directory = project("shapes", `
${imports}
${useEvidence("Shapes", source)}
import type { Short0, Medium0, Extra, Again, ListEntry } from "./Shapes.js";
const one: Short0 = { text: "one" };
const second: Medium0 = one;
const extras: Extra = [one, second];
const treeCandidate = { n: 1, children: [{ n: 2, children: [] }] };
const tree: Again = treeCandidate;
const list: ListEntry = [[[]], []];
const view = Shapes.certify({ one, many: [second], flag: true, tree: treeCandidate, list, extra: [one] }).materialize();
const name: string = view.many[0]!.text;
const child: number = view.tree.children[0]!.n;
const flag: boolean = view.flag;
// @ts-expect-error Recursion retains the required number member.
const invalid: Again = { n: 1, children: [{ n: "bad", children: [] }] };
void [extras, tree, name, child, flag, invalid];
`);
  writeFileSync(join(directory, "Shapes.d.ts"), generated.declaration);
  run(stockCompiler, "-p", directory, "--pretty", "false");
  run(join(directory, "out/index.js"));
});

test("the packaged compiler project checks the same long wildcard chain", () => {
  const { source } = evidence("Rows", authoredChain);
  const input = `
import { Hson } from "hson-live/hson";
export const Rows = Hson.schema\`${source}\`;
export const certified = Rows.certify({});
`;
  const directory = project("packaged-chain", input);
  const config = join(directory, "tsconfig.json");
  const summary = JSON.parse(run(cli, "generate", "--project", config));
  assert.equal(summary.schemas, 1);
  run(cli, "check", "--project", config);
  run(stockCompiler, "-p", summary.project, "--pretty", "false", "--noEmit");
  assert.equal(readFileSync(join(directory, "index.ts"), "utf8"), input);
});
