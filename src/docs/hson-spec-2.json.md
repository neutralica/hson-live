// hson-spec-2.json.md

# HSON Spec Part 2
# JSON Representation in HSON

This section defines the normative mapping between JSON values and the HSON node graph.
It specifies how JSON structures are represented internally, independent of syntax, parser, or runtime projection.

This mapping enables a lossless, deterministic round-trip conversion between JSON and HTML via HSON.

⸻

## 2.1 Scope

This specification applies to:
	•	JSON values as defined by ECMA-404:
	•	object
	•	array
	•	string
	•	number
	•	boolean
	•	null
	•	Their representation within the HSON node graph
	•	Serialization back to JSON without structural drift

This section does not describe HTML, markup syntax, or runtime behavior.

⸻

## 2.2 HSON Node Model (Summary)

All JSON values are represented using HsonNode structures and a fixed set of Virtual Structural Nodes (VSNs).

A HsonNode consists of:
	•	a tag name (the "key")
	•	an ordered list of child nodes (the "value")
	•	optional metadata and attributes 

Primitive values never appear directly as children of arbitrary nodes.
They are always wrapped in explicit primitive VSNs.

⸻

## 2.3 JSON Object Mapping

A JSON object is represented as a node containing an <_obj> VSN. The position of the <_obj> tag roughly mirrors the position of the curly braces that would delimit the object in JSON, and are serialized to JSON as such.
Except for 'cluster' VSNs - <_obj>, <_elem>, <_arr> - HsonNodes may not contain multiple child nodes in their _content properties. **every node's _content property is wrapped in its native cluster VSN**, even if the propery contains a single child node. 

Accurate preservation of cluster structure using these VSNs is a core requirement for HSON, as <_obj> and <_elem> shapes look similar but are fundamentally incompatible. 

Mapping rules
	•	Each JSON object maps to exactly one <_obj> node.
	•	Each property of the object is represented as a child node of <_obj>.
	•	Property names are represented as node _tags.
	•	Property values are represented as _content under their corresponding 'key' property node.

Example (conceptual):
```
{
  "a": 1,
  "b": "x"
}
```
maps to:
```
<_obj>
 ├─ a
 │   └─ <_val>(1)
 └─ b
     └─<_str>("x")
```
Notes
	•	JSON object ordering is not semantically significant and is not interpreted as meaningful.
	•	HSON canonicalizes JSON property order once at parsing.

⸻

## 2.4 JSON Array Mapping

A JSON array is represented as a node containing an <_arr> VSN. 

Mapping rules
	•	Each array maps to exactly one <_arr> node.
	•	Each element of the array is wrapped in an <_ii> (index item) node.
	•	<_ii> nodes preserve array ordering by carrying the index number in _meta.data-_index.
	•	Each <_ii> contains exactly one child representing the element value. <_ii> nodes may also contain <_arr> or <_obj> nodes

Example:
```
[1, "x", true]
```
maps to:
```
<_arr>
 ├─ <_ii> → <_val>(1)
 ├─ <_ii> →<_str>("x")
 └─ <_ii> → <_val>(true)
```

⸻

## 2.5 Primitive Value Mapping

Primitive values are represented using dedicated primitive VSNs.

Primitive VSNs
Primitive VSNs are the 'endpoint' for HsonNode graphs, containing the 'value' of the ordered pair. To preserve JSON's typed primitives when converted to untyped HTML, typed VSNs act as parser hints to dictate how to handle a given value.

type -> VSN _tag
string ->	<_str>
number ->	<_val>
boolean ->	<_val>
null ->	<_val>

Rules
	•	Primitive values must appear only within primitive nodes: <_str> or <_val>.
	•	Primitive values may not appear directly as children of non-primitive nodes.
	•	<_str> preserves string content verbatim.
	•	<_val> preserves numeric, boolean, and null. It is a parser hint to coerce the node's string value to a typed primitive on reentry into JSON. 

⸻

## 2.6 Mixed and Nested Structures

JSON values may be nested arbitrarily.

The mapping rules above apply recursively:
	•	Objects may contain arrays
	•	Arrays may contain objects
	•	Any structure depth is permitted

No information is discarded or reinterpreted during nesting.

⸻

## 2.7 Round-Trip Guarantees

Given a valid JSON value J:
	1.	Parsing J into HsonNode IR
	2.	Serializing the resulting node graph back to JSON

must produce a JSON value J′ such that:
	•	J′ is structurally equivalent to J
	•	All values are preserved exactly
	•	No keys or values are added, removed, or coerced
	•	If J′ is reparsed into HsonNodes again, the second node graph will be identical to the first

Whitespace, formatting, and source-level ordering are not part of this guarantee.

⸻

## 2.8 Canonicalization

HSON does not impose semantic meaning on:
	•	object property order
	•	formatting choices
	•	source syntax

However, once parsed into the node graph:
	•	the structure is explicit
	•	value semantics are fixed
	•	transformations are deterministic

This canonical form is the basis for HTML mapping, runtime projection, and reactive systems described in later sections.

⸻

## 2.9 Non-Goals

This mapping does not attempt to:
	•	validate JSON schemas
	•	infer types
	•	enforce application-level constraints
	•	interpret JSON as markup

It describes representation only.
