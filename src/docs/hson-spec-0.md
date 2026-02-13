// hson-spec-0.md

# HSON Serialized Syntax

This section describes the serialized textual form of HSON: the string format produced when a HsonNode graph is serialized to HSON, and the format accepted by the HSON parser.

HSON is an HTML-like syntax designed to serialize either JSON-derived or HTML-derived node graphs without introducing format-specific scaffolding. It is not HTML, though it intentionally resembles it.

⸻

## 1. Basic Form

HSON consists of nodes with:
	•	a tag name
	•	optional attributes
	•	optional child content

Every serialized HSON document represents a tree of nodes. A HsonNode's _tag and _content correspond 1:1 with key:value and parent:child node.

### Canonical form

<tag attrs?="?" flags?
  ...children?
>

Unlike HTML/XML, HSON tag names are displayed only once, when opening the tag. All content, attributes, and metadata are contained within the open tag.  
Tags are closed by > (if representing an object) or /> (if representing an element). There is no implicit closing.

⸻

## 2. Node Closure Rules

HSON uses two distinct closure forms, with strict meaning.

2.1 Structural close (> or />)

A node that may contain children always closes with > or />, even if it happens to have none at the moment. Nodes that are begun but not eventually closed with > will cause a parser error. 

<_obj>

This represents a node that exists as a structural container.

This is why _obj, _arr, and other structural nodes never close with />.

This rule is essential: structural nodes are never self-closing.

⸻

2.2 Self-closing form (/>)

The self-closing form is reserved for leaf nodes whose entire payload is known at declaration time.

<title "On Trees and Structure" />
<published true />

Self-closing nodes:
	•	have no children
	•	carry either attributes or an inline primitive payload
	•	do not imply structural containment

If a node is structural, or may contain children later, /> is invalid.

⸻

3. Inline Primitive Payloads

HSON supports a compact inline form for nodes whose content is a single primitive value.

<views 18342 />
<ratio 0.0279 />
<updated null />
<title "On Trees and Structure" />

This is syntactic sugar over the underlying node representation:
	•	primitive values are always represented internally via _str or _val VSNs
	•	the inline form exists only at the serialization layer
	•	there is no such thing as a “raw primitive” node

Quoting rules
	•	Strings must be quoted
	•	Numbers, booleans, and null are unquoted

"name"      → string
42          → number
true        → boolean
null        → null


⸻

4. Child Content

Child content appears as nested nodes or literals inside a container node.

<p
  "JSON and"
  <em "HTML" />
  "are often treated as opposites."
>

This represents ordered child content. Text and elements coexist naturally.

There is no concept of “text inside an element” separate from the node tree — text is simply a primitive child.

⸻

## 5. Attributes

Attributes appear inside the opening tag, before content. When attributes and content are both present, the node introduces the content on a newline, to maintain clear visual separation. When only attributes or primitive content is present on a node, it is serialized as a single line

<article id="post-042" class="entry featured"
  ...
>

Attributes:
	•	are HTML metadata, not content
    •	are stored in the _attrs property, not in _content
	•	are not ordered semantically
	•	map directly to _attrs internally
	•	are serialized as `foo="bar"`

Attributes never appear as child nodes.

⸻

## 6. Arrays (« » syntax)

HSON provides a compact array literal syntax.

<tags
  «
    "hson",
    "json",
    "html",
    "structure"
  »
>

This is equivalent to an internal _arr node with _iindexed children.
HSON parsers accept brackets as array delimiters provided the closer is consistent. If reserialized, all arrays use guillemet delimiters regardless of input symbol. 

Notes:
	•	« » is purely a serialization convenience and minor visual flourish
	•	internally, arrays are still represented structurally via VSNs
	•	array order is preserved through the use of internal _ii nodes
	•	array items may be primitives or full nodes, and may be mixed

Nested arrays and objects are permitted exactly as with JSON.

⸻

## 7. Objects as Nodes

When serializing JSON-derived data to HSON, object properties are represented as named child nodes.

<author
  <name "Neutralica" />
  <handle "@terminal_gothic" />
  <roles
    «
      "author",
      "maintainer"
    »
  >
>

There is no explicit “object literal” syntax at the HSON layer. Object-ness is expressed structurally by containment.

⸻

8. Structural Nodes and VSNs

Some nodes exist solely to preserve structure across formats. These are Virtual Structural Nodes (VSNs).

Common examples:
	•	_obj — object container
	•	_arr — array container
	•	_ii  — array item
	•	_str — string primitive
	•	_val — non-string primitive

VSNs:
	•	are always structural
	•	always close with >
	•	never use />
	•	are required when serializing HTML or JSON into the other format
	•	are omitted in HSON serialization wherever the syntax can express the structure directly

This is why HSON serialization appears cleaner than JSON→HTML projections.

⸻

9. Identity (data-_quid)

Nodes may carry a stable identity token via metadata:

<p data-_quid="Q7f3c"
  "Hello"
>

Notes:
	•	data-_quid is an internal identity mechanism
	•	it may or may not be serialized depending on context
	•	it is not part of the semantic data model
	•	users rarely need to interact with it directly

⸻

10. XML Correctness

HSON is parsed via an XML parser. As a result:
	•	tags must be properly nested
	•	attributes must be well-formed
	•	all nodes must be explicitly closed (> or />)

This enforces syntactic correctness but does not enforce HTML semantics or browser repair rules.

⸻

11. What HSON Is (at the Syntax Level)
	•	HSON is not HTML
	•	HSON is not JSON
	•	HSON is a serialization of a unified node graph that can project cleanly to either

It exists to serialize HsonNode graphs without introducing format-specific scaffolding, not to replace HTML or JSON as external interchange formats.

⸻

If you want, the next clean step is:
	•	a one-page mapping table: JSON → HSON → HTML (purely mechanical)
	•	or a short appendix explaining why _obj/_arr/_ii appear in HTML projections but not in HSON

But this section above should stand on its own as the “what am I looking at?” anchor for the whole system.