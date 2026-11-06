import assert from "node:assert/strict";
import { admit_data_source } from "../../src/core/data-source-admission.js";
import { HSON_MAX_NESTING } from "../../src/core/constants.js";
import { parse_ordered_json_text } from "../../src/core/exact-data-codec.js";
import { parse_canonical_hson_data } from "../../src/core/hson-data-canonical-codec.js";
import { read_transform_error_details } from "../../src/core/errors.js";
import {
  is_ordered_projected_object,
  is_ordered_projected_value,
  ordered_projected_array as array,
  ordered_projected_object as object,
  ordered_projected_value_equal,
  type OrderedProjectedValue,
} from "../../src/core/ordered-projected-value.js";
import { materialize_projected_value } from "../../src/core/projected-value-materialization.js";
import {
  projected_array_item_to_hson_node,
  projected_object_property_to_hson_node,
  projected_value_from_hson_node,
  projected_value_to_hson_node,
  projected_value_to_hson_root,
} from "../../src/core/projected-value-graph.js";
import type { HsonNode } from "../../src/core/types.js";
import { hson_data_from_value, hson_data_value } from "../../src/api/data/hson-data.js";
import { admit_public_livemap_root } from "../../src/api/livemap/livemap.node-admission.js";

type Check = (name: string, run: () => void) => void;

function admitted(source: string, expected: OrderedProjectedValue): OrderedProjectedValue {
  const value = admit_data_source(source);
  assert.ok(is_ordered_projected_value(value));
  assert.ok(ordered_projected_value_equal(value, expected), source);
  // These are the actual existing consumer boundaries, without source conversion.
  assert.equal(hson_data_value(hson_data_from_value(value)), value);
  const root = admit_public_livemap_root(projected_value_to_hson_root(value), "data", "D3a Data source");
  assert.ok(ordered_projected_value_equal(projected_value_from_hson_node(root), expected));
  return value;
}

function equivalent(json: string, hson: string, expected: OrderedProjectedValue): void {
  const jsonValue = admitted(json, expected);
  const hsonValue = admitted(hson, expected);
  assert.ok(ordered_projected_value_equal(jsonValue, hsonValue));
}

function rejected(source: string): Error {
  let result: OrderedProjectedValue | undefined;
  let error: unknown;
  try { result = admit_data_source(source); } catch (cause) { error = cause; }
  assert.equal(result, undefined, source);
  assert.ok(error instanceof Error, source);
  return error;
}

