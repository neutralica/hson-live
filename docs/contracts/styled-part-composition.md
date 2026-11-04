# Governed Parts, composition, and occurrence-owned CSS

Structured arguments follow the [directional Part grammar](part-argument-direction.md):
receiving roots use `data:local` / `doc:local`; invocations use
`parameter:data` / `parameter:doc`. Scalar arguments retain their existing syntax.

A governed Part collection is an inert object data Library. Its keyed members are
exact `{ kind: "document", document: string, css?: CssMap, stylesheet?: string }` records with exactly
one ordinary, non-connector element root. Admission permanently binds each name to
its complete definition for the lifetime of its authoritative owner. Collections
may admit new names; existing definitions cannot be edited, replaced (even with an
equal value), renamed, deleted, or cleared. Admission neither expands nested
connectors nor changes documents previously constructed from them.

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
It supplies no name, authority, Library selection, or identity. Definition admission
validates record shape, authored structure, declaration placement, structured CSS,
and stylesheet field types. Selected-source
lexical/receiving analysis occurs at `.write()` or receiving composition; admitting an
inert definition does not prove that all local or nested references will resolve.

Select the Library through `map.parts.must("components")`, not `.data` or `.doc`.

Authored Library admission (`fromLibraries`, local `addLibraries`, and initial
Locus authority definitions and `locus.admit`) consumes `<hson-part lib="parts" at="navigation"/>`.
The selected Part's actual root replaces the connector; there is no wrapper,
custom element, subscription, instance object, `.template()` or `.compose()` API.
The private structural traversal remains the construction mechanism. Native HTML
`<template>` keeps its existing semantics.

Select a Part with separate `lib="components" at="panel"` coordinates or qualified
`at="components/panel"`. Qualified `at` requires exactly one slash and nonempty halves;
it cannot be combined with `lib`. Nested unqualified connectors may omit `lib` to
retain their enclosing collection. Separate coordinates support an empty member key.
Static selectors may be unquoted; mixed literal/reference selectors such as
`at="components/^{item.kind}"` require quotes. Dynamic selection resolves during
composition, under the same receiving authority.

Missing, ungoverned, or unavailable collections/members reject composition atomically.
Definitions may refer to Parts admitted later; neither definition admission nor
`.write()` expands nested invocations. Library-add candidates and atomic batches
resolve consumers against the complete candidate, including newly admitted definitions,
regardless of entry or operation order. Established definitions remain immutable.

The optional connector `@:name` becomes a receiving-document QUAD on the realized
root. Authored Library source and `Hson.document` use the authored QUAD scanner and name
rules. `Hson.document` returns `HsonAuthored`; ordinary Transform and canonical
`HsonDocument` qualification do not accept those declarations. Shell declarations
form one flat document namespace. Each realized Part occurrence retains a separate
flat local namespace, including repeated and nested occurrences. Local names never
become implicit shell names. Public `page.q(name)` selects shell bindings; chained
scoped `.q()` navigation is not implemented. Structural Document locals can be inserted
with `<hson-part ^{local}/>` as described below. CSS can demand a root
QUID without an authored QUAD. Reads, capture and rendering allocate nothing.

## Whole definitions and deferred invocation

Read a detached whole definition with `parts.at(["heading"]).snap()`. Admit new,
distinctly named members through collection `.object.setKey` / `.object.setMany`
operations. Complete candidate validation also applies to staged and Locus writes.
New members may be constructed through several operations within one atomic batch;
every operation against an already admitted member rejects, including batches that
restore the original final value. Genuinely inert helper operations retain no-op behavior.
Caller-owned source remains editable before admission; reads return detached values.

Checkpoint and snapshot installation may extend an active owner's baseline but
cannot change or withdraw existing definitions. Fresh owners may initialize from
valid persisted definitions. Durable resume rejects conflicting deployment definitions
before installing recovered topology. Echo permission withdrawal removes only a
receiving projection; regrant and recovery remain supported. Part definitions never
acquire runtime subject identity; composed Document occurrences own their identities.

`css` and `stylesheet` are protected authoring fields. Direct path access below
`[member, "css"]` or `[member, "stylesheet"]`, object helpers targeting those fields,
and partial member patches containing them reject. Read the whole definition instead;
a complete proposed new definition is required to author either field.
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

