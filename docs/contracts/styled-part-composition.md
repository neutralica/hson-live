# Governed Parts, composition, and occurrence-owned CSS

A governed Part collection is an inert object data Library. Its keyed members are
exact `{ kind: "document", document: string, css?: CssMap, stylesheet?: string }` records with exactly
one ordinary, non-connector element root. Admitting or editing definitions neither
expands nested connectors nor changes documents previously constructed from them.

The internal `hson-part-collection-v1` Library validation contract is independent
of Schema and validates every member of each complete candidate. It travels with
portable registry/topology state and is enforced on reconstruction as well as
mutation. A lookalike ordinary data object is not a governed collection. Collection
admission neither registers separate member Libraries nor issues runtime identity
for Part definitions. The marker and low-level collection-admission helpers remain internal. Public admission is
`{ components: { parts: { heading: { kind: "document", document: '<h2 hson:part "%{content}"/>' } } } }`.
`kind: "document"` is required on every member. Neither the Parts Library nor its
members accept a supplemental `schema`, including an explicitly present undefined key.
Every definition's single authored root requires the valueless `hson:part` flag.
Missing, valued, nested, and connector declarations reject complete-candidate admission,
including uninvoked and optional definitions. The declaration stays in stored source;
governed realization strips it before canonical publication, HTML, DOM, or transport.
It supplies no name, authority, Library selection, or identity. `.write()` remains deferred.

Select the Library through `map.parts.must("components")`, not `.data` or `.doc`.

Authored Library admission (`fromLibraries`, local `addLibraries`, and initial
Locus authority definitions and `locus.admit`) consumes `<hson-part lib="parts" at="navigation"/>`.
The selected Part's actual root replaces the connector; there is no wrapper,
custom element, subscription, instance object, `.template()` or `.compose()` API.
The private structural traversal remains the construction mechanism. Native HTML
`<template>` keeps its existing semantics.

`lib` and `at` are separate exact string coordinates, never a slash-delimited
address. A top-level connector requires a nonempty `lib`; nested connectors may
omit `lib` to retain their selected collection. An empty member key is supported.
A missing, ungoverned or unavailable collection/member rejects immediately. There
is no deferred resolution. Library-add candidates can provide definitions and
consumers in either entry order. Ordinary atomic batches resolve against the
complete final candidate of each edited Part collection, independently of the
relative order of consumer and definition edits. Invalid final definitions reject
the entire candidate.

The optional connector `@:name` becomes a receiving-document QUAD on the realized
root. Authored Library source and `Hson.document` use the authored QUAD scanner and name
rules. `Hson.document` returns `HsonAuthored`; ordinary Transform and canonical
`HsonDocument` qualification do not accept those declarations. Shell declarations
form one flat document namespace. Each realized Part occurrence retains a separate
flat local namespace, including repeated and nested occurrences. Local names never
become implicit shell names. Public `page.q(name)` selects shell bindings; chained
scoped `.q()` navigation and structural slots are not implemented. CSS can demand a root
QUID without an authored QUAD. Reads, capture and rendering allocate nothing.

## Whole definitions and deferred invocation

Read a detached whole definition with `parts.at(["heading"]).snap()`. Replace it
with `.replace({ kind: "document", document, css, stylesheet })`, or admit complete
members through collection `.object.setKey` / `.object.setMany` operations. Complete
candidate validation also applies to staged and Locus writes. Changes never rebuild
previously realized occurrences.

`css` and `stylesheet` are protected authoring fields. Direct path access below
`[member, "css"]` or `[member, "stylesheet"]`, object helpers targeting those fields,
and partial member patches containing them reject. Retain/read or replace the whole
member instead; a complete proposed definition is required to author either field.
Ordinary lookalike data objects do not gain this protection or undefined omission.

```ts
import { Hson, hsonLiveMap } from "hson-live";

const map = hsonLiveMap.fromLibraries({
  components: { parts: {
    heading: { kind: "document", document: '<h2 hson:part "%{content}"/>', css: { color: "navy" } },
  } },
});
const invocation = map.parts.must("components").heading.write({ content: "Hello" });
map.addLibraries({ page: { document: Hson.document`<main ${invocation}/>` } });
```

