# Standalone canonical HSON validation

```ts
const UserSchema = hson.liveMap.schema.define(s => s.object({ age: s.number }));
const user = hson`<age 37>`;
const same = hson.liveMap.schema.validate(UserSchema, user);
// same === user; return type is HsonCanonical, not a Schema certificate.
```

`validate(schema: LiveMapSchema, canonical: HsonCanonical): HsonCanonical`
validates an existing admitted canonical string without allocating a LiveMap or
reserializing it. Complete projected, element, fragment and combined capabilities
use the existing owned Schema validators. Root interpretation comes from HSON,
not from the supplied Schema: ordinary `"text"` is a projected string, not a
fragment. No element-to-fragment or scalar-to-fragment coercion occurs.

Mismatches throw `LiveMapSchemaError` with structured issues; incomplete or
unrecognized Schemas fail with `INVALID_SCHEMA`, incompatible roots with
`TYPE_MISMATCH`. Malformed untyped strings preserve Transform errors and
non-string misuse throws `TypeError`. Projected constraint exceptions propagate;
document attribute constraints retain their existing adapter behavior.
