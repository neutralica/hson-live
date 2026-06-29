#### hson-live / hson.terminalgothic.com

# HSON Spec[3]
## HTML Representation in HSON

This section defines the normative mapping between HTML (and HTML-adjacent markup such as SVG/XML) and the HSON node graph.

Unlike JSON, HTML does not purely describe key-value pairs. It includes:
*	mixed content (elements and text interleaved),
*	attributes, a 'third layer' of user data,
*	void elements,
*	namespaces such as SVG,
*	ordering that is semantically meaningful.

The `_hson_elem` VSN exists to preserve these properties when parsing HTML to JSON and back.

⸻

## Scope

This specification applies to:
*	HTML and HTML-compatible markup (including SVG and XML-style elements)
*	Parsing from markup into HSON
*	Serializing HSON back into markup without loss

This section does not describe runtime projection, sanitization policy, or DOM APIs.

⸻

## `_hson_elem` as the Structural Boundary

All HTML content in HSON is represented within `_hson_elem` VSN wrappers within the node graph, and when serialized to JSON. HsonNodes will never serialize to HTML in _hson_elem tags.

#### Rule
*	Except for primitive nodes, any node with content must contain exactly one `_hson_elem` VSN as its structural 'cluster' wrapper.
*  `_hson_elem`, like other 'cluster' nodes `<_hson_obj>` and `<_hson_arr>` nodes, may contain any number of children.
*
* No HTML element, text node, or attribute may exist outside an `_hson_elem` context.
* `<_hson_obj>` and `_hson_elem` node graphs may not be blended

`_hson_elem` establishes HTML context and handling:
*	ordered child nodes,
*	mixed content boundaries,
*	element nesting,
*	the distinction between data and markup semantics.

_hson_elem and <_hson_obj> tags keep their content types separate from each other. Mismatches between the two dataa types (such as prohibition of duplicate keys/`$_tag` values in JSON; the lack of types in HTML) would cause fatal runtime errors unless their handling was clearly telegraphed. `_hson_elem`, `<_hson_obj>`, and `<_hson_arr>` exist to remove any ambiguity during transformation.

⸻

## Element Mapping

