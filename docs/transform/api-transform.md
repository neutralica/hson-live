
#### hson-live / hson.terminalgothic.com

# hson-live
## Transform API



The `hson.transform` namespace is also exported as `hsonTransform`.

```ts
hson.fromUntrustedHtml(input)   // destructive sanitization applied
hson.fromTrustedHtml(input)     // accepted and parsed as-is
hson.fromJson(input)
hson.fromHson(input)
hson.fromNode(node)             // accepts HsonNodes (in JSON)
```

`hson.transform` exposes synchronous numeric admission through `calc`.

```ts
hson.transform.calc(number): HsonNumber
hson.transform.calc(() => number): HsonNumber
```

The same numeric operation is exported as `hsonCalc`. Runtime authored-HSON text is admitted by `fromHson`.

Every constructor method parses and normalizes input to HSON's canonical node graph.

## HsonCanonical

`` hson`...` `` authors canonical HSON inline. Literal template segments are HSON source;
primitive substitutions are encoded according to their JavaScript types before
the completed HSON is validated and canonicalized.

```ts
import { hson } from "hson-live";
import type { HsonCanonical } from "hson-live/transform";

const authored: HsonCanonical = hson`
  <p "first"<em "middle"/>"last"/>
`;
```

The public visual grammar is deliberately small:

```text
hson`...`    author canonical HSON
hson.*       access hson-live subsystems
hson(...)    unsupported
```

Literal source and interpolated JavaScript data remain distinct:

```ts
hson`37`          // authored HSON number
hson`"37"`        // authored HSON string
hson`<foo/>`      // authored HSON element

hson`${37}`       // JavaScript number -> HSON number
hson`${"37"}`     // JavaScript string -> HSON string
hson`${true}`     // JavaScript boolean -> HSON boolean
```

The supported substitution values are primitive JavaScript `string`, `number`,
`boolean`, and `null`. Strings always become HSON string data; finite numbers
retain the numeric policy (including `-0`); booleans and null become their HSON
literals. Arrays, objects, nodes, functions, `undefined`, bigint, and symbols
reject rather than stringify or splice source.

There is no parse-success fallback and no structural/source interpolation.

Raw template segments keep HSON in charge of escapes. The complete reconstructed
source passes through the same parser, exact root detachment, canonical graph
admission, default serializer, and `HsonCanonical` branding path.

Runtime `TemplateStringsArray.raw` must not be treated as a byte-for-byte copy of the host file. In particular, JavaScript normalizes physical CRLF template line terminators to LF. Static diagnostics that need original-file offsets must map against the original host source text rather than this runtime string.

The returned spelling may differ from the source because the method reparses the source into canonical `HsonNode` state and serializes that graph with the default HSON options. It does not preserve original formatting, whitespace, line breaks, quoting, shorthand, comments, or other source-level spelling. Invalid input throws the existing parser, normalization, or invariant error. Internally the function parses one `_hson_root`, detaches its exact one semantic child, serializes that non-root node, and applies the `HsonCanonical` brand only after successful serialization.

The return is an `HsonCanonical`, a TypeScript-branded primitive string. It does not imply sanitization, authentication, or trust. The compile-time brand is lost across untyped transport or storage.

Runtime text containing arbitrary authored HSON is a separate operation:

```ts
const source: string = getTextAtRuntime();
const canonical: HsonCanonical = hson
  .fromHson(source)
  .toHson()
  .serialize();
```

Use `.toNode()` when validation is needed without serialized output. `fromHson`
truthfully owns runtime source admission; interpolation would encode `source` as
HSON string data.

HSON string values use double quotes. Single quotes delimit authored HSON names;
they are not an alternate string-value spelling. JavaScript double quotes,
single quotes delimit authored names rather than string values.

---

## Numeric admission

`hson.transform.calc(value)` and the equivalent named export `hsonCalc(value)`
admit either an already-computed number or one synchronous calculation. Both
paths require a primitive finite number, perform no coercion, preserve negative
zero, and return `HsonNumber`:

```ts
import { hson } from "hson-live";
import { hsonCalc, type HsonNumber } from "hson-live/number";

const count: HsonNumber = hsonCalc(42);
const negativeZero: HsonNumber = hson.transform.calc(-0);
const total: HsonNumber = hsonCalc(() => 6 * 7);
```

