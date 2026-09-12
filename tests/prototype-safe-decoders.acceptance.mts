import assert from "node:assert/strict";
import { canonical_inline_style } from "../src/core/inline-style.ts";
import { decode_locus_document_attribute_value } from "../src/api/locus/locus.protocol.ts";
import { parse_style_string } from "../src/api/transform/utils/attrs-utils/parse-style.ts";

function assert_safe_record(value: unknown): asserts value is Record<string, unknown> {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Object.getPrototypeOf(value), Object.prototype);
  assert.equal(Object.hasOwn(value as object, "__proto__"), true);
  assert.equal(Object.hasOwn(value as object, "constructor"), true);
  assert.equal(Object.hasOwn(value as object, "prototype"), true);
  assert.equal((value as Record<string, unknown>).polluted, undefined);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
}

const flatInput = JSON.parse(`{
  "ordinary": "red",
  "__proto__": { "value": "safe" },
  "constructor": "own-constructor",
  "prototype": "own-prototype"
}`) as unknown;
const flat = canonical_inline_style(flatInput);
assert_safe_record(flat);
assert.deepEqual(flat.__proto__, { value: "safe" });
assert.equal(flat.constructor, "own-constructor");
assert.equal(flat.prototype, "own-prototype");

const nestedInput = JSON.parse(`{
  "ordinary": "red",
  "__proto__": { "polluted": true },
  "constructor": "own-constructor",
  "prototype": {
    "__proto__": { "polluted": true },
    "constructor": "nested-constructor",
    "prototype": "nested-prototype"
  }
}`) as unknown;
const decoded = decode_locus_document_attribute_value("style", nestedInput);
assert_safe_record(decoded);
const decodedRecord = decoded as Record<string, unknown>;
assert.deepEqual(decodedRecord.__proto__, { polluted: true });
const nested = decodedRecord.prototype;
assert_safe_record(nested);
assert.deepEqual(nested.__proto__, { polluted: true });
assert.equal(nested.constructor, "nested-constructor");
assert.equal(nested.prototype, "nested-prototype");

const parsed = parse_style_string("ordinary: red; __proto__: safe; constructor: own-constructor; prototype: own-prototype");
assert_safe_record(parsed);
assert.equal(parsed.__proto__, "safe");
assert.equal(parsed.constructor, "own-constructor");
assert.equal(parsed.prototype, "own-prototype");

process.stdout.write("ok 1 - arbitrary style names remain safe own properties in all style decoders\n1..1\n");
