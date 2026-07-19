#### hson-live / hson.terminalgothic.com

# HSON Spec[0]
## Serialized Syntax
Updated: 2026-07-13

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

The parser accepts element and object closers in the same input. Multiple
top-level nodes with mixed closer kinds are rooted as element mode. This is
accepted behavior, although canonical output can normalize a mixed construct
to its containing cluster mode; it is not an error merely because both symbols
occur.

---

## Names

Bare names match:

```text
[A-Za-z_][A-Za-z0-9_-]*
```

The parser also accepts `:` and `.` in unquoted tag names. Keys outside the
serializer's bare-name set are emitted between backticks:

```hson
<`display name` "Ada">
<`a.b` 1>
```

Backtick names support escaped backticks, backslashes, and `\n`, `\r`, and
`\t`. Backticks are for tag/property names only; text and quoted attribute
values use double quotes.

The `_hson_` prefix is reserved for structural nodes and cannot be used as an
ordinary user tag/property name.

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

Only double quotes are supported for quoted text. JSON-style escapes are
decoded. Single quotes and backticks are rejected as text delimiters.

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

For example, permissive input `<tag count=2/>` parses as `{ count: "2" }` and
canonical reserialization produces `<tag count="2"/>`. Canonical HSON always
quotes ordinary valued attributes, including programmatic number, boolean, and
null values after `String(...)` conversion. This differs from primitive content,
which retains primitive typing.

A bare attribute is a presence flag:

```hson
<input disabled/>
```

The canonical graph representation is the string-valued entry
`{ disabled: "disabled" }`. Exact `value === key` equality distinguishes a
flag; for example, programmatic `{ disabled: true }` serializes as the ordinary
valued attribute `disabled="true"`, not as a flag. Input
`disabled="disabled"` is normalized to the canonical flag representation.

Names beginning `data-_` are routed to `$_meta`; other names go to `$_attrs`.
Metadata is serialized in attribute position when the graph/output route
retains it.

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
receives `data-_index`, but emitted order follows the physical child order, not
a sort of that metadata. `_hson_ii` wrappers and their indexes melt from HSON
text; parsing rebuilds sequential `data-_index` values from physical array order.

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

Serialization usually melts `_hson_root`, `_hson_obj`, `_hson_elem`,
`_hson_arr`, `_hson_ii`, `_hson_str`, and `_hson_val` into syntax. These VSNs
remain explicit in the IR and can appear literally in cross-format HTML/JSON
where scaffolding is required to preserve structure.

Canonical HSON is not a preservation of authored layout. The serializer can
change indentation, line breaks, array delimiters, key quoting, attribute
spelling, and compact/expanded node form while preserving the represented
graph semantics.

Canonical readable HSON is the default and uses two-space indentation.
`noBreak()` selects canonical compact HSON: it removes cosmetic line breaks and
indentation but retains conventional spaces between a tag name, attributes,
flags, and content. Both layouts are emitted structurally rather than by
rewriting whitespace in an already serialized string.

`noQuid()` removes only `data-_quid` from ordinary metadata-bearing nodes. It
preserves custom `data-_...` metadata and never mutates the graph or identity
registry. Metadata attached directly to melted `_hson_*` VSN nodes was already
outside the current HSON wire representation and remains so.

---

## Parse boundary

HSON has its own tokenizer and parser; it is not parsed as HTML or XML. The
HTML transform path is separately XML-backed and has different repair,
attribute, entity, and sanitization behavior.

© 2026 terminal_gothic. All rights reserved except as granted under the Public Parity License 7.0
