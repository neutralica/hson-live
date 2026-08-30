import assert from "node:assert/strict";
import { present_schema_diagnostic, schema_diagnostic_message } from "../editors/vscode-hson/src/schema-presentation.ts";
import { discover_schema_validation_sources } from "../src/internal/trusted-schema-diagnostics/discover-validation-sources.ts";
import type { TrustedSchemaDiagnostic } from "../src/internal/trusted-schema-diagnostics/protocol.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import { check_message_bank } from "./hson-message-bank-review.mts";
import { check_schema_scenarios } from "./hson-message-scenarios.mts";
import { check_runtime_messages } from "./hson-runtime-message-review.mts";
const text = 'import { Hson } from "hson-live"; import { UserSchema } from "./schema.js"; const user = Hson`<age "37">`; Hson.certify(UserSchema, user);';
const association = discover_schema_validation_sources("/project/user.ts", text)[0]!;
let checks = 0;
const check = (name: string, run: () => void) => { run(); console.log(`ok ${++checks} - ${name}`); };
const issue = (overrides: Partial<TrustedSchemaDiagnostic> = {}): TrustedSchemaDiagnostic => ({ code: "TYPE_MISMATCH", path: ["age"], expected: "number", received: "string", range: { precision: "exact", start: 5, end: 9 }, ...overrides });
check("primitive type wording", () => assert.equal(schema_diagnostic_message(issue()), 'Expected `age` to be a number, but this value is an Hson string.'));
check("primary exact slice is authored token", () => { const spec = present_schema_diagnostic(issue(), association); assert.equal(text.slice(spec.range.start, spec.range.end), '"37"'); assert.equal(spec.precision, "exact"); });
check("validation call is related, not primary", () => { const spec = present_schema_diagnostic(issue(), association); assert.equal(text.slice(spec.related[0]!.range.start, spec.related[0]!.range.end), 'Hson.certify(UserSchema, user)'); });
check("Schema label distinguishes contracts", () => assert.match(present_schema_diagnostic(issue(), association).message, /^\[UserSchema\]/));
check("missing member wording", () => assert.equal(schema_diagnostic_message(issue({ code: "MISSING_REQUIRED" })), 'Required `age` is missing.'));
check("missing member explicitly anchored", () => { const spec = present_schema_diagnostic(issue({ code: "MISSING_REQUIRED", range: { precision: "anchor", start: 9, end: 10 } }), association); assert.equal(spec.precision, "anchor"); assert.match(spec.message, /Anchored to existing source/); assert.equal(text.slice(spec.range.start, spec.range.end), '>'); });
check("unknown exact member wording", () => assert.match(schema_diagnostic_message(issue({ code: "UNKNOWN_KEY" })), /not allowed by this exact Schema/));
check("literal wording uses structured evidence", () => assert.equal(schema_diagnostic_message(issue({ code: "INVALID_LITERAL", expected: '"draft"', received: '"pending"' })), 'Expected `age` to equal "draft"; found "pending".'));
check("labeled constraint wording", () => assert.match(schema_diagnostic_message(issue({ code: "INVALID_CONSTRAINT", constraintLabel: "positive age" })), /constraint “positive age”/));
check("unlabeled constraint does not invent repairs", () => assert.equal(schema_diagnostic_message(issue({ code: "INVALID_CONSTRAINT" })), '`age` does not satisfy its Schema constraint.'));
check("wrong tag uses private semantic sidecar", () => assert.equal(schema_diagnostic_message(issue({ code: "INVALID_LITERAL", subject: "tag", expected: '"button"', received: '"span"' })), 'Expected element tag "button"; found "span".'));
check("attribute value names attribute", () => assert.match(schema_diagnostic_message(issue({ attributeName: "count" })), /Expected attribute `count` to be a number/));
check("missing flag uses semantic evidence", () => assert.equal(schema_diagnostic_message(issue({ code: "MISSING_REQUIRED", subject: "flag", attributeName: "disabled" })), 'Required flag `disabled` is missing.'));
check("unresolved stays template-level", () => { const spec = present_schema_diagnostic(issue({ range: { precision: "unresolved" } }), association); assert.deepEqual(spec.range, association.source.templateRange); assert.equal(spec.precision, "unresolved"); assert.match(spec.message, /exact source location unavailable/); });
check("out-of-bounds range fails to unresolved", () => assert.equal(present_schema_diagnostic(issue({ range: { precision: "exact", start: 500, end: 501 } }), association).precision, "unresolved"));
check("negative range fails to unresolved", () => assert.equal(present_schema_diagnostic(issue({ range: { precision: "exact", start: -1, end: 1 } }), association).precision, "unresolved"));
check("reversed range fails to unresolved", () => assert.equal(present_schema_diagnostic(issue({ range: { precision: "exact", start: 4, end: 1 } }), association).precision, "unresolved"));
check("missing offsets never appear exact", () => assert.equal(present_schema_diagnostic(issue({ range: { precision: "exact" } }), association).precision, "unresolved"));
check("root mismatch lacks invented repair", () => assert.match(schema_diagnostic_message(issue({ path: [], expected: "fragment document root", received: "data root" })), /fragment document root; received data root/));
check("unknown issue code gets neutral wording", () => assert.equal(schema_diagnostic_message(issue({ code: "INVALID_SCHEMA" })), 'Schema validation failed for `age` (INVALID_SCHEMA).'));
check("exact full presentation and related call text", () => {
  const spec = present_schema_diagnostic(issue(), association);
  assert.equal(spec.message, '[UserSchema] Expected `age` to be a number, but this value is an Hson string.');
  assert.deepEqual(spec.related, [{ range: association.callRange, message: 'Schema requested by this certify call (UserSchema).' }]);
});
check("anchor full presentation", () => assert.equal(present_schema_diagnostic(issue({ code: "MISSING_REQUIRED", range: { precision: "anchor", start: 9, end: 10 } }), association).message,
  '[UserSchema] Required `age` is missing. (Anchored to existing source; required structure is absent.)'));
