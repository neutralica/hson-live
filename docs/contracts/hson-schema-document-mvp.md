# Hson Schema document MVP

The first document-domain slice uses the same ordinary-Hson Schema declaration,
compiler, canonical graph, analyzer, generated evidence, and runtime validation
boundary as the data MVP.

```ts
export const PageSchema: HsonSchema = Hson`
  <
    type "document"
    tag "main"
    attrs <
      props <
        id "string"
        hidden <optional "flag">
      >
      closed true
    >
    content <sequence [
      <tag "section" content "string">
    ]>
  >
`;
```

The root is one exact-tag element. `content "empty"` means exact empty
content, `content "string"` means one textual item, and
`content <sequence [...]>` means an exact ordered sequence of nested element
descriptors. Sequences may be empty, but mixed element/text sequences are not
accepted because the current Hson document grammar cannot author that physical
shape without a structural-mode crossing.

`attrs.props` separates candidate attribute names from attrs descriptor
controls. Declared attrs are required unless wrapped in the same general
`optional` descriptor used by data members. `flag` validates the canonical Hson
flag spelling. Attrs are open by default; `attrs.closed true` closes them. This
slice accepts `string` and exact-string valued attrs. The canonical Hson parser
stores authored attrs as strings, so number/boolean/null attr Schemas are not
claimed until canonical attr decoding can be extended without changing legacy
Schema meaning.

Generated `<Name>Type` is a deeply readonly Hson-side element-node type with
exact `$_tag`, attrs and physical content structure, plus inaccessible proof at
every semantic node. `<Name>Hson` remains the declaration-specific certified
canonical Hson string. Static certification remains analyzer/build-authoritative;
dynamic certification remains `Hson.certify(schema, canonical)` and returns
the identical canonical string.

This slice does not add a builder, materializer, DOM certification, fragment,
repeat, arbitrary tag, content union, recursion, defs/ref, or document-specific
validation API.
