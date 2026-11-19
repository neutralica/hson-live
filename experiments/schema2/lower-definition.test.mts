import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { HsonDataValue } from "../../src/api/data/hson-data.js";
import { HsonSchemaError } from "../../src/api/livemap/livemap.error.js";
import { HsonSchema, compiled_hson_schema_of, hson_schema_digest } from "../../src/api/schema/hson-schema.js";
import { HSON_MAX_NESTING } from "../../src/core/constants.js";
import { parse_canonical_hson_data, serialize_canonical_hson_data } from "../../src/core/hson-data-canonical-codec.js";
import { ordered_projected_array, ordered_projected_object, ordered_projected_value_equal } from "../../src/core/ordered-projected-value.js";
import { compile_hson_schema } from "../../src/internal/hson-schema/compiler.js";
import { schema_definition_identity } from "../../src/internal/hson-schema/definition-identity.js";
import { corpus } from "./corpus-goldens.js";
import { lower_schema_definition, SchemaLoweringError } from "./lower-definition.js";
import {
  application_name as member, expression_group, header, is_schema_occurrence, member_map, operation as op, value,
  type DataOperand, type SchemaHeader, type SchemaOccurrence, type SchemaOrigin,
} from "./structure.js";
import {
  array, data, declarations, defs, exact, num, object, optional, ref, str, tuple, union,
} from "./structural-fixtures.js";

function compare(declaration: SchemaOccurrence, source: string) {
  const lowered = lower_schema_definition(declaration);
  const expected = HsonSchema.fromHson(source);
  const actual = HsonSchema.fromHson(lowered.schema1Source);
  const before = compiled_hson_schema_of(expected);
  const after = compiled_hson_schema_of(actual);
  assert.ok(ordered_projected_value_equal(lowered.orderedDefinition, before.orderedDefinition));
  assert.ok(ordered_projected_value_equal(after.orderedDefinition, before.orderedDefinition));
  assert.equal(lowered.schema1Source, serialize_canonical_hson_data(before.orderedDefinition));
  assert.equal(actual.toHson(), expected.toHson());
  assert.deepEqual(schema_definition_identity(after), schema_definition_identity(before));
  assert.deepEqual(after.graph, before.graph);
  return { actual, expected };
}

function certify(schema: HsonSchema, candidate: HsonDataValue) {
  try {
    return { ok: true, value: schema.certify(candidate).toHson() } as const;
  } catch (error) {
    if (!(error instanceof HsonSchemaError)) throw error;
    return { ok: false, issues: error.issues } as const;
  }
}

for (const golden of corpus) {
  test(`${golden.id} ordered definition, encoding, digest and original certification cases`, () => {
    const { actual, expected } = compare(declarations[golden.id], golden.schema);
    assert.equal(hson_schema_digest(actual), golden.digest);
    if (golden.id === "D09") assert.equal(compiled_hson_schema_of(actual).recursiveSccCount, 1);

    function check(source: string, accept: boolean, issue?: Readonly<Record<string, unknown>>) {
      const candidate = HsonDataValue.fromSource(source);
      const result = certify(actual, candidate);
      assert.deepEqual(result, certify(expected, candidate));
      assert.equal(result.ok, accept);
      if (result.ok) assert.equal(result.value, candidate.toHson());
      else if (issue) {
        const first: Readonly<Record<string, unknown>> = result.issues[0];
        for (const [key, value] of Object.entries(issue)) assert.deepEqual(first[key], value, key);
      }
    }
    check(golden.valid, true);
    check(golden.invalid, false, golden.expected);
    for (const mutation of golden.mutations) {
      assert.ok(golden.valid.includes(mutation.from), mutation.label);
      check(golden.valid.replace(mutation.from, mutation.to), mutation.accept, mutation.expected);
    }
  });
}

function structural_error(root: SchemaOccurrence, message: RegExp, origin?: SchemaOrigin) {
  assert.throws(() => lower_schema_definition(root), error => {
    assert.ok(error instanceof SchemaLoweringError);
    assert.match(error.message, message);
    if (origin) assert.equal(error.origin, origin);
    return true;
  });
}

function field(expression: SchemaOccurrence) {
  return data(object(member("v", expression)));
}

test("the investigated D02 excerpt retains the optional line2 contract", () => {
  const excerpt = data(object(
    member("displayName", str(header("minlen", "1"), header("maxlen", "80"))),
    member("address", object(member("line1", str()), optional("line2", str()), member("city", str()))),
  ));
  const { actual, expected } = compare(excerpt, `<type "data" content <
    displayName <string <minlen 1 maxlen 80>>
    address <content <line1 "string" line2 <optional "string"> city "string">>
  >>`);
  assert.equal(hson_schema_digest(actual), "8f3020ac06b47fed396638a5e1a41e55c123502cab5e0a49188d62251b59d3ff");
  for (const line2 of ["", 'line2 ""', "line2 null"]) {
    const candidate = HsonDataValue.fromSource(`<displayName "Mina" address <line1 "18 Cedar Lane" ${line2} city "Bristol">>`);
    const result = certify(actual, candidate);
    assert.deepEqual(result, certify(expected, candidate));
    assert.equal(result.ok, line2 !== "line2 null");
  }
});

