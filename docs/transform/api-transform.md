
# Transform API

## Package and environment boundaries

The canonical Transform facade is `hsonTransform` from `hson-live/transform`.
It is DOM-free, accepts strings for HTML ingress, and is also exposed as
`hson.transform` by the browser umbrella:

```ts
import { hsonTransform } from "hson-live/transform";

hsonTransform.fromUntrustedHtml(htmlString);
hsonTransform.fromTrustedHtml(htmlString);
hsonTransform.fromJson(input);
hsonTransform.fromHson(source);
hsonTransform.fromBinary(bytes, limits);
hsonTransform.fromNode(node);
```

The root `hson` facade adds browser `Element` overloads to its HTML shortcuts:

```ts
import { hson } from "hson-live";

hson.fromUntrustedHtml(stringOrElement) // sanitized HTML
hson.fromTrustedHtml(stringOrElement)   // unsanitized trusted HTML
hson.fromBinary(bytes, limits)
hson.fromJson(input)
hson.fromHson(input)
hson.fromNode(node)
```

The narrow and umbrella facades share the structural Hson, JSON, node, binary,
and output-chain implementations. Browser-only DOM query helpers on internal
source constructors are not package entrypoints.

`hson.transform` exposes synchronous numeric admission through `calc`.

```ts
hson.transform.calc(number): HsonNumber
hson.transform.calc(() => number): HsonNumber
```

The same numeric operation is exported as `hsonCalc`. Runtime authored-Hson text is admitted by `fromHson`.

Every constructor method parses and normalizes input to Hson's canonical node graph.

## Hson authoring and HsonCanonical

`` Hson`...` `` authors canonical Hson inline. Literal template segments are Hson source;
primitive substitutions are encoded according to their JavaScript types before
the completed Hson is validated and canonicalized.

```ts
import { Hson, type HsonCanonical } from "hson-live/hson";

const authored: HsonCanonical = Hson`
  <p "first"<em "middle"/>"last"/>
`;
```

The narrow `/hson` entrypoint exports `Hson` and the same `HsonCanonical` type
as `/transform`. The root also exports `Hson` for aggregate convenience.
Lowercase `hson` is a noncallable aggregate object; the old tag has no compatibility alias.

The public visual grammar is deliberately small:

```text
Hson`...`    author canonical Hson
hson.*       access hson-live subsystems
Hson.certify(schema, canonical)    validate canonical Hson
Hson(...)    unsupported ordinary source calls
hson(...)    unsupported; the aggregate is not callable
```

Literal source and interpolated JavaScript data remain distinct:

```ts
Hson`37`          // authored Hson number
Hson`"37"`        // authored Hson string
Hson`<foo/>`      // authored Hson element

Hson`${37}`       // JavaScript number -> Hson number
Hson`${"37"}`     // JavaScript string -> Hson string
Hson`${true}`     // JavaScript boolean -> Hson boolean
```

The supported substitution values are primitive JavaScript `string`, `number`,
`boolean`, and `null`. Strings always become Hson string data; finite numbers
retain the numeric policy (including `-0`); booleans and null become their Hson
literals. Arrays, objects, nodes, functions, `undefined`, bigint, and symbols
reject rather than stringify or splice source.

There is no parse-success fallback and no structural/source interpolation.

Raw template segments keep Hson in charge of escapes. The complete reconstructed
source passes through the same parser, exact root detachment, canonical graph
admission, default serializer, and `HsonCanonical` branding path.

Runtime `TemplateStringsArray.raw` must not be treated as a byte-for-byte copy of the host file. In particular, JavaScript normalizes physical CRLF template line terminators to LF. Static diagnostics that need original-file offsets must map against the original host source text rather than this runtime string.

The returned spelling may differ from the source because the method reparses the source into canonical `HsonNode` state and serializes that graph with the default Hson options. It does not preserve original formatting, whitespace, line breaks, quoting, shorthand, comments, or other source-level spelling. Invalid input throws the existing parser, normalization, or invariant error. Internally the function parses one `_hson_root`, detaches its exact one semantic child, serializes that non-root node, and applies the `HsonCanonical` brand only after successful serialization.

The return is an `HsonCanonical`, a TypeScript-branded primitive string. It does not imply sanitization, authentication, or trust. The compile-time brand is lost across untyped transport or storage.