`write()` and `write(args)` return detached `HsonAuthored` connector source. The
optional argument is a plain record of own enumerable data fields using incoming
parameter names, without type suffixes. Scalar values are strings, finite numbers,
booleans, or null and become attributes through `String(value)` (`-0` becomes `"0"`).
Data arguments accept supported JavaScript values or authenticated `HsonDataValue` carriers. Strings are literal Data; use `Hson.data.fromSource(source)` for encoded input. Document arguments require serialized source. The writer serializes admitted Data into the established authored attribute representation and derives outgoing
`:data` / `:doc` suffixes from the selected immutable definition. Arrays and objects
are supported Data values; scalar parameters remain limited to scalar values.
Undefined values, accessors, and symbols are not argument values or fields. `lib` and `at`
are reserved; `style` and `__proto__` cannot be scalar parameters but may name
structured inputs.

Selected-source analysis, unexpected-input checks, transport-kind checks, and
statically required missing-input checks run during `.write()`, along with direct
Data value admission. Authored Part attributes remain serialized transport. Receiving
composition decodes that transport and performs its established interface, structural,
conditional-requirement, and nested-selection checks. The writer issues no subject identity, compiles no occurrence CSS, and changes
no revision. Receiving composition resolves the immutable definition in its own owner;
another owner may bind the coordinates differently. The invocation carries neither a
definition snapshot nor a live binding. Staged writers have no `.write()`; ordinary,
authoritative, and read-only whole-member handles do.

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
  "& :is(a, button)": { _hover: { opacity: 0.8 } },
  "@:current": { fontWeight: "bold" },  // this Part's own authored QUAD
  $media: {
    "(max-width: 480px)": { gap: "0.5rem", "@:current": { fontSize: ".85rem" } },
  },
};
```

A structured relative key contains one selector with one leading `&`; use `:is(...)`
for alternatives. Selector-list keys, bare nested selectors, and `@media` keys reject.
Supported pseudos are `_hover`, `_active`, `_focus`, `_focusWithin`,
`_focusVisible`, `_visited`, `_checked`, `_disabled`, `__before`, and `__after`.
Before/after shorthand does not supply `content`; author `content: '""'` when needed.
`"@:name"` resolves only an
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
retirement machinery as textual `stylesheet`. LiveTree stylesheet `setMany()` handles
accept the shared structured grammar, including `$media`. Local `"@:name"` targets
require a receiving namespace resolver; standalone handles cannot resolve them.
Imperative property removal and inline style storage have separate contracts in the
[LiveTree CSS reference](../livetree/api-css-manager.md).

## Parameters

Descendant elements and ordinary Part connectors also support
[structural collection iteration](part-array-iteration.md). Its `for:`/`per:` declaration
is consumed before connector argument classification or canonical publication.

Ordinary invocations must be empty. Coordinates and construction directives are
reserved; remaining attributes supply initial parameters. The implemented argument
kinds are `scalar`, `data`, and `doc`; there are no `str` or `num` declarations.
Incoming `%{name}` references name parameters without paths. Locally declared
`^{name}` references may select properties, numeric indexes, and quoted keys.
Receiving roots bind `data:local=%{incoming}` or `doc:local=%{incoming}`; outgoing
invocations send `incoming:data` or `incoming:doc`. See the [directional grammar](part-argument-direction.md)
for reserved names and forwarding rules.

```ts
const map = hsonLiveMap.fromLibraries({
  components: { parts: {
    panel: { kind: "document", document: Hson.document`
      <section hson:part data:model=%{payload} doc:extra=%{content}
        <h2 "%{title}"/>
        <p "^{model.count}"/>
        <aside <hson-part ^{extra}/> />
      />
    ` },
  } },
});
const invocation = map.parts.must("components").panel.write({
  title: "Hello",
  payload: Hson.data.from({ count: 2 }),
  content: Hson.document`<em "More"/>`,
});
map.addLibraries({ page: { document: Hson.document`<main ${invocation}/>` } });
```

A structural `<hson-part ^{extra}/>` inserts a Document local without `lib`, `at`,
or argument attributes. Structural arguments remain detached fragments; completion
applies to the final [governed page](../livemap/api-livemap.md#complete-governed-documents).
Array/object iteration and dynamic Part selection construct independent occurrences;
changing source Data does not update an existing page. The [iteration reference](part-array-iteration.md)
defines aliases, scope, and execution order.

Scalar substitution operates in decoded text and ordinary attribute values, including
forwarding attributes. A whole scalar attribute reference retains a supported typed
primitive from programmatic connector input; authored source and `.write()` supply
string-valued attributes. Mixed attributes and document text use scalar string spelling.
Scalar replacement is neither rescanned for placeholders nor parsed as Hson/HTML.
Document transport, by contrast, supplies structure through its explicit `doc` channel.

### Required and optional arguments

A strict scalar use requires its incoming argument. A trailing `?` makes a reference
optional, as in `%{title?}`, `^{model.title?}`, or `doc:extra=%{content?}`. Missing optional
substitution omits the complete containing attribute or text position, including literal
prefixes and suffixes. `false`, `0`, `""`, and `null` remain present values. Missing
optional Document content inserts nothing. Optional receiving declarations propagate
absence into local uses; optional local uses do not relax a required declaration.
Undeclared bindings, invalid traversal through a present value, malformed input, and
unrelated required references still reject.

`part:optional` controls structural presence, separately from reference optionality.
Data demand beneath an optional definition root can be conditional on execution,
including whether an iterator has members. `.write()` defers those conditional
requirements to composition; statically required inputs still reject immediately.
If omission removes the final page's only root, complete-page admission rejects.
There are no defaults, general expressions, or ongoing bindings.

Tags, attribute names, identity metadata, structured style maps, script/style
content and scalar placeholders in ordinary HTML handler attributes beginning with
`on` (case-insensitive) are unsupported. Recognized structured arguments such as
`onload:doc` follow the directional Part grammar instead. Existing CSS
and Hson admission may reject invalid placements before construction. CSS is not
interpolated. Literal `%{` in Part text must not be used: there is no separate
escape/interpolation language. A string passed to an existing runtime text
mutation remains text; graph mutations receive canonical content under their
existing grammar.

## Occurrence CSS

Structured `css: CssMap` is compiled and scoped to the occurrence root. Its rules
receive an explicit `@scope` that includes the root and its descendants; `&` is
anchored at the occurrence root. Local `"@:name"` targets resolve within that Part's
namespace. Parent rules can reach
nested Part descendants through the ordinary cascade. This is not Shadow DOM isolation.

Raw `stylesheet` text is retained exactly, without CSS parsing, nested-selector
lowering, selector rewriting, or automatic scoping. Its selectors can affect siblings
and elements outside the occurrence. Imports, global definitions, duplicate declarations,
and CSS syntax are left to the browser. Raw identity-looking selectors are not interpreted
as subject references. The governed page still validates HTML style transport, including
RAWTEXT restrictions, before publication.

Both forms carry occurrence ownership for retirement. Ownership controls contribution
lifetime; only structured CSS receives automatic selector scoping. Textual contributions
precede structured contributions when both fields are present. See [managed stylesheet
operations](../livemap/api-livemap.md#selection-and-reads) for raw replacement, clearing,
and ordered style carriers.

## Ownership and atomicity

The managed stylesheet's existing ordered entries carry an optional `owner`:
one exact subject selector, translated with all other CSS identity references.
This is CSS/document state, not an independent registry, graph or runtime ledger.
Each contributed raw text entry or generated top-level group carries its occurrence
root owner. Rendering ignores this metadata; portable capture retains and translates
it using the existing authored/disposable correspondence envelope.

Moving a root keeps its contribution. Retiring a root removes only entries with
that explicit owner in the same accepted graph/CSS candidate. Retiring an enclosing root also retires nested roots still inside it.
Replacement retires old contributions before admitting the new contributions.
Independently authored rules are not inferred to be owned from their selectors:
remaining references to retired subjects still reject the complete mutation.
Explicit granular replacement of an owned contribution rejects; complete
stylesheet replacement can explicitly take over stylesheet ownership. Direct local
CSS writes currently reject on scoped Documents; use the
[staged Library writer](../livemap/api-livemap.md#selection-and-reads) for local replacement.
Hosted writes use the existing document authority path.

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
Admitting new definitions never rebuilds accepted occurrences; established definitions
cannot change.

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

Document `render()` supports scoped first paint. Governed admission has already
established the complete `html/head/body` page, including managed-style transport checks. Authorized `session.now({ html: "page" })`, SSR
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
