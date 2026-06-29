#### hson-live / hson.terminalgothic.com

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

A JSON object is represented as a node containing an <_hson_obj> VSN. The position of the <_hson_obj> tag roughly mirrors the position of the curly braces that would delimit the object in JSON, and are serialized to JSON as such.
Nodes other than 'cluster' VSNs - <_hson_obj>, <_hson_elem>, <_hson_arr> -  may not contain multiple child nodes in their `$_content` properties. Other than primitive-containing <_hson_str> and <_hson_val> tags, **every node's `$_content` property is wrapped in its native cluster VSN**, even if the propery contains a single child node.

Accurate preservation of cluster structure using these VSNs is a core requirement for HSON, as <_hson_obj> and <_hson_elem> shapes look similar but are fundamentally incompatible.

#### Mapping rules
*	Each JSON object maps to exactly one <_hson_obj> node.
*	Each property of the object is represented as a child node of <_hson_obj>.
*	Property names are represented as node `$_tag` values.
*	Property values are represented as `$_content` under their corresponding 'key' property node.

#### Conceptual Example:
```
{
  "a": 1,
  "b": "x"
}
```
maps to:
```
<_hson_obj>
 ├─ a
 │   └─ <_hson_val>(1)
 └─ b
     └─<_hson_str>("x")
```
#### Notes
*	JSON object ordering is not semantically significant and is not interpreted as meaningful.
*	HSON canonicalizes JSON property order once at parsing.

⸻

## JSON Array Mapping

A JSON array is represented as a node containing an <_hson_arr> VSN.

#### Mapping rules
*	Each array maps to exactly one <_hson_arr> node.
*	Each element of the array is wrapped in an <_hson_ii> (index item) node.
*	<_hson_ii> nodes preserve array ordering by carrying the index number in `$_meta.data-_index`.
*	Each <_hson_ii> contains exactly one child representing the element value. <_hson_ii> nodes may also contain <_hson_arr> or <_hson_obj> nodes

#### Example:
```
[1, "x", true]
```
maps to:
```
<_hson_arr>
 ├─ <_hson_ii> → <_hson_val>(1)
 ├─ <_hson_ii> →<_hson_str>("x")
 └─ <_hson_ii> → <_hson_val>(true)
```

⸻

## Primitive Value Mapping

Primitive values are represented using dedicated primitive VSNs.

#### Primitive VSNs
Primitive VSNs are the 'endpoint' for HsonNode graphs, containing the 'value' of the ordered pair. To preserve JSON's typed primitives when converted to untyped HTML, typed VSNs act as parser hints to dictate how to handle a given value.

* type -> VSN `$_tag`
* string ->	<_hson_str>
* number ->	<_hson_val>
* boolean ->	<_hson_val>
* null ->	<_hson_val>

Rules
*	Primitive values must appear only within primitive nodes: <_hson_str> or <_hson_val>.
*	Primitive values may not appear directly as children of non-primitive nodes.
*	<_hson_str> preserves string content verbatim.
*	<_hson_val> preserves numeric, boolean, and null. It is a parser hint to coerce the node's string value to a typed primitive on reentry into JSON.

⸻

## Mixed and Nested Structures

JSON values may be nested arbitrarily.

The mapping rules above apply recursively:
*	Objects may contain arrays
*	Arrays may contain objects
*	Any structure depth is permitted

No information is discarded or reinterpreted during nesting.

⸻

### Object Items in Arrays

Objects inside arrays must serialize with an anonymous object wrapper.

Array items have no property name, so object boundaries cannot be inferred from
their child properties alone. The wrapper groups all properties belonging to the
same array item.

```ts
[
  <
    <name "jo">
    <age 31>
  >
]
```
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
⸻

## Non-Goals

This mapping does not attempt to:
*	validate JSON schemas
*	infer types
*	enforce application-level constraints
*	interpret JSON as markup

It describes representation only.

© 2026 terminal_gothic. All rights reserved except as granted under the Public Parity License 7.0
