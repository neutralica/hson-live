# Structural array iteration in governed Parts

`for:` repeats a descendant element or an ordinary `lib`/`at` Part connector.
It is construction syntax in a governed Part definition. It cannot appear on
the definition root or in a canonical Document. Each Part invocation still
produces one rooted result, or zero through `part:optional`.

```hson
<ul hson:part items:data="%{items}"
  <li for:item:i="#{items}" title="#{item}"
    "#{i}: #{item}"
  />
/>
```

With `items` equal to admitted Data `["alpha", "beta"]`, this produces two `li`
children, in that order. An empty array produces `<ul/>`.

## Bindings and sources

| Directive | Local bindings |
| --- | --- |
| `for:item` | Each member as Data |
| `for:item:i` | Member Data and a zero-based scalar index |
| `for::i` | Zero-based scalar index |

Alias names use the existing Part parameter-name grammar,
`[A-Za-z_][A-Za-z0-9_-]*`. They are case-sensitive; `data` and `doc` are valid
aliases. An element may have one iterator. Two aliases in one directive must
be different. Empty item aliases are legal only in the index-only form.

The source is a whole local `#{...}` reference. Existing property, numeric
index and quoted-key selectors work, for example `#{column.blocks}` or
`#{rows[0].children}`. The source must resolve to array Data. Missing, null,
scalar and object sources reject the candidate. Incoming `%{...}` parameters
remain distinct from local references: receive incoming Data on the definition
root before using it as a collection.

The source resolves in the enclosing scope. The new aliases then apply to the
directive-bearing element's attributes, text and descendants. Inner iterators
may shadow either an outer alias or a receiving declaration. Leaving the body
restores the outer bindings; aliases never leak to siblings. Local scalar
indices render as strings in ordinary attributes and text. Connector scalar
arguments retain the scalar representation; `data:i` cannot forward an index
declared as a scalar.

## Direct Part selection

```ts
const map = hsonLiveMap.fromLibraries({
  components: { parts: {
    Column: {
      kind: "document",
      document: Hson.document`<section hson:part blocks:data="%{blocks}"
        <hson-part for:block:i="#{blocks}"
          lib="components" at="#{block.kind}" data:block="#{block}"/>
      />`,
      css: { "& .content": { fontWeight: "bold" } },
    },
    Heading: {
      kind: "document",
      document: Hson.document`<h1 hson:part block:data="%{block}"
        class="content" "#{block.text}"/>`,
      css: { color: "blue" },
    },
    Paragraph: {
      kind: "document",
      document: Hson.document`<p hson:part block:data="%{block}"
        class="content" "#{block.text}"/>`,
      css: { color: "red" },
    },
  } },
  page: { document: Hson.document`<html <head/> <body
    <hson-part lib="components" at="Column" data:blocks="${Hson.data.from([
      { kind: "Heading", text: "Title" },
      { kind: "Paragraph", text: "Body" },
    ])}"/>
  />/>` },
});
```

Each connector resolves its coordinates and inputs in that row's scope, uses
the selected Part's ordinary receiving-interface validation, and forwards the
admitted structured value without serialization or reparsing. No HTML wrapper
is introduced. `map.parts.components.Column.write({ blocks: Hson.data.from(...) })`
also uses the same interface and composition path.

## Optional content, identity and admission

The iterator source is a control dependency. Reading an array alone does not
make an optional ancestor present. Empty iterations contribute no body presence.
Each realized body otherwise uses the existing two-phase `part:optional`
analysis, including omission of ordinary elements. Literal-only loop bodies
do not create a qualifying value use. Static declaration, reference-placement
and lexical validation still examines empty bodies.

Every realized ordinary iteration root has an independent occurrence namespace.
A directly repeated connector uses the selected Part's occurrence, with no
second occurrence at the same coordinate. Authored QUADs belong to that local
namespace and can repeat across rows. A QUAD on the repeated connector aliases
the selected root; a same-named descendant in the selected Part is a collision
and rejects. Exact lookup never silently becomes plural.

Selected Parts retain independent structured CSS ownership and retirement.
Ordinary enclosing selectors continue to match repeated descendants. For this
release, a surviving enclosing Part's structured exact-QUAD CSS reference into an
iterated subtree rejects explicitly, regardless of cardinality. Use ordinary
selectors or place the styled subject inside a selected Part. No QUAD is
silently dropped and no selector is rewritten into a plural match.

Preparation and expansion are bounded before unbounded instance allocation.
The complete candidate passes the existing Document Schema, scoped identity,
CSS and authority checks. Identity issuance is staged. A late invalid item or
issuer failure publishes no graph, identity ledger, CSS or commit event.
All iterator directives are consumed before canonical publication.

Public Document content insertion and replacement use the same scoped
preparation as initial admission. Subsequent local graph and CSS edits retain
occurrence ownership; replacement retires the displaced occurrences even when
the resulting markup is equal. Ordinary flat Document edits remain flat.

Existing scoped Document transport and mutation boundaries remain in force;
see [SSR cuts and continuation](../ssr-composition.md). Iteration does not add
flat `capture()`/`cut()` support or a second identity/transport format.

## Authoring tools and release boundary

Runtime interfaces and compiler/editor facts share declaration and reference
analysis. Diagnostics locate invalid directive syntax and provable lexical
errors in source. Completion offers visible bindings, respects shadowing and
the source's enclosing scope, and recovers when edits repair the source.
Literal admitted Data and directly supplied Schema-annotated Data can provide
advisory element-property suggestions. Those observations do not establish an
exhaustive Part input Schema or prove the validity of every possible invocation.
Static Document Schema evaluation continues to use the actual composer.

Unrelated quoted TypeScript value interpolations preserve lexical completion
and provable reference diagnostics. Their values remain opaque and cannot prove
a receiving interface. Structural slots and dynamic construction declarations
withhold lexical proof; incomplete reference edits recover through the shared
scanner and parser.

This release adds no `per:`, `if:`, keyed reconciliation, automatic live Data
bindings, or iteration of structural Document placeholders. Changing source
Data does not update an already realized Document; the application admits a
new composition through its existing governed operation.
