# Standalone canonical HSON validation

```ts
import { HSON } from "hson-live/hson";
import { hsonLiveMap } from "hson-live/livemap";

const UserSchema = hsonLiveMap.schema.define(s => s.object({ user: s.object({ age: s.number }) }));
const user = HSON`<user <age 37>>`;
const same = HSON.validate(UserSchema, user);
// same === user; return type is HsonCanonical, not a Schema certificate.
```

`HSON.validate`, `hsonLiveMap.schema.validate`, and
`hson.liveMap.schema.validate` are the same authoritative function. The latter
two remain legitimate LiveMap-facing entrances. None allocates a map.

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

## Trusted editor diagnostics for natural map ownership

The preferred authored layout can keep HSON separate from map construction:

```ts
const source = HSON`
  <user <age "37">>
`;
const map = hsonLiveMap.fromHson(source);
map.schema.use(UserSchema);
```

D3 can project the current candidate's authoritative diagnostics into `source`
without adding `schema.validate`. This requires enabled trusted diagnostics and
source-bound D1 lifecycle evidence from the configured diagnostic provider.
Static source shape alone is insufficient. Mutation before attachment, including
mutate-then-revert, prevents attribution; rejected initial attachment remains
diagnosable. Two maps can independently govern one template. The dedicated
`hsonLiveMap.fromHson` public facade is equally supported.

Standalone `schema.validate` remains useful for fixtures, static configuration,
build/CI, and validation without a map. Its canonical interpretation is unchanged;
map-flow candidates preserve `fromHson`'s existing document-text interpretation.