Runtime text containing arbitrary authored Hson is a separate operation:

```ts
import { hsonTransform } from "hson-live/transform";

const source: string = getTextAtRuntime();
const canonical: HsonCanonical = hsonTransform
  .fromHson(source)
  .toHson()
  .serialize();
```

Use `.toNode()` when validation is needed without serialized output. `fromHson`
truthfully owns runtime source admission; interpolation would encode `source` as
Hson string data.

Hson string values use double quotes. Single quotes delimit authored Hson names;
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

All supported sources parse to `HsonNode`, Hson's graph type.

```ts
type HsonNode = {
  $_tag: string;
  $_content: (HsonNode | Primitive)[];
  $_attrs?: HsonAttrs;
  $_meta?: HsonMeta;
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
- `data-*` remains application-owned and is never reinterpreted as Hson   metadata.
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

Parses JSON data into Hson nodes.

- Accepts a JSON string or a parsed JSON value.
- Does not sanitize.
- Detaches caller-owned records and arrays before normalization. Parsing never   mutates the supplied value or retains mutable aliases into canonical graph   state.
- Metadata on an explicit `_hson_root` is invalid and rejects; it is not   ignored or filtered. An empty runtime `_hson_root` remains a separate   runtime-carrier exception outside direct Hson-text serialization.
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

Parses Hson text into HsonNodes.

- Does not sanitize.
- `.toNode()` returns exactly its one semantic child and never returns   `_hson_root`. Meaningful `_hson_elem`, `_hson_obj`, `_hson_arr`, `_hson_str`,   and `_hson_val` nodes remain intact.
- Bare quoted strings, finite numbers, booleans, and `null` are valid Hson values.
- Hson serializes numeric values unquoted and use JSON number syntax and admit only finite   JavaScript numbers: a leading plus is forbidden, while an exponent plus is allowed (for example, `1e+3`).
### `hson.fromNode(node: HsonNode)`

Parses and validates an external HsonNode graph .

- Does not sanitize.

### `hson.fromBinary(input: Uint8Array, options?)`

Decodes canonical Binary Hson into the common Transform output chain. The
narrow spelling is `hsonTransform.fromBinary(...)`; the root `hson` facade is an
equivalent shortcut.

Only `Uint8Array` is accepted. Node `Buffer` works because it is a
`Uint8Array` subclass. Optional limits are positive safe integers:

```ts
type BinaryDecodeOptions = Readonly<{
  maxBytes?: number;      // default 1,048,576
  maxGraphDepth?: number; // default 256
  maxGraphNodes?: number; // default 100,000
}>;
```

The decoder rejects a wrong marker, truncation, trailing bytes, unknown
discriminators, non-finite numbers, malformed nodes, duplicate or unsorted
attribute/metadata keys, exceeded limits, and any accepted graph whose
re-encoded bytes differ from the input. Binary Hson has no numeric version
field or compatibility fallback.

---

## Step 2: Output Constructor

All transform source constructors return a common surface:

```ts
.toHtml()           // returns an HTML string
.toJson()           // returns a JSON object or string
.toHson()           // returns an Hson string
.toBinary()         // returns canonical Binary Hson bytes
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

Selects Hson output.

- `serialize()` returns `HsonCanonical`, a primitive Hson string.
- Use the source constructor's `.toNode()` terminal for the canonical graph.
- Hson text is produced lazily by `serialize()`, after Hson options have been   accumulated. The source graph is not cloned or mutated.
- Every admitted Hson-serializable semantic value is emitted without literal structural   VSN names, raw metadata containers, or array-index metadata. Parsing that   output, detaching the parser root, and comparing canonically reconstructs the   original graph. Object-member metadata is outside this domain and rejects.   `noQuid()` applies the same rule after removing only eligible element QUID   metadata from the expected projection; it cannot legalize object metadata.
- Direct `serialize_hson(node)` and `hson.fromNode(node).toHson().serialize()`   use the same canonical serializer. `noBreak` changes layout only.
- Canonical names use the established preferred bare grammar where possible.   Names requiring quoting use apostrophe delimiters, escape apostrophes as   `\'`, and treat backticks as ordinary data. Canonical Hson never emits a   backtick-delimited name.
- Direct or fluent Hson serialization of any caller-supplied `_hson_root`   rejects before layout and QUID options. Parser-owned JSON/HTML roots and the   Hson parser root are explicitly detached by their source pipeline first.
- `fromNode()` treats its input as a detached semantic value. Redundant detached   scalar `_hson_obj`/`_hson_elem` carriers normalize to their scalar before   output, while owned object-member carriers, element text clusters, and arrays   remain intact. Direct serialization rejects a detached carrier that bypassed   admission.