test("fixed root roles retain both opposite-outcome witness pairs", () => {
  const collision = member("content", exact("string"));
  compare(data(object(member("content", str()))), '<type "data" content <content "string">>');
  compare(data(object(member("ref", str()), member("content", exact(false)))),
    '<type "data" content <ref "string" content <exact false>>>');
  const first = compare(data(object(member("exact", str()))), '<type "data" content <exact "string">>');
  const second = compare(data(object(collision)), '<type "data" content <content <content <exact "string">>>>');

  const definitions = defs(member("string", num()));
  const refMember = member("ref", str());
  const third = compare(data(definitions, ref("string")), '<type "data" defs <string "number"> content <ref "string">>');
  const fourth = compare(data(definitions, object(refMember)), '<type "data" defs <string "number"> content <content <ref "string">>>');

  function opposite(left: HsonSchema, right: HsonSchema, yes: string, no: string) {
    assert.notEqual(hson_schema_digest(left), hson_schema_digest(right));
    for (const [source, pass] of [[yes, true], [no, false]] as const) {
      const candidate = HsonDataValue.fromSource(source);
      assert.equal(certify(left, candidate).ok, pass);
      assert.equal(certify(right, candidate).ok, !pass);
    }
  }
  opposite(first.actual, second.actual, '<exact "abc">', '<content "string">');
  opposite(third.actual, fourth.actual, '2', '<ref "P">');
});

test("omitted fields, explicit broad content, empty defs and the empty object root have separate identities", () => {
  const forms = [
    compare(data(), '<type "data">'),
    compare(data(op("any")), '<type "data" content "any">'),
    compare(data(defs()), '<type "data" defs <>>'),
    compare(data(object()), '<type "data" content <>>'),
  ];
  assert.equal(new Set(forms.map(({ actual }) => hson_schema_digest(actual))).size, forms.length);
});

test("an omitted body stays absent across repeated lowering under prototype mutation", () => {
  const root = op("data");
  const before = lower_schema_definition(root);
  const foreignMap = { kind: "members", entries: [] };
  const foreignBody = { kind: "group", items: [{ kind: "operation", name: "object", headers: [], body: foreignMap }] };
  assert.ok(!Object.hasOwn(root, "body"));
  assert.ok(!Object.hasOwn(Object.prototype, "body"));
  let during;
  try {
    Object.defineProperty(Object.prototype, "body", { value: foreignBody, configurable: true });
    during = lower_schema_definition(root);
    assert.equal(root.body, undefined);
  } finally {
    Reflect.deleteProperty(Object.prototype, "body");
  }

  const control = HsonSchema.fromHson('<type "data">');
  const compiledControl = compiled_hson_schema_of(control);
  const identity = schema_definition_identity(compiledControl);
  const candidate = HsonDataValue.fromSource("7");
  const accepted = certify(control, candidate);
  assert.ok(accepted.ok);
  for (const result of [before, during, lower_schema_definition(root)]) {
    const schema = HsonSchema.fromHson(result.schema1Source);
    assert.ok(ordered_projected_value_equal(result.orderedDefinition, compiledControl.orderedDefinition));
    assert.equal(result.schema1Source, control.toHson());
    assert.deepEqual(schema_definition_identity(compiled_hson_schema_of(schema)), identity);
    assert.deepEqual(certify(schema, candidate), accepted);
    assert.equal(result.originAt(["content", "content"]), root);
  }
  assert.equal(Object.getPrototypeOf(root), null);
  assert.ok(!Object.hasOwn(root, "body"));
});

test("absent, null and empty operands reach their own lowering or compiler result", () => {
  structural_error(field(op("exact")), /explicit literal/);
  for (const [operand, spelling] of [
    [null, "null"], ["", '""'], [ordered_projected_object([]), "<>"], [ordered_projected_array([]), "[]"],
  ] as const) {
    const body = value(operand);
    structural_error(field(op("string", body)), /absent content/, body);
    const lowered = lower_schema_definition(field(op("exact", body)));
    const target = parse_canonical_hson_data(`<type "data" content <v <exact ${spelling}>>>`);
    assert.ok(ordered_projected_value_equal(lowered.orderedDefinition, target));
    assert.equal(compile_hson_schema(lowered.schema1Source).ok, operand === null || typeof operand === "string");
  }
  const pair = compare(data(object(optional("v", op("any")))), '<type "data" content <v <optional "any">>>');
  for (const source of ['<>', '<v null>', '<v <>>', '<v []>', '<v "">']) {
    const candidate = HsonDataValue.fromSource(source);
    assert.equal(pair.actual.certify(candidate).toHson(), candidate.toHson());
  }
});

