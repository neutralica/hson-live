// hson-spec-0-syntax.md

# HSON Spec
# 0 - Serialized Syntax

This section describes the serialized textual form of HSON: the string format produced when a HsonNode graph is serialized to HSON, and the format accepted by the HSON parser.

HSON is an HTML-like syntax designed to serialize either JSON-derived or HTML-derived node graphs without introducing format-specific scaffolding. It is not HTML, though it resembles a pared-down dialect of it.

⸻
## 1. Basic Form

HSON is a tree of nodes. Each node has:

- a tag name  
- optional attributes  
- optional child content  

Every serialized HSON document corresponds 1:1 to a node graph. A HsonNode’s _tag and _content properties directly represent the serialized structure. 

### Canonical Form
```
<tag attrs? flags?
  "…content"?
>
```
Unlike HTML or XML, tag names appear only once. All attributes and content are contained within that single construct. There is no separate closing tag.

Nodes are terminated by one of two explicit closers. The chosen closer encodes the structural model (see below). There is no 'implicit' closure.

---

## 2. Node Closure Rules

HSON's two closure symbols are structural markers that carry strict meaning.

### 2.1 `_elem` nodes (`/>`)

Nodes sourced from html elements terminate with `/>`. 

### 2.2 `_obj` nodes (`>`)
Nodes sourced from JSON terminate with `>`. This includes arrays (see below). The use of angle brackets in HSON closely tracks the use of curly braces in JSON. 


A single serialized HSON string must use one model consistently. Mixing `/>` and `>` within the same document is invalid and will throw.

---

## 3. Primitive Content and Inline Form

If a node contains either attributes XOR one primitive value it uses the inline closure form:

```
<tag primitive/>
<tag primitive>
```
A space before the closure (`<tag primitive />`) is also valid)

Examples:
HTML:
```
<title "On Trees and Structure"/>
<section id="hson-spec-1-syntax"/>
<generator disabled/>
```

JSON:
```
<author "neutralica">
<views 18342>
<updated null>
```

#### Rules:
*	A node may contain at most one primitive value to close inline.
*	It may not contain both attributes and inline primitive content.
*	It may not contain a child node.

If a node contains:
*	child nodes,
*	multiple primitives,
*	or both attributes and primitive content,

then its content must be serialized on subsequent lines and the closer must appear on its own line, similar to a JSON object.

#### HTML:
```
<title
  <h1 "overview"/>
  <div
    <button id="weird-button"
      "press me"
    />
  />
/>
```

#### JSON:
```
<user
  <name "bo">
  <age "32">
  <children
    <name "mo">
    <name "jo">
  >
>
```


## HsonNode IR Representation

Internally, in the HsonNode graph:
- Primitive values are always wrapped in `_str` or `_val` leaf nodes.
- Other nodes never store raw primitives directly.
- HTML has no native type information. When serializing JSON values to HTML, numbers, booleans, or null are wrapped in `<_val>` tags to maintain their types.
- A `_val` node explicitly signals that its content should be parsed. If a number, boolean, or `null` is not wrapped in `<_val>` in HTML it will reenter the node graph as a string .


## HSON Serialization Rules

HSON's syntax is designed to express both HTML and JSON without requiring structural hints like leaf nodes. _str or _val nodes (or any other underscored structural node like _elem, _obj, _arr) will never appear in serialized HSON.

Within the serialized HSON:
- String content must always be quoted.
- Numbers, booleans, and `null` are always unquoted.

* “name”   → string
* 42       → number
* “42”     → string
* true     → boolean
* “false”  → string
* null     → null
* “null”   → string


---

## 4. Children

A node’s `_content` property consists of ordered child nodes, which may be:

- standard container nodes, or
- primitive leaf nodes (`<_str>` / `<_val>`)

```
<p
  "JSON and"
  <em "HTML"/>
  "are often treated as opposites."
/>
```

Content order is preserved when parsing HSON. Text and nested nodes coexist naturally, as they do in HTML: text is simply a primitive leaf node within the tree.


## 5. Attributes

