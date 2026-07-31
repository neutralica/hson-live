#### hson-live / hson.terminalgothic.com

# HSON Spec[0]
## Serialized Syntax
Updated: 2026-07-31

HSON is the textual serialization of an HSON node graph. It resembles markup,
but one construct contains a node's name, attributes, and content; there is no
repeated closing tag name.

---

## Tags and closers

```hson
<tag attrs? content? />
<property attrs? content? >
```

The closer selects cluster semantics:

- `/>` produces element semantics and an `_hson_elem` content cluster;
- `>` produces object semantics and an `_hson_obj` or `_hson_arr` content
  cluster.

The space before `/>` is optional. A construct may be inline or multiline:

```hson
<h1 "Title"/>

<article id="post"
  <h1 "Title"/>
/>
```

Closer semantics apply to the complete containing branch. Multiple top-level
nodes group beneath `_hson_elem` when every closer is element-mode, or beneath
`_hson_obj` when every closer is object-mode. A sequence that mixes the two
modes, such as `<a/><b 2>`, rejects instead of defaulting to element mode.

The same rule is recursive: `<wrapper <child/>/>` and
`<record <field 2>>` are coherent, while object-shaped children beneath an
element branch and element-shaped properties beneath an object branch reject.

---

## Names

Bare header names use an ASCII, case-sensitive grammar:

```text
[A-Za-z_:][A-Za-z0-9:._-]*
```

Tag/property names outside that bare grammar are emitted between backticks:

```hson
<`display name` "Ada">
<`a.b` 1>
```

Backtick names use a restricted escape grammar. Only escaped backticks,
backslashes, `\n`, `\r`, and `\t` are accepted. JSON-only escapes such as
`\uXXXX`, `\b`, `\f`, and `\/`, as well as unknown escapes, reject. A literal
forward slash needs no escape. Backticks are for tag/property names only; text
and quoted attribute values use double quotes.

The `_hson_` prefix is reserved for structural nodes and cannot be authored as
an ordinary user tag/property name. This applies to bare and backtick spellings,
to known VSN names such as `_hson_obj`, and to future `_hson_*` names. Parser
synthesis may still create those internal names for anonymous objects, arrays,
primitive leaves, clusters, and the attachment root.

---

## Primitive content

Double-quoted values are strings. Unquoted `true`, `false`, and `null` are
typed primitives. Numeric forms accept a sign, integers or decimals, and an
optional exponent:

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

The parser attaches that value directly beneath its internal `_hson_root` as
`_hson_str` or `_hson_val`. Public `fromHson().toNode()` detaches exactly that
leaf; it does not imply `_hson_elem` or `_hson_obj`. A bare name such as
`value` is not a string and remains invalid.

Only double quotes are supported for quoted text. The JSON escapes `\"`, `\\`,
`\/`, `\b`, `\f`, `\n`, `\r`, `\t`, and `\uXXXX` are decoded. Unknown,
incomplete, malformed, and unterminated escapes reject. Single quotes and
backticks are rejected as text delimiters.

An inline node may have attributes and one primitive value:

```hson
<button id="save" disabled "Save"/>
```

The parser accepts this combined form and multiple inline content nodes, such
as `<p "first" <em "middle"/> "last"/>`. Canonical readable serialization
keeps one primitive content node inline and expands complex mixed content.

Internally, strings become `_hson_str`; non-string primitives become
`_hson_val`. Those leaf VSNs normally melt into literal syntax when HSON is
serialized.

Element mixed content means strings interleaved with recursively
element-structured ordinary children. It does not permit object or array
relationships inside the same `_hson_elem` branch.

---

## Attributes, flags, and metadata

Attributes appear after the tag name:

```hson
<article id="post-042" class="entry featured"/>
```

Ordinary HSON attributes use HTML-compatible string semantics. The parser
accepts double-quoted and unquoted spellings, but both produce string-valued
ordinary attributes. Quoted values use HSON/JSON string escapes; no HTML entity
decoding occurs on this parser edge. `style` is parsed separately into the
graph's structured style map.

Attribute declaration names are case-sensitive and duplicates reject before
canonical attribute storage. Thus `a` and `A` are distinct, while repeated
valued, flag, `style`, or colonized names reject even when comments or layout
separate the declarations. This is an authored-HSON rule. Raw HTML retains its
separate case-insensitive duplicate policy.

Quoted attribute values accept exactly the same JSON escape set as quoted
content: `\"`, `\\`, `\/`, `\b`, `\f`, `\n`, `\r`, `\t`, and `\uXXXX`.
Unknown, incomplete, malformed, and unterminated escapes reject; `\/` decodes
to `/`.

For example, permissive input `<tag count=2/>` parses as `{ count: "2" }` and
canonical reserialization produces `<tag count="2"/>`. Canonical HSON always
quotes ordinary valued attributes. Permissive node ingress converts
programmatic number, boolean, and null values to strings before they enter the
canonical graph. This differs from primitive content, which retains primitive
typing.

A bare attribute is a presence flag:

```hson
<input disabled/>
```

The canonical graph representation is the string-valued entry
`{ disabled: "disabled" }`. Exact `value === key` equality distinguishes a
flag; for example, programmatic `{ disabled: true }` serializes as the ordinary
valued attribute `disabled="true"`, not as a flag. Input
`disabled="disabled"` is normalized to the canonical flag representation.

All attribute names, including every `data-*` spelling, go to `$_attrs`.
Structural metadata is declared only through its dedicated syntax: `@quid` in
HSON and registered `hson:*` names in HTML/SVG. Metadata is exact-allowlist and
default-deny. Backtick quoting never applies to attribute or metadata names.

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

`//` starts a comment wherever trivia is legal and consumes through the physical
newline. Comments may appear between structural tokens, are not stored in the
node graph, and are not reserialized.

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

The parser also accepts `[` and `]`, including `[]`; serialization uses `«` and
`»`. Arrays may be inline or multiline and may contain primitives, nested
arrays, named nodes, or anonymous objects. Commas separate top-level items.

Internally, an array is `_hson_arr` with ordered `_hson_ii` children. Each item
receives a canonical decimal string `index`. Wrapper-bearing inputs are sorted
by a valid complete index permutation during admission; canonical physical
order and index order must then agree. `_hson_ii` wrappers and their indexes
melt from ordinary HSON array text because HSON array order is intrinsic;
parsing rebuilds sequential indexes from source order.

---

## Objects and empty objects

Object properties use `>`:

```hson
<author
  <handle "Neutralica">
  <roles
    « "author", "maintainer" »
  >
>
```

The exact token `<>` represents an empty object. A lone `<` can open the
parser's implicit anonymous-object form, used particularly for object items in
arrays:

```hson
<people
  «
    <
      <name "Jo">
      <age 31>
    >
  »
>
```

Ordinary object property names must be unique after parsing.

---

## Canonicalization and VSNs

Serialization melts semantic `_hson_obj`, `_hson_elem`, `_hson_arr`,
`_hson_ii`, `_hson_str`, and `_hson_val` nodes into syntax. `_hson_root` is
different: it is an internal attachment carrier and every root rejects direct
HSON serialization. HSON, JSON, and HTML source pipelines detach their
parser-owned root before HSON output. A root supplied through `fromNode()` is
not silently unwrapped. VSNs remain explicit in the IR and can appear literally
in cross-format HTML/JSON where scaffolding is required to preserve structure.

HSON output itself is VSN-free. Objects use ordinary property and anonymous
object notation, arrays use array notation while their `_hson_ii` indexes are
reconstructed from order, strings and scalar values use primitive notation,
and element clusters use ordinary element-mode tags and fragments. The
serializer never writes `_hson_*` tag spellings, `$_meta`, or array-index
metadata as HSON source. Persisted QUID metadata is the defined exception to
metadata elision and is represented by the `@quid` header sigil.

The canonical closure rule is semantic rather than byte-oriented:

```text
valid non-root canonical HsonNode
  -> serialize_hson(node)
  -> parse_hson(output)
  -> detach_hson_root_value()
  -> canonical_hson_graph_equal(node, detached)
```

Readable and compact layouts can differ in whitespace, and canonical spelling
can differ from authored input, but both must reconstruct the same graph.

Canonical HSON is not a preservation of authored layout. The serializer can
change indentation, line breaks, array delimiters, key quoting, attribute
spelling, and compact/expanded node form while preserving the represented
graph semantics.

Canonical readable HSON is the default and uses two-space indentation.
`noBreak()` selects canonical compact HSON: it removes cosmetic line breaks and
indentation but retains conventional spaces between a tag name, attributes,
flags, and content. Both layouts are emitted structurally rather than by
rewriting whitespace in an already serialized string.

`noQuid()` removes only the defined `quid` field from eligible standard
tags and never mutates the graph or identity registry. Structural VSN metadata
is restricted to the operational
`index` on `_hson_ii`; it is omitted because array order carries the same
information and parsing regenerates it. `_hson_root`, `_hson_elem`,
`_hson_obj`, `_hson_arr`, `_hson_str`, and `_hson_val` accept no metadata.
Every other `$_meta` key is undefined and rejected on every node kind; it is
never silently stripped. Adding metadata requires an explicit future
field/node-kind contract in the registry.

An empty `_hson_root` remains a documented runtime-only exception for internal
systems, but it has no HSON text form. Like every populated root, it rejects at
HSON egress and is never substituted with `<>`, `{}`, or another value.

---

## Parse boundary

HSON has its own tokenizer and parser; it is not parsed as HTML or XML. The
HTML transform path is separately XML-backed and has different repair,
attribute, entity, and sanitization behavior.

Empty, whitespace-only, and comment-only HSON source has no semantic value and
rejects. Explicit empty values use `""`, `<>`, or `«»` (`[]` is accepted and
canonicalizes to `«»`).

© 2026 terminal_gothic. All rights reserved except as granted under the Public Parity License 7.0
