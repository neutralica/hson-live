#### hson-live / hson.terminalgothic.com

# Hson Spec[3]
## HTML transport representation in Hson
Updated: 2026-09-21

HTML maps into the Hson graph as ordered element content. The mapping preserves the structure required to re-emit useful equivalent markup, but it is canonicalizing rather than source-text-lossless.

Public `.toHtml()` is the Hson transport serializer. It retains structural/type
carriers such as `_hson_obj`, `_hson_arr`, `_hson_ii`, and `_hson_val` where
HTML would lose that information. It never emits `_hson_str` or `_hson_elem`
elements. This output is not the native-browser SSR realization
required by exact document continuation. The separate browser-realization
serializer remains internal in the current release.

In particular, `_hson_*` names are canonical/transport structure,
`hson-boundary` is derived browser-realization evidence, and `hson:quid` is
runtime identity evidence in managed browser markup. Ordinary Transform HTML
omits `hson:quid` on output and rejects it on input.

---

## Element clusters

A normal HTML element becomes an ordinary node whose tag is the parsed element name, whose attributes are in `$_attrs`, and whose content is represented by one `_hson_elem` cluster:

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

`_hson_elem` is internal structure and melts into ordinary HTML children. Reserved `hson-text` comments preserve adjacent, empty, control-bearing, and whitespace-sensitive leaves; each string also appears as HTML text. Its direct children may be only `_hson_str` leaves or ordinary element nodes. Typed `_hson_val`, JSON object or array clusters, and array items cannot appear directly inside it.

Empty and void elements use canonical ordinary `$_content: []`; an empty `_hson_elem` is not retained. Voidness is inferred from tag semantics during HTML serialization; the source spelling `<img>`, `<img/>`, or an expanded repair form is not retained.

---

## Hson text for HTML graphs

Hson uses one tag construct rather than HTML opening/closing pairs:

```hson
<main id="root"
  <h1 "Title"/>
  <p "One"/>
/>
```

Simple text-only content may be emitted inline. Attributes and text remain separate in the graph. The parser accepts this compact combined spelling:

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

The source's indentation, quote style, comments, entity spelling, optional end tags, and void-tag spelling are not preserved.

---

## Text behavior

General HTML parsing trims each non-empty text node and drops layout-only whitespace. This means boundary spaces can be lost:

```html
<p>Hello <em>world</em></p>
```

records `"Hello"`, not `"Hello "`, on the general parser path. Text is neither fully whitespace-lossless nor guaranteed to reproduce the exact original `textContent` around element boundaries.

Trusted Transform `style` and `script` RAWTEXT is never trimmed. Every nonempty serialized body uses one `/*hson-raw:<lowercase UTF-16 hex>*/` token. Generic Transform uses `/*hson-raw:a:<lowercase UTF-16 hex>*/` for multiple raw text leaves; the `a:` discriminator is needed only in that case. Empty content has no body payload. This single wire mode avoids collisions with literal reserved-token-looking stylesheet text without a separate escape grammar. The HTML tokenizer sees these ASCII tokens as raw text; trusted ingress decodes them before canonical construction. Literal CDATA-looking content remains literal. Ordinary source comments are ingress trivia, while reserved Hson text comments are decoded explicitly. Other non-element, non-text DOM nodes are ignored where the ingress route exposes them.

HsonDocument has narrower semantics: `<style/>` or one nonempty string leaf; `<script src="..."/>` with no content. An explicit empty style leaf, inline script, and structural content under either tag reject at document admission. Whole quoted string interpolation, such as ``<style "${css}"/>``, can supply multiline CSS without multiline Hson literal syntax. Browser realization is separate and rejects stylesheet text that actual HTML parsing cannot preserve exactly.

There are specialized SVG ingestion paths whose text handling differs and can retain raw SVG text-node whitespace. Code that depends on whitespace should test the exact source constructor and format route it uses.

---

## Attributes

Attributes are stored on the ordinary element node rather than as children.
The parser canonicalizes them:

- HTML attribute names are lowercased.
- SVG attribute spelling reported by the namespace-aware DOM is preserved.
- `style` is parsed into a structured CSS map rather than retained as one raw string.
- `xmlns`, `xmlns:*`, and `xml:*` namespace plumbing is dropped.
- SVG `xlink:href` is mapped to `href` when no `href` is already present.
- Registered `hson:index` is routed to `$_meta`, not `$_attrs`, and is legal only on `_hson_ii`. Ordinary Transform input rejects `hson:quid`; local LiveTree realization handles runtime identity separately. Unknown `hson:*` names reject.
- Private transit names are rejected at public ingress and never enter the canonical graph.
- Every `data-*` attribute is routed to `$_attrs` as application data, including the literal name `data--attrmap`.
- other attribute whitespace is normalized.
- empty values and values equal to the attribute name are treated as presence attributes and stored canonically.

As a result, attribute presence is preserved more reliably than exact source value spelling. Attribute order is not semantically significant after parsing.

