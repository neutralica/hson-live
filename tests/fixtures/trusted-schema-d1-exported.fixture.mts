import assert from "node:assert/strict";
import { hson } from "../../src/hson.ts";
import { LiveMapSchemaError } from "../../src/api/livemap/livemap.error.ts";
import { capture_trusted_schema_template as capture, construct_trusted_schema_application as construct, attempt_trusted_schema_attachment as attempt } from "../../src/internal/trusted-schema-diagnostics/lifecycle-evidence.ts";
import { register_trusted_schema_for_development } from "../../src/internal/trusted-schema-diagnostics/dev-registration.ts";
export { hson };
process.stdout.write("D1_PROJECT_EXECUTED\n");
const numberName = hson.liveMap.schema.define((s) => s.object({ name: s.number }));
const stringName = hson.liveMap.schema.define((s) => s.object({ name: s.string }));
export const trustedSchemas = {
  age: hson.liveMap.schema.define((s) => s.object.exact({ age: s.number.constrain("positive age", (value) => value > 0), status: s.literal("draft", "published") })),
  document: hson.liveMap.schema.define((s) => s.button(s.attrs({ count: s.number.optional, disabled: s.flag }))),
  fragment: hson.liveMap.schema.define((s) => s.tuple(s.a(), s.b())),
  string: stringName,
  hang: hson.liveMap.schema.define((s) => s.object({ value: s.number.constrain("blocks", (value) => {
    if (value === 99) { process.stdout.write("D1_CONSTRAINT_ENTERED\n"); const end = Date.now() + 5_000; while (Date.now() < end) { /* bounded isolated block */ } }
    return true;
  }) })),
  throwing: hson.liveMap.schema.define((s) => s.object({ value: s.number.constrain("throws", (value) => { if (value === 99) throw new Error("fixture constraint throw"); return true; }) })),
  oneNumber: numberName, oneString: stringName,
  equalNumber: numberName, equalString: stringName,
  mutated: stringName, roundtrip: stringName,
};

const age = construct(capture`<age 1 status "draft">`);
const ageBefore = age.map.capture();
assert.equal(attempt(age, "age", trustedSchemas.age).evidence.attachment, "attached");
assert.equal(age.map.schema.get(), trustedSchemas.age);
assert.deepEqual(age.map.capture(), ageBefore);
attempt(construct(capture`<name "x">`), "string", stringName);
const document = construct(capture`<button disabled/>`);
assert.equal(attempt(document, "document", trustedSchemas.document).evidence.attachment, "attached");
assert.equal(document.map.schema.get(), trustedSchemas.document);
attempt(construct(capture`<a/> <b/>`), "fragment", trustedSchemas.fragment);
attempt(construct(capture`<value 1>`), "hang", trustedSchemas.hang);
attempt(construct(capture`<value 1>`), "throwing", trustedSchemas.throwing);

// A single REAL tagged occurrence, evaluated twice, keeps occurrence identity.
function sharedOccurrence() { return capture`<name "x">`; }
const sharedA = sharedOccurrence();
const sharedB = sharedOccurrence();
assert.equal(sharedA, sharedB);
const first = construct(sharedA);
const second = construct(sharedB);
assert.notEqual(first.map, second.map);
assert.notEqual(numberName, stringName);
const beforeFailure = first.map.capture();
const rejected = attempt(first, "oneNumber", numberName);
assert.equal(rejected.schema, numberName);
assert.equal(rejected.evidence.attachment, "rejected");
assert.ok(rejected.error instanceof LiveMapSchemaError);
assert.equal(rejected.error.issues[0]?.code, "TYPE_MISMATCH");
assert.deepEqual(rejected.error.issues[0]?.path, ["name"]);
assert.equal(rejected.error.issues[0]?.expected, "number");
assert.equal(first.map.schema.get(), undefined);
assert.deepEqual(first.map.capture(), beforeFailure);
const attached = attempt(second, "oneString", stringName);
assert.equal(attached.evidence.attachment, "attached");
assert.equal(second.map.schema.get(), stringName);
assert.notEqual(rejected.evidence.associationId, attached.evidence.associationId);

const equalA = capture`<name "x">`;
const equalB = capture`<name "x">`;
assert.equal(equalA.canonical, equalB.canonical);
assert.notEqual(equalA, equalB);
assert.notEqual(equalA.templateId, equalB.templateId);
attempt(construct(equalA), "equalNumber", numberName);
attempt(construct(equalB), "equalString", stringName);

for (const schemaId of ["mutated", "roundtrip"]) {
  const application = construct(capture`<name "x">`);
  const map = application.map;
  assert.ok(map.mode === "data-object");
  map.set(["name"], "changed");
  if (schemaId === "roundtrip") map.set(["name"], "x");
  const result = attempt(application, schemaId, stringName);
  assert.equal(result.evidence.attachment, "attached");
  assert.equal(result.evidence.correspondence, "unavailable");
  assert.ok(result.evidence.attemptRevision > result.evidence.constructedRevision);
}
register_trusted_schema_for_development("sentinel", stringName, hson);
process.stdout.write("D1_SCHEMA_REGISTERED\n");
