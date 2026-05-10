#### hson-live / terminalgothic.com/hson

# HSON Spec[2]
## JSON Representation in HSON

This section defines the normative mapping between JSON values and the HSON node graph.
It specifies how JSON structures are represented internally, independent of syntax, parser, or runtime projection.

This mapping enables a lossless, deterministic round-trip conversion between JSON and HTML via HSON.

⸻

## Scope

This specification applies to:
*	JSON values as defined by ECMA-404:
*	object
*	array
*	string
*	number
*	boolean
*	null
*	Their representation within the HSON node graph
*	Serialization back to JSON without structural drift

This section does not describe HTML, markup syntax, or runtime behavior.

⸻

## HSON Node Model (Summary)

All JSON values are represented using HsonNode structures and a fixed set of Virtual Structural Nodes (VSNs).

A HsonNode consists of:
*	a tag name (the "key")
*	an ordered list of child nodes (the "value")
*	optional metadata and attributes 

Primitive values never appear directly as children of arbitrary nodes.
They are always wrapped in explicit primitive VSNs.

⸻

## JSON Object Mapping

A JSON object is represented as a node containing an <_-obj> VSN. The position of the <_-obj> tag roughly mirrors the position of the curly braces that would delimit the object in JSON, and are serialized to JSON as such.
Nodes other than 'cluster' VSNs - <_-obj>, <_-elem>, <_-arr> -  may not contain multiple child nodes in their _content properties. Other than primitive-containing <_-str> and <_-val> tags, **every node's _content property is wrapped in its native cluster VSN**, even if the propery contains a single child node. 

Accurate preservation of cluster structure using these VSNs is a core requirement for HSON, as <_-obj> and <_-elem> shapes look similar but are fundamentally incompatible. 

#### Mapping rules
*	Each JSON object maps to exactly one <_-obj> node.
*	Each property of the object is represented as a child node of <_-obj>.
*	Property names are represented as node _tags.
*	Property values are represented as _content under their corresponding 'key' property node.

#### Conceptual Example:
```
{
  "a": 1,
  "b": "x"
}
```
maps to:
```
<_-obj>
 ├─ a
 │   └─ <_-val>(1)
 └─ b
     └─<_-str>("x")
```
#### Notes
*	JSON object ordering is not semantically significant and is not interpreted as meaningful.
*	HSON canonicalizes JSON property order once at parsing.

⸻

## JSON Array Mapping

A JSON array is represented as a node containing an <_-arr> VSN. 

#### Mapping rules
*	Each array maps to exactly one <_-arr> node.
*	Each element of the array is wrapped in an <_-ii> (index item) node.
*	<_-ii> nodes preserve array ordering by carrying the index number in _meta.data-_index.
*	Each <_-ii> contains exactly one child representing the element value. <_-ii> nodes may also contain <_-arr> or <_-obj> nodes

#### Example:
```
[1, "x", true]
```
maps to:
```
<_-arr>
 ├─ <_-ii> → <_-val>(1)
 ├─ <_-ii> →<_-str>("x")
 └─ <_-ii> → <_-val>(true)
```

⸻

## Primitive Value Mapping

Primitive values are represented using dedicated primitive VSNs.

#### Primitive VSNs
Primitive VSNs are the 'endpoint' for HsonNode graphs, containing the 'value' of the ordered pair. To preserve JSON's typed primitives when converted to untyped HTML, typed VSNs act as parser hints to dictate how to handle a given value.

* type -> VSN _tag
* string ->	<_-str>
* number ->	<_-val>
* boolean ->	<_-val>
* null ->	<_-val>

Rules
*	Primitive values must appear only within primitive nodes: <_-str> or <_-val>.
*	Primitive values may not appear directly as children of non-primitive nodes.
*	<_-str> preserves string content verbatim.
*	<_-val> preserves numeric, boolean, and null. It is a parser hint to coerce the node's string value to a typed primitive on reentry into JSON. 

⸻

## Mixed and Nested Structures

JSON values may be nested arbitrarily.

The mapping rules above apply recursively:
*	Objects may contain arrays
*	Arrays may contain objects
*	Any structure depth is permitted

No information is discarded or reinterpreted during nesting.

⸻

## Round-Trip Guarantees

Given a valid JSON value J:
1.	Parsing J into HsonNode IR
2.	Serializing the resulting node graph back to JSON

must produce a JSON value J′ such that:
*	J′ is structurally equivalent to J
*	All values are preserved exactly
*	No keys or values are added, removed, or coerced
*	If J′ is reparsed into HsonNodes again, the second node graph will be identical to the first

Whitespace, formatting, and source-level ordering are not part of this guarantee.

⸻

## Canonicalization

HSON does not impose semantic meaning on:
*	object property order
*	formatting choices
*	source syntax

However, once parsed into the node graph:
*	the structure is explicit
*	value semantics are fixed
*	transformations are deterministic

This canonical form is the basis for HTML mapping, runtime projection, and reactive systems described in later sections.

⸻

## Non-Goals

This mapping does not attempt to:
*	validate JSON schemas
*	infer types
*	enforce application-level constraints
*	interpret JSON as markup

It describes representation only.

© 2026 terminal_gothic. All rights reserved except as granted under the Public Parity License 7.0