`write()` and `write(args)` return detached `HsonAuthored` connector source. They
capture Library/member coordinates and scalar argument spellings; arguments become
ordinary string attributes through `String(value)` (including `-0` becoming `"0"`).
They allocate no subject
identity, compile no occurrence CSS, and change no revision. Argument fields must
be own enumerable data properties with finite scalar values. Reserved names such
as `lib`, `at`, `style`, and `__proto__` reject. Missing/unused parameter validation
is deferred until receiving admission. That receiver resolves its then-current
matching definition, which may differ from the writer's original definition.
The invocation is not a definition snapshot or a live binding. Staged writers have
no `.write()`; ordinary, authoritative, and read-only whole-member handles do.

## Structured declarations and textual stylesheets

Import `CssMap` from `hson-live/livemap`.
`css` accepts a structured map; use `stylesheet` for textual Part CSS. If both are
present, textual contributions precede structured contributions in the merged
occurrence stylesheet.

```ts
import type { CssMap } from "hson-live/livemap";

const css: CssMap = {
  color: "navy",                         // occurrence root
  borderRadius: { value: 50, unit: "%" },
  "& a, & button": { _hover: { opacity: 0.8 } },
  "@:current": { fontWeight: "bold" },  // this Part's own authored QUAD
  $media: {
    "(max-width: 480px)": { gap: "0.5rem", "@:current": { fontSize: ".85rem" } },
  },
};
```

Every selector-list arm starts with `&`; bare nested selector keys and `@media`
keys reject. Supported pseudos are `_hover`, `_active`, `_focus`, `_focusWithin`,
`_focusVisible`, `_visited`, `_checked`, `_disabled`, `__before`, and `__after`.
Before/after shorthand adds `content: ""` if absent. `"@:name"` resolves only an
existing name declared in this Part, never a nested Part's namespace. It is allowed
at the root and inside a root `$media` group's body, not beneath a selector, pseudo,
or another local target. `$media` itself is root-only.

Properties use the maintained known-property inventory, native names, camelCase,
`cssFloat`, supported vendor aliases, or custom-property names. Normalization
collisions reject. Values are strings, finite numbers, or `{ value, unit? }` with
supported units. Declarative null and booleans reject. Authored `undefined` entries
are omitted, including nested entries and `unit: undefined`, before canonical data
admission; they do not delete retained declarations. CSS-significant Unicode
whitespace, escapes, strings, and token boundaries survive projection. Own-data
inspection rejects accessors, symbols, cycles, and unsupported prototypes.

Grammar, selector/media syntax, local targets, and complete stylesheet compilation
validate atomically with the whole candidate, before runtime identity issuance or
publication. Structured source is then governed by the same occurrence CSS and
retirement machinery as textual `stylesheet`. LiveTree `setMany()` supports a
narrower relative declaration grammar: it has no `$media` groups or local QUAD
resolution. Use its `.media(...)` facade for media rules. Imperative property
removal and inline style storage have separate contracts in the
[LiveTree CSS reference](../livetree/api-css-manager.md).

## Parameters

Connectors must be empty. Every attribute other than `lib` and `at` is a named
initial parameter. Names match `[A-Za-z_][A-Za-z0-9_-]*`. Values are supported
canonical scalars: string, finite number, boolean or null. Structural values,
arrays, opaque objects and undefined are rejected, including structured `style`
inputs. Missing parameters, unused/unknown inputs and malformed `%{name}` tokens
reject with the parameter name or placement in the error. There are no defaults,
expressions, recursive configuration objects or ongoing bindings.

Placeholders occur only in decoded document text and ordinary attribute values,
including values forwarded to nested connectors. An attribute consisting entirely
of `%{name}` preserves the admitted connector scalar type. Authored string
connectors and `write()` supply string-valued attributes; programmatic receiving
graph content can retain supported typed primitive attributes. Partial attributes and all document text
become strings using the scalar's ordinary string spelling (`null`, `true`, etc.).
Canonical document text is STR-only; it cannot contain a typed VAL leaf. A
replacement value is never scanned again for placeholders and is never parsed as
Hson or HTML. Quotes, `<`, `&`, Unicode and empty strings pass through normal
Hson/HTML serialization and escaping. No raw markup is inserted.

Tags, attribute names, identity metadata, structured style maps, script/style
content and placeholders in attributes beginning with `on` (case-insensitive) are unsupported. Existing CSS
and Hson admission may reject invalid placements before construction. CSS is not
interpolated. Literal `%{` in Part text must not be used: there is no separate
escape/interpolation language. A string passed to an existing runtime text
mutation remains text; graph mutations receive canonical content under their
existing grammar.

## Occurrence CSS

