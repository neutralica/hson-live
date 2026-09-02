import assert from "node:assert/strict";

import { hson } from "../src/hson.ts";
import { hsonTransform } from "../src/api/transform/index.ts";
import { construct_source_1 } from "../src/api/transform/constructors/construct-source-1.ts";
import { parse_hson } from "../src/api/transform/parsers/parse-hson.ts";
import { serialize_hson } from "../src/api/transform/serializers/serialize-hson.ts";
import { detach_hson_root_value } from "../src/api/transform/utils/node-utils/detach-hson-root-value.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import { TransformError } from "../src/core/errors.ts";
import type { HsonNode, Primitive } from "../src/core/types.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "transform.hson-root-boundary",
  title: "Hson root detachment and source shaping",
  category: "Transform",
  runtime: "node",
  tags: Object.freeze(["hson", "parsing", "root-boundary", "source-shaping"]),
});

const testEvents = create_test_event_emitter("transform.hson-root-boundary");
let checks = 0;

function check(name: string, fn: () => void): void {

  testEvents.case_begin(name, name);
  try {
    fn();
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

function node(tag: string, content: HsonNode["$_content"] = []): HsonNode {
  return { $_tag: tag, $_content: content };
}

function root(value?: HsonNode): HsonNode {
  return node("_hson_root", value === undefined ? [] : [value]);
}

function publicNode(source: string): HsonNode {
  return hson.fromHson(source).toNode();
}

function canonicalize(source: string): string {
  return hson.fromHson(source).toHson().serialize();
}

function assertBare(
  source: string,
  tag: "_hson_str" | "_hson_val",
  payload: Primitive,
  canonical: string,
): void {
  const internal = parse_hson(source);
  assert.equal(internal.$_tag, "_hson_root");
  assert.equal(internal.$_content.length, 1);
  const internalValue = internal.$_content[0] as HsonNode;
  assert.equal(internalValue.$_tag, tag);
  assert.equal(Object.is(internalValue.$_content[0], payload), true);

  const value = publicNode(source);
  assert.equal(value.$_tag, tag);
  assert.equal(Object.is(value.$_content[0], payload), true);
  assert.notEqual(value.$_tag, "_hson_root");
  assert.equal(hson.fromHson(source).toHson().noBreak().serialize(), canonical);
  assert.equal(canonicalize(source), canonical);
  assert.equal(canonical_hson_graph_equal(publicNode(canonical), value), true);
}

function assertNoPublicRoot(source: string): void {
  const transform = hson.fromHson(source);
  assert.notEqual(transform.toNode().$_tag, "_hson_root");
  assert.doesNotMatch(transform.toHson().serialize(), /_hson_root/);
  assert.doesNotMatch(JSON.stringify(transform.toJson().value()), /_hson_root/);
  assert.doesNotMatch(transform.toHtml().serialize(), /_hson_root/);
}

function assertRootEgressRejects(value: HsonNode): void {
  const pattern = /_hson_root is an internal attachment carrier/;
  assert.throws(() => serialize_hson(value), pattern);
  assert.throws(() => hson.fromNode(value).toHson().serialize(), pattern);
}

function expectTransformError(source: string, code: string): TransformError {
  let observed: TransformError | undefined;
  assert.throws(
    () => publicNode(source),
    (cause) => {
      if (!(cause instanceof TransformError)) return false;
      observed = cause;
      return cause.code === code;
    },
  );
  assert.ok(observed);
  return observed;
}

check("bare empty string attaches as one _hson_str semantic value", () => {
  assertBare(`""`, "_hson_str", "", `""`);
});

check("bare nonempty string attaches as one _hson_str semantic value", () => {
  assertBare(`"hello"`, "_hson_str", "hello", `"hello"`);
});

check("bare escaped string preserves its decoded payload and canonical spelling", () => {
  assertBare(`"a\\n\\\"b"`, "_hson_str", `a\n"b`, `"a\\n\\\"b"`);
});

check("bare zero attaches as one _hson_val semantic value", () => {
  assertBare(`0`, "_hson_val", 0, `0`);
});

check("bare negative zero retains exact numeric identity", () => {
  assertBare(`-0`, "_hson_val", -0, `-0`);
});

check("bare positive integer attaches as one _hson_val semantic value", () => {
  assertBare(`42`, "_hson_val", 42, `42`);
});

check("bare negative number attaches as one _hson_val semantic value", () => {
  assertBare(`-12.5`, "_hson_val", -12.5, `-12.5`);
});

check("accepted exponent input canonicalizes as a finite _hson_val", () => {
  assertBare(`1e3`, "_hson_val", 1000, `1000`);
});

check("alternative exponent spellings close to exact canonical numeric values", () => {
  assertBare(`1E3`, "_hson_val", 1000, `1000`);
  assertBare(`1e+3`, "_hson_val", 1000, `1000`);
  assertBare(`1e-3`, "_hson_val", 0.001, `0.001`);
});

check("invalid root number spellings reject before root-shaping diagnostics", () => {
  const leadingZero = expectTransformError(`01`, "HSON_NUMBER_LEADING_ZERO");
  assert.deepEqual(leadingZero.source, { index: 1, line: 1, column: 2 });
  const leadingPlus = expectTransformError(`+1`, "HSON_NUMBER_LEADING_PLUS");
  assert.deepEqual(leadingPlus.source, { index: 0, line: 1, column: 1 });
});

check("bare true attaches as one _hson_val semantic value", () => {
  assertBare(`true`, "_hson_val", true, `true`);
});

check("bare false attaches as one _hson_val semantic value", () => {
  assertBare(`false`, "_hson_val", false, `false`);
});

check("bare null attaches as one _hson_val semantic value", () => {
  assertBare(`null`, "_hson_val", null, `null`);
});

check("empty anonymous object detaches as _hson_obj", () => {
  assert.equal(publicNode(`<>`).$_tag, "_hson_obj");
  assert.deepEqual(publicNode(`<>`).$_content, []);
});

check("populated top-level object detaches as one _hson_obj", () => {
  const value = publicNode(`<a 1 b 2>`);
  assert.equal(value.$_tag, "_hson_obj");
  assert.deepEqual(value.$_content.map((child) => (child as HsonNode).$_tag), ["a", "b"]);
});

check("nested top-level object retains nested object structure", () => {
  const value = publicNode(`<record <field 2>>`);
  assert.equal(value.$_tag, "_hson_obj");
  assert.equal((value.$_content[0] as HsonNode).$_tag, "record");
});

check("empty guillemet array detaches as _hson_arr", () => {
  assert.deepEqual(publicNode(`«»`), node("_hson_arr"));
});

check("empty bracket array detaches as _hson_arr and canonicalizes to guillemets", () => {
  assert.deepEqual(publicNode(`[]`), node("_hson_arr"));
  assert.equal(canonicalize(`[]`), `«»`);
});

check("primitive array detaches with canonical indexed membership", () => {
  const value = publicNode(`«1,"two",false,null»`);
  assert.equal(value.$_tag, "_hson_arr");
  assert.deepEqual(value.$_content.map((item) => (item as HsonNode).$_meta?.index), ["0", "1", "2", "3"]);
});

check("object array retains object-wrapped membership", () => {
  const value = publicNode(`«<name "Ada">»`);
  const item = value.$_content[0] as HsonNode;
  assert.equal((item.$_content[0] as HsonNode).$_tag, "_hson_obj");
});

check("nested array retains array-valued membership", () => {
  const value = publicNode(`«[1,2],«3»»`);
  const first = value.$_content[0] as HsonNode;
  assert.equal((first.$_content[0] as HsonNode).$_tag, "_hson_arr");
});

check("established trailing-comma array syntax remains valid", () => {
  assert.equal(hson.fromHson(`«1,2,»`).toHson().noBreak().serialize(), `«1,2»`);
});

check("single tagged element-side input detaches only _hson_root", () => {
  const value = publicNode(`<a/>`);
  assert.equal(value.$_tag, "_hson_elem");
  assert.equal((value.$_content[0] as HsonNode).$_tag, "a");
});

check("multiple tagged element-side inputs retain one _hson_elem content carrier", () => {
  const value = publicNode(`<a/><b/>`);
  assert.equal(value.$_tag, "_hson_elem");
  assert.deepEqual(value.$_content.map((child) => (child as HsonNode).$_tag), ["a", "b"]);
});

check("single tagged object-side input detaches only _hson_root", () => {
  const value = publicNode(`<a 1>`);
  assert.equal(value.$_tag, "_hson_obj");
  assert.equal((value.$_content[0] as HsonNode).$_tag, "a");
});

check("multiple object members retain one _hson_obj", () => {
  const value = publicNode(`<a 1 b 2>`);
  assert.equal(value.$_tag, "_hson_obj");
  assert.equal(value.$_content.length, 2);
});

check("tagged element text remains beneath the ordinary element branch", () => {
  const value = publicNode(`<p "text"/>`);
  const ordinary = value.$_content[0] as HsonNode;
  assert.equal((ordinary.$_content[0] as HsonNode).$_tag, "_hson_elem");
});

check("tagged nested element content retains meaningful _hson_elem wrappers", () => {
  const value = publicNode(`<p <em "text"/>/>`);
  const ordinary = value.$_content[0] as HsonNode;
  assert.equal((ordinary.$_content[0] as HsonNode).$_tag, "_hson_elem");
});

check("tagged object scalar property retains its object-side relationship", () => {
  const value = publicNode(`<record <field 2>>`);
  assert.equal(value.$_tag, "_hson_obj");
  assert.deepEqual(hson.fromNode(value).toJson().value(), { record: { field: 2 } });
});

check("tagged nested object property retains object semantics", () => {
  assert.deepEqual(
    hson.fromHson(`<record <nested <field 2>>>`).toJson().value(),
    { record: { nested: { field: 2 } } },
  );
});

check("tagged array-valued property retains array semantics", () => {
  assert.deepEqual(
    hson.fromHson(`<record <items «1,2»>>`).toJson().value(),
    { record: { items: [1, 2] } },
  );
});

check("zero-length Hson source rejects", () => {
  assert.throws(() => publicNode(``), /has no semantic value/);
});

check("space-only Hson source rejects", () => {
  assert.throws(() => publicNode(`   `), /has no semantic value/);
});

check("tab-only Hson source rejects", () => {
  assert.throws(() => publicNode(`\t\t`), /has no semantic value/);
});

check("LF-only Hson source rejects", () => {
  assert.throws(() => publicNode(`\n\n`), /has no semantic value/);
});

check("CRLF-only Hson source rejects", () => {
  assert.throws(() => publicNode(`\r\n\r\n`), /has no semantic value/);
});

check("comment-only Hson source rejects", () => {
  assert.throws(() => publicNode(`// comment`), /has no semantic value/);
});

check("mixed whitespace and comment-only Hson source rejects", () => {
  assert.throws(() => publicNode(` \t// comment\r\n  `), /has no semantic value/);
});

check("explicit empty string object and array remain valid empty values", () => {
  assert.deepEqual([publicNode(`""`).$_tag, publicNode(`<>`).$_tag, publicNode(`«»`).$_tag], [
    "_hson_str", "_hson_obj", "_hson_arr",
  ]);
});

check("primitive Hson source exposes no root through any public terminal", () => {
  assertNoPublicRoot(`42`);
});

check("object Hson source exposes no root through any public terminal", () => {
  assertNoPublicRoot(`<a 1 b 2>`);
});

check("array Hson source exposes no root through any public terminal", () => {
  assertNoPublicRoot(`«1,2»`);
});

check("element Hson source exposes no root through any public terminal", () => {
  assertNoPublicRoot(`<a/>`);
});

check("object-side tagged Hson exposes no root through any public terminal", () => {
  assertNoPublicRoot(`<record <field 2>>`);
});

check("browser umbrella and universal Transform share exact Hson detachment", () => {
  assert.equal(hson.fromHson, hsonTransform.fromHson);
  assert.deepEqual(hson.fromHson(`<a/>`).toNode(), hsonTransform.fromHson(`<a/>`).toNode());
});

check("browser-capable source constructor detaches its internal Hson root", () => {
  const browserSource = construct_source_1({ unsafe: true });
  assert.equal(browserSource.fromHson(`42`).toNode().$_tag, "_hson_val");
  assert.equal(browserSource.fromHson(`<a/>`).toNode().$_tag, "_hson_elem");
});

check("Worker-safe Transform returns the same bare primitive shape", () => {
  const value = hsonTransform.fromHson(`-0`).toNode();
  assert.equal(value.$_tag, "_hson_val");
  assert.equal(Object.is(value.$_content[0], -0), true);
});

check("valid one-child root detachment returns the exact child identity", () => {
  const child = node("_hson_obj");
  assert.equal(detach_hson_root_value(root(child)), child);
});

check("exact detachment preserves child metadata content and root input", () => {
  const child = node("_hson_elem", [{
    $_tag: "main",
    $_meta: { quid: "000000001" },
    $_content: [],
  }]);
  const attached = root(child);
  const before = structuredClone(attached);
  const detached = detach_hson_root_value(attached);
  assert.equal(detached, child);
  assert.deepEqual(attached, before);
});

check("exact detachment rejects an empty root", () => {
  assert.throws(() => detach_hson_root_value(root()), /exactly one semantic node; observed 0/);
});

check("exact detachment rejects a multi-child root", () => {
  const attached = node("_hson_root", [node("_hson_obj"), node("_hson_arr")]);
  assert.throws(() => detach_hson_root_value(attached), /exactly one semantic node; observed 2/);
});

check("exact detachment rejects nonnode root content", () => {
  const attached = node("_hson_root", [42]);
  assert.throws(() => detach_hson_root_value(attached), /semantic content must be a HsonNode/);
});

check("exact detachment rejects nonroot input", () => {
  assert.throws(() => detach_hson_root_value(node("_hson_obj")), /expected an internal _hson_root/);
});

check("exact detachment accepts one ordinary document element", () => {
  const ordinary = node("ordinary");
  assert.equal(detach_hson_root_value(root(ordinary)), ordinary);
});

check("exact detachment does not unwrap a meaningful element cluster", () => {
  const semantic = node("_hson_elem", [node("a")]);
  assert.equal(detach_hson_root_value(root(semantic)), semantic);
  assert.equal(detach_hson_root_value(root(semantic)).$_tag, "_hson_elem");
});

check("exact detachment does not unwrap meaningful primitive VSNs", () => {
  for (const semantic of [node("_hson_str", ["x"]), node("_hson_val", [2])]) {
    assert.equal(detach_hson_root_value(root(semantic)), semantic);
  }
});

check("empty root rejects direct and fluent Hson egress", () => {
  assertRootEgressRejects(root());
});

check("root containing string rejects direct and fluent Hson egress", () => {
  assertRootEgressRejects(root(node("_hson_str", ["x"])));
});

check("root containing scalar rejects direct and fluent Hson egress", () => {
  assertRootEgressRejects(root(node("_hson_val", [2])));
});

check("root containing object rejects direct and fluent Hson egress", () => {
  assertRootEgressRejects(root(node("_hson_obj")));
});

check("root containing array rejects direct and fluent Hson egress", () => {
  assertRootEgressRejects(root(node("_hson_arr")));
});

check("root containing an element content carrier rejects direct and fluent Hson egress", () => {
  assertRootEgressRejects(root(node("_hson_elem", [node("a")])));
});

check("root rejection precedes every readable compact and QUID option combination", () => {
  const attached = root(node("_hson_elem", [node("a")]));
  for (const options of [{}, { noBreak: true }, { noQuid: true }, { noBreak: true, noQuid: true }]) {
    assert.throws(() => serialize_hson(attached, options), /internal attachment carrier/);
  }
});

check("Hson-source reserialization succeeds because its parser root was detached", () => {
  assert.equal(hson.fromHson(`<a/>`).toHson().serialize(), `<a/>`);
  assert.equal(hson.fromHson(`42`).toHson().serialize(), `42`);
});

check("JSON and HTML parser-owned roots still convert to Hson through explicit detachment", () => {
  assert.equal(hson.fromJson({ a: 1 }).toHson().noBreak().serialize(), `<a 1>`);
  assert.equal(hsonTransform.fromTrustedHtml(`<a></a>`).toHson().noBreak().serialize(), `<a/>`);
});

check("Hson source frame caches one detached semantic node identity", () => {
  const source = hson.fromHson(`<a/>`);
  assert.equal(source.toNode(), source.toNode());
  assert.equal(source.toNode().$_tag, "_hson_elem");
});

check("detached semantic nodes retain no observable parent pointer", () => {
  const value = publicNode(`<a/>`) as HsonNode & Record<string, unknown>;
  assert.equal(Object.hasOwn(value, "parent"), false);
  assert.equal(Object.hasOwn(value, "$_parent"), false);
});

check("runtime source canonicalization remains owned by fromHson", () => {
  assert.equal(typeof canonicalize(`42`), "string");
});

check("hson canonicalizes every bare primitive category", () => {
  assert.deepEqual(
    [`"x"`, `0`, `-0`, `true`, `false`, `null`].map(canonicalize),
    [`"x"`, `0`, `-0`, `true`, `false`, `null`],
  );
});

check("hson canonicalizes tagged Hson after exact root detachment", () => {
  assert.equal(canonicalize(`<a/><b/>`), `<a/>\n<b/>`);
});

check("hson rejects empty source before branding", () => {
  assert.throws(() => canonicalize(``), /has no semantic value/);
});

check("repeated Hson canonicalization is stable", () => {
  const first = canonicalize(`<p "first"<em "middle"/>"last"/>`);
  assert.equal(canonicalize(first), first);
});

check("Unit 1 mixed-mode rejection and uniform grouping remain enforced", () => {
  assert.throws(() => publicNode(`<a/><b 2>`), /mixed top-level structural modes/);
  assert.equal(publicNode(`<a/><b/>`).$_tag, "_hson_elem");
  assert.equal(publicNode(`<a 1 b 2>`).$_tag, "_hson_obj");
});

check("valid QUID metadata survives root detachment and Hson output", () => {
  const value = publicNode(`<main @000000001/>`);
  assert.equal((value.$_content[0] as HsonNode).$_meta?.quid, "000000001");
  assert.match(hson.fromNode(value).toHson().serialize(), /@000000001/);
});

check("array indexes survive detachment and reconstruction", () => {
  const value = publicNode(`«"a","b"»`);
  assert.deepEqual(value.$_content.map((item) => (item as HsonNode).$_meta?.index), ["0", "1"]);
  assert.deepEqual(publicNode(hson.fromNode(value).toHson().serialize()), value);
});

check("canonical equality remains root-sensitive", () => {
  const semantic = node("_hson_obj");
  assert.equal(canonical_hson_graph_equal(root(semantic), semantic), false);
});

check("top-level primitive sequences and arbitrary bare names remain invalid", () => {
  assert.throws(() => publicNode(`"x" <a/>`), /top-level primitive must be the sole/);
  assert.throws(() => publicNode(`value`), /unexpected bare token/);
});

check("authored root failures expose stable structured identities and positions", () => {
  const empty = expectTransformError(``, "HSON_SOURCE_EMPTY");
  assert.deepEqual(empty.source, { index: 0, line: 1, column: 1 });

  const multiple = expectTransformError(`1 2`, "HSON_ROOT_MULTIPLE_VALUES");
  assert.deepEqual(multiple.source, { index: 2, line: 1, column: 3 });

  const mixed = expectTransformError(`<a/> <b 2>`, "HSON_ROOT_MIXED_MODES");
  assert.deepEqual(mixed.source, { index: 5, line: 1, column: 6 });

  const trailing = expectTransformError(`42>`, "HSON_TRAILING_SOURCE");
  assert.deepEqual(trailing.source, { index: 2, line: 1, column: 3 });
});

check("internal root egress retains its precise structured serialization identity", () => {
  assert.throws(
    () => serialize_hson(root(node("_hson_obj"))),
    (cause) => cause instanceof TransformError
      && cause.code === "HSON_ROOT_SERIALIZATION_FORBIDDEN"
      && cause.stage === "serialization-admission",
  );
});

process.stdout.write(`# ${checks} Hson root-boundary checks passed\n`);
testEvents.terminal("pass");
emit_hson_live_test_completion("transform.hson-root-boundary", checks, checks, 0);
