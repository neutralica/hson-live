#### hson-live / hson.terminalgothic.com

# hson-live
## Transform API
Updated: 2026-07-31

Transform source constructors remain exposed directly on `hson`:

```ts
hson.fromUntrustedHtml(input)
hson.fromTrustedHtml(input)
hson.fromJson(input)
hson.fromHson(input)
hson.fromNode(node)
```

Candidate normalization and admission are organized on the existing Transform
namespace:

```ts
hson.transform.string(source)
hson.transform.number(candidate)
hson.transform.calc(() => calculation())
```

The same leaf implementations are available as the named exports `hsonString`,
`hsonNumber`, and `hsonCalc`.

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

`hson.transform.string(source)` parses HSON source and returns its normalized official
serialization as an `HsonString`:

```ts
import { hson } from "hson-live";
import type { HsonString } from "hson-live/transform";

const normalized: HsonString = hson.transform.string(
  `<p "first"<em "middle"/>"last"/>`,
);
```

The equivalent named producer is exported as `hsonString(source)` from both
`hson-live` and `hson-live/transform`. `hson.transform.string` references that same
function. The named Transform export imports only the HSON parser, serializer,
and their required canonical graph boundaries; it does not initialize browser,
LiveTree, LiveMap, or LiveHost surfaces.

The returned spelling may differ from the source because the method reparses
the source into canonical `HsonNode` state and serializes that graph with the
default HSON options. It does not preserve original formatting, whitespace,
line breaks, quoting, shorthand, comments, or other source-level spelling.
Invalid input throws the existing parser, normalization, or invariant error.
Internally the function parses one `_hson_root`, detaches its exact one semantic
child, serializes that non-root node, and applies the `HsonString` brand only
after successful serialization.

The result is a TypeScript-branded primitive string, not a security,
authentication, sanitization, or trust check. The compile-time brand is
normally lost across untyped transport or storage. A receiver should treat
transported text as `string`; it may pass that text through `hson.transform.string()`
again when it needs a branded, normalized value.

`hson.transform.string()` always reparses and serializes, including when its argument is
already an `HsonString`. It exposes no formatting options and uses default
serializer behavior, including QUID preservation.

---

## Numeric admission

`hson.transform.number(candidate)` and the equivalent named export
`hsonNumber(candidate)` admit unknown values to the universal HSON numeric
domain. They require a primitive, finite JavaScript number, perform no
coercion, preserve negative zero, and return `HsonNumber`:

```ts
import { hson } from "hson-live";
import { hsonNumber, type HsonNumber } from "hson-live/number";

const count: HsonNumber = hsonNumber(42);
const negativeZero: HsonNumber = hson.transform.number(-0);
```

`HsonNumber` is compile-time proof of completed universal numeric admission.
At runtime it is an ordinary JavaScript number with no wrapper or brand
metadata. It does not prove mathematical correctness, integer status,
positivity, or a schema-specific range. Serialization and transport carry an
ordinary number and erase the proof; decoded data must pass through numeric
admission again.

`hson.transform.calc(calculate)` and the equivalent named export `hsonCalc(calculate)`
execute one synchronous callback exactly once and pass only its returned result
through `hsonNumber`. They do not validate intermediate arithmetic or claim
that a calculation is correct. Callback failures propagate unchanged. A
Promise result is not awaited and is rejected as an object rather than a
number.

```ts
import { hsonCalc, type HsonNumber } from "hson-live/number";

const total: HsonNumber = hsonCalc(() => 6 * 7);
```

Use `hson-live/number` when dependency weight matters. That entrypoint reaches
only the numeric leaf implementation and portable structured-error support; it
does not import the full `hson` or Transform facades. The root and Transform
barrels also re-export the same function objects for namespace and established
entrypoint parity.

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
- A supplied `Element` is the source root. The canonical graph includes that
  element itself, its attributes and metadata, and its descendants.
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
- A supplied `Element` is the source root, not an `innerHTML` snapshot.
- SVG markup is allowed on this path.

String and Element inputs that represent the same element normalize to
canonically equal graphs. An Element has already crossed a lossy DOM boundary:
duplicate source attributes may have collapsed, HTML casing is normalized,
namespace information is whatever the DOM exposes, and original quoting,
whitespace, and lexical spelling cannot be recovered. Direct trusted Element
parsing does not stringify and reparse the Element. The untrusted browser path
may serialize the complete source root only to cross the DOMPurify security
boundary before canonical parsing.

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
- Detaches caller-owned records and arrays before normalization. Parsing never
  mutates the supplied value or retains mutable aliases into canonical graph
  state.
- Metadata on an explicit `_hson_root` is invalid and rejects; it is not
  ignored or filtered. An empty runtime `_hson_root` remains a separate
  runtime-carrier exception outside direct HSON-text serialization.
