#### hson-live / hson.terminalgothic.com

# HSON Spec[1]
## Nodes, Structure, and Invariants
Updated: 2026-07-13

HSON transformations normalize through one ordered tree representation,
`HsonNode`. The graph preserves the semantic structure needed to project JSON,
HTML, and HSON, but it is not a byte-for-byte record of source spelling.
Parsers and serializers can canonicalize whitespace, quoting, attribute form,
tag case, object-key order, and other surface details.

---

## HsonNode

The current public shape is:

```ts
type HsonNode = {
  $_tag: string;
  $_content: (HsonNode | Primitive)[];
  $_attrs?: HsonAttrs;
  $_meta?: HsonMeta;
};
```

`$_tag` and `$_content` are required. Empty optional attribute and metadata
containers are omitted by the node factory; empty content is `[]`.

- `$_tag` identifies an ordinary element/property node or a virtual structural
  node (VSN).
- `$_content` is physically ordered. Except for primitive VSN payloads, its
  entries must be nodes rather than raw primitives.
- `$_attrs` stores HTML-derived attributes and serializable inline style.
- `$_meta` stores exact registered metadata: optional `quid` on ordinary
  elements and required string `index` on `_hson_ii`. Invariant checking
  rejects every other key.

Cycles are invalid. The representation is structurally a rooted ordered tree,
even when application-level handles refer to its nodes from elsewhere.

---

## Virtual structural nodes

The `_hson_` prefix is reserved for hson-live's structural tags. Other leading
underscore names are not reserved by this rule.

### `_hson_root`

The transform root contains zero or one child. A present child must be exactly
one of `_hson_obj`, `_hson_elem`, or `_hson_arr`. Some public facades unwrap a
root/element pair for convenience, but JSON/object/array LiveTrees can retain
the root wrapper. A literal zero-child root satisfies the graph invariant but
has no HSON wire form and therefore fails HSON serialization. A root containing
an empty `_hson_obj` serializes as `<>`.

### `_hson_obj`

Represents a JSON object cluster. Direct children are property nodes. Ordinary
property tags must be unique, must not carry attributes, and cannot be a direct
`_hson_elem` child. Every ordinary property must remain recursively
object-structured through its established scalar, nested-object, or array
value relationship; an empty element-shaped property is not an empty object.
Object property order has no JSON semantic meaning and the JSON serializer
canonicalizes it.

### `_hson_elem`

Represents ordered HTML element content. Its direct children may be
`_hson_str` leaves or ordinary element nodes. Raw primitives, `_hson_val`,
`_hson_obj`, `_hson_arr`, and `_hson_ii` are forbidden directly inside it.
Ordinary descendants must themselves be empty or recursively
element-structured. This restriction keeps untyped HTML text separate from
typed JSON structure.

An empty ordinary element is represented by `$_content: []`. A retained empty
`_hson_elem` is invalid canonical state. Node ingress has one narrow legacy
normalization: when an empty `_hson_elem` is the sole relationship beneath an
ordinary node, it is elided without mutating the caller. Empty `_hson_obj` and
`_hson_arr` nodes remain valid and distinct.

### `_hson_arr` and `_hson_ii`

`_hson_arr` represents a JSON array and may contain only `_hson_ii` children.
Each `_hson_ii`:

- appears directly under `_hson_arr`;
- has exactly one node child;
- has no attributes; and
- carries required canonical decimal string metadata at `index`.

An ordinary array-item object must therefore sit beneath an `_hson_obj` child
of `_hson_ii`; an ordinary node directly beneath `_hson_ii` is invalid.

Wrapper-bearing inputs use `index` as semantic ordering metadata during
admission. The complete sibling set must be the exact strings `"0"` through
`String(wrapperCount - 1)`: no gaps, duplicates, signs, leading zeros,
fractions, exponents, nonnumeric text, or out-of-range values are valid. A
valid physical permutation is sorted by index without mutating caller input.

Canonical graph state then requires physical wrapper order to match semantic
array order and every wrapper index to equal `String(physicalPosition)`.
Serializers follow that canonical physical order and reject noncanonical graph
input rather than repairing it at egress.

