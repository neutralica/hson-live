# Standalone canonical Hson validation

```ts
import { Hson, type HsonFromSchema, type JsonFromSchema } from "hson-live/hson";
import { hsonLiveMap } from "hson-live/livemap";

const UserSchema = Hson.schema`<type "data" content <user <content <age "number">>>>`;
type UserHson = HsonFromSchema<typeof UserSchema>;
type UserJson = JsonFromSchema<typeof UserSchema>;
const user: UserHson = Hson.data`<user <age 37>>`;
const same = UserSchema.certify(user);
// same === user; return type is HsonData<typeof UserSchema>.
```

The Schema object's `certify` method validates one canonical candidate in its
own mode and returns a Schema-proven primitive string. LiveMap's distinct
operation is establishing a governing library contract: either at admission with `hsonLiveMap.fromLibraries({ state: { data, schema: UserSchema } })` / `map.addLibraries({ state: { data, schema: UserSchema } })`, or afterward on an unmanaged local map with `map.lib("state").schema.use(UserSchema)`. Omitting `schema` selects `ANY_DATA` or `ANY_DOCUMENT` from the entry's explicit kind. A context-neutral
`Hson.canonical` string such as `"text"` can be admitted according to the
Schema's mode; a known wrong-mode candidate rejects.

Post-hoc `schema.use` is tightening-only. A family-top contract may acquire one
same-family specific Schema after the complete current root validates. The
attachment is one ordinary revisioned map commit; canonical equality is an
unchanged no-op, while a wrong family or a different fixed Schema rejects
atomically. Capture and local replay retain the tightened contract, and a
pre-tightening capture cannot restore over it. Locus-managed authorities and
projected Echo clients reject direct attachment in this phase.

Mismatches throw the internal `HsonSchemaError` with structured issues; incomplete or
unrecognized Schemas fail with `INVALID_SCHEMA`, incompatible roots with
`TYPE_MISMATCH`. Malformed untyped strings preserve Transform errors and
non-string misuse throws `TypeError`. Approved declarative refinements are
evaluated by the canonical graph authority; executable callback constraints are
not a Schema feature.

## Any canonical data value

`<type "data">` is the family-top Schema for every valid Hson data value. It is equivalent to `<type "data" content "any">` and to the exported `ANY_DATA` Schema object. Adding `content` narrows the accepted data. The family includes object, array, string, finite number, boolean, and null roots.

`<type "document">` is the family-top Schema for every valid Hson document, equivalent to `ANY_DOCUMENT`. `<type "document" tag "main">` narrows only the root tag; its content remains unconstrained. `content "empty"` explicitly requires empty content. Both constants are ordinary `HsonSchema` values, with the usual `toHson()` and `certify()` behavior. Generated evidence for the data top uses `JsonValue`; document top evidence represents a canonical document root with broad valid content and retains its proof identity.

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
Canonical Schema graphs have one unversioned current shape. Generated compiler
projects use content-derived tooling identity and input observations for freshness.

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

Generated declarations and evidence require regeneration when relevant tooling or
inputs change.

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

`by` is exactly one ordinary direct data-object member name. Every item must
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
const map = hsonLiveMap.fromLibraries({ state: { data: source, schema: UserSchema } });
```

D3 can project the current candidate's authoritative diagnostics into `source`
without adding `schema.validate`. This requires enabled trusted diagnostics and
source-bound D1 lifecycle evidence from the configured diagnostic provider.
Static source shape alone is insufficient. Two maps can independently govern one template.

Static authored source uses `HsonFromSchema<typeof Schema>` annotations
(or the lower-level `HsonData<S>` / `HsonDocument<S>`) and the headless Schema analyzer;
it does not call `schema.certify`. Dynamic ingress uses
`schema.certify`. Map-owned state is validated during library admission, before
post-hoc attachment, and before mutation commits.

## Runtime Schema identity

Runtime `schemaDigest` is SHA-256 of a deterministic encoding of the fully validated ordered authored Schema definition, before compiler lowering. The encoder uses fixed tuples: a type tag followed by its payload; object payloads contain ordered `[name, encodedValue]` pairs, and arrays contain ordered encoded items. Finite numbers use exact normalized spellings with explicit `-0`. It never materializes member keys through an ordinary JavaScript object.

Identity ignores whitespace/layout, quote and escape spelling, accepted equivalent array syntax, and physical-versus-escaped newlines with the same decoded value. It preserves authored definition/member order (including integer-like names), def names/ref structure, unused definitions, inline versus ref, union order, document sequence order, optionality, exact values and configured uniqueness mapping/order. This is definition identity, not universal behavioral equivalence. Every definition, including unused definitions and reference cycles, validates before identity is available.

Compiler topology, evaluator diagnostics and source ranges do not enter identity. Tooling retains exact authored source and `sourceDigest` as provenance/evidence; runtime Schema handles retain the normalized definition. Registry compatibility uses Schema identity plus ordered library names, scope, root mode and root codec; it excludes Schema presentation bytes. Local initializer fingerprints use Schema identity while retaining exact root/CSS state. Echo/Locus/checkpoint reconstruction verifies exact transport/chunk checksums where applicable, parses and fully validates Schema source, recomputes its definition digest, and then enforces authority/revision/session/topology/permission fences. Existing persisted artifacts hard-cut; no compatibility or version path is provided.
