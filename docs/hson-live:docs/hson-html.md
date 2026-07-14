#### hson-live / hson.terminalgothic.com

# HSON Spec[3]
## HTML Representation in HSON
Updated: 2026-07-13

HTML maps into the HSON graph as ordered element content. The mapping preserves
the structure required to re-emit useful equivalent markup, but it is
canonicalizing rather than source-text-lossless.

---

## Element clusters

A normal HTML element becomes an ordinary node whose tag is the parsed element
name, whose attributes are in `$_attrs`, and whose content is represented by
one `_hson_elem` cluster:

```html
<p>Hello <em>world</em></p>
```

```text
p
└─ _hson_elem
   ├─ _hson_str ("Hello")
   └─ em
      └─ _hson_elem
         └─ _hson_str ("world")
```

`_hson_elem` is structural and is melted when ordinary HTML is serialized; it
does not become a literal HTML tag. Its direct children may be only
`_hson_str` leaves or ordinary element nodes. Typed `_hson_val`, JSON object or
array clusters, and array items cannot appear directly inside it.

Empty and void elements use an empty `_hson_elem` cluster. Voidness is inferred
from tag semantics during HTML serialization; the source spelling `<img>`,
`<img/>`, or an expanded repair form is not retained.

---

## HSON text for HTML graphs

HSON uses one tag construct rather than HTML opening/closing pairs:

```hson
<main id="root"
  <h1 "Title"/>
  <p "One"/>
/>
```

Simple text-only content may be emitted inline. Attributes and text remain
separate in the graph. The parser accepts this compact combined spelling:

```hson
<button id="save" disabled "Save"/>
```

The current serializer expands attributes-plus-content:

```hson
<button id="save" disabled
  "Save"
/>
```

Mixed text and elements retain their graph order:

```hson
<p
  "Hello"
  <strong "world"/>
  "."
/>
```

The source's indentation, quote style, comments, entity spelling, optional end
tags, and void-tag spelling are not preserved.

---

## Text behavior

General HTML parsing trims each non-empty text node and drops layout-only
whitespace. This means boundary spaces can be lost:

```html
<p>Hello <em>world</em></p>
```

records `"Hello"`, not `"Hello "`, on the general parser path. Text is neither
fully whitespace-lossless nor guaranteed to reproduce the exact original
`textContent` around element boundaries.

`style` and `script` content is also trimmed and stored as one `_hson_str`
leaf, with a recognized CDATA wrapper removed. Comments and non-element,
non-text DOM nodes are ignored.

There are specialized SVG ingestion paths whose text handling differs and can
retain raw SVG text-node whitespace. Code that depends on whitespace should
test the exact source constructor and format route it uses.

---

## Attributes

Attributes are stored on the ordinary element node rather than as children.
The parser canonicalizes them:

- HTML attribute names are lowercased.
- SVG attribute spelling reported by the namespace-aware DOM is preserved.
- `style` is parsed into a structured CSS map rather than retained as one raw
  string.
- `xmlns`, `xmlns:*`, and `xml:*` namespace plumbing is dropped.
- SVG `xlink:href` is mapped to `href` when no `href` is already present.
- `data-_index` and `data-_quid` are routed to `$_meta`, not `$_attrs`.
- transit-only `data--*` attributes are dropped.
- other attribute whitespace is normalized.
- empty values and values equal to the attribute name are treated as presence
  attributes and stored canonically.

As a result, attribute presence is preserved more reliably than exact source
value spelling. Attribute order is not semantically significant after parsing.

---

## Tag and namespace behavior

The general XML-backed HTML parser normalizes element tags to lowercase.
Trusted top-level SVG has a specialized namespace-aware conversion path; SVG
attribute case is preserved there, while its exact element-tag behavior follows
the DOM/parser path in use.

The parser adds or removes namespace scaffolding as needed for XML processing.
It is therefore inaccurate to promise verbatim namespace-prefix or declaration
round-tripping. The goal is usable SVG/XML structure, not preservation of every
namespace token from the source.

Literal incoming `<_hson_elem>` and `<_hson_str>` elements are rejected on the
HTML path. Other recognized VSN tags are accepted only where required to carry
cross-format structural data and must satisfy the graph invariants.

---

## HTML-ish input repairs

String input is parsed with an XML-backed pipeline plus targeted preflights. It
can normalize or repair common HTML forms, including:

- known named entities;
- boolean attributes;
- unquoted attribute values;
- void elements;
- limited optional `li`/`p` end tags;
- multiple top-level elements via a temporary root; and
- selected XML-hostile attribute characters.

Malformed input that remains invalid after those repairs throws a transform
error. These repairs are parsing conveniences, not sanitization. Only
`fromUntrustedHtml` applies DOMPurify; `fromTrustedHtml` does not.

When a constructor receives an `Element`, the public transform constructor
currently snapshots `innerHTML`, so the supplied element itself is not the
result root. Descendant `data-_quid` values are stripped during ingestion.

---

## Round-trip contract

HTML -> node -> HTML aims to preserve representable element nesting,
attributes, text values after parser normalization, and content order. It does
not promise:

- the original source string;
- comments or layout-only whitespace;
- tag/attribute case on every path;
- raw style attribute spelling;
- namespace declaration spelling; or
- an identical node graph after every cross-format route.

HTML and JSON use different cluster semantics. `_hson_elem` preserves ordered
markup and duplicate tags; `_hson_obj` preserves unique JSON properties; and
`_hson_arr` preserves arrays. Cross-format serialization may expose literal VSN
scaffolding where the target format otherwise could not express the source
structure.

© 2026 terminal_gothic. All rights reserved except as granted under the Public Parity License 7.0
