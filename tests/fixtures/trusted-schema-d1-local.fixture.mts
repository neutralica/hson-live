import assert from "node:assert/strict";
import { hson } from "../../src/hson.ts";
import { register_trusted_schema_for_development } from "../../src/internal/trusted-schema-diagnostics/dev-registration.ts";
import { capture_trusted_schema_template as capture, construct_trusted_schema_application as construct, attempt_trusted_schema_attachment as attempt } from "../../src/internal/trusted-schema-diagnostics/lifecycle-evidence.ts";
let state = { minimum: 1 };
let calls = 0;
const localOnly = hson.liveMap.schema.define((s) => s.object({ local: s.number.constrain("captured minimum", value => { calls += 1; return value >= state.minimum; }) }));
const registration = register_trusted_schema_for_development("localOnly", localOnly, hson);
assert.equal(registration.schema, localOnly);
assert.equal(registration.origin, hson);
const attachment = attempt(construct(capture`<local 2>`), "localOnly", localOnly);
assert.equal(attachment.schema, localOnly);
assert.equal(attachment.evidence.attachment, "attached");
export function replaceCapturedMinimum(minimum: number): void { state = { minimum }; }
export function constraintCalls(): number { return calls; }