- JSON string ingress preserves textual property sequence, including
  integer-index property names, before constructing canonical `_hson_obj`
  content.
- JSON string ingress rejects duplicate decoded property names with
  `HSON_JSON_DUPLICATE_PROPERTY` before an earlier declaration can be
  overwritten. Primary and first-declaration source evidence remain
  structured.
- Already-parsed JavaScript objects admit the enumeration order the supplied
  runtime value exposes. They cannot recover textual order or overwritten
  duplicate declarations discarded before this API received the value.

### `hson.fromHson(input: string)`

Parses HSON text into HSON nodes.

- Does not sanitize.
- The parser internally creates one `_hson_root` attachment carrier.
- `.toNode()` returns exactly its one semantic child and never returns
  `_hson_root`. Meaningful `_hson_elem`, `_hson_obj`, `_hson_arr`, `_hson_str`,
  and `_hson_val` nodes remain intact.
- Bare quoted strings, finite numbers, booleans, and `null` are complete HSON
  values. Empty, whitespace-only, and comment-only source rejects.
- `.toJson()`, `.toHson()`, `.toHtml()`, and `.sanitizeBEWARE()` remain
  available for conversion and canonical reserialization.

### `hson.fromNode(node: HsonNode)`

Starts the transform pipeline from an existing HSON node graph.

- Does not sanitize.
- Normalizes permissive graph spellings without mutating the caller. If no
  normalization is needed the original graph reference is retained.
- Treats the supplied node as a detached semantic value: an unowned
  scalar-only `_hson_obj` or `_hson_elem` carrier collapses to its scalar,
  while owned carriers and arrays remain structural.

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
serialize to HSON and parse that text again. `fromNode(node)` returns the
admitted graph, which remains the original reference when normalization made
no change. HSON source is the specific exception at the attachment boundary:
its cached frame stores and repeatedly returns the exact detached semantic
child of the internal parser root.

### `.toHtml()`

Chooses HTML output.

- `serialize()` returns an HTML string.
- No in-memory HTML parse terminal is exposed.
- Serializer-owned reserved carriers are emitted only where the HTML wire
  needs them to preserve object/element mode, detached scalars, or exact text
  item boundaries. Reserved tags are lowered before ordinary element parsing.
- Detached typed scalars use `_hson_obj → _hson_val`; `_hson_elem` may detach
  only an `_hson_str` text leaf and never admits `_hson_val` content.

### `.toJson()`

Chooses JSON output.

- `serialize()` returns a JSON string.
- `value()` returns a detached in-memory `JsonValue` projection directly,
  without a textual serialization/parse round trip.
- JSON text emission uses `-0` for negative zero; `value()` retains the same
  runtime identity.
- `serialize()` emits object properties directly from canonical `_hson_obj`
  content order. It does not route integer-like keys through ordinary object
  enumeration or sort them.

JSON roundtrips serialize as plain JSON values, not raw internal HSON node
shapes, except where a node shape is intentionally represented by the format.

### `.toHson()`

Chooses HSON output.

- `serialize()` returns `HsonString`, a primitive HSON string.
- Use the source constructor's `.toNode()` terminal for the canonical graph.
- HSON text is produced lazily by `serialize()`, after HSON options have been
  accumulated. The source graph is not cloned or mutated.
- Every admitted HSON-serializable semantic value is emitted without literal structural
  VSN names, raw metadata containers, or array-index metadata. Parsing that
  output, detaching the parser root, and comparing canonically reconstructs the
  original graph. Object-member metadata is outside this domain and rejects.
  `noQuid()` applies the same rule after removing only eligible element QUID
  metadata from the expected projection; it cannot legalize object metadata.
- Direct `serialize_hson(node)` and `hson.fromNode(node).toHson().serialize()`
  use the same canonical serializer. `noBreak` changes layout only.
- Direct or fluent HSON serialization of any caller-supplied `_hson_root`
  rejects before layout and QUID options. Parser-owned JSON/HTML roots and the
  HSON parser root are explicitly detached by their source pipeline first.
- `fromNode()` treats its input as a detached semantic value. Redundant detached
  scalar `_hson_obj`/`_hson_elem` carriers normalize to their scalar before
  output, while owned object-member carriers, element text clusters, and arrays
  remain intact. Direct serialization rejects a detached carrier that bypassed
  admission.

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
outside the serializable HSON-text domain, including every empty or populated
`_hson_root`, remain rejected and therefore do not produce an `HsonString`.

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
The selected Element itself is the graft root.

Use `queryDom`, not `queryDOM`, on the public `hson.liveTree` facade.

The lower-level Transform `queryDOM(selector)` and `queryBody()` methods are
intentionally child/body snapshot operations: they parse the selected
element's `innerHTML`. They are distinct from direct `fromHtml(Element)` and
from LiveTree grafting.

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