test("nullable and optional vary independently", () => {
  for (const nullable of [true, false]) for (const omittable of [true, false]) {
    const expr = nullable ? union(str(), op("null")) : str();
    const declaration = data(object(omittable ? optional("v", expr) : member("v", expr)));
    const schema = HsonSchema.fromHson(lower_schema_definition(declaration).schema1Source);
    for (const [source, expected] of [['<>', omittable], ['<v null>', nullable], ['<v "">', true], ['<v 0>', false]] as const) {
      assert.equal(certify(schema, HsonDataValue.fromSource(source)).ok, expected);
    }
  }
});

test("ordered names, definitions, modifiers, branches and signed zero reach identity", () => {
  compare(data(
    defs(member("10", tuple()), member("2", exact(true)), member("__proto__", ref("10"))),
    object(member("10", ref("__proto__")), member("2", ref("2")), member("__proto__", object())),
  ), `<type "data" defs <'10' <tuple []> '2' <exact true> __proto__ <ref "10">>
      content <'10' <ref "__proto__"> '2' <ref "2"> __proto__ <content <>>>>`);
  const negative = compare(field(exact(-0)), '<type "data" content <v <exact -0>>>');
  const positive = compare(field(exact(0)), '<type "data" content <v <exact 0>>>');
  assert.notEqual(hson_schema_digest(negative.actual), hson_schema_digest(positive.actual));
  assert.ok(certify(negative.actual, HsonDataValue.fromSource("<v -0>")).ok);
  assert.ok(!certify(negative.actual, HsonDataValue.fromSource("<v 0>")).ok);
  const first = compare(field(num(header("min", "-0"), header("int"))), '<type "data" content <v <number <min -0 int true>>>>');
  const second = compare(field(num(header("int"), header("min", "-0"))), '<type "data" content <v <number <int true min -0>>>>');
  assert.notEqual(hson_schema_digest(first.actual), hson_schema_digest(second.actual));
  compare(field(union(op("null"), str())), '<type "data" content <v <union ["null","string"]>>>');
  compare(field(num(header("over", "-1e2"), header("under", "1e2"))), '<type "data" content <v <number <over -100 under 100>>>>');
  compare(field(str(header("suffix", "🍎"), header("contains", ""))), '<type "data" content <v <string <suffix "🍎" contains "">>>>');
  compare(field(op("tuple", expression_group([num(), str()]), [header("minlen", "2")])), '<type "data" content <v <tuple <content ["number","string"] minlen 2>>>>');
  compare(field(array(op("any"), header("unique"))), '<type "data" content <v <array <content "any" unique true>>>>');
});

test("configured uniqueness preserves field order and both zero signs in relation rows", () => {
  const cases = ordered_projected_array([0, -0].map(selector =>
    ordered_projected_array([selector, ordered_projected_array([selector])])));
  const config = ordered_projected_object([["cases", cases], ["by", "ref"]]);
  const item = object(member("ref", num()));
  const { actual } = compare(field(array(item, header("unique", value(config)))),
    '<type "data" content <v <array <content <content <ref "number">> unique <cases [[0,[0]],[-0,[-0]]] by "ref">>>>>');
  assert.ok(certify(actual, HsonDataValue.fromSource('<v [<ref 0>,<ref -0>]>')).ok);
  const conflict = certify(actual, HsonDataValue.fromSource('<v [<ref -0>,<ref -0>]>'));
  assert.ok(!conflict.ok);
  assert.ok(Object.is(conflict.issues[0].conflictingKey, -0));
});

const relation = value(parse_canonical_hson_data('<by "slot" cases [["A", ["K"]]]>'));
const row = object(member("slot", str()), member("id", num()));
const conflictingRows = HsonDataValue.fromSource('<v [<slot "A" id 1>, <slot "A" id 2>]>');

test("a bare header keeps its category and omitted operand under prototype mutation", () => {
  const bare = header("unique");
  const configured = header("unique", relation);
  const root = field(array(row, bare));
  const path = ["content", "v", "array", "unique"];
  const before = lower_schema_definition(root);
  const keys = ["operand", "body", "kind"];
  for (const key of keys) {
    assert.ok(!Object.hasOwn(bare, key));
    assert.ok(!Object.hasOwn(Object.prototype, key));
  }
  try {
    Object.defineProperties(Object.prototype, {
      operand: { value: relation, configurable: true },
      body: { value: relation, configurable: true },
      kind: { value: "operation", configurable: true },
    });
    for (const key of keys) assert.equal(Reflect.has(bare, key), false, key);
    assert.ok(!is_schema_occurrence(bare));
    assert.ok(Object.hasOwn(configured, "operand"));
    assert.equal(configured.operand, relation);
    const during = lower_schema_definition(root);
    assert.equal(during.schema1Source, before.schema1Source);
    assert.equal(during.originAt(path), bare);
  } finally {
    for (const key of keys) Reflect.deleteProperty(Object.prototype, key);
  }
  assert.equal(Object.getPrototypeOf(bare), null);
  assert.equal(before.originAt(path), bare);
});