export function data_source_admission_cases(check: Check): void {
  check("every graph construction boundary authenticates and validates its complete input subtree", () => {
    const boundaries: ReadonlyArray<(value: OrderedProjectedValue) => HsonNode> = [
      projected_value_to_hson_node,
      projected_value_to_hson_root,
      value => projected_object_property_to_hson_node("member", value),
      value => projected_array_item_to_hson_node(3, value),
    ];
    const owned = object([["nested", array([-0])]]);
    let calls = 0;
    const accessor = Object.freeze(Object.defineProperty([], "0", {
      enumerable: true, get() { calls++; return owned; },
    }));
    const { proxy, revoke } = Proxy.revocable(owned, {
      get() { calls++; throw new Error("caller get"); },
      getOwnPropertyDescriptor() { calls++; throw new Error("caller descriptor"); },
    });
    const imitations = [Object.freeze({ ...owned }), Object.freeze([owned]), accessor, proxy];
    for (const convert of boundaries) {
      for (const imitation of imitations) {
        assert.throws(() => Reflect.apply(convert, undefined, [imitation]), {
          name: "TypeError", message: /owned by the ordered carrier factories/,
        });
      }
      for (const invalid of [NaN, Infinity, -Infinity]) {
        assert.throws(() => convert(invalid), /finite/);
      }
      // Ownership alone does not establish canonical names or nesting limits.
      const reserved = object([["ok", array([object([["$_meta", 1]])])]]);
      assert.throws(() => convert(reserved), { name: "TypeError", message: /Reserved Hson prefix/ });
      let nested: OrderedProjectedValue = null;
      for (let depth = 0; depth < HSON_MAX_NESTING - 1; depth++) nested = array([nested]);
      assert.doesNotThrow(() => convert(nested));
      assert.throws(() => convert(array([nested])), {
        name: "TypeError", message: `Hson nesting depth must be less than ${HSON_MAX_NESTING}`,
      });
    }
    revoke();
    for (const convert of boundaries) {
      assert.throws(() => Reflect.apply(convert, undefined, [proxy]), /owned by the ordered carrier factories/);
    }
    assert.equal(calls, 0);
    assert.throws(() => projected_object_property_to_hson_node("$_meta", owned), /Reserved Hson prefix/);
    for (const index of [-1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => projected_array_item_to_hson_node(index, owned), /non-negative safe integer/);
    }
  });

  check("shared grammar has one exact primitive and array interpretation", () => {
    const cases: readonly (readonly [string, OrderedProjectedValue])[] = [
      ['"plain"', "plain"], ['""', ""], ["true", true], ["false", false], ["null", null],
      ["0", 0], ["-0", -0], ["-0.0e+0", -0], ["-1e-999", -0], ["1e-999", 0],
      ["-2.5e2", -250], ["5e-324", Number.MIN_VALUE], ["1.7976931348623157e308", Number.MAX_VALUE],
      ["9007199254740993", 9007199254740992],
      ["[0,-0,[true,false,null,\"x\"],[]]", array([0, -0, array([true, false, null, "x"]), array([])])],
    ];
    for (const [source, expected] of cases) {
      admitted(" \t\r\n" + source + "\r\n", expected);
      assert.ok(ordered_projected_value_equal(parse_ordered_json_text(source), parse_canonical_hson_data(source)));
      admitted("// Hson trivia: { < « \"\r\n" + source + " // tail", expected);
    }
    assert.ok(Object.is(admit_data_source("-0"), -0));
    assert.ok(!Object.is(admit_data_source("0"), -0));
  });

  check("objects, empty structures and nested array spellings yield canonical Data", () => {
    equivalent("{}", "<>", object([]));
    admitted("< // empty\n >", object([]));
    equivalent("[]", "«»", array([]));
    equivalent('{"name":"Ada","active":true,"count":2.5,"missing":null}',
      '<name "Ada" active true count 2.5 missing null>',
      object([["name", "Ada"], ["active", true], ["count", 2.5], ["missing", null]]));
    equivalent('[{"10":-0,"2":2},[[],{},[true,null]],"end"]',
      '«<\'10\' -0 \'2\' 2>,[«»,<>,«true,null,»],"end",»',
      array([object([["10", -0], ["2", 2]]), array([array([]), object([]), array([true, null])]), "end"]));
    equivalent('[[0,[1,2]],[]]', '[«0,[1,2,],»,«»,]',
      array([array([0, array([1, 2])]), array([])]));
    equivalent('{"nested":[{"value":-0},[]]}', '<nested [<value -0>,«»,]>',
      object([["nested", array([object([["value", -0]]), array([])])]]));
  });

  check("escapes, Unicode, content layout and comments preserve decoded values", () => {
    const source = String.raw`"quote:\" slash:\/ backslash:\\ \b\f\n\r\t \u03bb \ud83d\ude80"`;
    const expected = 'quote:" slash:/ backslash:\\ \b\f\n\r\t λ 🚀';
    equivalent(source, "// leading\n" + source, expected);
    equivalent(String.raw`{"\u03bb":"雪 🚀","name\nline":"\u0000"}`,
      String.raw`<'\u03bb' "雪 🚀" 'name\nline' "\u0000">`,
      object([["λ", "雪 🚀"], ["name\nline", "\u0000"]]));
    equivalent('"first\\nsecond"', '"\r\n  first\r\n  second\r\n"', "first\nsecond");
    admitted('["literal < « { //", // comment containing ] « <\r\n "tab\there",]', array(["literal < « { //", "tab\there"]));
  });

  check("numeric-looking names retain order and signed zero in owned output and graphs", () => {
    const expected = object([["10", -0], ["2", 2], ["01", 1], ["", false],
      ["__proto__", object([["nested", array([-0])]])], ["constructor", "safe"], ["prototype", true]]);
    const json = '{"10":-0,"2":2,"01":1,"":false,"__proto__":{"nested":[-0]},"constructor":"safe","prototype":true}';
    const hson = "<'10' -0 '2' 2 '01' 1 '' false __proto__ <nested «-0»> constructor \"safe\" prototype true>";
    equivalent(json, hson, expected);
    for (const source of [json, hson]) {
      const value = admitted(source, expected);
      assert.ok(is_ordered_projected_object(value));
      assert.deepEqual(value.entries.map(([name]) => name), ["10", "2", "01", "", "__proto__", "constructor", "prototype"]);
      assert.ok(Object.is(value.entries[0]![1], -0));
      assert.ok(Object.isFrozen(value) && Object.isFrozen(value.entries) && Object.isFrozen(value.entries[0]));
      assert.equal(Reflect.set(value.entries[0]!, "0", "mutated"), false);
      const materialized = materialize_projected_value(value);
      assert.ok(materialized !== null && typeof materialized === "object" && !Array.isArray(materialized));
      assert.equal(Object.getPrototypeOf(materialized), Object.prototype);
      assert.ok(Object.hasOwn(materialized, "__proto__"));
      materialized["10"] = 99;
      const graph = projected_value_to_hson_root(value);
      graph.$_content.length = 0;
      assert.ok(ordered_projected_value_equal(value, expected));
    }
    const items = admitted('[[-0]]', array([array([-0])]));
    assert.ok(Array.isArray(items) && Object.isFrozen(items) && Object.isFrozen(items[0]));
  });

  check("reserved Data names reject recursively after decoding", () => {
    for (const name of ["$_", "$_meta", "$_attrs", "$_tag", "$_content", "$_future", "_hson_", "_hson_root", "_hson_obj", "_hson_future"]) {
      for (const source of [
        JSON.stringify({ [name]: 1 }), JSON.stringify({ nested: [0, [{ [name]: 1 }]] }),
        "<'" + name + "' 1>", "<nested [0,«<'" + name + "' 1>»]>",
      ]) rejected(source);
    }
    for (const source of [
      String.raw`{"\u0024\u005fmeta":1}`, String.raw`[{"nested":{"\u005fhson_root":1}}]`,
      String.raw`<'\u0024\u005fmeta' 1>`, String.raw`[<nested <'\u005fhson_root' 1>>]`,
    ]) rejected(source);
    // Neither reserved-looking text nor unreserved metadata-like names are claims.
    equivalent('{"$":1,"_hson":2,"prefix$_meta":3,"quid":"000000001","text":"$_meta _hson_root"}',
      '<\'$\' 1 _hson 2 \'prefix$_meta\' 3 quid "000000001" text "$_meta _hson_root">',
      object([["$", 1], ["_hson", 2], ["prefix$_meta", 3], ["quid", "000000001"], ["text", "$_meta _hson_root"]]));
  });

  check("Document structure, structural envelopes and runtime identity never admit as Data", () => {
    for (const source of [
      '<p/>', '<p id="x" "text"/>', '<\'$_widget\'/>', '"one" "two"', '[<p/>]', '<nested <p/>>',
      '<_hson_obj>', '<@000000001 value 1>', '[@000000001 1]', '«@000000001 1»',
      '<nested [<@000000001 value 1>]>', '<p @000000001/>',
      '{"_hson_root":{"a":1}}', '{"_hson_elem":[{"p":"text"}]}',
      '{"$_tag":"p","$_content":[],"$_meta":{"quid":"000000001"}}',
      '{"nested":[{"$_meta":{"quid":"000000001"}}]}',
    ]) rejected(source);
    const identity = rejected('<@000000001 value 1>');
    assert.equal(read_transform_error_details(identity)?.code, "PORTABLE_RUNTIME_QUID_FORBIDDEN");
  });

  check("semantic rejection is final and retains the responsible admission failure", () => {
    const reserved = rejected('{"nested":{"$_meta":{"quid":"000000001"}}}');
    assert.ok(reserved instanceof TypeError);
    assert.match(reserved.message, /Reserved Hson prefix/);
    const duplicate = rejected(String.raw`[{"a":1,"\u0061":2}]`);
    assert.equal(read_transform_error_details(duplicate)?.code, "HSON_JSON_DUPLICATE_PROPERTY");
    assert.equal(read_transform_error_details(duplicate)?.operation, "parse-json");
    assert.equal(read_transform_error_details(rejected('<a 1 a 2>'))?.code, "HSON_OBJECT_DUPLICATE_MEMBER");
    for (const source of ["1e999", "[1e999]", '{"value":-1e999}']) {
      const details = read_transform_error_details(rejected(source));
      assert.equal(details?.code, "HSON_NUMBER_NONFINITE");
      assert.equal(details?.operation, "hson.number-admission");
    }
    assert.equal(read_transform_error_details(rejected('«1e999»'))?.code, "HSON_NUMBER_NONFINITE");
    const tooDeep = "[".repeat(HSON_MAX_NESTING) + "null" + "]".repeat(HSON_MAX_NESTING);
    const nesting = rejected(tooDeep);
    assert.ok(nesting instanceof TypeError);
    assert.match(nesting.message, /Hson nesting depth/);
    assert.equal(read_transform_error_details(rejected("«".repeat(HSON_MAX_NESTING) + "null" + "»".repeat(HSON_MAX_NESTING)))?.code,
      "HSON_NESTING_LIMIT");
  });

  check("malformed source and combinations outside either established grammar reject", () => {
    for (const source of [
      "", " \t\r\n", "// comment only", "bare", "NaN", "Infinity", "+1", "01", "1.", "1e", "1 2",
      "{", "[", "[1,,2]", "[1 2]", '{"a":1,}', "{'a':1}", '<a>', '<a 1,>', '«1]',
      String.raw`"bad\q"`, String.raw`"bad\u12"`, '"unterminated', "'string'", '/* comment */ 1',
      '\u00a0<a 1>', '\ufeff{}',
      '[{"a":1},]', '{"a":[1,]}', '[<a 1>,{"b":2}]', '«{"a":1}»', '// comment\n{"a":1}',
    ]) rejected(source);
  });
}