Each HTML element maps to a node:
* node.$_tag - the element name
* node.$_content - any child nodes, wrapped in _hson_elem structural layers
* node.$_attrs - (see: ## Attributes, below)

Example:

```
<p>Hello <em>world</em></p>
```

maps to:

```
<p>
 └─ _hson_elem
     ├─<_hson_str>("Hello ")
     ├─ em
     │   └─ _hson_elem
     │       └─<_hson_str>("world")
```

#### Rules
*	Element names are preserved verbatim (case rules follow source semantics).
*	Nesting depth is preserved exactly.
*	Element ordering is preserved and semantically significant.


⸻
## HSON Serialization of HTML Sources
HTML is not converted to HSON by rewriting tag strings directly. HTML is first parsed into the canonical HSON node graph, then that node graph is serialized as HSON text.
This means HSON serialization reflects graph structure, not the original spelling of the HTML source.
#### Pipeline

HTML source
↓ parse
HSON node graph
↓ serialize
HSON text

#### Rule
* HTML elements serialize as HSON element tags.
* HTML attributes serialize as HSON tag attributes.
* HTML text nodes serialize as quoted string leaves.
* Child ordering is preserved exactly.
* Original HTML formatting, quote style, and void-tag spelling are not preserved as source text.
Example:
```html
<main id="root"><div id="box">x</div></main>
```
serializes to:
```html
<main id="root"
  <div id="box"
    "x"
  />
/>
```

This is not a separate representation from the parsed graph. It is the HSON textual serialization of the same element tree.

⸻

Compact Text Serialization

When an element contains a simple text leaf, the serializer may emit that text directly inside the opening HSON tag as a compact form.

Example HTML:
```html
<h1>title</h1>
<p>one</p>
<p>two</p>
```
Expanded HSON serialization:

```html
<h1
  "title"
/>
<p
  "one"
/>
<p
  "two"
/>
```

Compact HSON serialization:

```html
<h1 "title"/>
<p "one"/>
<p "two"/>
```

Both forms represent the same node structure:

h1
└─ _str("title")

The compact form is a serialization convenience only. It does not imply that text is stored as an attribute, tag argument, or special element property.

⸻

Attribute and Content Separation in Serialization

Attributes and content remain separate during serialization.

Example HTML:
```html
<button id="save" disabled>Save</button>
```

Node shape:
```
button
├─ $_attrs
│  ├─ id: "save"
│  └─ disabled: true
└─ _elem
   └─ _str("Save")
```

HSON serialization:
```html
<button id="save" disabled
  "Save"
/>
```

or, where compact text serialization is allowed:
```html
<button id="save" disabled "Save"/>
```

The attribute values belong to the element node. The text content belongs to the ordered element content.

⸻

Mixed Content Serialization

Mixed content is serialized in the same order it appears in the node graph.

Example HTML:
```html
<p>Hello <strong>world</strong>.</p>
```

Node shape:
```
p
└─ _elem
   ├─ _str("Hello ")
   ├─ strong
   │  └─ _elem
   │     └─ _str("world")
   └─ _str(".")
```

HSON serialization:
```html
<p
  "Hello "
  <strong "world"/>
  "."
/>
```


⸻

Void Element Serialization

A void element has no child content. Void elements are serialized by their node structure and regardless of their exact original closing syntax.

Example HTML:
```html
<img src="cat.png" alt="Cat">
```

Node shape:
```
img
├─ $_attrs
│  ├─ src: "cat.png"
│  └─ alt: "Cat"
└─ _elem
```

HSON serialization:
```html
<img src="cat.png" alt="Cat"/>
```

For void elements, HSON preserves the element structure and attributes, but may canonicalize the original HTML closing syntax on first parse.

⸻


Serialization Round-Trip Principle

For all formats, round-trip test targets are the HSON node graph, not the exact original source string. HTML may be canonicalized initially but the structure remains intact over round-trip transformations.

Given:

`<section><h1>Title</h1><p>One</p><p>Two</p></section>`

HSON may serialize the parsed graph as:
```html
<section
  <h1 "Title"/>
  <p "One"/>
  <p "Two"/>
/>
```

If this HSON is parsed again, it must produce the same element/content graph:
```
section
└─ _elem
   ├─ h1
   │  └─ _elem
   │     └─ _str("Title")
   ├─ p
   │  └─ _elem
   │     └─ _str("One")
   └─ p
      └─ _elem
         └─ _str("Two")
```


⸻

A node representing markup content uses `_hson_elem` for ordered element content.

A node representing object or array structure uses `_hson_obj` / `_hson_arr`.

These VSNs describe different structural roles and may not be blended.

⸻

## Text Nodes

Text nodes are represented using either `<_hson_str>` or `<_hson_val>` VSNs. Lacking types, HTML-native content is always parsed into `<_hson_str>` tags. For JSON-native data, `<_hson_val>` nodes exist as a parser hint to preserve types across transformations.

#### Rules
*	String text content must be wrapped in <_hson_str>.
*	When parsing typed data from JSON, such as numbers, `<_hson_val>` tags keep it separate and safe from stringification.
*	Text nodes may appear anywhere within `_hson_elem` VSNs.
*	Whitespace is preserved as encountered by the parser.

Text is not normalized, merged, or reordered.

⸻

## Attributes

Attributes are represented as data, not syntax.

#### Mapping
*	Attributes are stored on the node’s attribute map (*not* as children).
*	Attribute names and values are preserved exactly.
*	Boolean attributes are preserved explicitly.

Example:
```html
<input disabled value="x">
```
maps to:
```
input
 ├─ $_attrs:
 │   ├─ disabled: true
 │   └─ value: "x"
 └─ _hson_elem
```
Notes
*	Attribute presence vs value is preserved.
*	Attribute ordering is not semantically significant after parsing.

⸻

## Void Elements

Void elements (e.g. img, br, input) are represented as nodes with an empty _hson_elem.

#### Rules
*	Void elements still contain an _hson_elem node.
*	_hson_elem is empty and must not contain children.
*	The voidness is inferred from tag semantics, not from structure.

This ensures uniform handling of all elements.

⸻

## Mixed Content Guarantees

HTML allows arbitrary interleaving of text and elements.

HSON preserves this exactly by:
*	using `_hson_elem` as an ordered container,
*	representing text (and all HTML-native textcontent) as <_hson_str>,
*	representing typed primitives as <_hson_val>,
*	representing elements as child nodes.

No flattening or normalization occurs.

⸻

## Namespaces (SVG / XML)

Namespaced elements and attributes are preserved verbatim.

#### Rules
*	Namespaced tag names are preserved as-is.
*	Namespace prefixes are not stripped or inferred.
*	SVG and XML structures are treated identically to HTML at the structural level.

HSON does not reinterpret namespaces; it preserves them.

⸻

## Round-Trip Guarantees

Given valid HTML H:
	1.	Parsing H into HsonNodes
	2.	Serializing the resulting node graph back to HTML

must produce markup H′ such that:
*	element structure is preserved
*	attribute presence and values are preserved
*	text content and ordering are preserved
*	mixed content boundaries are preserved
*	if reparsed again into HsonNodes, the node graph is identical to the first

Formatting differences (whitespace, quoting style) are not considered violations.

⸻

## Relationship to JSON Mapping

HTML and JSON differ structurally:
*	JSON is value-oriented
*	HTML is content-oriented and ordered

HSON reconciles this by:
*	using `<_hson_obj>` / `<_hson_arr>` for JSON semantics
*	using `_hson_elem` for markup semantics

These VSNs never overlap in responsibility.

A node representing markup content uses `_hson_elem` for ordered element content.
A node representing object or array structure uses `_hson_obj` / `_hson_arr`.

These VSNs describe different structural roles and may not be blended.

####  Node graphs that mix `_hson_elem` and `_hson_obj` types are invalid and may cause parser errors.


© 2026 terminal_gothic. All rights reserved except as granted under the Public Parity License 7.0