function assert_slot_conflict(schema: HsonSchema) {
  const conflict = certify(schema, conflictingRows);
  assert.ok(!conflict.ok);
  const [issue] = conflict.issues;
  assert.equal(issue.code, "INVALID_CONSTRAINT");
  assert.deepEqual(issue.path, ["v", 1, "slot"]);
  assert.deepEqual(issue.relatedPath, ["v", 0, "slot"]);
  assert.equal(issue.conflictingKey, "K");
}

test("array headers distinguish configured uniqueness from a misplaced occurrence", () => {
  const misplaced = op("unique", relation);
  // @ts-expect-error A complete occurrence cannot be assigned to a header slot.
  assert.throws(() => array(row, misplaced), /owned Schema header/);

  const { actual } = compare(field(array(row, header("unique", relation))), `<type "data" content <v <array <
    content <content <slot "string" id "number">> unique <by "slot" cases [["A", ["K"]]]>
  >>>>`);
  assert_slot_conflict(actual);

  const bare = HsonSchema.fromHson(lower_schema_definition(field(array(row, header("unique")))).schema1Source);
  assert.ok(certify(bare, conflictingRows).ok);
  assert.ok(!certify(bare, HsonDataValue.fromSource('<v [<slot "A" id 1>, <slot "A" id 1>]>')).ok);
});

// The former tests counted reads of headers/name/operand/value and required a
// malformed later slot to reject before an earlier getter ran. Those were rules
// for snapshotting arbitrary records. The reader now supplies completed children.
function foreign_data(clause: SchemaOccurrence): SchemaOccurrence {
  return { ...data(), body: { kind: "group", items: [clause] } };
}

test("the minlen getter cannot substitute a slot or strip a configured unique operand", () => {
  for (const replaceSlot of [true, false]) {
    const later: { name: string; operand?: DataOperand } = { name: "unique", operand: relation };
    const rules = [{
      name: "minlen",
      get operand() {
        if (replaceSlot) Reflect.set(rules, 1, op("unique", relation));
        else {
          Object.assign(later, { body: relation });
          delete later.operand;
        }
        return "0";
      },
    }, later];
    const child = { ...array(row), headers: rules };
    const named = { ...member("v"), body: child };
    const foreign = foreign_data({ ...object(), body: { kind: "members", entries: [named] } });
    assert.throws(() => lower_schema_definition(foreign), /owned Schema occurrence at the root/);
    assert.throws(() => op("array", row, rules), /owned Schema header/);
    assert.equal(rules[1], later);
    assert.equal(later.operand, relation);
    assert.ok(!Object.hasOwn(later, "body"));
  }

  const configured = header("unique", relation);
  const root = field(array(row, header("minlen", "0"), configured));
  const { actual } = compare(root, '<type "data" content <v <array <content <content <slot "string" id "number">> minlen 0 unique <by "slot" cases [["A", ["K"]]]>>>>>');
  assert_slot_conflict(actual);
  assert.equal(lower_schema_definition(root).originAt(["content", "v", "array", "unique"]), configured);
});

test("only original completed occurrences can enter lowering or become structural children", () => {
  const root = data();
  assert.ok(is_schema_occurrence(root));
  const proxy = new Proxy(root, { get() { throw new Error("read a foreign semantic field"); } });
  const lookalike = Object.freeze({ ...root });
  const accessor = { ...root, get name(): string { throw new Error("read a foreign name"); } };
  const samePrototype = Object.freeze({ __proto__: null, ...root });
  for (const foreign of [{ ...root }, lookalike, samePrototype, proxy, accessor]) {
    assert.ok(!is_schema_occurrence(foreign));
    assert.throws(() => lower_schema_definition(foreign), /owned Schema occurrence at the root/);
    assert.throws(() => expression_group([foreign]), /owned Schema occurrence/);
    assert.throws(() => member_map([foreign]), /owned Schema occurrence/);
    assert.throws(() => member("v", foreign), /owned Schema body/);
  }
  assert.throws(() => op("data", { ...expression_group([]) }), /owned Schema body/);
  assert.throws(() => op("object", { ...member_map([]) }), /owned Schema body/);
  assert.throws(() => header("unique", { ...relation }), /owned Data operand/);
  assert.throws(() => value(Object.freeze([true])), /ordered carrier factories/);
  const config = ordered_projected_object([["by", "slot"]]);
  for (const foreign of [Object.freeze({ ...config }), new Proxy(config, {})]) {
    assert.throws(() => value(foreign), /ordered carrier factories/);
  }
  assert.equal(value(config).value, config);
  // @ts-expect-error A header is a distinct category even when it is owned.
  assert.throws(() => op("array", header("optional")), /owned Schema body/);
  // @ts-expect-error A nested operation cannot be a braced Data operand.
  assert.throws(() => header("unique", op("any")), /owned Data operand/);
  // @ts-expect-error An operation name must be decoded text.
  assert.throws(() => op(42), /string occurrence name/);
  // @ts-expect-error A header name must be decoded text.
  assert.throws(() => header(42), /string header name/);
});

