// hson-spec-1-nodes.md

# HSON Spec[1]
##Nodes, Structure, and Invariants

## 1. Overview

HSON is defined around a single structural intermediate representation (IR): the HsonNode graph.

All supported formats—JSON, HTML, SVG, XML, and HSON’s own surface syntax—are parsed into this representation before any transformation, rendering, or serialization occurs. All output formats are derived from this same representation.

The HsonNode graph is lossless, order-preserving, and round-trip stable. This section defines the structure, invariants, and semantics of that graph.

⸻

## 2. Fundamental Properties

An HsonNode graph must satisfy the following properties:

####  Tree-structured
The graph forms a rooted, ordered tree. Cycles are not permitted.

####  Order-preserving
The relative order of child nodes is significant and must be preserved across transformations.

####  Typed by role, not by syntax
Nodes encode semantic roles (element, object, array, value) independently of their source format.

####  Format-neutral
No node implicitly “belongs” to JSON, HTML, or any other surface syntax.

⸻

## 3. HsonNode Structure

An HsonNode is a structured object with the following conceptual components:

### 3.1 Required Fields

Every HsonNode must contain:

#### _tag
A string identifying the node’s role or semantic type.

#### _content: may be `[]` (empty)
An ordered list of child entries.
_content values may be:
*	other HsonNodes
*	primitive values (string, number, boolean, null) -- IF contained in the _content of a string or value node (see below)
*	HSON accepts all valid JSON values. Typed values (1 vs "1") are preserved via the use of <_str> and <_val> VSNs (see §4, below)

HSON's `_tag:_content` structure mirrors JSON's `key:value` pair and HTML's `parent/child node` relationships exactly. 

### 3.2 Optional Fields

HsonNodes may additionally contain two other properties:

#### _attrs
A map of HTML attributes and/or boolean attributes ("flags") to their primitive values.

#### _meta

Internal metadata used to preserve structural distinctions (e.g., array indexes, _quids: 'Quantum Unique IDs').

_meta is considered structural support data and not part of the node's semantic content.

⸻

## 4. Virtual Structural  Nodes (VSNs)

Certain _tag values are reserved to encode structure that does not correspond to a literal HTML tag or JSON key. These are referred to as Virtual Structural Nodes (VSNs). Specifically, HSON forbids all underscored tags in user data, reserving those for structure-preserving elements as described below:

### 4.1 Core VSN Tags

VSNs define and preserve the structural meaning of content in the node graph. The following VSN tags are normative:

#### <_elem>
Element: Represents an HTML Element 'cluster'.
*	<_elem> tags can contain multiple of the same key/_tag.

#### <_obj>
Object: Represents a JSON object 'cluster'.
*	encodes key–value pairs as child nodes.
*	child nodes must have unique key/_tags.

<_obj> and <_elem> are required for disambiguation of HsonNode 'clusters'. Though the shapes of <_elem> and <_obj> structures are very similar, each have differences that cause fatal errors in the other (such as JSON objects' requirement for unique keys, whereas HTML elements may contain multiple 'button' tags).

#### <_arr>
Array: Represents a JSON array.
*	must contain only <_ii>-wrapped children.
*	Order of items is preserved by <_ii> nodes' _meta.data-_index properties.

#### <_ii>
Index Item: Represents a single array item and carries the index number.
*	must appear only as a child of <_arr>.
*	must contain exactly one semantic value (primitive or node).
*	must have a '_meta.data-_index' property carrying the item's order in the array sequence

#### <_str>
String: Represents a string literal. Only <<_str>> tags may contain raw string primitives in its _content property.

#### <_val>
Value: Represents a non-string primitive literal (number, boolean, null). Only <_val> tags may contain raw non-string data in its _content property

#### <_root>
Root: Represents the base 'wrapper' node of a HSON tree undergoing transformation. 
*	To survive XML parsing, all HSON content must be contained within a single element
*	To ensure consistency, HSON's transformers wrap content under operation in a <_root> tag during processin. This tag is unwrapped on serialization or appending to other nodes and is usually not exposed publicly. 


### Note:
<_elem> tags, as well as _attrs properties, will only be derived from HTML sources of data. 
<_obj> tags, <_arr>/<_ii> tags will only be derived from JSON data. 

⸻

## 5. Primitive Values

Primitive values may only appear wrapped inside <_str> or <_val> nodes. Primitives appearing in the _content of other tags will cause an error in the HSON parser. HSON's transformer chain handles all creation of such nodes and they are effectively hidden from the user. 

#### Maxims:
*	Strings must be representable without loss of encoding.
*	Numbers must preserve numeric identity (no unintended stringification or coercion) across transforms.
*	Boolean and null values must also be preserved distinctly, rather than e.g. as strings.

⸻

## 6. HTML Attributes

Attributes are represented as data, not syntax.
*	Attribute ordering must be preserved where the source format defines ordering.
*	Boolean attributes must be representable distinctly from string-valued attributes.
*	Attribute names are case-sensitive unless the source format specifies otherwise.

Attribute ordering is canonicalized on first parsing for consistency. Attribute data is never coerced into _tag or _content values; it is always mapped within the _attrs/HsonAttrs propertry.

⸻

## 7. Mixed Content

Especially When derived from native HTML, HsonNode _content may contain a mix of HsonNodes and primitive values (typically strings) - these must always be contained within <_str> or <_val> tags, as noted above

Attempting this mixed content within a JSON could lead to creation of an invalid object with duplicated keys, or a keyless value like an array:
{a: "1", b: "2", "no key", d: "4"  }
Permitting and preserving this mixed structure in <_elem>, but not in <_obj> - even when that HTML element is parsed into JSON - is one of the main reasons for the existence of these VSN tags and allows faithful representation of:
*	HTML mixed content
*	text interleaved with elements
*	markup embedded within data structures

⸻

## 8. Identity and Stability

HSON nodes may carry a stable identity token, referred to as a QUID (Quantum Unique ID).

A QUID preserves the continuity of node identity across transformations and runtime projections. When present, it allows a node to be recognized as “the same thing” even if it is rebuilt, moved, or re-emitted in a different form.

QUIDs are optional and assigned lazily. Most transformations do not require it, but runtime systems such as LiveTree use QUIDs to support stable styling, event binding, and structural updates without reconciliation. They are created when a node is queried or created, so that the variable reference stays fresh even after redrawing of the LiveTree during mutation. 

QUIDs are properties for LiveTree's internal use and are contained within a node's `_meta.data-_quid` property. They may appear in metadata or DOM attributes during debugging or serialization, but users should not need to interact with them directly.
⸻

## 9. Invariants

The following invariants must always hold.
	
No transformation may:
*	collapse mixed content
*	reinterpret or coerce primitives
*	discard attributes without explicit instruction
	Serializing to another format and reparsing back into HsonNode IR must yield an equivalent node graph.

'Equivalent' here means:
*	identical structure
*	identical ordering
*	identical primitive values
*	identical semantic roles

⸻

## 10. Non-Goals

The HsonNode model intentionally does not attempt to:
*	enforce schemas
*	validate business rules
*	interpret semantics beyond structure
*	infer intent beyond the source data

Those concerns are explicitly layered above the node model.

⸻