A balanced-token pass splits recovered style blocks into declarations and nested
rules, each parsed with CSSTree before lowering and ordinary managed stylesheet
admission. Bare type and class nesting (`.a { button { ... } }` and
`.a { .b { ... } }`), nested selector lists, either mixed explicit/implicit list
order, and supported nested conditions follow the same lowering path. Declaration
runs retain their position before, between and after nested rules. Implicit
nested selectors use `:is(parent)` and a descendant combinator, retaining CSS
nesting's maximum parent-list specificity; explicit `&` is replaced structurally.

Colon-bearing implicit selectors such as `button:is(.b)`, `button:not(.x)`,
`button:first-child` and `button::before` use the same path, including either
mixed-list order with explicit `&`. CSSTree may initially recover these as a
declaration with a raw value; the complete non-custom declaration is re-split at
balanced token boundaries to identify the qualified nested rule. Actual property
values containing colons, strings, URLs and functions remain declarations. Custom
properties own their raw values, including colon-bearing text and balanced blocks;
they are never reinterpreted as nested selectors. Malformed values/selectors and
unsupported opaque constructs still reject through the strict managed codec.
Recovery uses original source spans, preserving the descendant whitespace in
`button :is(...)` instead of regenerating it as `button:is(...)`.

Each occurrence's ordinary rules are placed in an explicit
`@scope ([hson\:quid="receiving-id"])` anchored to its single root. Each ordinary
selector's first compound receives the structural zero-specificity constraint
`:where(:scope,:scope *)`, before any pseudo-element. This makes that compound
match the root or a descendant and avoids native scope's implicit descendant-only
anchoring: both `button` on a button root and `section button` through a section
root work. Selector lists retain their individual matching specificity. Explicit
scope-containing selectors retain their authored relationship; top-level `&`
becomes `:scope`. Structured functional selectors, pseudo-elements and supported
inner scopes keep their CSS meaning. Identity remains solely in the scope/owner
references, using the actual receiving root, with no authored root QUAD required.

