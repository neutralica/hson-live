// @hson-live-external-test
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { hson } from "../src/hson.ts";
import { hsonTransform } from "../src/api/transform/index.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import type { HsonAttrs, HsonMeta, HsonNode, Primitive } from "../src/core/types.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "transform.binary-hson-vectors",
  title: "Canonical Binary Hson golden vectors",
  category: "Transform",
  runtime: "node",
  tags: Object.freeze(["binary", "serialization", "canonical-graph", "sha256", "public-api", "externally-discoverable"]),
});

const testEvents = create_test_event_emitter("transform.binary-hson-vectors");
let checks = 0;

async function check(name: string, run: () => void | Promise<void>): Promise<void> {

  testEvents.case_begin(name, name);
  try {
    await run();
    testEvents.case_end(name, "pass");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Check failed.";
    testEvents.diagnostic(name, "assertion", message.slice(0, 1_000));
    testEvents.case_end(name, "fail");
    testEvents.terminal("fail");
    throw error;
  }
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

/** Parse only hand-authored hexadecimal fixtures; this is not a format encoder. */
function fixedHex(source: string): Uint8Array {
  const hex = source.replaceAll(/\s/g, "");
  assert.match(hex, /^(?:[0-9a-fA-F]{2})*$/);
  return Uint8Array.from(hex.match(/../g)?.map((pair) => Number.parseInt(pair, 16)) ?? []);
}

function node(
  tag: string,
  content: HsonNode["$_content"] = [],
  attrs?: HsonAttrs,
  meta?: HsonMeta,
): HsonNode {
  const value: HsonNode = { $_tag: tag, $_content: content };
  if (attrs !== undefined) value.$_attrs = attrs;
  if (meta !== undefined) value.$_meta = meta;
  return value;
}

function elem(value: HsonNode): HsonNode {
  return node("_hson_elem", [value]);
}

function str(value: string, meta?: HsonMeta): HsonNode {
  return node("_hson_str", [value], undefined, meta);
}

function val(value: Exclude<Primitive, string>): HsonNode {
  return node("_hson_val", [value]);
}

function assertGolden(expectedNode: HsonNode, expectedBytes: Uint8Array): void {
  const actualBytes = hsonTransform.fromNode(expectedNode).toBinary().serialize();
  assert.deepEqual(actualBytes, expectedBytes);

  const decoded = hsonTransform.fromBinary(expectedBytes).toNode();
  assert.equal(canonical_hson_graph_equal(decoded, expectedNode), true);
  assert.notEqual(decoded, expectedNode);
  assert.deepEqual(hsonTransform.fromNode(decoded).toBinary().serialize(), expectedBytes);
}

function assertTypedStyleGolden(
  expectedNode: HsonNode,
  expectedBytes: Uint8Array,
  expectedUnitPresence: boolean,
  expectedUnit: string | undefined,
): void {
  assertGolden(expectedNode, expectedBytes);
  const decoded = hsonTransform.fromBinary(expectedBytes).toNode();
  const cluster = decoded.$_content[0];
  assert.equal(typeof cluster, "object");
  assert.notEqual(cluster, null);
  if (typeof cluster !== "object" || cluster === null) throw new Error("missing decoded element");
  const width = cluster.$_attrs?.style?.width;
  assert.equal(typeof width, "object");
  assert.notEqual(width, null);
  if (typeof width !== "object" || width === null) throw new Error("missing decoded typed style");
  assert.equal(Object.hasOwn(width, "unit"), expectedUnitPresence);
  assert.equal(Reflect.get(width, "unit"), expectedUnit);
}

function sha256Oracle(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/*
 * These are literal, independently authored byte vectors. They deliberately do
 * not call the production encoder (or a test-side mirror of it) to form the
 * expected byte sequence.
 */
const GOLDEN_NULL = fixedHex(`48 53 4f 4e  12 00 00 20`);
const GOLDEN_FALSE = fixedHex(`48 53 4f 4e  12 00 00 21`);
const GOLDEN_TRUE = fixedHex(`48 53 4f 4e  12 00 00 22`);
const GOLDEN_EMPTY_STRING = fixedHex(`48 53 4f 4e  11 00 00  00000000`);
const GOLDEN_ASCII = fixedHex(`48 53 4f 4e  11 00 00  00000001 0041`);
const GOLDEN_BMP = fixedHex(`48 53 4f 4e  11 00 00  00000001 00e9`);
const GOLDEN_ASTRAL = fixedHex(`48 53 4f 4e  11 00 00  00000002 d83d de00`);
const GOLDEN_HIGH_SURROGATE = fixedHex(`48 53 4f 4e  11 00 00  00000001 d800`);
const GOLDEN_LOW_SURROGATE = fixedHex(`48 53 4f 4e  11 00 00  00000001 dc00`);
const GOLDEN_ZERO = fixedHex(`48 53 4f 4e  12 00 00 23 0000000000000000`);
const GOLDEN_NEGATIVE_ZERO = fixedHex(`48 53 4f 4e  12 00 00 23 8000000000000000`);

const GOLDEN_ORDERED_OBJECT = fixedHex(`
  48 53 4f 4e
  13 00 00 00000002
    10 00000001 0062 00 00 00000001
      13 00 00 00000001
        12 00 00 23 4000000000000000
    10 00000001 0061 00 00 00000001
      13 00 00 00000001
        12 00 00 23 3ff0000000000000
`);

const GOLDEN_ARRAY = fixedHex(`
  48 53 4f 4e
  14 00 00 00000002
    16 00 01 00000001
      00000005 0069 006e 0064 0065 0078
      00000001 0030
      00000001
        12 00 00 23 3ff0000000000000
    16 00 01 00000001
      00000005 0069 006e 0064 0065 0078
      00000001 0031
      00000001
        12 00 00 23 4000000000000000
`);

const GOLDEN_EMPTY_ELEMENT = fixedHex(`
  48 53 4f 4e
  15 00 00 00000001
    10 00000004 006d 0061 0069 006e 00 00 00000000
`);

const GOLDEN_ORDERED_ELEMENT_CONTENT = fixedHex(`
  48 53 4f 4e
  15 00 00 00000001
    10 00000004 006d 0061 0069 006e 00 00 00000001
      15 00 00 00000003
        11 00 00 00000001 0061
        11 00 00 00000000
        11 00 00 00000001 0062
`);

const GOLDEN_ATTRS = fixedHex(`
  48 53 4f 4e
  15 00 00 00000001
    10 00000004 006d 0061 0069 006e
      01 00000002
        00000008 0064 0069 0073 0061 0062 006c 0065 0064 21
        00000002 0069 0064 24 00000001 0078
      00
      00000000
`);

const GOLDEN_PRESENT_EMPTY_META = fixedHex(`
  48 53 4f 4e
  11 00 01 00000000 00000001 006d
`);

const GOLDEN_QUID = fixedHex(`
  48 53 4f 4e
  15 00 00 00000001
    10 00000004 006d 0061 0069 006e
      00
      01 00000001
        00000004 0071 0075 0069 0064
        00000009 0030 0030 0030 0030 0030 0030 0030 0030 0031
      00000000
`);

const GOLDEN_RAW_STYLE = fixedHex(`
  48 53 4f 4e
  15 00 00 00000001
    10 00000004 006d 0061 0069 006e
      01 00000001
        00000005 0073 0074 0079 006c 0065
        24 00000009 0063 006f 006c 006f 0072 003a 0072 0065 0064
      00
      00000000
`);

const GOLDEN_PRIMITIVE_STYLE = fixedHex(`
  48 53 4f 4e
  15 00 00 00000001
    10 00000004 006d 0061 0069 006e
      01 00000001
        00000005 0073 0074 0079 006c 0065
        26 00000001
          00000005 0063 006f 006c 006f 0072
          24 00000003 0072 0065 0064
      00
      00000000
`);

const GOLDEN_TYPED_STYLE_ABSENT = fixedHex(`
  48 53 4f 4e
  15 00 00 00000001
    10 00000004 006d 0061 0069 006e
      01 00000001
        00000005 0073 0074 0079 006c 0065
        26 00000001
          00000005 0077 0069 0064 0074 0068
          25 23 4000000000000000 00
      00
      00000000
`);

const GOLDEN_TYPED_STYLE_UNDEFINED = fixedHex(`
  48 53 4f 4e
  15 00 00 00000001
    10 00000004 006d 0061 0069 006e
      01 00000001
        00000005 0073 0074 0079 006c 0065
        26 00000001
          00000005 0077 0069 0064 0074 0068
          25 23 4000000000000000 01
      00
      00000000
`);

const GOLDEN_TYPED_STYLE_EMPTY_UNIT = fixedHex(`
  48 53 4f 4e
  15 00 00 00000001
    10 00000004 006d 0061 0069 006e
      01 00000001
        00000005 0073 0074 0079 006c 0065
        26 00000001
          00000005 0077 0069 0064 0074 0068
          25 23 4000000000000000 02 00000000
      00
      00000000
`);

const GOLDEN_TYPED_STYLE_PX = fixedHex(`
  48 53 4f 4e
  15 00 00 00000001
    10 00000004 006d 0061 0069 006e
      01 00000001
        00000005 0073 0074 0079 006c 0065
        26 00000001
          00000005 0077 0069 0064 0074 0068
          25 23 4000000000000000 02 00000002 0070 0078
      00
      00000000
`);

const GOLDEN_EMPTY_STYLE = fixedHex(`
  48 53 4f 4e
  15 00 00 00000001
    10 00000004 006d 0061 0069 006e
      01 00000001
        00000005 0073 0074 0079 006c 0065
        26 00000000
      00
      00000000
`);

const GOLDEN_NESTED = fixedHex(`
  48 53 4f 4e
  15 00 00 00000001
    10 00000004 006d 0061 0069 006e
      00
      01 00000001
        00000004 0071 0075 0069 0064
        00000009 0030 0030 0030 0030 0030 0030 0030 0030 0031
      00000001
        15 00 00 00000001
          10 00000006 0073 0074 0072 006f 006e 0067 00 00 00000001
            15 00 00 00000001
              11 00 00 00000002 006f 006b
`);

const orderedObject = hson.fromHson(`<b 2 a 1>`).toNode();
const indexedArray = hson.fromHson(`«1,2»`).toNode();
const emptyElement = hson.fromHson(`<main/>`).toNode();
const orderedElement = hson.fromHson(`<main "a" "" "b"/>`).toNode();
const quidElement = hson.fromHson(`<main @000000001/>`).toNode();
const nestedElement = hson.fromHson(`<main @000000001 <strong "ok"/>/>`).toNode();
const attrsElement = elem(node("main", [], { id: "x", disabled: false }));
const rawStyleAttrs: HsonAttrs = {};
Reflect.set(rawStyleAttrs, "style", "color:red");
const rawStyleElement = elem(node("main", [], rawStyleAttrs));
const primitiveStyleElement = elem(node("main", [], { style: { color: "red" } }));
const typedStyleAbsentElement = elem(node("main", [], { style: { width: { value: 2 } } }));
const typedStyleUndefinedElement = elem(node("main", [], { style: { width: { value: 2, unit: undefined } } }));
const typedStyleEmptyUnitElement = elem(node("main", [], { style: { width: { value: 2, unit: "" } } }));
const typedStylePxElement = elem(node("main", [], { style: { width: { value: 2, unit: "px" } } }));
const emptyStyleElement = elem(node("main", [], { style: {} }));

await check("null has its fixed Binary Hson vector", () => assertGolden(val(null), GOLDEN_NULL));
await check("false has its fixed Binary Hson vector", () => assertGolden(val(false), GOLDEN_FALSE));
await check("true has its fixed Binary Hson vector", () => assertGolden(val(true), GOLDEN_TRUE));
await check("the empty string has its fixed Binary Hson vector", () => assertGolden(str(""), GOLDEN_EMPTY_STRING));
await check("an ASCII string has its fixed Binary Hson vector", () => assertGolden(str("A"), GOLDEN_ASCII));
await check("a BMP non-ASCII code unit has its fixed Binary Hson vector", () => assertGolden(str("é"), GOLDEN_BMP));
await check("an astral surrogate pair has its fixed Binary Hson vector", () => assertGolden(str("😀"), GOLDEN_ASTRAL));
await check("an isolated high surrogate has its fixed Binary Hson vector", () => assertGolden(str("\ud800"), GOLDEN_HIGH_SURROGATE));
await check("an isolated low surrogate has its fixed Binary Hson vector", () => assertGolden(str("\udc00"), GOLDEN_LOW_SURROGATE));
await check("positive zero has its fixed Binary Hson vector", () => assertGolden(val(0), GOLDEN_ZERO));
await check("negative zero has its distinct fixed Binary Hson vector", () => assertGolden(val(-0), GOLDEN_NEGATIVE_ZERO));
await check("a representative object preserves member order", () => assertGolden(orderedObject, GOLDEN_ORDERED_OBJECT));
await check("an array preserves canonical item indexes", () => assertGolden(indexedArray, GOLDEN_ARRAY));
await check("an empty ordinary element has its fixed Binary Hson vector", () => assertGolden(emptyElement, GOLDEN_EMPTY_ELEMENT));
await check("element content preserves ordering, adjacent text, and empty text", () => assertGolden(orderedElement, GOLDEN_ORDERED_ELEMENT_CONTENT));
await check("ordinary attributes sort their keys without changing values", () => assertGolden(attrsElement, GOLDEN_ATTRS));
await check("legacy present-empty metadata decodes to canonical absence", () => {
  const candidate = str("m", {});
  const encoded = hsonTransform.fromNode(candidate).toBinary().serialize();
  assert.deepEqual(encoded, GOLDEN_ASCII.map((byte, index) => index === GOLDEN_ASCII.length - 1 ? "m".charCodeAt(0) : byte));
  const decoded = hsonTransform.fromBinary(GOLDEN_PRESENT_EMPTY_META).toNode();
  assert.equal(Object.hasOwn(decoded, "$_meta"), false);
  assert.deepEqual(hsonTransform.fromNode(decoded).toBinary().serialize(), encoded);
});
await check("QUID metadata uses the ordinary metadata string grammar", () => assertGolden(quidElement, GOLDEN_QUID));
await check("a raw style string uses the ordinary string attribute grammar", () => assertGolden(rawStyleElement, GOLDEN_RAW_STYLE));
await check("0x26 contains a primitive structured-style entry", () => assertGolden(primitiveStyleElement, GOLDEN_PRIMITIVE_STYLE));
await check("typed style unit state 0x00 preserves absence", () => {
  assertTypedStyleGolden(typedStyleAbsentElement, GOLDEN_TYPED_STYLE_ABSENT, false, undefined);
});
await check("typed style unit state 0x01 preserves own-present undefined", () => {
  assertTypedStyleGolden(typedStyleUndefinedElement, GOLDEN_TYPED_STYLE_UNDEFINED, true, undefined);
});
await check("typed style unit state 0x02 preserves an empty string", () => {
  assertTypedStyleGolden(typedStyleEmptyUnitElement, GOLDEN_TYPED_STYLE_EMPTY_UNIT, true, "");
});
await check("typed style unit state 0x02 preserves px", () => {
  assertTypedStyleGolden(typedStylePxElement, GOLDEN_TYPED_STYLE_PX, true, "px");
});
await check("0x26 preserves an admitted empty structured style map", () => assertGolden(emptyStyleElement, GOLDEN_EMPTY_STYLE));
await check("a nested representative graph has one exact byte spelling", () => assertGolden(nestedElement, GOLDEN_NESTED));

await check("Binary SHA hashes the exact trivial golden bytes", async () => {
  const binary = hsonTransform.fromNode(val(null)).toBinary();
  assert.deepEqual(binary.serialize(), GOLDEN_NULL);
  assert.equal(sha256Oracle(GOLDEN_NULL), "29ce60d4cbb89e7fa4de6747470147d4b76cb2fd9aecb99ed1f0f39fa2171d35");
  assert.equal(await binary.sha256(), sha256Oracle(GOLDEN_NULL));
});

await check("Binary SHA hashes the exact nested golden bytes", async () => {
  const binary = hsonTransform.fromNode(nestedElement).toBinary();
  assert.deepEqual(binary.serialize(), GOLDEN_NESTED);
  assert.equal(await binary.sha256(), sha256Oracle(GOLDEN_NESTED));
  assert.notEqual(await binary.sha256(), await hsonTransform.fromNode(nestedElement).toHson().sha256());
});

await check("Binary SHA hashes surrogate bytes directly", async () => {
  const binary = hsonTransform.fromNode(str("\ud800")).toBinary();
  assert.deepEqual(binary.serialize(), GOLDEN_HIGH_SURROGATE);
  assert.equal(await binary.sha256(), sha256Oracle(GOLDEN_HIGH_SURROGATE));
});

process.stdout.write(`1..${checks}\n`);
testEvents.terminal("pass");
emit_hson_live_test_completion("transform.binary-hson-vectors", checks, checks, 0);
