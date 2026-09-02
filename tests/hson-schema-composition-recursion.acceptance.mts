import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { Hson, type HsonSchema } from "../src/index.ts";
import { compile_hson_schema } from "../src/internal/hson-schema/compiler.ts";
import { generate_hson_schema_types } from "../src/internal/hson-schema/generate-types.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "hson-schema-composition-recursion",
  title: "Hson Schema composition and recursion",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["hson-schema", "composition", "recursion"]),
});

const testEvents = create_test_event_emitter("hson-schema-composition-recursion");
let checks = 0;
const check = (name: string, run: () => void): void => {
  testEvents.case_begin(name, name);
  try {
    run();
    testEvents.case_end(name, "pass");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Check failed.";
    testEvents.diagnostic(name, "assertion", message.slice(0, 1_000));
    testEvents.case_end(name, "fail");
    testEvents.terminal("fail");
    throw error;
  } console.log(`ok ${++checks} - ${name}`); };
const compile = (source: string) => compile_hson_schema(source);

const compositionSource = `<
  type "data"
  defs <Address <content <city "string" country "string">>>
  content <content <billing <ref "Address"> shipping <ref "Address">>>
>`;
const treeSource = `<
  type "data"
  defs <Tree <content <value "string" children <array <ref "Tree">>>>>
  content <ref "Tree">
>`;
const mutualSource = `<
  type "data"
  defs <
    A <content <name <exact "a"> bs <array <ref "B">>>>
    B <content <name <exact "b"> as <array <ref "A">>>>
  >
  content <ref "A">
>`;

check("defs/ref ordinary composition shares one canonical definition authority", () => {
  const result = compile(compositionSource);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.definitions.length, 1);
  assert.equal(result.value.referenceUses.length, 2);
  const refs = result.value.graph.nodes.filter((node) => node.kind === "projected-ref");
  assert.equal(refs.length, 2);
  if (refs[0]?.kind === "projected-ref" && refs[1]?.kind === "projected-ref") assert.equal(refs[0].target, refs[1].target);
});

check("forward, backward, and case-sensitive local refs resolve deterministically", () => {
  const source = `<type "data" defs <A <content <b <ref "B">>> B <content <value "string">>> content <ref "A">>`;
  const left = compile(source), right = compile(source);
  assert.equal(left.ok, true); assert.equal(right.ok, true);
  if (left.ok && right.ok) assert.deepEqual(left.value.graph, right.value.graph);
  assert.equal(compile(`<type "data" defs <Name "string"> content <ref "name">>`).ok, false);
});

check("compiler exposes stable authored def/ref facts for editor-neutral tooling", () => {
  const source = `<type "data" defs <'display name' <content <next <ref "display name">>> Later "string"> content <ref "Later">>`;
  const result = compile(source);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const definition = result.value.symbols.definitions.find(symbol => symbol.name === "display name");
  assert.ok(definition);
  assert.equal(source.slice(definition.declarationRange.start, definition.declarationRange.end), "'display name'");
  assert.equal(definition.referenceRanges.length, 1);
  assert.equal(source.slice(definition.referenceRanges[0]!.start, definition.referenceRanges[0]!.end), '"display name"');
  assert.equal(result.value.symbols.references.every(reference => reference.targetId !== undefined), true);
  const unresolved = compile(`<type "data" defs <Known "string"> content <ref "Missing">>`);
  assert.equal(unresolved.ok, false);
  if (!unresolved.ok) {
    assert.equal(unresolved.symbols?.definitions[0]?.name, "Known");
    assert.equal(unresolved.symbols?.references[0]?.targetId, undefined);
  }
});

check("malformed, missing, nested, and extra-member refs reject with source ranges", () => {
  for (const source of [
    `<type "data" defs <Known "string"> content <ref "Missing">>`,
    `<type "data" defs <Known "string"> content <ref 1>>`,
    `<type "data" defs <Known "string"> content <ref "Known" extra true>>`,
    `<type "data" defs <Outer <defs <Inner "string"> content <value "string">>> content <ref "Outer">>`,
  ]) {
    const result = compile(source);
    assert.equal(result.ok, false, source);
    if (!result.ok) assert.ok(result.issues[0]?.range !== undefined || result.issues[0]?.code === "INVALID_ROOT");
  }
});

check("duplicate definitions reject through authored Hson parsing", () => {
  assert.equal(compile(`<type "data" defs <Thing "string" Thing "number"> content <ref "Thing">>`).ok, false);
});

check("unused definitions are excluded under canonical reachability authority", () => {
  const base = compile(`<type "data" content <value "string">>`);
  const unused = compile(`<type "data" defs <Unused <content <n "number">>> content <value "string">>`);
  assert.equal(base.ok, true); assert.equal(unused.ok, true);
  if (base.ok && unused.ok) {
    assert.equal(unused.value.definitions.length, 1);
    assert.equal(unused.value.referenceUses.length, 0);
    assert.deepEqual(unused.value.graph, base.value.graph);
  }
});

check("productive self recursion lowers to a finite real graph cycle", () => {
  const result = compile(treeSource);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.recursiveSccCount, 1);
  assert.ok(result.value.graph.nodes.length < 10);
  const recursive = result.value.graph.nodes.find((node, index) => node.kind === "projected-ref" && node.target < index);
  assert.ok(recursive !== undefined);
});

check("productive mutual recursion lowers and emits finite mutually recursive aliases", () => {
  const result = compile(mutualSource);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.recursiveSccCount, 1);
  const generated = generate_hson_schema_types("MutualSchema", result.value.semantic, result.value.definitions);
  assert.match(generated.declarations, /type __MutualSchemaDefinition0/);
  assert.match(generated.declarations, /type __MutualSchemaDefinition1/);
  assert.ok(generated.declarations.length < 10_000);
});