### `.toBinary()`

Selects the canonical binary representation of the exact detached Hson graph:

```ts
const binary = hsonTransform.fromHson(`<note "hello"/>`).toBinary();
const bytes: Uint8Array = binary.serialize();
const digest: string = await binary.sha256();
```

`serialize()` returns a fresh `Uint8Array` copy each time. The bytes are
deterministic for the admitted graph: the codec uses fixed discriminators and
widths, preserves graph/content order and UTF-16 code units, sorts
attribute/metadata record keys by code unit, and writes finite numbers as
big-endian binary64. It is a graph transport, not the UTF-8 bytes of serialized
Hson, JSON, or HTML. A `_hson_root` carrier is not a detached Binary Hson value
and rejects.

`toBinary()` snapshots the source graph when that output is selected. Later
mutation of a caller-owned node cannot change the returned representation.

### `HsonCanonical`

`HsonCanonical` is a TypeScript-only branded primitive string returned by official Hson serialization APIs. Import it as a type from `hson-live/hson` or `hson-live/transform`.

It is assignable to `string`, but an arbitrary `string` is not assignable to `HsonCanonical`. The brand records compile-time producer provenance only: it adds no runtime marker, wrapper, prefix, property, or other change to the serialized text. It is not a security, trust, validation-token, sanitization, authentication, or cryptographic guarantee.

Transport and persistence boundaries such as HTTP, WebSocket, JSON, storage, environment variables, process boundaries, and third-party APIs typed as plain strings normally erase the brand. Receivers accept transported Hson text as an ordinary `string` and parse it normally. Parsing arbitrary text produces canonical `HsonNode` graph state after success; it does not brand the input text.

Readable, compact (`noBreak`), and `noQuid` Hson serialization all return `HsonCanonical`. The type does not imply that those options produce identical bytes, preserve source spelling, whitespace, quoting, comments, or formatting, or preserve JavaScript object identity for shared references. Graph carriers outside the serializable Hson-text domain, including every empty or populated `_hson_root`, remain rejected and therefore do not produce an `HsonCanonical`.

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

This should only be used for Hson nodes that semantically encode HTML. It is lossy for generic JSON/Hson data because DOMPurify will strip markup it does not recognize.

---

## Hson Serialization Options

After `toHson()`, the API exposes a composable option/finalizer surface:

```ts
.noBreak()
.noQuid()
.withOptions(options)
.serialize()
```

The active Hson options are:

```ts
type FrameOptions = {
  noBreak?: boolean;
  noQuid?: boolean;
};
```

Readable, two-space-indented Hson is the default. `noBreak` selects canonical compact Hson without cosmetic newlines or indentation while retaining conventional spaces between tag/header/content terms. `noQuid` omits only the persisted `quid` metadata key and does not alter live identity registration. `index` is the separate operational field on `_hson_ii`. Every `data-*` spelling is an ordinary application attribute.

Ordinary Hson attributes have string-valued wire semantics in either layout. The parser accepts both `count=2` and `count="2"` as `{ count: "2" }`, while canonical serialization emits `count="2"`. Programmatic number, boolean, and null values are likewise stringified and quoted without mutating the source graph. Presence flags are the distinct exact-equality form `{ disabled: "disabled" }` and serialize as bare `disabled`.

### Persisted QUID declarations

Hson has one identity-specific header declaration: `@quid`. It maps only to canonical `$_meta["quid"]`; it is neither HTML `id`, a selector, nor a request to generate identity. Persisted QUIDs are random 45-bit identifiers: exactly 9 lowercase Base32 characters from `0123456789abcdefghjkmnpqrstvwxyz`. They are generated from the first 45 bits of 6 secure random bytes; there is no normalization, legacy-width admission, fallback format, quoted form, or `@@` form.

```hson
<panel @d1r6x8qwc class="settings" "Content"/>
```