### `_hson_str` and `_hson_val`

These are the only nodes allowed to contain raw primitive payloads:

- `_hson_str` contains exactly one string;
- `_hson_val` contains exactly one finite number, boolean, or `null`.

Neither may carry attributes. The distinction preserves JSON primitive types
when values cross an untyped text/markup representation.

---

## Attributes and metadata

Attributes are data attached to an ordinary node; they are not child nodes.
VSNs cannot have attributes. Source parsers may normalize attribute names and
values according to their source format, so source attribute order and exact
spelling are not graph invariants.

HSON presence flags use the canonical string-equals-key representation, for
example `{ disabled: "disabled" }`, and serialize as bare `disabled`. LiveTree
keeps those flags in its separate `flags` namespace. Ordinary `attrs.set`
stores canonical boolean and null values; deletion is explicit through
`attrs.drop`, and `undefined` is rejected.

The graph type continues to permit ordinary string, number, boolean, and null
attribute values for programmatic compatibility; this is not a promise of typed
wire attributes. HSON parsing stores ordinary attribute values as strings, and
canonical HSON serialization quotes every non-flag ordinary value after
`String(...)` conversion. Thus a graph-held `{ count: 2 }` serializes as
`count="2"` and reparses as `{ count: "2" }`. Structured style values retain
their separate existing CSS-string normalization behavior.

Metadata is structural support, not semantic JSON/HTML content. QUID identity
is stored as `$_meta["quid"]`; array index metadata uses
`$_meta["index"]`.

HSON `noQuid` output filters only persisted `quid`. Array indexes are
implicit in textual item order and rebuilt during parsing. Metadata attached
directly to melted structural VSN nodes is not represented on the current HSON
wire; this is a pre-existing limitation rather than a general metadata filter.

---

## Mixed content

HTML mixed content is preserved as physical order within `_hson_elem`, with
text represented by `_hson_str` leaves interleaved with ordinary element
nodes. JSON objects use `_hson_obj`, where duplicate ordinary property names
and keyless text are invalid. These cluster types make the two models explicit
rather than inferring them from a similar-looking child list.

The source format does not permanently own a node kind. Cross-format
serialization can expose structural scaffolding—for example, HTML structure in
JSON or typed JSON structure in HTML—so claims that a VSN can arise from only
one source format are too strong.

---

## Identity

A QUID is optional live identity used by LiveTree for DOM lookup, managed CSS,
and handle continuity. Supplied identity is preserved; absent identity is
assigned lazily where live behavior needs it.
QUIDs are not a universal transform round-trip guarantee:

- valid supplied root and descendant QUIDs are preserved in cold canonical
  graphs after syntax, eligibility, and placement validation;
- duplicate valid values may remain cold, while active LiveTree admission
  claims identity and enforces uniqueness atomically;
- detach, movement, and reattachment preserve QUID identity;
- cloned LiveTree branches receive fresh QUIDs;
- terminal destruction releases active QUID ownership;
- HSON `.noQuid()` filters output only and does not mutate graph identity or
  runtime ownership; and
- transform/canonicalization operations may rebuild or normalize graphs.

Application data should not depend on QUID spelling or persistence outside the
live runtime contract.

---

## Enforced invariants

Current invariant validation enforces, among other rules:

- valid VSN placement and payload cardinality;
- no attributes on VSNs;
- only the exact registered metadata keys on their allowed node kinds;
- one cluster child under `_hson_root`;
- unique ordinary property tags under `_hson_obj`;
- `_hson_ii`-only children under `_hson_arr`; and
- `_hson_str`/ordinary-element-only children under `_hson_elem`.

The useful round-trip promise is semantic equivalence within the target
format: values, relevant structure, and content order survive where the target
can represent them. Exact node-graph identity is not promised across every
cross-format route because serializers intentionally canonicalize and may add
format-bridging VSN structure.

---

## Non-goals

The node model does not enforce application schemas, business rules, CSS/HTML
safety, or source-text fidelity. Sanitization and runtime behavior are separate
layers.

© 2026 terminal_gothic. All rights reserved except as granted under the Public Parity License 7.0