`HsonNumber` is compile-time proof of completed universal numeric admission. At runtime it is an ordinary JavaScript number with no wrapper or brand metadata. It does not prove mathematical correctness, integer status, positivity, or a schema-specific range. Serialization and transport carry an ordinary number and erase the proof; decoded data must pass through numeric admission again.

The callback form executes exactly once with no arguments. Callback failures
propagate unchanged. A Promise result is not awaited and is rejected as a
non-number. `calc` validates the result; it does not claim mathematical or
schema-specific correctness.

Use `hson-live/number` when dependency weight matters. That entrypoint reaches only the numeric leaf implementation and portable structured-error support; it does not import the full `hson` or Transform facades. The root and Transform barrels also re-export the same function objects for namespace and established entrypoint parity.

---

## HsonNodes - the Intermediate Model

All supported sources parse to `HsonNode`, HSON's graph type.

```ts
type HsonNode = {
  $_tag: string;
  $_content: (HsonNode | Primitive)[];
  $_attrs: HsonAttrs;
  $_meta: HsonMeta;
};
```

## Step 1: Source Constructor

### `hson.fromUntrustedHtml(input: string | Element)`

Parses external HTML through the safe HTML path.

- Applies source-aware duplicate/reserved-name checks, sanitizes unsafe markup   behavior with DOMPurify, then performs canonical node conversion.
- Accepts a string or an existing `Element`.
- A supplied `Element` is the source root. The canonical graph includes that   element itself, its attributes and metadata, and its descendants.
- Syntactic `hson:*` candidates remain observable after sanitization and are   admitted or rejected by the same metadata registry used for trusted input.
- A valid descendant `hson:quid` is preserved as graph identity. Malformed,   unknown, misplaced, or duplicate metadata rejects rather than disappearing.
- `data-*` remains application-owned and is never reinterpreted as HSON   metadata.
- External SVG markup is rejected on this safe path.

This is the default choice for user-authored or third-party HTML. QUID identity is not trust, authorization, authentication, or execution capability. Existing live-graph uniqueness and ownership checks still apply when a cold parsed graph becomes active.

### `hson.fromTrustedHtml(input: string | Element)`

Parses trusted raw HTML. Use only for developer-authored or otherwise trusted markup.

- Accepts a string or an existing `Element`.

- No sanitization is applied.
- A supplied `Element` is the source root, not an `innerHTML` snapshot.
- SVG markup is allowed on this path.

Normalization is lossy: duplicate attributes may be collapsed, HTML casing normalized, and original quote symbols, whitespace, and lexical spelling cannot be recovered. Trusted Elements are parsed directly. String and Element inputs that represent the same element normalize to canonically equal graphs.

For raw HTML strings, ordinary attribute names compare case-insensitively for duplicate detection; the last ordinary value wins. Duplicate `hson:*` metadata declarations reject.

Repeated `class` declarations merge unique tokens in the order encountered. Canonical-valid colonized ordinary names are carried reversibly through the XML-backed browser parser and admitted under their original semantic name. Invalid names and authored private parser-transit names reject. 

### `hson.fromJson(input: string | JsonValue)`

Parses JSON data into HSON nodes.

- Accepts a JSON string or a parsed JSON value.
- Does not sanitize.
- Detaches caller-owned records and arrays before normalization. Parsing never   mutates the supplied value or retains mutable aliases into canonical graph   state.
- Metadata on an explicit `_hson_root` is invalid and rejects; it is not   ignored or filtered. An empty runtime `_hson_root` remains a separate   runtime-carrier exception outside direct HSON-text serialization.
- JSON string ingress preserves textual property sequence, including   integer-index property names, before constructing canonical `_hson_obj`   content.
- JSON string ingress rejects duplicate decoded property names with   `HSON_JSON_DUPLICATE_PROPERTY` before an earlier declaration can be   overwritten. Primary and first-declaration source evidence remain   structured.
- Already-parsed JavaScript objects admit the enumeration order the supplied   runtime value exposes. They cannot recover textual order or overwritten   duplicate declarations discarded before this API received the value.

### `hson.fromHson(input: string)`

```ts
const source = `
<
  unquotedName ""
  'ordinary quoted name' "value"
>
`;

const node = hson.fromHson(source).toNode();
```

Parses HSON text into HsonNodes.

