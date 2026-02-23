// hson-spec-3-html.md

# HSON Spec[3]
## HTML Representation in HSON

This section defines the normative mapping between HTML (and HTML-adjacent markup such as SVG/XML) and the HSON node graph.

Unlike JSON, HTML does not purely describe key-value pairs. It includes:
*	mixed content (elements and text interleaved),
*	attributes, a 'third layer' of user data,
*	void elements,
*	namespaces such as SVG,
*	ordering that is semantically meaningful.

The <_elem> VSN exists to preserve these properties when parsing HTML to JSON and back.

⸻

## 3.1 Scope

This specification applies to:
*	HTML and HTML-compatible markup (including SVG and XML-style elements)
*	Parsing from markup into HSON
*	Serializing HSON back into markup without loss

This section does not describe runtime projection, sanitization policy, or DOM APIs.

⸻

## 3.2 <_elem> as the Structural Boundary

All HTML content in HSON is represented within <_elem> VSN wrappers.

#### Rule
*	Except for primitive nodes, any node containing markup content must contain exactly one <_elem> VSN as its structural 'cluster' wrapper. <_elem> nodes, like <_obj> and <_arr> nodes, may contain any number of children (which is why they're described as 'clusters') 
*	No HTML element, text node, or attribute may exist outside an <_elem> context.

<_elem> establishes:
*	child ordering,
*	mixed content boundaries,
*	element nesting,
*	the distinction between data and markup semantics.

Without <_elem>, HTML cannot be represented faithfully; elements would be treated as objects and the mismatches between the two types (no duplicate keys/_tags in JSON; raw text content in HTML) would cause fatal runtime errors.

⸻

## 3.3 Element Mapping

Each HTML element maps to:
*	a node whose tag name is the element name
*	whose _content is wrapped within an <_elem>

Example:

```
<p>Hello <em>world</em></p>
```

maps to:

```
<p>
 └─ <_elem>
     ├─<_str>("Hello ")
     ├─ em
     │   └─ <_elem>
     │       └─<_str>("world")
```

#### Rules
*	Element names are preserved verbatim (case rules follow source semantics).
*	Nesting depth is preserved exactly.
*	Element ordering is preserved and semantically significant.

⸻

## 3.4 Text Nodes

Text nodes are represented using either <_str> or <_val> VSNs. Lacking types, HTML-native content is always parsed into <_str> tags. For JSON-native data, <_val> nodes exist as a parser hint to preserve types across transformations.

#### Rules
*	String text content must be wrapped in <_str>.
*	When parsing typed data from JSON, such as numbers, <_val> tags keep it separate and safe from stringification.
*	Text nodes may appear anywhere within <_elem> VSNs.
*	Whitespace is preserved as encountered by the parser.

Text is not normalized, merged, or reordered.

⸻

## 3.5 Attributes

Attributes are represented as data, not syntax.

#### Mapping
*	Attributes are stored on the node’s attribute map (*not* as children).
*	Attribute names and values are preserved exactly.
*	Boolean attributes are preserved explicitly.

Example:
```
<input disabled value="x">
```
maps to:
```
input
 ├─ _attrs:
 │   ├─ disabled: true
 │   └─ value: "x"
 └─ <_elem>
```
Notes
*	Attribute presence vs value is preserved.
*	Attribute ordering is not semantically significant after parsing.

⸻

## 3.6 Void Elements

Void elements (e.g. img, br, input) are represented as nodes with an empty <_elem>.

#### Rules
*	Void elements still contain <_elem>.
*	<_elem> is empty and must not contain children.
*	The voidness is inferred from tag semantics, not from structure.

This ensures uniform handling of all elements.

⸻

## 3.7 Mixed Content Guarantees

HTML allows arbitrary interleaving of text and elements.

HSON preserves this exactly by:
*	using <_elem> as an ordered container,
*	representing text (and all HTML-native textcontent) as <_str>,
*	representing typed primitives as <_val>,
*	representing elements as child nodes.

No flattening or normalization occurs.

⸻

## 3.8 Namespaces (SVG / XML)

Namespaced elements and attributes are preserved verbatim.

#### Rules
*	Namespaced tag names are preserved as-is.
*	Namespace prefixes are not stripped or inferred.
*	SVG and XML structures are treated identically to HTML at the structural level.

HSON does not reinterpret namespaces; it preserves them.

⸻

## 3.9 Round-Trip Guarantees

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

## 3.10 Relationship to JSON Mapping

HTML and JSON differ structurally:
*	JSON is value-oriented
*	HTML is content-oriented and ordered

HSON reconciles this by:
*	using <_obj> / <_arr> for JSON semantics
*	using <_elem> for markup semantics

These VSNs never overlap in responsibility.

A node representing HTML always uses <_elem>.
A node representing JSON structure never does.

####  Node graphs that mix _elem and _obj types are invalid and will cause parser errors. 

⸻

## 3.11 Non-Objectives

This mapping does not attempt to:
*	enforce HTML semantic validity or browser-specific correction rules
*	infer meaning or structure from tag names (non-VSN)
*	repair broken markup except to require XML well-formedness 
*	impose rendering rules
*	normalize authoring style

It describes representation only.