test("header list, name, operand and braced value getters stop at their construction boundaries", () => {
  function unread(): never { throw new Error("read a foreign semantic field"); }
  const wrapped: DataOperand = { kind: "value", get value() { return unread(); } };
  const foreignHeader = { get name() { return unread(); }, get operand() { return unread(); } };
  const foreignChild = { ...array(row), get headers() { return unread(); } };
  assert.throws(() => header("unique", wrapped), /owned Data operand/);
  assert.throws(() => op("array", row, [foreignHeader, { name: "unique" }]), /owned Schema header/);
  assert.throws(() => member("v", foreignChild), /owned Schema body/);
});

test("misplaced occurrences and body-bearing header records reject during construction", () => {
  const misplaced = op("optional", value(false));
  // @ts-expect-error An operation cannot be an optional header.
  assert.throws(() => member("v", str(), [misplaced]), /owned Schema header/);
  const authored = { name: "optional", body: value(false) };
  // @ts-expect-error A header cannot carry an authored body.
  assert.throws(() => member("v", str(), [authored]), /owned Schema header/);
  const malformed: SchemaHeader[] = JSON.parse('[{"kind":"name","name":"int"},{"name":42}]');
  for (const entry of [...malformed, { name: "optional", body: undefined }]) {
    assert.throws(() => num(entry), /owned Schema header/);
  }
  const misplacedRelation = { name: "unique", body: relation };
  // @ts-expect-error A relation in the body position cannot construct an array header.
  assert.throws(() => array(row, misplacedRelation), /owned Schema header/);

  const valid = header("optional");
  assert.equal(Reflect.set(valid, "body", value(false)), false);
  assert.equal(Reflect.set(valid, "kind", "operation"), false);
  const { actual } = compare(data(object(member("v", str(), [valid]))), '<type "data" content <v <optional "string">>>');
  assert.ok(certify(actual, HsonDataValue.fromSource("<>")).ok);
});

test("ordered construction requires dense physical data slots of the correct category", () => {
  const holes = new Array<SchemaOccurrence>(2);
  holes[1] = str();
  assert.throws(() => member_map(holes), /data slot at occurrence\[0\]/);
  assert.throws(() => expression_group(holes), /data slot at occurrence\[0\]/);
  const rules = new Array<SchemaHeader>(1);
  assert.throws(() => op("number", undefined, rules), /data slot at header\[0\]/);
  Object.defineProperty(rules, 0, { get() { throw new Error("read an accessor slot"); } });
  assert.throws(() => op("number", undefined, rules), /data slot at header\[0\]/);
  // @ts-expect-error A collection body is an array of occurrences.
  assert.throws(() => member_map({}), /Expected an array/);
});

function reports_one_entry(buffer: SchemaOccurrence[]) {
  return new Proxy(Object.seal(buffer), {
    get(target, key, receiver) {
      return key === "length" ? 1 : Reflect.get(target, key, receiver);
    },
  });
}

test("a shortened length read cannot hide the second required member", () => {
  const a = member("a", str()), b = member("b", str());
  const input = reports_one_entry([a, b]);
  assert.equal(input.length, 1);
  assert.equal(Object.getOwnPropertyDescriptor(input, "length")?.value, 2);
  const map = member_map(input);
  assert.equal(map.entries.length, 2);
  assert.equal(map.entries[0], a);
  assert.equal(map.entries[1], b);
  const { actual, expected } = compare(data(op("object", map)), '<type "data" content <a "string" b "string">>');
  for (const [source, ok] of [['<a "yes">', false], ['<a "yes" b "yes">', true]] as const) {
    const candidate = HsonDataValue.fromSource(source);
    const result = certify(actual, candidate);
    assert.equal(result.ok, ok);
    assert.deepEqual(result, certify(expected, candidate));
  }
});

