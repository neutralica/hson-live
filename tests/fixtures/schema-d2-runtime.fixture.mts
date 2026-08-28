import { hson } from "../../src/hson.ts";
import { register_trusted_schema_for_development as register } from "../../src/internal/trusted-schema-diagnostics/dev-registration.ts";
export { hson };
export let calls = 0;
export const UserSchema = hson.liveMap.schema.define(s => s.object({ user: s.object({ age: s.number }) }));
export const Stateful = hson.liveMap.schema.define(s => s.number.constrain("alternating", () => ++calls % 2 === 0));
export const Blocking = hson.liveMap.schema.define(s => s.number.constrain(value => { if (value === 99) { const end = Date.now() + 5_000; while (Date.now() < end) {} } return true; }));
export const Document = hson.liveMap.schema.define(s => s.button(s.attrs({ count: s.number.optional, disabled: s.flag })));
export const trustedSchemas = { userHandle: UserSchema, stateHandle: Stateful, blocking: Blocking, document: Document };
const local = hson.liveMap.schema.define(s => s.number);
const binding = { moduleUrl: "file:///project/local.ts", localName: "Local", declarationStart: 40 };
register("localHandle", local, hson, binding);
register("localHandle", local, hson, binding);
const ambiguous = { moduleUrl: "file:///project/ambiguous.ts", localName: "Schema", declarationStart: 40 };
register("ambiguousA", local, hson, ambiguous);
register("ambiguousB", UserSchema, hson, ambiguous);
const duplicate = new URL(import.meta.url).searchParams.has("conflict");
if (duplicate) register("localHandle", UserSchema, hson, binding);
// No application entrypoint, template capture, LiveMap, or validate executes.