Scope includes the root and its descendants. Parent rules can style nested Part
descendants through the ordinary cascade; this is not Shadow DOM isolation.
An unrelated sibling occurrence and outside elements are outside that scope.
Specificity, layer order, inheritance and native scope proximity still apply. In
particular, scope proximity can resolve equal-specificity declarations; an
explicit higher-specificity or important override follows the normal cascade.
See the [CSS scope specification](https://www.w3.org/TR/css-cascade-6/#scoped-styles).

Supported conditions/groups retain their order and repeated occurrences:
`@media`, `@supports`, `@layer`, `@container`, `@scope`, and `@starting-style`.
Nested conditions inside style rules are lowered with those rules. A nested
`@scope` inside a style rule is explicitly unsupported. Opaque selector arguments
that CSSTree cannot structurally inspect reject. Imports, namespace declarations,
font-face, layer-order statements, unsupported global forms and malformed CSS
reject rather than escaping the occurrence's scope. Existing managed-codec
limits, including duplicate declarations that cannot be represented, remain.

Top-level supported `@keyframes` and `@property` definitions retain their global
CSS names and semantics. Duplicate definitions across occurrences reject, even
when identical. Names and animation declarations are not automatically renamed.
Exact Part-local `[hson\:quad="name"]` subject references continue to resolve
through local QUAD paths and receive identities within the occurrence scope.
Unresolved, generated, mixed, opaque or non-exact identity claims reject through
the existing CSS identity translator. Ordinary selectors need only root identity.

## Ownership and atomicity

The managed stylesheet's existing ordered entries carry an optional `owner`:
one exact subject selector, translated with all other CSS identity references.
This is CSS/document state, not an independent registry, graph or runtime ledger.
Each generated top-level group or global definition carries its occurrence root
owner. Rendering ignores this metadata; portable capture retains and translates
it using the existing authored/disposable correspondence envelope.

Moving a root keeps its contribution. Retiring a root removes only entries with
that explicit owner, including global definitions, in the same accepted graph/CSS
candidate. Retiring an enclosing root also retires nested roots still inside it.
Replacement retires old contributions before checking new global conflicts.
Independently authored rules are not inferred to be owned from their selectors:
remaining references to retired subjects still reject the complete mutation.
Explicit granular replacement of an owned contribution rejects; complete
stylesheet replacement can explicitly take over stylesheet ownership. Explicit
rule/scopes conflicts remain errors.

One existing LiveMap authority installs graph, overlay, issued ledger, authored
bindings and CSS together. Construction, Schema, resource, cycle, allocation,
reentrancy and authority failures expose no partial outer candidate. Independently
accepted inner work is preserved. New runtime subjects carry owner-issued identity
in the ordinary incoming graph operation, using Mirror's structural insertion proof
rather than an existing-subject registration. Allocation consults the registered
projection's active, pending and issued namespace and rechecks currency before
acceptance. The private same-runtime exact admission
facility continues to use its existing ownership path; portable constructors do
not accept generated QUID claims.

The complete composition candidate is planned before deciding whether an edit is
a no-op. Replacing an element with a Part that realizes to identical markup still
admits demanded identity, owned CSS and ownership/order metadata in one accepted
transition. Valid explicit lineage reuses an existing receiving identity and its
QUAD/handles. A truly equivalent candidate with no new governed effects publishes
nothing, issues no identity and leaves the revision unchanged; graph equality
alone does not decide that result.

## Realized-only source decision

This cut stores only the realized canonical Library graph. The consumed connector
is not available for in-Library source editing, and there is no `source` property.
Applications may retain authored input externally and submit fresh content through
ordinary replacement/admission, with ordinary replacement identity consequences.
Definition changes never retroactively rebuild accepted occurrences.

Explicit replacement lineage is interpreted against the old graph and the
authored incoming fragment. Construction records transient authored-to-final
subject correspondence, including a connector's single resulting root, and
translates only the requested destination paths before ordinary identity planning.
Generated Part descendants have no authored incoming path. Missing, ambiguous or
invalid correspondence rejects atomically; expansion neither invents continuity
nor discards requested continuity. The graph planner and existing authority still
own the final overlay, authored QUAD bindings, issued ledger and CSS retirement.

The bounded feasibility review found one graph, sparse identity overlay and
mutation ledger per document in `livemap.library.ts`/`livemap.core.ts`; document
capture, semantic checkpoints, projection and restore all transport that graph.
Editable source retention would add a second authoritative graph plus transport
and reconciliation of arbitrary source/runtime edits. That is outside this cut.
Unrelated live edits are preserved because construction only handles the newly
inserted/replaced content, rather than recomposing the retained document.

## Transport and support boundaries

Canonical restore, replay, rendering, and continuation consume realized state;
they never expand Parts. Residual connectors at canonical document ingress reject.
Coordinated hosted snapshots and semantic checkpoints carry realized graph,
occurrence topology, flat local namespaces, owned CSS, and portable subject
correspondence. Receivers issue fresh runtime identities; source collections are
not needed to render or continue the final document.

Document `render()` supports scoped first paint. Nonempty managed CSS retains the
explicit `html`/`head` requirement. Authorized `session.now({ html: "page" })`, SSR
bootstrap encoding, Echo initial admission/replay/reconcile, durable checkpoints
and tails, and hosted continuation support scoped Part documents. Continuation
validates original carriers, establishes receiver-owned correspondence, switches
CSS synchronously, and consumes disposable markers while retaining compatible
Elements. See [document continuation](../document-continuation.md).

Public local `map.capture()` / `map.cut()` and full-authority `locus.cut()` still
reject scoped documents. This is an implemented local-transfer limitation, not a
restriction on authorized hosted delivery. The local SSR text encoder also rejects
selected governed Parts collections; exclude source collections from flat local
transfers. Client-local initializer envelopes retain their subject-correspondence
limitation. Ordinary standalone LiveTree admission and DOM graft do not reconstruct
authored QUAD namespaces.

Private definitions may be realized into shared markup and CSS. Projection shares
those realized values, not private definitions or unvisited source. Public mutation
gates, hosted document authorization, and complete-candidate identity guards still
apply. Hosted flat/scoped effects use authenticated correspondence and ordered
replay; arbitrary generated QUID claims remain forbidden. Repeated occurrences
are independent, nonreactive realizations, with their own identity lifetimes and
CSS owners.

Permanent acceptance covers Node and actual Worker construction/mutation, scalar
parameters, inert definitions, coherent batches, ownership retirement, local CSS
references, conflict and reentrancy failures, source-free A→B→C restoration,
private projection and durable checkpoints. Source-bundled real Chrome checks
JavaScript-disabled first paint, parent rules reaching nested Part buttons,
outside controls, root-only allocation, synchronous CSS handoff, retained Elements,
strict independent-rule retirement, owned teardown and re-grafting without sources.