check("unresolved full presentation", () => assert.equal(present_schema_diagnostic(issue({ range: { precision: "unresolved" } }), association).message,
  '[UserSchema] Expected `age` to be a number, but this value is an Hson string. (Template-level diagnostic; exact source location unavailable.)'));
check("composite overrides anchor wording without claiming exactness", () => {
  const spec = present_schema_diagnostic(issue({ range: { precision: "anchor", start: 0, end: 10 }, hostOrigin: { kind: "composite", range: association.source.templateRange } }), association);
  assert.equal(spec.precision, "unresolved");
  assert.equal(spec.message, '[UserSchema] Expected `age` to be a number, but this value is an Hson string. (Range spans multiple source origins; not a character-exact location.)');
});
check("substitution full presentation uses kind evidence and host range", () => {
  const range = { start: 7, end: 10 };
  const spec = present_schema_diagnostic(issue({ hostOrigin: { kind: "substitution-expression", range, scalarKind: "string" } }), association);
  assert.equal(spec.precision, "substitution-expression");
  assert.deepEqual(spec.range, range);
  assert.equal(spec.message, '[UserSchema] This expression evaluated to an Hson string, but the Schema requires number here.');
});
check("map.schema.use related label uses discovered call", () => {
  const host = 'import { Hson, hson } from "hson-live"; import { UserSchema } from "./schema.js"; const value=Hson`<age "37">`; const map=hson.liveMap.fromHson(value); map.schema.use(UserSchema);';
  const use = discover_schema_validation_sources("/project/user.ts", host)[0]!;
  const spec = present_schema_diagnostic(issue(), use);
  assert.deepEqual(spec.related, [{ range: use.callRange, message: 'Schema requested by this map.schema.use call (UserSchema).' }]);
  assert.equal(host.slice(spec.related[0]!.range.start, spec.related[0]!.range.end), "map.schema.use(UserSchema)");
});
check("legacy English cannot override structured evidence", () => {
  const injected = { ...issue(), message: "Required banana is missing. Expected string." };
  assert.equal(schema_diagnostic_message(injected), 'Expected `age` to be a number, but this value is an Hson string.');
});
check_message_bank(check);
check_schema_scenarios(check);
await check_runtime_messages(async (name, run) => { await run(); console.log(`ok ${++checks} - ${name}`); });
emit_hson_live_test_completion("schema-d2-presentation", checks, checks, 0);