const indexedSetterTest = "an inherited indexed setter cannot hide a required member";
test(indexedSetterTest, () => {
  const childMarker = "--indexed-setter-child";
  if (process.argv[2] !== childMarker) {
    const child = spawnSync(process.execPath, [
      "--import", import.meta.resolve("tsx"), `--test-name-pattern=^${indexedSetterTest}$`,
      fileURLToPath(import.meta.url), childMarker,
    ], { encoding: "utf8", timeout: 30_000 });
    assert.ifError(child.error);
    assert.equal(child.status, 0, child.stdout + child.stderr);
    return;
  }

  const a = member("a", str()), b = member("b", str());
  const source = [a, b];
  const previous = Object.getOwnPropertyDescriptor(Array.prototype, "1");
  let setterCalls = 0;
  let map;
  Object.defineProperty(Array.prototype, "1", { configurable: true, set() { setterCalls++; } });
  try {
    map = member_map(source);
  } finally {
    if (previous) Object.defineProperty(Array.prototype, "1", previous);
    else Reflect.deleteProperty(Array.prototype, "1");
  }

  assert.deepEqual(source, [a, b]);
  assert.notEqual(map.entries, source);
  assert.equal(map.entries.length, 2);
  assert.ok(Object.isFrozen(map.entries));
  assert.ok(Object.isFrozen(map));
  assert.equal(Object.getPrototypeOf(map), null);
  for (const [index, item] of source.entries()) {
    const slot = Object.getOwnPropertyDescriptor(map.entries, index);
    assert.ok(slot && Object.hasOwn(slot, "value"), `owned member list must have a data slot at index ${index}`);
    assert.equal(slot.value, item);
    assert.equal(slot.enumerable, true);
  }
  assert.equal(setterCalls, 0);

  const { actual, expected } = compare(data(op("object", map)), '<type "data" content <a "string" b "string">>');
  assert.equal(hson_schema_digest(actual), hson_schema_digest(expected));
  for (const [spelling, ok] of [['<a "yes">', false], ['<a "yes" b "yes">', true]] as const) {
    const candidate = HsonDataValue.fromSource(spelling);
    const result = certify(actual, candidate);
    assert.deepEqual(result, certify(expected, candidate));
    assert.equal(result.ok, ok);
    if (!result.ok) {
      assert.equal(result.issues.length, 1);
      assert.equal(result.issues[0].code, "MISSING_REQUIRED");
      assert.deepEqual(result.issues[0].path, ["b"]);
    }
  }
});

test("a shortened length read cannot hide a trailing hole", () => {
  const fields = [member("a", str())];
  fields.length = 2;
  assert.throws(() => member_map(reports_one_entry(fields)), /data slot at occurrence\[1\]/);
});

test("list cardinality must be a valid array length", () => {
  for (const count of ["0", NaN, -0, -1, 0.5, 2 ** 32]) {
    const view = new Proxy([], {
      getOwnPropertyDescriptor(target, key) {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
        return key === "length" ? { ...descriptor, value: count } : descriptor;
      },
    });
    assert.throws(() => expression_group(view), /length/);
  }
});

// The old validation pass could exhaust this iterator and a later map could
// substitute its own results. Even a partially consumed producer has all its slots.
function single_use<T>(buffer: T[]): readonly T[] {
  const cursor = buffer.values();
  buffer[Symbol.iterator] = () => cursor;
  cursor.next();
  buffer.map = () => [];
  return Object.freeze(buffer);
}

test("root, member, header, tuple and union lists preserve every physical entry in order", () => {
  for (const collection of ["tuple", "union"]) {
    const first = str(), second = num();
    const items = expression_group(single_use([first, second]));
    const rule = header("minlen", "2");
    const title = member("title", op("string", undefined, single_use([rule])));
    const fields = member_map(single_use([title, member("items", op(collection, items))]));
    const root = op("data", expression_group(single_use([defs(), op("object", fields)])));
    const { actual } = compare(root, `<type "data" defs <> content <title <string <minlen 2>> items <${collection} ["string", "number"]>>>`);
    assert.ok(!certify(actual, HsonDataValue.fromSource("<>")).ok);
    const lowered = lower_schema_definition(root);
    assert.equal(lowered.originAt(["content", "title", "string", "minlen"]), rule);
    assert.equal(lowered.originAt(["content", "items", collection, 0]), first);
    assert.equal(lowered.originAt(["content", "items", collection, 1]), second);
  }
  // An exhausted iterator also cannot hide a physically present invalid header.
  // @ts-expect-error An owned occurrence is still the wrong physical entry.
  assert.throws(() => op("array", row, single_use([op("unique", relation)])), /owned Schema header/);
});

