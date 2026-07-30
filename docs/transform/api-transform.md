#### hson-live / hson.terminalgothic.com

# hson-live
## Transform API
Updated: 2026-07-30

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
4. Finalize with `serialize()`, or JSON's in-memory `value()` terminal.

HSON text has a direct parsing path instead:

```ts
const node = hson.fromHson(source).toNode();
```

Canonical graph access always uses `.toNode()`. HSON input can still be
canonically reserialized with `.toHson().serialize()`.

Use this API when the goal is serialized HTML, JSON, HSON, or a structured JSON
or HSON value. Use `hson.liveTree.*` when the goal is a mutable `LiveTree`.

---

## Normalized HSON String

`hson.string(source)` parses HSON source and returns its normalized official
serialization as an `HsonString`:

```ts
import { hson } from "hson-live";
import type { HsonString } from "hson-live/transform";

const normalized: HsonString = hson.string(
  `<p "first"<em "middle"/>"last"/>`,
);
```

The equivalent named producer is exported as `hsonString(source)` from both
`hson-live` and `hson-live/transform`. `hson.string` references that same
function. The named Transform export imports only the HSON parser, serializer,
and their required canonical graph boundaries; it does not initialize browser,
LiveTree, LiveMap, or LiveHost surfaces.

The returned spelling may differ from the source because the method reparses
the source into canonical `HsonNode` state and serializes that graph with the
default HSON options. It does not preserve original formatting, whitespace,
line breaks, quoting, shorthand, comments, or other source-level spelling.
Invalid input throws the existing parser, normalization, or invariant error.

The result is a TypeScript-branded primitive string, not a security,
authentication, sanitization, or trust check. The compile-time brand is
normally lost across untyped transport or storage. A receiver should treat
transported text as `string`; it may pass that text through `hson.string()`
again when it needs a branded, normalized value.

`hson.string()` always reparses and serializes, including when its argument is
already an `HsonString`. It exposes no formatting options and uses default
serializer behavior, including QUID preservation.

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

- Applies source-aware duplicate/reserved-name checks, sanitizes unsafe markup
  behavior with DOMPurify, then performs canonical node conversion.
- Accepts a string or an existing `Element`.
- If an `Element` is supplied, the current implementation snapshots its
  `innerHTML`.
- Syntactic `hson:*` candidates remain observable after sanitization and are
  admitted or rejected by the same metadata registry used for trusted input.
- A valid descendant `hson:quid` is preserved as graph identity. Malformed,
  unknown, misplaced, or duplicate metadata rejects rather than disappearing.
- `data-*` remains application-owned and is never reinterpreted as HSON
  metadata.
- External SVG markup is rejected on this safe path.

This is the default choice for user-authored or third-party HTML.
QUID identity is not trust, authorization, authentication, or execution
capability. Existing live-graph uniqueness and ownership checks still apply
when a cold parsed graph becomes active.

### `hson.fromTrustedHtml(input: string | Element)`

Parses trusted HTML through the unsafe/raw HTML path.

- No sanitization is applied.
- Accepts a string or an existing `Element`.
- An `Element` input is also treated as an `innerHTML` snapshot, not as the
  root element itself.
- SVG markup is allowed on this path.

For raw HTML strings, ordinary attribute names compare case-insensitively for
duplicate detection. The last ordinary value wins, repeated `class`
declarations merge unique tokens in encounter order, and duplicate `hson:*`
metadata declarations reject. Canonical-valid colonized ordinary names are
carried reversibly through the XML-backed browser parser and admitted under
their original semantic name. Invalid names and authored private parser-transit
names reject. `data--attrmap`, like every `data-*` spelling, is ordinary
application data.

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
- No in-memory HTML parse terminal is exposed.

### `.toJson()`

Chooses JSON output.

- `serialize()` returns a JSON string.
- `value()` returns a detached in-memory `JsonValue` projection directly,
  without a textual serialization/parse round trip.

JSON roundtrips serialize as plain JSON values, not raw internal HSON node
shapes, except where a node shape is intentionally represented by the format.

### `.toHson()`

Chooses HSON output.

- `serialize()` returns `HsonString`, a primitive HSON string.
- Use the source constructor's `.toNode()` terminal for the canonical graph.
- HSON text is produced lazily by `serialize()`, after HSON options have been
  accumulated. The source graph is not cloned or mutated.

### `HsonString`