check("existing canonical productivity authority rejects zero-progress recursion at the ref range", () => {
  const result = compile(`<type "data" defs <Loop <ref "Loop">> content <ref "Loop">>`);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.issues[0]?.code, "INVALID_SCHEMA_GRAPH");
    assert.match(result.issues[0]?.message ?? "", /no consuming validation progress/);
    assert.ok(result.issues[0]?.range !== undefined);
  }
});

check("refs compose through array, tuple, restricted union, and refinements", () => {
  const result = compile(`<
    type "data"
    defs <Age <number <int true min 0>> Text "string" Count "number">
    content <content <age <ref "Age"> ages <array <ref "Age">> pair <tuple [<ref "Text">, <ref "Count">]> choice <union [<ref "Text">, <ref "Count">]>>>
  >`);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.graph.nodes.filter((node) => node.kind === "projected-refinement").length, 2);
});

check("refs preserve finite exact-domain distinguishability through nested unions", () => {
  const result = compile(`<
    type "data"
    defs <
      Lobby <exact "lobby">
      Ready <exact "ready">
      Active <union [<ref "Lobby">, <union [<ref "Ready">, <exact "playing">]>]>
    >
    content <content <pair <union [<ref "Lobby">, <ref "Ready">]> phase <ref "Active">>>
  >`);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.graph.nodes.filter((node) => node.kind === "projected-union").length, 3);
});

check("finite exact-domain duplicates and cycles reached through refs fail closed", () => {
  for (const source of [
    `<type "data" defs <Left <exact "same"> Right <exact "same">> content <value <union [<ref "Left">, <ref "Right">]>>>`,
    `<type "data" defs <Domain <union [<exact "a">, <exact "b">]> Duplicate <exact "b">> content <value <union [<ref "Domain">, <ref "Duplicate">]>>>`,
    `<type "data" defs <Cycle <union [<exact "a">, <ref "Cycle">]>> content <ref "Cycle">>`,
  ]) {
    const result = compile(source);
    assert.equal(result.ok, false, source);
    if (!result.ok) assert.equal(result.issues.some((entry) => entry.code === "INVALID_UNION"), true);
  }
});

check("data/document capability mismatches reject in the single local namespace", () => {
  const result = compile(`<type "data" defs <Element <tag "x" content "empty">> content <ref "Element">>`);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.issues.some((entry) => entry.code === "INVALID_REFERENCE"), true);
});

check("document item composition and productive recursion use existing document graph edges", () => {
  const composition = compile(`<type "document" defs <Child <tag "child" content "empty">> tag "root" content <sequence [<ref "Child">]>>`);
  const recursive = compile(`<type "document" defs <Node <tag "node" content <sequence [<ref "Node">]>>> tag "root" content <sequence [<ref "Node">]>>`);
  assert.equal(composition.ok, true); assert.equal(recursive.ok, true);
  if (recursive.ok) {
    assert.equal(recursive.value.recursiveSccCount, 1);
    const generated = generate_hson_schema_types("RecursiveDocumentSchema", recursive.value.semantic, recursive.value.definitions);
    assert.match(generated.declarations, /type __RecursiveDocumentSchemaDefinition0/);
    assert.match(generated.declarations, /__RecursiveDocumentSchemaDefinition0/);
    assert.ok(generated.declarations.length < 5_000);
  }
  assert.equal(compile(`<type "document" defs <Text "string"> tag "root" content <sequence [<ref "Text">]>>`).ok, false);
});

check("runtime certification validates finite recursive candidates and preserves exact identity", () => {
  const schema: HsonSchema = Hson`<type "data" defs <Tree <content <value "string" children <array <ref "Tree">>>>> content <ref "Tree">>`;
  const valid = Hson`<value "root" children [<value "leaf" children []>]>`;
  assert.equal(Hson.certify(schema, valid), valid);
  assert.throws(() => Hson.certify(schema, Hson`<value "root" children [<value 1 children []>]>`));
  const mutual: HsonSchema = Hson`<type "data" defs <A <content <name <exact "a"> bs <array <ref "B">>>> B <content <name <exact "b"> as <array <ref "A">>>>> content <ref "A">>`;
  const mutualCandidate = Hson`<name "a" bs [<name "b" as []>]>`;
  assert.equal(Hson.certify(mutual, mutualCandidate), mutualCandidate);
});

check("moderately nested recursive validation and generation remain bounded", () => {
  const result = compile(treeSource);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const generated = generate_hson_schema_types("TreeSchema", result.value.semantic, result.value.definitions);
  const candidate = Hson`<value "0" children [<value "1" children [<value "2" children [<value "3" children [<value "4" children []>]>]>]>]>`;
  const schema: HsonSchema = Hson`<type "data" defs <Tree <content <value "string" children <array <ref "Tree">>>>> content <ref "Tree">>`;
  const started = performance.now();
  assert.equal(Hson.certify(schema, candidate), candidate);
  const elapsed = performance.now() - started;
  assert.ok(generated.declarations.length < 5_000);
  assert.ok(elapsed < 1_000, `recursive validation took ${elapsed}ms`);
  console.log(JSON.stringify({ recursionPerformance: "ok", defs: result.value.definitions.length, refs: result.value.referenceUses.length, recursiveSccs: result.value.recursiveSccCount, canonicalNodes: result.value.canonicalNodeCount, proofNodes: generated.proofNodeCount, generatedDeclarationBytes: Buffer.byteLength(generated.declarations), runtimeValidationMs: Math.round(elapsed * 100) / 100 }));
});

testEvents.terminal("pass");
