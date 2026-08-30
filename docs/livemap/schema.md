# Standalone canonical Hson validation

```ts
import { Hson, type HsonSchema } from "hson-live/hson";
import { hsonLiveMap } from "hson-live/livemap";

const UserSchema: HsonSchema = Hson`<type "data" content <user <content <age "number">>>>`;
const user = Hson`<user <age 37>>`;
const same = Hson.certify(UserSchema, user);
// same === user; return type is HsonCanonical, not a Schema certificate.
```

`Hson.certify` is the sole generic dynamic certification operation. LiveMap's
distinct operation is owner governance: `map.schema.use(UserSchema)`.

`Hson.certify(schema: HsonSchema, canonical: HsonCanonical): HsonCanonical`
validates an existing admitted canonical string without allocating a LiveMap or
reserializing it. Complete data, element, fragment and combined capabilities
use the canonical HsonSchema evaluator. Root interpretation comes from Hson,
not from the supplied Schema: ordinary `"text"` is a data string, not a
fragment. No element-to-fragment or scalar-to-fragment coercion occurs.

Mismatches throw the internal `HsonSchemaError` with structured issues; incomplete or
unrecognized Schemas fail with `INVALID_SCHEMA`, incompatible roots with
`TYPE_MISMATCH`. Malformed untyped strings preserve Transform errors and
non-string misuse throws `TypeError`. Approved declarative refinements are
evaluated by the canonical graph authority; executable callback constraints are
not a Schema feature.

## Trusted editor diagnostics for natural map ownership

The preferred authored layout can keep Hson separate from map construction:

```ts
const source = Hson`
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

Static authored source uses generated `<Name>Hson` annotations and the headless
Schema analyzer; it does not call `Hson.certify`. Dynamic ingress uses
`Hson.certify`. Map-owned state uses `map.schema.use` and is revalidated before
mutation commits.
