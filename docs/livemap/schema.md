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
reserializing it. Complete data, document, and combined capabilities
use the canonical HsonSchema evaluator. Root interpretation comes from Hson,
not from the supplied Schema: ordinary `"text"` is a data string, while a
document Schema constrains ordered content beneath the internal document root.

Mismatches throw the internal `HsonSchemaError` with structured issues; incomplete or
unrecognized Schemas fail with `INVALID_SCHEMA`, incompatible roots with
`TYPE_MISMATCH`. Malformed untyped strings preserve Transform errors and
non-string misuse throws `TypeError`. Approved declarative refinements are
evaluated by the canonical graph authority; executable callback constraints are
not a Schema feature.

## Any canonical data value

The authored data expression `"any"` accepts any canonical Hson data-mode
value: strings, finite numbers (including `-0`), booleans, null, ordered dense
arrays, and ordered arbitrary-key data objects, recursively. Empty arrays and
objects are included. For example, broad interaction-shaped fields can be
expressed without a custom predicate:

```ts
const InteractionFieldsSchema: HsonSchema = Hson`
  <type "data" content <args "any" payload "any">>
`;
```

`"any"` does not mean arbitrary JavaScript. Document-mode Hson, document
identity metadata, undefined, non-finite numbers, bigint, symbols, functions,
accessors, sparse arrays, cycles, class instances, DOM values, and other
runtime capabilities remain outside canonical data admission. Normal Hson data
name restrictions also remain in force.

Generated TypeScript represents this expression as the public `JsonValue`
type, never TypeScript `any`. Canonical Hson equality continues to distinguish
`0` from `-0`, and data-object member order remains semantic; Schema does not
sort or normalize either form.

The expression lowers directly to the existing canonical
`projected-any` node. Canonical Schema graph version 2 is therefore unchanged.
The authored-language and generated-evidence compatibility token is
`hson-schema-mvp-9`; evidence generated under earlier tokens is stale.

This local canonical-data support does not resolve generic Echo/Locus action
payload fidelity. Negative zero, object-member-order/dedupe equivalence, and
dangerous-key cloning behavior such as an own `__proto__` member require the
separate hosted-action transport audit.

## Finite string alphabets

The `alphabet` member restricts a string to a finite declared repertoire and
composes conjunctively with the existing string refinements:

```ts
const PersistedIdSchema: HsonSchema = Hson`
  <type "data" content <
    id <string <len 9 alphabet "0123456789abcdefghjkmnpqrstvwxyz">>
  >>
`;
```

The repertoire is one ordinary Hson string. Both length and alphabet membership
use ECMAScript string iteration (`Array.from(value)` / `for...of`): a well-formed
non-BMP code point is one unit, while a combining sequence can contain multiple
units; an isolated surrogate, where preserved, is also one iteration unit.
Comparison is exact and case-sensitive. There is no Unicode
normalization, locale behavior, grapheme segmentation, range syntax, or regular
expression interpretation. Ordinary Hson escapes are decoded before the
repertoire is checked.

Duplicate iteration units make the Schema invalid; they are never silently
removed. Repertoire order is preserved as canonical graph identity even though
membership acceptance is order-independent. The empty repertoire is valid: it
accepts only the empty candidate. It may therefore form an unsatisfiable but
structurally valid conjunction with a positive length.

An alphabet mismatch uses the existing `INVALID_CONSTRAINT` issue and
refinement-failure evidence. Internally, evaluation records the first offending
unit and its zero-based iteration-unit index; the index does not become a
`LivePath` segment and user-facing expected text does not expose the complete
repertoire.

This addition is canonical Schema graph format version 2 and Hson Schema
compatibility token `hson-schema-mvp-9`. Generated declarations and freshness
evidence from older tokens must be regenerated.

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
