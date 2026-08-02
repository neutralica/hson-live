#### hson-live / hson.terminalgothic.com

# HSON Spec[0]
## Serialized Syntax
Updated: 2026-07-31

HSON is the textual serialization of an HSON node graph. Object values and elements deliberately use asymmetric angle syntax and neither repeats a closing name.

---

## Tags and closers

```hson
<tag attrs? content? />
<object-member-name value ... >
```

The closer selects cluster semantics:

- `/>` selects the existing named-element grammar and `_hson_elem` semantics;
- `>` selects the object grammar. One angle pair represents one complete semantic `_hson_obj` value.

The space before `/>` is optional. A construct may be inline or multiline:

```hson
<h1 "Title"/>

<article id="post"
  <h1 "Title"/>
/>
```

Multiple top-level element nodes remain an `_hson_elem` fragment. Multiple top-level object values do not merge: one object pair must contain all sibling members. A sequence that mixes object and element values, such as `<a/><b 2>`, also rejects.

The same rule is recursive: `<wrapper <child/>/>` and `<record <field 2>>` are coherent, while object values beneath an element branch and element values beneath an object or array branch reject.

---

## Names

Bare header names use an ASCII, case-sensitive grammar:

```text
[A-Za-z_:][A-Za-z0-9:._-]*
```

The parser accepts every spelling in that grammar. The serializer deliberately uses a narrower preferred bare spelling, so accepted names containing a leading colon, any colon, or a dot are emitted as single-quoted names:

```hson
<':x' 1 'a:b' 2 'a.b' 3 'display name' "Ada">
```

That serializer-owned spelling change does not change the decoded name or graph. Single-quoted names accept `\'` for an apostrophe, plus `\\`, `\b`, `\f`, `\n`, `\r`, `\t`, and exactly four hexadecimal digits after `\u`. Unknown, malformed, incomplete, trailing, and unterminated escapes reject. Raw unescaped U+0000 through U+001F also reject. Literal backticks and forward slashes need no escape. The serializer uses the same closed grammar and can therefore spell every admitted decoded name.

An empty decoded quoted name is accepted only as an object member key:

```hson
<'' 1>
```

It is serialized with explicit apostrophe delimiters. Empty element, attribute, and flag names reject; `<''/>` is a missing element name. Single-quoted names are otherwise for element or object-member names only. Double quotes delimit string values. Backticks have no HSON syntactic role and remain ordinary data inside quoted names and string values.

The `_hson_` prefix is reserved for structural nodes and cannot be authored as an ordinary user element/member name. This applies to bare and quoted spellings, to known VSN names such as `_hson_obj`, and to future `_hson_*` names. Parser synthesis may still create those internal names for objects, arrays, primitive leaves, clusters, and the attachment root.

---

## Primitive content

Double-quoted values are strings. Unquoted `true`, `false`, and `null` are typed primitives. Numeric forms accept a sign, integers or decimals, and an optional exponent:

```hson
<title "On Trees"/>
<count 42>
<ratio -0.25>
<distance +1.2e3>
<enabled true>
<missing null>
```

A complete HSON document may also be one bare primitive:

```hson
"hello"
42
-0
true
false
null
```

The parser attaches that value directly beneath its internal `_hson_root` as `_hson_str` or `_hson_val`. Public `fromHson().toNode()` detaches exactly that leaf; it does not imply `_hson_elem` or `_hson_obj`. A bare name such as `value` is not a string and remains invalid.

Only double quotes are supported for quoted text. The JSON escapes `\"`, `\\`, `\/`, `\b`, `\f`, `\n`, `\r`, `\t`, and `\uXXXX` are decoded. Unknown, incomplete, malformed, and unterminated escapes reject. Single quotes and backticks are not text delimiters. Every raw unescaped C0 control character (U+0000 through U+001F) rejects at its exact source position, including physical tab, LF, CR, backspace, and form feed. Escaped controls are required, and physical line endings inside quoted strings are never normalized. This rule is identical for primitive strings, object and array string values, element text, and quoted attributes.

JavaScript template literals can contain ordinary HSON quoted-name delimiters directly:

```ts
const source = `
<
  'major problem here:' ""
  'ordinary quoted name' "value"
>
`;
```

When the decoded HSON name itself contains an apostrophe, preserve the normal host-language layering by escaping the HSON backslash for JavaScript: ``const source = `<'don\\'t' 1>`;``.

An inline node may have attributes and one primitive value:

```hson
<button id="save" disabled "Save"/>
```

The parser accepts this combined form and multiple inline content nodes, such as `<p "first" <em "middle"/> "last"/>`. Canonical readable serialization keeps one primitive content node inline and expands complex mixed content.