`HsonString` is a TypeScript-only branded primitive string returned by official
HSON serialization APIs. Import it as a type from `hson-live/transform`.

It is assignable to `string`, but an arbitrary `string` is not assignable to
`HsonString`. The brand records compile-time producer provenance only: it adds
no runtime marker, wrapper, prefix, property, or other change to the serialized
text. It is not a security, trust, validation-token, sanitization,
authentication, or cryptographic guarantee.

Transport and persistence boundaries such as HTTP, WebSocket, JSON, storage,
environment variables, process boundaries, and third-party APIs typed as plain
strings normally erase the brand. Receivers accept transported HSON text as an
ordinary `string` and parse it normally. Parsing arbitrary text produces
canonical `HsonNode` graph state after success; it does not brand the input
text.

Readable, compact (`noBreak`), and `noQuid` HSON serialization all return
`HsonString`. The type does not imply that those options produce identical
bytes, preserve source spelling, whitespace, quoting, comments, or formatting,
or preserve JavaScript object identity for shared references. Graph carriers
outside the serializable HSON-text domain, including an empty `_hson_root`,
remain rejected and therefore do not produce an `HsonString`.

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
persisted `quid` metadata key and does not alter live identity
registration. `index` is the separate operational field on `_hson_ii`.
Every `data-*` spelling is an ordinary application attribute.

Ordinary HSON attributes have string-valued wire semantics in either layout.
The parser accepts both `count=2` and `count="2"` as `{ count: "2" }`, while
canonical serialization emits `count="2"`. Programmatic number, boolean, and
null values are likewise stringified and quoted without mutating the source
graph. Presence flags are the distinct exact-equality form
`{ disabled: "disabled" }` and serialize as bare `disabled`.

### Persisted QUID declarations

HSON has one identity-specific header declaration: `@quid`. It maps only to
canonical `$_meta["quid"]`; it is neither HTML `id`, a selector, nor a
request to generate identity. Persisted QUIDs are random 80-bit identifiers:
exactly 16 lowercase Base32 characters from
`0123456789abcdefghjkmnpqrstvwxyz`. They are generated from 10 secure random
bytes; there is no normalization, fallback format, quoted form, or `@@` form.

```hson
<panel @4k7m2v9d1r6x8qwc class="settings" "Content"/>
```

Parsing accepts one declaration anywhere in an opening header before inline
content; serialization is canonical and writes it immediately after the tag.
`@` after content and duplicate declarations are errors. Attribute tokens,
including `data-_quid`, are ordinary HSON attributes and never metadata. Only
ordinary elements may carry persisted identity, and duplicate values across a
document remain a LiveMap graph-invariant error. HTML and SVG use
`hson:quid`.

Options compose and are idempotent:

```ts
hson.fromNode(node).toHson().noBreak().noQuid().serialize();
hson.fromNode(node).toHson().noQuid().noBreak().serialize();
hson.fromNode(node).toHson().withOptions({ noBreak: true, noQuid: true }).serialize();
```

The former `spaced`, `linted`, and `lineLength` options have been removed.
`.toJson()` materializes the in-memory projection once; `value()` returns that
projection and `serialize()` stringifies it. HTML output behavior is unchanged.

---

## Finalizers

### `.serialize()`

Returns a string for the chosen output:

- after `.toHtml()` - HTML string
- after `.toJson()` - JSON string
- after `.toHson()` - `HsonString`

### `.value()`

Returns the in-memory JSON projection:

- after `.toJson()` - `JsonValue`

The terminal vocabulary is deliberately explicit:

```ts
source.toNode()                 // canonical HsonNode
source.toJson().value()         // in-memory JsonValue
source.toJson().serialize()     // JSON text
source.toHson().serialize()     // HSON text
source.toHtml().serialize()     // HTML text
```

Public output finalizers do not expose `parse()`.

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
- Public output finalizers expose no `.parse()` terminal.
- VSN tag values remain in the `_hson_` namespace; internal node fields use the
  `$_` names.
- `fromNode(node).toNode()` returns the same graph reference; it is not a clone
  operation.

A separate `hson-transform.md` overview is not currently necessary. The
pipeline is small, while `hson-syntax.md`, `hson-nodes.md`, `hson-json.md`, and
`hson-html.md` already document the parsers' shared model and format-specific
behavior. This file is the appropriate home for the callable transform chain.

© 2026 terminal_gothic. All rights reserved except as granted under the Public Parity License 7.0
