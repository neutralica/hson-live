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
  $_attrs: HsonAttrs;
  $_meta: HsonMeta;
};
```

All four fields are required by the public type and node factories. Empty
attribute and metadata maps are represented as `{}`; empty content is `[]`.

- `$_tag` identifies an ordinary element/property node or a virtual structural
  node (VSN).
- `$_content` is physically ordered. Except for primitive VSN payloads, its
  entries must be nodes rather than raw primitives.
- `$_attrs` stores HTML-derived attributes and serializable inline style.
- `$_meta` stores internal `data-_*` metadata such as array indexes and QUIDs.
  Invariant checking rejects metadata keys outside that prefix.

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
the root wrapper.

### `_hson_obj`

Represents a JSON object cluster. Direct children are property nodes. Ordinary
property tags must be unique, must not carry attributes, and cannot be a direct
`_hson_elem` child. Object property order has no JSON semantic meaning and the
JSON serializer canonicalizes it.

### `_hson_elem`

Represents ordered HTML element content. Its direct children may be
`_hson_str` leaves or ordinary element nodes. Raw primitives, `_hson_val`,
`_hson_obj`, `_hson_arr`, and `_hson_ii` are forbidden directly inside it.
This restriction keeps untyped HTML text separate from typed JSON structure.

### `_hson_arr` and `_hson_ii`

`_hson_arr` represents a JSON array and may contain only `_hson_ii` children.
Each `_hson_ii`:

- appears directly under `_hson_arr`;
- has exactly one node child;
- has no attributes; and
- carries string metadata at `data-_index`.

Array serialization follows the physical order of `_hson_ii` nodes in
`$_content`. `data-_index` is required and validated, but changing only that
metadata does not reorder the emitted array.

### `_hson_str` and `_hson_val`

These are the only nodes allowed to contain raw primitive payloads:

- `_hson_str` contains exactly one string;
- `_hson_val` contains exactly one non-string primitive: number, boolean, or
  `null`.

Neither may carry attributes. The distinction preserves JSON primitive types
when values cross an untyped text/markup representation.

---

## Attributes and metadata

Attributes are data attached to an ordinary node; they are not child nodes.
VSNs cannot have attributes. Source parsers may normalize attribute names and
values according to their source format, so source attribute order and exact
spelling are not graph invariants.

Boolean presence is represented by a boolean value in `$_attrs`. Through the
LiveTree attribute API, `true` means present and `false`, `null`, or
`undefined` removes the attribute.

Metadata is structural support, not semantic JSON/HTML content. QUID identity
is stored as `$_meta["data-_quid"]`; array index metadata uses
`$_meta["data-_index"]`.

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
and handle continuity. It is assigned lazily where live behavior needs it.
QUIDs are not a universal transform round-trip guarantee:

- plain transform `Element` ingestion strips descendant `data-_quid` values;
  the current LiveTree `Element` constructor does not apply that explicit step;
- cloned LiveTree branches receive fresh QUIDs; and
- transform/canonicalization operations may rebuild or normalize graphs.

Application data should not depend on QUID spelling or persistence outside the
live runtime contract.

---

## Enforced invariants

Current invariant validation enforces, among other rules:

- valid VSN placement and payload cardinality;
- no attributes on VSNs;
- only `data-_*` metadata keys;
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