Internally, strings become `_hson_str`; non-string primitives become `_hson_val`. Those leaf VSNs normally melt into literal syntax when HSON is serialized.

Element mixed content means strings interleaved with recursively element-structured ordinary children. It does not permit object or array relationships inside the same `_hson_elem` branch.

---

## Element attributes, flags, and metadata

Attributes and flags appear only after an element name:

```hson
<article id="post-042" class="entry featured"/>
```

Ordinary HSON attributes use HTML-compatible string semantics. The parser accepts double-quoted and unquoted spellings, but both produce string-valued ordinary attributes. Quoted values use HSON/JSON string escapes; no HTML entity decoding occurs on this parser edge. `style` is parsed separately into the graph's structured style map.

Attribute declaration names are case-sensitive and duplicates reject before canonical attribute storage. Thus `a` and `A` are distinct, while repeated valued, flag, `style`, or colonized names reject even when comments or layout separate the declarations. This is an authored-HSON rule. Raw HTML retains its separate case-insensitive duplicate policy.

Quoted attribute values accept exactly the same JSON escape set as quoted content: `\"`, `\\`, `\/`, `\b`, `\f`, `\n`, `\r`, `\t`, and `\uXXXX`. Unknown, incomplete, malformed, and unterminated escapes reject; `\/` decodes to `/`.

For example, permissive input `<tag count=2/>` parses as `{ count: "2" }` and canonical reserialization produces `<tag count="2"/>`. Canonical HSON always quotes ordinary valued attributes. Permissive node ingress converts programmatic number, boolean, and null values to strings before they enter the canonical graph. This differs from primitive content, which retains primitive typing.

A bare attribute is a presence flag:

```hson
<input disabled/>
```

Before element content begins, the bare names `true`, `false`, and `null` are ordinary flags, not typed content. Thus `<input true false null/>` has three flags, and explicit `true="true"`-style declarations normalize equivalently. Numeric tokens are not names: `<a 1/>` rejects as typed element content. Once content has begun, every subsequent flag or attribute rejects as a header item after content.

The canonical graph representation is the string-valued entry `{ disabled: "disabled" }`. Exact `value === key` equality distinguishes a flag; for example, programmatic `{ disabled: true }` serializes as the ordinary valued attribute `disabled="true"`, not as a flag. Input `disabled="disabled"` is normalized to the canonical flag representation. 

All attribute names, including every `data-*` spelling, go to `$_attrs`. Structural metadata is declared only through its dedicated syntax: `@quid` in HSON and registered `hson:*` names in HTML/SVG. Metadata is exact-allowlist and default-deny. Backtick quoting never applies to attribute or metadata names. Object members cannot author QUIDs, metadata, attributes, or flags. An object-structured ordinary node carrying metadata is outside the HSON-serializable domain; serialization rejects it even under `noQuid()`.

---

## Children and comments

Child nodes and primitive leaves are ordered:

```hson
<p
  "JSON and"
  <em "HTML"/>
  "share a graph."
/>
```

The authored trivia alphabet is exactly SPACE (U+0020), horizontal tab (U+0009), LF (U+000A), and CR (U+000D). CRLF is the ordinary CR-plus-LF pair. Vertical tab, form feed, nonbreaking space, Unicode line/paragraph separators, and other ECMAScript or Unicode whitespace are not trivia and reject.

`//` starts a comment wherever trivia is legal and consumes through LF, CR, or CRLF. It may run to end of source after a complete semantic value. Comments may appear between structural tokens, are not stored in the node graph, and are not reserialized. A comment alone still has no semantic value. Block comments are unsupported.

---

## Arrays

Canonical arrays use guillemets and comma-separated items:

```hson
<tags
  «
    "hson",
    "json",
    "html"
  »
>
```

The parser also accepts `[` and `]`, including `[]`; serialization uses `«` and `»`. Arrays may be inline or multiline and may contain primitives, nested arrays, or object values. Commas separate top-level items. One optional trailing comma is accepted with either delimiter family (`[1,2,]` and `«1,2,»`) and is never emitted. Missing, leading, extra, and doubled commas reject. An array does not collapse when it has one item and cannot bridge an object branch to element-mode content.

Internally, an array is `_hson_arr` with ordered `_hson_ii` children. Each item receives a canonical decimal string `index`. Wrapper-bearing inputs are sorted by a valid complete index permutation during admission; canonical physical order and index order must then agree. `_hson_ii` wrappers and their indexes melt from ordinary HSON array text because HSON array order is intrinsic; parsing rebuilds sequential indexes from source order.

---

## Objects

One object angle pair contains repeated punctuation-free `name value` members:

```hson
<
  author <
    handle "Neutralica"
    roles « "author", "maintainer" »
  >
>
```

The grammar is:

```text
object-value :=
  "<" trivia*
  (object-member (required-trivia object-member)*)?
  trivia* ">"

object-member := source-name required-trivia object-member-value

object-member-value :=
    quoted-string | number | true | false | null
  | object-value | array-value
```

Trivia is whitespace or a `//` physical-line comment. At least one trivia unit is required between a member name and value and between sibling members; the amount and indentation are not semantic. Block comments remain unsupported. Object members use no colon and no comma. Arrays retain commas.

The exact token `<>` represents an empty object. The same pair remains the object boundary at zero, one, or many members. An object array item uses that pair directly:

```hson
<people
  «
    <
      name "Jo"
      age 31
    >
  »
>
```

Ordinary member names are case-sensitive and must be unique. A member must own exactly one value. Thus `<a>` is invalid and an empty object value is written `<a <>>`.

The `$_content` member sequence is authoritative graph identity. Parsing, admission, serialization, reparsing, canonical equality, browsers, and Workers preserve that sequence; serializers never alphabetize object members.

The former property-angle and anonymous-wrapper grammar has been removed. Adjacent root properties (`<a 1><b 2>`), doubled objects (`<<a 1>>`), and doubled array objects (`«<<a 1>>»`) are invalid rather than compatibility aliases.

---

## Canonicalization and VSNs

Serialization melts semantic `_hson_obj`, `_hson_elem`, `_hson_arr`, `_hson_ii`, `_hson_str`, and `_hson_val` nodes into syntax. `_hson_root` is different: it is an internal attachment carrier and every root rejects direct HSON serialization. HSON, JSON, and HTML source pipelines detach their parser-owned root before HSON output. A root supplied through `fromNode()` is not silently unwrapped. VSNs remain explicit in the IR and can appear literally in cross-format HTML/JSON where scaffolding is required to preserve structure.

HSON output itself is VSN-free. Every semantic object value uses one object angle pair, arrays use array notation while their `_hson_ii` indexes are reconstructed from order, strings and scalar values use primitive notation, and element clusters use ordinary element-mode tags and fragments. The serializer never writes `_hson_*` tag spellings, `$_meta`, or array-index metadata as HSON source. Persisted QUID metadata is represented by the `@quid` header sigil only for eligible element nodes. Object-member metadata rejects.

The canonical closure rule is semantic rather than byte-oriented:

```text
admitted HSON-serializable semantic value
  -> serialize_hson(node)
  -> parse_hson(output)
  -> detach_hson_root_value()
  -> canonical_hson_graph_equal(node, detached)
```

Readable and compact layouts can differ in whitespace, and canonical spelling can differ from authored input, but both must reconstruct the same graph.

Canonical HSON is not a preservation of authored layout. The serializer can change indentation, line breaks, array delimiters, key quoting, attribute spelling, and compact/expanded node form while preserving the represented graph semantics.

Canonical readable HSON is the default and uses two-space indentation. `noBreak()` selects canonical compact HSON: it removes cosmetic line breaks and indentation but retains conventional spaces between a tag name, attributes, flags, and content. Both layouts are emitted structurally rather than by rewriting whitespace in an already serialized string.

`noQuid()` removes only the defined `quid` field from eligible element nodes and never mutates the graph or identity registry. It does not legalize object metadata. Structural VSN metadata is restricted to the operational `index` on `_hson_ii`; it is omitted because array order carries the same information and parsing regenerates it. `_hson_root`, `_hson_elem`, `_hson_obj`, `_hson_arr`, `_hson_str`, and `_hson_val` accept no metadata. Every other `$_meta` key is undefined and rejected on every node kind; it is never silently stripped. Adding metadata requires an explicit future field/node-kind contract in the registry.

An empty `_hson_root` remains a documented runtime-only exception for internal systems, but it has no HSON text form. Like every populated root, it rejects at HSON egress and is never substituted with `<>`, `{}`, or another value.

---

## Parse boundary

HSON has its own tokenizer and parser; it is not parsed as HTML or XML. The HTML transform path is separately XML-backed and has different repair, attribute, entity, and sanitization behavior.

Empty, whitespace-only, and comment-only HSON source has no semantic value and rejects. Explicit empty values use `""`, `<>`, or `«»` (`[]` is accepted and canonicalizes to `«»`).

Authored-source failures use portable `TransformError` details. Stable identity is read from `operation`, `code`, optional `stage`, and exact zero-based index / one-based line and column in `source`; graph-only failures retain graph `path` instead of fabricated source coordinates. Duplicate object members and element attributes identify the duplicate as primary `source` and the first declaration as structured `related` evidence. Diagnostic prose is informative but is not the machine-readable identity.

© 2026 terminal_gothic. All rights reserved except as granted under the Public Parity License 7.0