Attributes appear inside the opening tag, before content. When attributes and content are both present, the node introduces the content on a newline, to maintain clear visual separation. When only attributes or primitive content is present on a node, it is serialized as a single line

```
<article id="post-042" class="entry featured"
  ...
>
```

#### Attributes:
*	are HTML-derived metadata, not content
  *	are stored in the _attrs property, not in _content
*	are not ordered semantically
*	are serialized in HSON tags as `foo="bar"`

Attributes never appear as child nodes.


## Flags (Boolean Attributes)

Flags are boolean attributes whose presence implies `true`.

#### HTML:
```
<details disabled>
  ...
</details>
```

#### HSON:
```
<details disabled
  ...
/>
```

Internally, flags are stored in XML form, `key="key"`:
```
{
  _attrs: {
    disabled: disabled
  }
}
```

Like attributes--which they are--flags are not child nodes and never appear in _content.

⸻

## 6. Arrays (« » syntax)

HSON provides a compact array literal syntax.
```
<tags
  «
    "hson",
    "json",
    "html",
    "structure"
  »
>
```

This is equivalent to an internal _arr node with _iindexed children.
HSON parsers accept brackets as array delimiters provided the closer is consistent. If reserialized, all arrays use guillemet delimiters regardless of input symbol. 

#### Notes:
*	« » is purely a serialization convenience and minor visual flourish
*	internally, arrays are still represented structurally via VSNs
*	array order is preserved through the use of internal _ii nodes
*	array items may be primitives or full nodes, and may be mixed
*	newline separation of array items is not required

Nested arrays and objects within arrays are permitted exactly as with JSON. Arrays are represented in HSON's node graph as `_arr` tags.

⸻

## 7. Objects as Nodes

When serializing JSON-derived data to HSON, object properties are represented as named child nodes.

#### JSON:
```ts
{
  "author": {
    "handle": "Neutralica",
    "org": "@terminal_gothic",
    "roles": [
      "author",
      "maintainer"
    ]
  }
}
```

#### HSON:
```
<author
  <handle "Neutralica">
  <org "@terminal_gothic">
  <roles
    «
      "author",
      "maintainer"
    »
 >
>
```

hson-lives's HSON parser accepts arrays with or without newline separators; arrays in HSON are reserialized with newlines. Like JSON, commas are required between items.
⸻

## 8. Structural Nodes and VSNs

Some nodes exist solely to preserve structure across formats. These are Virtual Structural Nodes (VSNs).

#### Common examples:
*	_obj — object container
*	_arr — array container
*	_ii  — array item
*	_str — string primitive
*	_val — non-string primitive

#### VSNs:
*	are always structural
*	always close with>
*	never use/>
*	are required when serializing HTML or JSON into the other format
*	are unnecessary in HSON serialization: syntax expresses structure

VSNs are required when serializing HTML into JSON or vice-versa. The HSON syntax expresses either format cleanly without VSN clutter.

⸻

## 9. Identity (data-_quid)

Nodes may carry a stable identity token called a `quantum unique ID` (quid):
```
<p data-_quid="Q7f3c"
  "Hello"
>
```

quids are an internal identity marker. They function as a query term to locate a node that has been moved or mutated and enable reliable referencing of nodes and their assignment to JS variables. 

quids are stored in a node's _meta property and may or may not be serialized depending on context or options. quids are serialized as a data-attribute, `data-_quid="..."`.	they are not part of the semantic data model and	users rarely need to know about them or interact with them directly.

⸻

## 10. XML Correctness
HTML is ultimately parsed via XML and must be XML-valid to be accepted.
*	tags must be properly nested
*	attributes must be well-formed

This enforces a modicum of consistency and reliability in markup structure; it also sidesteps the unpredictable parsing rules of individual browsers.


⸻

## 11. What HSON is at the syntax level
*	HSON is not HTML
*	HSON is not JSON
*	HSON is a serialization of a unified node graph that can project cleanly to either

It exists to serialize HsonNode graphs without introducing format-specific scaffolding, not to replace HTML or JSON as external interchange formats.