Raw HTML-string duplicates are resolved while their original names are still visible. Names compare case-insensitively. Ordinary attributes use last-wins values and retain the position and spelling of their first occurrence. Repeated `class` declarations merge tokens in encounter order and remove repeated tokens. Repeated registered or candidate `hson:*` metadata declarations reject. An existing `Element` has already lost raw duplicate tokens and therefore begins at the post-token semantic boundary.

For XML-backed string parsing, canonical-valid ordinary names that are unsafe for XML transit, such as `a:b`, are encoded into deterministic, injective, self-decoding private names. They are decoded before canonical attribute admission; the temporary spelling never enters `$_attrs`. Invalid canonical names reject rather than being made valid by transport. Literal `hson:*` candidates use their separate metadata codec and still pass through the exact registry, so `hson:unknown` rejects. Authored names in either private transit domain reject on string, `Element`, raw-node, codec, and serializer boundaries.

The string preflight order is comment stripping, flag expansion, text/entity normalization, SVG namespace handling, quote normalization, duplicate resolution plus ordinary-name transit encoding, Hson metadata-name transit encoding, XML parsing, attribute enumeration, both transit decoders, canonical graph construction, and invariant validation.

---

## Tag and namespace behavior

The general XML-backed HTML parser normalizes element tags to lowercase. Trusted top-level SVG has a specialized namespace-aware conversion path; SVG attribute case is preserved there, while its exact element-tag behavior follows the DOM/parser path in use.

The parser adds or removes namespace scaffolding as needed for XML processing. It is therefore inaccurate to promise verbatim namespace-prefix or declaration round-tripping. The goal is usable SVG/XML structure, not preservation of every namespace token from the source.

Reserved transport tags are lowered before an ordinary HTML element is constructed. `<_hson_obj>` establishes object mode; `_hson_arr` and `_hson_ii` preserve array structure; `_hson_val` retains non-string scalar type. `_hson_elem` is internal only and is forbidden as a serialized HTML carrier.

Strings use HTML text. When text topology or XML-hostile code units require exact evidence, a preceding `<!--hson-text:<lowercase UTF-16 hex>-->` annotation identifies one semantic leaf. Detached strings use this annotation and text under `_hson_obj`; detached typed values use `_hson_val` under `_hson_obj`. `_hson_str` is internal only and forbidden as an HTML carrier. Malformed reserved annotations reject on trusted ingress.

---

## HTML-ish input repairs

String input is parsed with an XML-backed pipeline plus targeted preflights. It can normalize or repair common HTML forms, including:

- known named entities;
- boolean attributes;
- unquoted attribute values;
- void elements;
- limited optional `li`/`p` end tags;
- multiple top-level elements via a temporary root; and
- selected XML-hostile attribute characters.

Malformed input that remains invalid after those repairs throws a transform error. These repairs are parsing conveniences, not sanitization. Only `fromUntrustedHtml` applies DOMPurify; `fromTrustedHtml` does not.

When a constructor receives an `Element`, the supplied element is the source root. Its attributes, metadata, and descendants are included in the canonical graph; it is not treated as an `innerHTML` snapshot. Equivalent string and Element sources normalize to canonically equal graphs where the DOM boundary has not already erased a distinction. That boundary cannot recover duplicate source attributes, original HTML casing, source quoting or whitespace, or namespace detail not represented by the received DOM.

The Transform `queryDOM(selector)` and `queryBody()` helpers are intentionally different: they snapshot selected children or body children through `innerHTML`. LiveTree `queryDom(selector).graft()` and `queryBody().graft()` instead treat the selected Element itself as the managed root.

Untrusted HTML sanitization and canonical graph validation are separate stages. Sanitization removes unsafe markup behavior without silently deleting Hson metadata candidates. Ordinary Transform input rejects generated `hson:quid` claims with `PORTABLE_RUNTIME_QUID_FORBIDDEN`; malformed, unknown, misplaced, or duplicate metadata also rejects. Local LiveTree graft and browser realization use their separate runtime path. Ordinary `data-*` attributes remain application data.

---

## Round-trip contract

Serializer-owned node -> HTML -> node transport preserves structural mode, typed values, ordered and empty text items, attributes, metadata, and `-0` on supported canonical graphs. Generic Transform RAWTEXT nodes with child elements or object/array/value content remain outside this HTML transport; the serializer rejects them rather than silently flattening their structure. HsonDocument admission excludes those shapes for `style` and `script`. Arbitrary authored HTML still passes through the documented HTML normalization rules and does not promise:

- the original source string;
- comments or layout-only whitespace;
- tag/attribute case on every path;
- raw style attribute spelling;
- namespace declaration spelling; or
- source-level distinctions that the HTML parser does not place in the graph.

HTML and JSON use different cluster semantics. `_hson_elem` preserves ordered markup and duplicate tags; `_hson_obj` preserves unique JSON properties; and `_hson_arr` preserves arrays. Cross-format serialization may expose literal VSN scaffolding where the target format otherwise could not express the source structure.

© 2026 terminal_gothic. All rights reserved except as granted under the PolyForm Strict License 1.0.0