Parsing accepts one declaration anywhere in an opening header before inline content; serialization is canonical and writes it immediately after the tag. `@` after content and duplicate declarations are errors. Attribute tokens, including `data-_quid`, are ordinary Hson attributes and never metadata. Only ordinary elements may carry persisted identity, and duplicate values across a document remain a LiveMap graph-invariant error. HTML and SVG use `hson:quid`.

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

Binary output has its own `serialize(): Uint8Array` terminal.

### `.value()`

Returns the in-memory JSON projection:

- after `.toJson()` - `JsonValue`

The terminal vocabulary is deliberately explicit:

```ts
source.toNode()                 // canonical HsonNode
source.toJson().value()         // in-memory JsonValue
source.toJson().serialize()     // JSON text
source.toHson().serialize()     // Hson text
source.toHtml().serialize()     // HTML text
source.toBinary().serialize()   // Binary Hson Uint8Array
```

Public output finalizers do not expose `parse()`.

### `.sha256()`

Every selected representation exposes asynchronous
`sha256(): Promise<string>`. It returns a lowercase 64-character hexadecimal
SHA-256 digest of the exact bytes emitted by that representation:

- Hson, JSON, and HTML hash the UTF-8 bytes produced by `TextEncoder` from
  their exact `serialize()` string;
- Binary Hson hashes the exact `Uint8Array` returned by its serializer.

Formatting and representation are significant. Readable and compact Hson may
hash differently, and one graph's Hson, JSON, HTML, and binary hashes are not
expected to match. The operation uses `globalThis.crypto.subtle.digest` with
`SHA-256`; it rejects when WebCrypto or SHA-256 support is unavailable. This is
a representation digest, not an authentication or trust proof.

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

Internal browser source constructors still contain child/body snapshot helpers,
but they are not exported by `hson-live`, `hson-live/transform`, or the public
`hson` facade.

---

## Security Summary

| Source | Sanitized by default | Intended use |
| --- | --- | --- |
| `fromUntrustedHtml` | yes | external or user-authored HTML |
| `fromTrustedHtml` | no | trusted developer-authored HTML |
| `fromJson` | no | structured data |
| `fromHson` | no | Hson text |
| `fromNode` | no | existing internal graph |
| `sanitizeBEWARE` | yes, after source selection | explicit lossy HTML sanitation |

Sanitization is automatic only for `fromUntrustedHtml`. Other formats are treated as data unless the caller explicitly opts into the HTML sanitation escape hatch.

---

## Errors

Transform parser and serializer failures generally use the exported
`TransformError` class. Its stable readable fields are `operation`, `code`, and
optional `stage`, source position, graph `path`, and related source positions:

```ts
import {
  is_transform_error,
  read_transform_error_details,
} from "hson-live/transform";

try {
  hsonTransform.fromHson(source).toNode();
} catch (error) {
  if (is_transform_error(error)) {
    console.error(read_transform_error_details(error));
  }
}
```

`read_transform_error_details` returns immutable structured details or
`undefined` for another failure type. Do not parse the human message to recover
source evidence.

Not every terminal failure is a `TransformError`: Binary Hson currently throws
ordinary `Error` values prefixed with `Binary Hson`, WebCrypto hashing rejects
with an ordinary `Error`, and a caller's `hsonCalc` callback failure propagates
unchanged. Consumers should classify with `is_transform_error` before relying
on Transform fields.

---

## Design Notes

- Transformations normalize through `HsonNode`.
- Transform sources do not mutate the DOM.
- LiveTree construction is explicit and separate.
- Public output finalizers expose no `.parse()` terminal.
- Binary ingress accepts only canonical bytes and has no version fallback.
- `sha256()` hashes the selected serialized representation, not an abstract
  format-independent graph.
- VSN tag values remain in the `_hson_` namespace; internal node fields use the   `$_` names.
- `fromNode(node).toNode()` returns the same graph reference; it is not a clone   operation.

A separate `hson-transform.md` overview is not currently necessary. The pipeline is small, while `hson-syntax.md`, `hson-nodes.md`, `hson-json.md`, and `hson-html.md` already document the parsers' shared model and format-specific behavior. This file is the appropriate home for the callable transform chain.

© 2026 terminal_gothic. All rights reserved except as granted under the Public Parity License 7.0
