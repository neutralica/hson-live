# Standalone canonical Hson validation

```ts
import { Hson, type HsonData, type SchemaType } from "hson-live/hson";
import { hsonLiveMap } from "hson-live/livemap";

const UserSchema = Hson.schema`<type "data" content <user <content <age "number">>>>`;
const user = Hson.data`<user <age 37>>`;
const same = UserSchema.certify(user);
// same === user; return type is HsonData<typeof UserSchema>.
```

The Schema object's `certify` method validates one canonical candidate in its
own mode and returns a Schema-proven primitive string. LiveMap's distinct
operation is owner governance: `map.schema.use(UserSchema)`. A context-neutral
`Hson.canonical` string such as `"text"` can be admitted according to the
Schema's mode; a known wrong-mode candidate rejects.

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
const InteractionFieldsSchema = Hson.schema`
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

The expression lowers directly to the existing canonical `projected-any` node.
The current Canonical Schema graph version is 3. The authored-language and
generated-evidence compatibility token is `hson-schema-mvp-10`; evidence
generated under earlier tokens is stale.

This local canonical-data support does not resolve generic Echo/Locus action
payload fidelity. Negative zero, object-member-order/dedupe equivalence, and
dangerous-key cloning behavior such as an own `__proto__` member require the
separate hosted-action transport audit.

## Finite string alphabets

The `alphabet` member restricts a string to a finite declared repertoire and
composes conjunctively with the existing string refinements:

```ts
const PersistedIdSchema = Hson.schema`
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

The current Canonical Schema graph format is version 3 and the Hson Schema
compatibility token is `hson-schema-mvp-10`. Generated declarations and
freshness evidence from older tokens must be regenerated.

## Array uniqueness

The `unique` array refinement has two authored forms. `unique true` preserves
its original meaning: complete array elements must be pairwise distinct under
exact canonical Hson equality.

These forms are alternatives for the array descriptor's single `unique`
member. One Schema may use them independently at different array locations,
but the authored language does not apply both forms to the same array.

The configured form derives finite, Schema-owned uniqueness keys from one
required direct member of each item:

```hson
<array <
  content <content <kind "string" note "string">>
  unique <
    by "kind"
    cases [
      ["morning-hour", ["09:00", "09:30"]],
      ["single-0930", ["09:30"]],
      ["single-1000", ["10:00"]]
    ]
  >
>>
```

Here `morning-hour` plus `single-0930` rejects because both contribute
`"09:30"`; `morning-hour` plus `single-1000` accepts. The relation is
validation metadata only. It does not add keys to, reorder, or otherwise
transform candidate data.

V1 `by` is exactly one ordinary direct data-object member name. Every item must
be a data object, must own that member, and the selected value must be an exact
Hson primitive: string, finite number, boolean, or null. The selected value
must match one case row; an unmapped value fails candidate validation. Case
selectors and derived keys use exact Hson equality, including `0` distinct
from `-0`. Arrays, objects, document nodes, undefined, and runtime-only values
are not valid selectors or keys.

Each case maps its selector to zero or more primitive keys. An empty key list
is valid and consumes no uniqueness key. Duplicate selector rows and duplicate
keys within a row make the Schema invalid. Case order and key order remain part
of canonical Schema identity, but array item order and case-row order do not
change candidate acceptance. The first item contributing a key remains its
owner; a later conflict reports the later selected-member path, the earlier
related path, and the exact conflicting key.

A Decks-style relation can remain entirely in Schema:

```hson
unique <
  by "position"
  cases [
    ["top-left", ["TL"]],
    ["top-right", ["TR"]],
    ["top-half", ["TL", "TR"]],
    ["full", ["TL", "TR", "BL", "BR"]]
  ]
>
```

Configured `unique` is not an arbitrary mapper, data transformation, geometry
facility, callback validator, path language, or general dependent-validation
system. It is one closed finite relation inside the existing uniqueness
constraint family. Generated TypeScript retains the ordinary collection/item
structure and adds nominal refinement evidence at the array boundary; it does
not enumerate valid collection permutations or infer member literal unions.

The authoritative format limits are 4,096 case rows, 1,024 keys in one case,
and 16,384 total derived keys in one relation. Relation setup is linear in rows
and total relation keys. Candidate work is linear in the object members
inspected to resolve selectors plus contributed keys. All of that work
participates in the normal canonical evaluator step, depth, content, and issue
budgets.

## Trusted editor diagnostics for natural map ownership

The preferred authored layout can keep Hson separate from map construction:

```ts
const source = Hson.canonical`
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

Static authored source uses `HsonData<typeof Schema>` or
`HsonDocument<typeof Schema>` annotations and the headless Schema analyzer;
it does not call `schema.certify`. Dynamic ingress uses
`schema.certify`. Map-owned state uses `map.schema.use` and is revalidated before
mutation commits.
