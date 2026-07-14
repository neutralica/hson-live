#### hson-live / hson.terminalgothic.com

# HSON Spec[2]
## JSON Representation in HSON
Updated: 2026-07-13

This section describes how JSON values map to `HsonNode` and back. JSON input
accepts either a JSON string or an already parsed `JsonValue`.

---

## Root and cluster model

Every parsed JSON value is placed under `_hson_root`, whose one child is a
cluster:

- objects use `_hson_obj`;
- arrays use `_hson_arr`; and
- a top-level scalar is structurally wrapped so the root still owns a cluster.

JSON property names become ordinary `$_tag` values. The `_hson_` prefix is
reserved for structural keys and is rejected in ordinary user JSON, apart from
the parser's explicit structural `_hson_elem` interchange form.

---

## Objects

Each JSON object maps to `_hson_obj`. Each property becomes one child node, and
ordinary child tags must be unique.

For a scalar property, the actual graph retains an object cluster layer below
the property node:

```text
_hson_obj
└─ title
   └─ _hson_obj
      └─ _hson_str ("Hello")
```

Nested objects recurse through the same property/cluster arrangement. This
wrapper structure is part of the current IR even when serialized HSON presents
the shorter form `<title "Hello">`.

JSON object key order is not semantically significant. Parsing initially walks
the input object's current enumeration order, but JSON serialization sorts keys
canonically. Therefore a parse/serialize/reparse cycle preserves the JSON value
but need not produce a node graph with the original property order.

---

## Arrays

An array maps to `_hson_arr`. Every item is wrapped by `_hson_ii`, which holds
exactly one node and string metadata at `data-_index`:

```text
_hson_arr
├─ _hson_ii { data-_index: "0" }
│  └─ _hson_val (1)
├─ _hson_ii { data-_index: "1" }
│  └─ _hson_str ("x")
└─ _hson_ii { data-_index: "2" }
   └─ _hson_val (true)
```

The array serializer uses the physical `_hson_ii` order in `$_content`.
`data-_index` is required structural metadata and is checked for presence and
string type, but it is not used to sort or reorder items.

Array items can be scalars, arrays, or objects. Objects in HSON array syntax use
an anonymous object wrapper because an array item has no property name:

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

---

## Primitives

JSON strings use `_hson_str`. Numbers, booleans, and `null` use `_hson_val`.
Each leaf contains exactly one raw primitive.

```text
"42"  -> _hson_str ("42")
42    -> _hson_val (42)
false -> _hson_val (false)
null  -> _hson_val (null)
```

The VSN distinction prevents numbers, booleans, and null from being silently
converted to strings when routed through HSON or markup.

---

## HTML structure represented in JSON

JSON output can carry element-mode graphs using a literal `_hson_elem` member
whose value is an ordered array. This scaffolding preserves duplicate element
tags, text/element interleaving, and attributes—properties that an ordinary
JSON object cannot model directly.

Conversely, converting JSON structure to HTML can emit literal VSN scaffolding
needed to preserve JSON objects, arrays, and typed values. Cross-format output
is therefore structurally faithful, but it is not promised to look like
idiomatic hand-authored data in the other format.

---

## Round-trip contract

For valid JSON input, JSON -> node -> JSON preserves:

- object/array/scalar structure;
- property names;
- array order; and
- string, number, boolean, and null identity.

The serialized JSON string is canonicalized. Whitespace and source property
order are not preserved, and a reparsed node graph need not be byte-for-byte or
order-identical to the first graph. The appropriate equality test is JSON value
equivalence, with array order retained and object order ignored.

---

## Non-goals

This mapping does not validate schemas, infer application types, attach meaning
to property order, or interpret ordinary JSON strings as markup.

© 2026 terminal_gothic. All rights reserved except as granted under the Public Parity License 7.0