test("changing map role and cardinality cannot substitute for explicit object context", () => {
  const collision = optional("content", str());
  const declared = object(collision);
  let nameReads = 0, entryReads = 0;
  const changingRole = { ...declared, get name() { return ++nameReads <= 2 ? "object" : "defs"; } };
  const changingBody = {
    kind: "members" as const,
    get entries() { return ++entryReads === 1 ? [collision] : [collision, member("other", str())]; },
  };
  for (const clause of [changingRole, { ...declared, body: changingBody }]) {
    assert.throws(() => lower_schema_definition(foreign_data(clause)), /owned Schema occurrence at the root/);
    assert.throws(() => expression_group([clause]), /owned Schema occurrence/);
  }
  assert.throws(() => op("object", changingBody), /owned Schema body/);
  assert.deepEqual([nameReads, entryReads], [0, 0]);
  const { actual } = compare(data(object(collision)), '<type "data" content <content <content <optional "string">>>>');
  const substituted = HsonSchema.fromHson('<type "data" content <content <optional "string">>>');
  for (const [source, accepted] of [['<>', true], ['<optional "ok">', false]] as const) {
    const candidate = HsonDataValue.fromSource(source);
    assert.equal(certify(actual, candidate).ok, accepted);
    assert.equal(certify(substituted, candidate).ok, !accepted);
  }
});

test("retained buffers cannot change a completed declaration or its diagnostic subjects", () => {
  const flag = header("unique", relation);
  const rules = [header("minlen", "0"), flag];
  const rule = op("array", row, rules);
  const named = member("v", rule);
  const fields = [named];
  const map = member_map(fields);
  const clauses = [op("object", map)];
  const body = expression_group(clauses);
  const root = op("data", body);
  const before = lower_schema_definition(root);
  const uniquePath = ["content", "v", "array", "unique"];
  assert.equal(before.originAt(uniquePath), flag);

  rules.splice(0, 2, header("unique"));
  fields[0] = member("other", str());
  clauses.length = 0;
  for (const record of [root, body, map, named, rule, flag, relation]) {
    assert.equal(Object.getPrototypeOf(record), null);
    assert.ok(Object.isFrozen(record));
  }
  for (const list of [body.items, map.entries, rule.headers]) assert.ok(Object.isFrozen(list));
  assert.equal(Reflect.set(named, "name", "other"), false);
  assert.equal(Reflect.set(flag, "operand", undefined), false);
  assert.equal(Reflect.set(relation, "value", false), false);
  const after = lower_schema_definition(root);
  assert.ok(ordered_projected_value_equal(after.orderedDefinition, before.orderedDefinition));
  assert.equal(after.schema1Source, before.schema1Source);
  assert.equal(hson_schema_digest(HsonSchema.fromHson(after.schema1Source)), hson_schema_digest(HsonSchema.fromHson(before.schema1Source)));
  for (const lowered of [before, after]) {
    assert.equal(lowered.originAt([]), root);
    assert.equal(lowered.originAt(["content"]), map);
    assert.equal(lowered.originAt(["content", "v"]), rule);
    assert.equal(lowered.originAt([...uniquePath, "cases", 0]), flag);
    assert.equal(flag.operand, relation);
    assert_slot_conflict(HsonSchema.fromHson(lowered.schema1Source));
  }
  assert.equal(map.entries[0], named);
  assert.equal(named.name, "v");

  const duplicate = member("v", rule);
  assert.notEqual(duplicate, named);
  const duplicates = [named, duplicate];
  const invalid = data(op("object", member_map(duplicates)));
  structural_error(invalid, /Duplicate name/, duplicate);
  duplicates.pop();
  structural_error(invalid, /Duplicate name/, duplicate);

  const repeated = member_map([named, named]);
  assert.equal(repeated.entries[0], named);
  assert.equal(repeated.entries[1], named);
  structural_error(data(op("object", repeated)), /Duplicate name/, named);
});

test("duplicate headers report the second authored header", () => {
  const first = header("unique", relation);
  const duplicate = header("unique", relation);
  assert.notEqual(first, duplicate);
  structural_error(field(array(row, first, duplicate)), /Duplicate array header/, duplicate);
  const extra = header("optional");
  structural_error(data(object(member("v", str(), [header("optional"), extra]))), /only one optional/, extra);
});

test("a required nested operation identifies the wrong child or the owner of a missing child", () => {
  const wrongChild = member("item", str());
  structural_error(field(op("array", wrongChild)), /nested Schema operation/, wrongChild);
  const missingChild = op("array");
  structural_error(field(missingChild), /nested Schema operation/, missingChild);
});

test("member maps, literal operands and expression groups report the child when present", () => {
  for (const [name, place, message] of [
    ["object", field, /ordered member map/], ["defs", data, /ordered member map/],
    ["exact", field, /explicit literal operand/], ["ref", field, /explicit literal operand/],
    ["tuple", field, /ordered group of expressions/], ["union", field, /ordered group of expressions/],
  ] as const) {
    const child = str();
    structural_error(place(op(name, child)), message, child);
    const missing = op(name);
    structural_error(place(missing), message, missing);
  }
});

