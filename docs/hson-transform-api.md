#### hson-live / hson.terminalgothic.com

# hson-live
## Transform API

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

These constructors build a deterministic conversion pipeline:

1. Choose a source format.
2. Choose an output format.
3. Optionally attach formatting flags.
4. Finalize with `serialize()` or `parse()`.

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
  $_attrs?: HsonAttrs;
  $_meta?: HsonMeta;
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
- External SVG markup is rejected on this safe path.

This is the default choice for user-authored or third-party HTML.

### `hson.fromTrustedHtml(input: string | Element)`

Parses trusted HTML through the unsafe/raw HTML path.

- No sanitization is applied.
- Accepts a string or an existing `Element`.
- SVG markup is allowed on this path.

Use only for developer-authored or otherwise trusted markup.

### `hson.fromJson(input: string | JsonValue)`

Parses JSON data into HSON nodes.

- Accepts a JSON string or an already parsed JSON value.
- Does not sanitize.
- Preserves JSON object, array, primitive, and ordering semantics.

### `hson.fromHson(input: string)`

Parses HSON text into HSON nodes.

- Does not sanitize.
- Returns the same output-selection builder as the other transform sources.

### `hson.fromNode(node: HsonNode)`

Starts the transform pipeline from an existing HSON node graph.

- Does not sanitize.
- Does not clone the node.
- Assumes the caller is providing a valid current-shape `HsonNode`.

---

## Output Selection

Every transform source returns an output builder with:

```ts
.toHtml()
.toJson()
.toHson()
.sanitizeBEWARE()
```

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
- `parse()` returns the current `HsonNode` graph.

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

## Optional Formatting Surface

After `toHtml()`, `toJson()`, or `toHson()`, the API exposes:

```ts
.spaced()
.noBreak()
.withOptions(options)
```

These methods attach `FrameOptions`:

```ts
type FrameOptions = {
  spaced?: boolean;
  lineLength?: number;
  linted?: boolean;
  noBreak?: boolean;
};
```

Current limitation: these methods are part of the public chain, but current
serializers do not consistently re-materialize output from those flags. Treat
them as reserved/partial formatting controls unless a serializer explicitly
documents support for a specific option.

---

## Finalizers

### `.serialize()`

Returns a string for the chosen output:

- after `.toHtml()` - HTML string
- after `.toJson()` - JSON string
- after `.toHson()` - HSON string

### `.parse()`

Returns a structured value for data formats:

- after `.toJson()` - `JsonValue`
- after `.toHson()` - `HsonNode`
- after `.toHtml()` - throws

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
- VSN tag values remain in the `_-` namespace; internal node fields use the
  `$_` names.

© 2026 terminal_gothic. All rights reserved except as granted under the Public Parity License 7.0
