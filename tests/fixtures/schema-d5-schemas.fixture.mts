import { hson } from "../../src/hson.ts";
export { hson };
export const UserSchema = hson.liveMap.schema.define(s => s.object({ user: s.object({ age: s.number }) }));
export const OtherSchema = hson.liveMap.schema.define(s => s.object({ user: s.object({ age: s.literal(42) }) }));
export const DocumentSchema = hson.liveMap.schema.define(s => s.button(s.attrs({ count: s.number.optional, disabled: s.flag })));
export const ConstraintSchema = hson.liveMap.schema.define(s => s.object({ user: s.object({ age: s.number.constrain("positive age", n => n > 0) }) }));
export const LiteralSchema = hson.liveMap.schema.define(s => s.object({ user: s.object({ age: s.literal("draft", "published") }) }));
export const trustedSchemas = { user: UserSchema, other: OtherSchema, document: DocumentSchema, constraint: ConstraintSchema, literal: LiteralSchema };