- Does not sanitize.
- `.toNode()` returns exactly its one semantic child and never returns   `_hson_root`. Meaningful `_hson_elem`, `_hson_obj`, `_hson_arr`, `_hson_str`,   and `_hson_val` nodes remain intact.
- Bare quoted strings, finite numbers, booleans, and `null` are valid HSON values. 
- HSON serializes numeric values unquoted and use JSON number syntax and admit only finite   JavaScript numbers: a leading plus is forbidden, while an exponent plus is allowed (for example, `1e+3`). 
### `hson.fromNode(node: HsonNode)`

Parses and validates an external HsonNode graph .

- Does not sanitize.

---

## Step 2: Output Constructor

All transform source constructors return a common surface:

```ts
.toHtml()           // returns an HTML string
.toJson()           // returns a JSON object or string
.toHson()           // returns an HSON string
.toNode()           // returns the underlying HsonNode graph (in JSON)
.sanitizeBEWARE()   // destructive sanitizer for external non-HTML input
```

### `.toHtml()`

Selects HTML output.

- `serialize()` returns an HTML string.
- No in-memory HTML parse terminal is exposed.

### `.toJson()`

Selects JSON output.

- `serialize()` returns a JSON string with key order canonicalized
- `value()` returns an in-memory `JsonValue` directly

The raw HsonNode data type is also represented in JSON. Serialized keys beginning with the reserved prefix`$_` indicate raw HsonNode data, serialized via `toNode()` rather than `toJson()`

### `.toHson()`

Selects HSON output.

- `serialize()` returns `HsonCanonical`, a primitive HSON string.
- Use the source constructor's `.toNode()` terminal for the canonical graph.
- HSON text is produced lazily by `serialize()`, after HSON options have been   accumulated. The source graph is not cloned or mutated.
- Every admitted HSON-serializable semantic value is emitted without literal structural   VSN names, raw metadata containers, or array-index metadata. Parsing that   output, detaching the parser root, and comparing canonically reconstructs the   original graph. Object-member metadata is outside this domain and rejects.   `noQuid()` applies the same rule after removing only eligible element QUID   metadata from the expected projection; it cannot legalize object metadata.
- Direct `serialize_hson(node)` and `hson.fromNode(node).toHson().serialize()`   use the same canonical serializer. `noBreak` changes layout only.
- Canonical names use the established preferred bare grammar where possible.   Names requiring quoting use apostrophe delimiters, escape apostrophes as   `\'`, and treat backticks as ordinary data. Canonical HSON never emits a   backtick-delimited name.
- Direct or fluent HSON serialization of any caller-supplied `_hson_root`   rejects before layout and QUID options. Parser-owned JSON/HTML roots and the   HSON parser root are explicitly detached by their source pipeline first.
- `fromNode()` treats its input as a detached semantic value. Redundant detached   scalar `_hson_obj`/`_hson_elem` carriers normalize to their scalar before   output, while owned object-member carriers, element text clusters, and arrays   remain intact. Direct serialization rejects a detached carrier that bypassed   admission.

### `HsonCanonical`

`HsonCanonical` is a TypeScript-only branded primitive string returned by official HSON serialization APIs. Import it as a type from `hson-live/transform`.

It is assignable to `string`, but an arbitrary `string` is not assignable to `HsonCanonical`. The brand records compile-time producer provenance only: it adds no runtime marker, wrapper, prefix, property, or other change to the serialized text. It is not a security, trust, validation-token, sanitization, authentication, or cryptographic guarantee.

Transport and persistence boundaries such as HTTP, WebSocket, JSON, storage, environment variables, process boundaries, and third-party APIs typed as plain strings normally erase the brand. Receivers accept transported HSON text as an ordinary `string` and parse it normally. Parsing arbitrary text produces canonical `HsonNode` graph state after success; it does not brand the input text.

Readable, compact (`noBreak`), and `noQuid` HSON serialization all return `HsonCanonical`. The type does not imply that those options produce identical bytes, preserve source spelling, whitespace, quoting, comments, or formatting, or preserve JavaScript object identity for shared references. Graph carriers outside the serializable HSON-text domain, including every empty or populated `_hson_root`, remain rejected and therefore do not produce an `HsonCanonical`.

### `.sanitizeBEWARE()`

Applies HTML-style sanitization after source selection and before output selection:

```ts
const safeHtml = hson
  .fromNode(node)
  .sanitizeBEWARE()
  .toHtml()
  .serialize();
```

The current implementation serializes the current node graph to HTML, runs that HTML through the untrusted HTML parser/sanitizer, then continues from the sanitized node graph.

This should only be used for HSON nodes that semantically encode HTML. It is lossy for generic JSON/HSON data because DOMPurify will strip markup it does not recognize.

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

Readable, two-space-indented HSON is the default. `noBreak` selects canonical compact HSON without cosmetic newlines or indentation while retaining conventional spaces between tag/header/content terms. `noQuid` omits only the persisted `quid` metadata key and does not alter live identity registration. `index` is the separate operational field on `_hson_ii`. Every `data-*` spelling is an ordinary application attribute.

Ordinary HSON attributes have string-valued wire semantics in either layout. The parser accepts both `count=2` and `count="2"` as `{ count: "2" }`, while canonical serialization emits `count="2"`. Programmatic number, boolean, and null values are likewise stringified and quoted without mutating the source graph. Presence flags are the distinct exact-equality form `{ disabled: "disabled" }` and serialize as bare `disabled`.

### Persisted QUID declarations

HSON has one identity-specific header declaration: `@quid`. It maps only to canonical `$_meta["quid"]`; it is neither HTML `id`, a selector, nor a request to generate identity. Persisted QUIDs are random 45-bit identifiers: exactly 9 lowercase Base32 characters from `0123456789abcdefghjkmnpqrstvwxyz`. They are generated from the first 45 bits of 6 secure random bytes; there is no normalization, legacy-width admission, fallback format, quoted form, or `@@` form.

```hson
<panel @d1r6x8qwc class="settings" "Content"/>
```

Parsing accepts one declaration anywhere in an opening header before inline content; serialization is canonical and writes it immediately after the tag. `@` after content and duplicate declarations are errors. Attribute tokens, including `data-_quid`, are ordinary HSON attributes and never metadata. Only ordinary elements may carry persisted identity, and duplicate values across a document remain a LiveMap graph-invariant error. HTML and SVG use `hson:quid`.

Options compose and are idempotent:

```ts
hson.fromNode(node).toHson().noBreak().noQuid().serialize();
hson.fromNode(node).toHson().noQuid().noBreak().serialize();
hson.fromNode(node).toHson().withOptions({ noBreak: true, noQuid: true }).serialize();
```

The former `spaced`, `linted`, and `lineLength` options have been removed. `.toJson()` materializes the in-memory projection once; `value()` returns that projection and `serialize()` stringifies it. HTML output behavior is unchanged.

---

## Finalizers

### `.serialize()`

Returns a string for the chosen output:

- after `.toHtml()` - HTML string
- after `.toJson()` - JSON string
- after `.toHson()` - `HsonCanonical`

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

The `from*` LiveTree methods return detached branches. The DOM query methods return a graft handle; calling `.graft()` parses the selected live DOM subtree, re-projects it as managed LiveTree DOM, and returns the controlling `LiveTree`. The selected Element itself is the graft root.

Use `queryDom`, not `queryDOM`, on the public `hson.liveTree` facade.

The lower-level Transform `queryDOM(selector)` and `queryBody()` methods are intentionally child/body snapshot operations: they parse the selected element's `innerHTML`. They are distinct from direct `fromHtml(Element)` and from LiveTree grafting.

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

Sanitization is automatic only for `fromUntrustedHtml`. Other formats are treated as data unless the caller explicitly opts into the HTML sanitation escape hatch.

---

## Design Notes

- Transformations normalize through `HsonNode`.
- Transform sources do not mutate the DOM.
- LiveTree construction is explicit and separate.
- Public output finalizers expose no `.parse()` terminal.
- VSN tag values remain in the `_hson_` namespace; internal node fields use the   `$_` names.
- `fromNode(node).toNode()` returns the same graph reference; it is not a clone   operation.

A separate `hson-transform.md` overview is not currently necessary. The pipeline is small, while `hson-syntax.md`, `hson-nodes.md`, `hson-json.md`, and `hson-html.md` already document the parsers' shared model and format-specific behavior. This file is the appropriate home for the callable transform chain.

© 2026 terminal_gothic. All rights reserved except as granted under the Public Parity License 7.0
