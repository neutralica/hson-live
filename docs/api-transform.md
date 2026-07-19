#### hson-live / hson.terminalgothic.com

# hson-live
## Transform API
Updated: 2026-07-13

The transform API is exposed directly on `hson` through the public source
constructors:

```ts
hson.fromUntrustedHtml(input)
hson.fromTrustedHtml(input)
hson.fromJson(input)
hson.fromHson(input)
hson.fromNode(node)
```

There is no public `hson.transform` namespace in the current library.

Every constructor normalizes to a canonical node graph and supports two kinds
of terminal operation:

1. Choose a source format.
2. Call `.toNode()` for the canonical `HsonNode`, or choose an output format.
3. Optionally attach formatting flags to that output.
4. Finalize an output with `serialize()` (or JSON's existing `parse()`).

HSON text has a direct parsing path instead:

```ts
const node = hson.fromHson(source).toNode();
```

The former `.toHson().parse()` graph-access route has been removed. HSON input
can still be canonically reserialized with `.toHson().serialize()`.

Use this API when the goal is serialized HTML, JSON, HSON, or a structured JSON
or HSON value. Use `hson.liveTree.*` when the goal is a mutable `LiveTree`.

---

## Intermediate Model

All supported sources normalize to the same internal graph type:
`HsonNode`.

The current internal node fields are:

```ts
type HsonNode = {
  $_tag: string;
  $_content: (HsonNode | Primitive)[];
  $_attrs: HsonAttrs;
  $_meta: HsonMeta;
};
```

Do not confuse these field names with VSN tag string values. Tags such as
`_hson_root`, `_hson_elem`, `_hson_obj`, `_hson_arr`, `_hson_ii`, `_hson_str`, and `_hson_val` remain tag
values stored in `node.$_tag`.

---

## Source Constructors

### `hson.fromUntrustedHtml(input: string | Element)`

Parses external HTML through the safe HTML path.

- Sanitizes with DOMPurify before node conversion.
- Accepts a string or an existing `Element`.
- If an `Element` is supplied, the current implementation snapshots its
  `innerHTML`.
- Descendant `data-_quid` attributes are stripped during ingestion.
- External SVG markup is rejected on this safe path.

This is the default choice for user-authored or third-party HTML.

### `hson.fromTrustedHtml(input: string | Element)`

Parses trusted HTML through the unsafe/raw HTML path.

- No sanitization is applied.
- Accepts a string or an existing `Element`.
- An `Element` input is also treated as an `innerHTML` snapshot, not as the
  root element itself.
- SVG markup is allowed on this path.

Use only for developer-authored or otherwise trusted markup.

### `hson.fromJson(input: string | JsonValue)`

Parses JSON data into HSON nodes.

- Accepts a JSON string or an already parsed JSON value.
- Does not sanitize.
- Preserves JSON values. Object keys are emitted in sorted canonical order by
  the JSON serializer; source key order is not retained in serialized output.

### `hson.fromHson(input: string)`

Parses HSON text into HSON nodes.

- Does not sanitize.
- `.toNode()` parses and directly returns the canonical `HsonNode`.
- `.toJson()`, `.toHson()`, `.toHtml()`, and `.sanitizeBEWARE()` remain
  available for conversion and canonical reserialization.

### `hson.fromNode(node: HsonNode)`

Starts the transform pipeline from an existing HSON node graph.

- Does not sanitize.
- Does not clone the node.
- Assumes the caller is providing a valid current-shape `HsonNode`.

---

## Output Selection

All transform sources return a common normalized-source surface with:

```ts
.toNode()
.toHtml()
.toJson()
.toHson()
.sanitizeBEWARE()
```

`.toNode()` directly returns the normalized canonical graph. It does not
serialize to HSON and parse that text again. For `fromNode(node)`, it returns
the original graph reference.

### `.toHtml()`

Chooses HTML output.

- `serialize()` returns an HTML string.
- `parse()` is intentionally unavailable and throws.

### `.toJson()`

Chooses JSON output.

- `serialize()` returns a JSON string.
- `parse()` returns a structured `JsonValue`.

JSON roundtrips serialize as plain JSON values, not raw internal HSON node
shapes, except where a node shape is intentionally represented by the format.

### `.toHson()`

Chooses HSON output.

- `serialize()` returns HSON text.
- `parse()` is not exposed; use the source constructor's `.toNode()` terminal.
- HSON text is produced lazily by `serialize()`, after HSON options have been
  accumulated. The source graph is not cloned or mutated.

### `.sanitizeBEWARE()`

Applies HTML-style sanitization after source selection and before output
selection:

```ts
const safeHtml = hson
  .fromNode(node)
  .sanitizeBEWARE()
  .toHtml()
  .serialize();
```

The current implementation serializes the current node graph to HTML, runs that
HTML through the untrusted HTML parser/sanitizer, then continues from the
sanitized node graph.

This should only be used for HSON nodes that semantically encode HTML. It is
lossy for generic JSON/HSON data because DOMPurify will strip markup it does
not recognize.

---

## HSON Serialization Options

After `toHson()`, the API exposes a composable option/finalizer surface:

```ts
.noBreak()
.noQuid()
.withOptions(options)
.serialize()
.parse()
```

The active HSON options are:

```ts
type FrameOptions = {
  noBreak?: boolean;
  noQuid?: boolean;
};
```

Readable, two-space-indented HSON is the default. `noBreak` selects canonical
compact HSON without cosmetic newlines or indentation while retaining
conventional spaces between tag/header/content terms. `noQuid` omits only the
persisted `data-_quid` metadata key. It does not remove `data-_index` or custom
`data-_...` metadata, and it does not alter live identity registration.

Ordinary HSON attributes have string-valued wire semantics in either layout.
The parser accepts both `count=2` and `count="2"` as `{ count: "2" }`, while
canonical serialization emits `count="2"`. Programmatic number, boolean, and
null values are likewise stringified and quoted without mutating the source
graph. Presence flags are the distinct exact-equality form
`{ disabled: "disabled" }` and serialize as bare `disabled`.

Options compose and are idempotent:

```ts
hson.fromNode(node).toHson().noBreak().noQuid().serialize();
hson.fromNode(node).toHson().noQuid().noBreak().serialize();
hson.fromNode(node).toHson().withOptions({ noBreak: true, noQuid: true }).serialize();
```

The former `spaced`, `linted`, and `lineLength` options have been removed.
JSON and HTML serialization remain eager and otherwise unchanged by this HSON
layout work.

---

## Finalizers

### `.serialize()`

Returns a string for the chosen output:

- after `.toHtml()` - HTML string
- after `.toJson()` - JSON string
- after `.toHson()` - HSON string

### `.parse()`

Returns the existing structured JSON projection:

- after `.toJson()` - `JsonValue`
- after `.toHtml()` - throws

HSON output deliberately does not expose `parse()`. Every source constructor
uses `.toNode()` for canonical graph access instead.

HTML parse output is intentionally not exposed from this surface. Use
`serialize()` and hand the resulting string to your chosen integration point.

---

## LiveTree Construction

LiveTree construction is a separate public facade:

```ts
hson.liveTree.fromUntrustedHtml(input)
hson.liveTree.fromTrustedHtml(input)
hson.liveTree.fromJson(input)
hson.liveTree.fromHson(input)
hson.liveTree.fromNode(node)
hson.liveTree.queryDom(selector).graft()
hson.liveTree.queryBody().graft()
hson.liveTree.create.div()
```

The `from*` LiveTree methods return detached branches. The DOM query methods
return a graft handle; calling `.graft()` parses the selected live DOM subtree,
re-projects it as managed LiveTree DOM, and returns the controlling `LiveTree`.

Use `queryDom`, not `queryDOM`, on the public `hson.liveTree` facade.

---

## Security Summary

| Source | Sanitized by default | Intended use |
| --- | --- | --- |
| `fromUntrustedHtml` | yes | external or user-authored HTML |
| `fromTrustedHtml` | no | trusted developer-authored HTML |
| `fromJson` | no | structured data |
| `fromHson` | no | HSON text |
| `fromNode` | no | existing internal graph |
| `sanitizeBEWARE` | yes, after source selection | explicit lossy HTML sanitation |

Sanitization is automatic only for `fromUntrustedHtml`. Other formats are
treated as data unless the caller explicitly opts into the HTML sanitation
escape hatch.

---

## Design Notes

- Transformations normalize through `HsonNode`.
- Transform sources do not mutate the DOM.
- LiveTree construction is explicit and separate.
- HTML `.parse()` is intentionally not available.
- VSN tag values remain in the `_hson_` namespace; internal node fields use the
  `$_` names.
- `fromNode(node).toNode()` returns the same graph reference; it is not a clone
  operation.

A separate `hson-transform.md` overview is not currently necessary. The
pipeline is small, while `hson-syntax.md`, `hson-nodes.md`, `hson-json.md`, and
`hson-html.md` already document the parsers' shared model and format-specific
behavior. This file is the appropriate home for the callable transform chain.

© 2026 terminal_gothic. All rights reserved except as granted under the Public Parity License 7.0