test("a present invalid data group owns the root body diagnostic", () => {
  const child = member_map([]);
  structural_error(op("data", child), /ordered data root declarations/, child);
  const empty = expression_group([]);
  structural_error(op("data", empty), /nonempty group/, empty);
  compare(data(), '<type "data">');
});

test("a literal within the Data depth limit can exceed it inside the generated definition", () => {
  let literal: DataOperand["value"] = 0;
  for (let depth = 0; depth < HSON_MAX_NESTING - 3; depth++) literal = ordered_projected_array([literal]);
  const body = value(literal);
  const root = field(op("exact", body));
  // The literal body owns the overflow when embedded in the generated definition.
  structural_error(root, /nesting depth/);
});

test("unsupported roles, missing operands and malformed headers report structural occurrences", () => {
  const alien = op("future");
  structural_error(field(union(num(), alien)), /Unsupported Data Schema operation/, alien);
  structural_error(data(array(str())), /Unsupported data root role/);
  structural_error(op("document"), /Only Data Schema/);
  structural_error(op("data", expression_group([])), /nonempty group/);
  structural_error(data(object(), defs()), /before root content/);
  structural_error(data(op("any"), op("any")), /only one content/);
  structural_error(data(op("object", expression_group([]))), /ordered member map/);
  structural_error(data(op("object", member_map([str()]))), /user-defined names/);
  const missing = member("a");
  structural_error(data(object(missing)), /nested Schema operation/, missing);
  structural_error(field(tuple(member("string", str()))), /Expected a Schema operation/);
  structural_error(field(op("tuple", value(ordered_projected_array([])))), /group of expressions/);
  const duplicate = member("a", str());
  structural_error(data(object(member("a", num()), duplicate)), /Duplicate name/, duplicate);
  structural_error(data(object(member("$_reserved", str()))), /Invalid Data name/);
  const optionalDef = header("optional");
  structural_error(data(defs(member("T", str(), [optionalDef]))), /Unsupported header/, optionalDef);
  structural_error(data(object(member("a", str(), [header("optional", "true")]))), /optional flag/);
  structural_error(data(object(member("a", str(), [header("optional"), header("optional")]))), /only one optional/);
  structural_error(field(str(header("minlen", "1"), header("minlen", "2"))), /Duplicate string header/);
  structural_error(field(num(header("int", "true"))), /requires a flag/);
  structural_error(field(str(header("future", "x"))), /Unsupported string header/);
  structural_error(field(array(str(), header("unique", value(true)))), /Configured unique requires a Data object/);
  structural_error(field(op("null", undefined, [header("min", "0")])), /does not take/);
  for (const text of ["", " ", "1\n", "0x10", "Infinity", "01", "1e999"]) {
    const bad = header("min", text);
    structural_error(field(num(bad)), /finite JSON number/, bad);
  }
});

test("compiler validation is a separate step with structural owners for generated paths", () => {
  const badLength = header("minlen", "-1");
  const flag = header("optional");
  const lowered = lower_schema_definition(data(object(member("2", array(str(badLength)), [flag]))));
  assert.equal(lowered.originAt(["content", "2"]), flag);
  const checked = compile_hson_schema(lowered.schema1Source);
  assert.ok(!checked.ok);
  const issue = checked.issues[0];
  assert.equal(issue.code, "INVALID_SCHEMA_EXPRESSION");
  assert.deepEqual(issue.path, ["content", "2", "optional", "array", "string", "minlen"]);
  assert.equal(lowered.originAt(issue.path), badLength);
  const badRelation = header("unique", value(ordered_projected_object([["by", "slot"], ["cases", ordered_projected_array([1])]])));
  const relation = lower_schema_definition(field(array(op("any"), badRelation)));
  const checkedRelation = compile_hson_schema(relation.schema1Source);
  assert.ok(!checkedRelation.ok);
  assert.deepEqual(checkedRelation.issues[0].path, ["content", "v", "array", "unique", "cases", 0]);
  assert.equal(relation.originAt(checkedRelation.issues[0].path), badRelation);
  for (const [root, code] of [
    [field(union(str(), str())), "INVALID_UNION"],
    [data(defs(member("Unused", ref("Unused")))), "INVALID_SCHEMA_GRAPH"],
    [field(ref("Missing")), "INVALID_REFERENCE"],
    [field(num(header("over", "1"), header("max", "0"))), "INVALID_SCHEMA_EXPRESSION"],
  ] as const) {
    const result = compile_hson_schema(lower_schema_definition(root).schema1Source);
    assert.ok(!result.ok);
    assert.ok(result.issues.some(issue => issue.code === code));
  }
});
