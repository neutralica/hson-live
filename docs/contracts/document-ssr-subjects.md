> Cut 8D implementation-stage record. The final graft/hosted exclusions below describe that cut, not current capability. Coordinated hosted flat/scoped subject SSR and continuation are implemented; see [continuation](../document-continuation.md) and [Parts](styled-part-composition.md). The internal opt-in APIs below remain internal.

# Internal portable subject SSR

Cut 8D is an opt-in, internal SSR realization mode. It connects Cut 8B's portable
subject projection to Cut 8C's exact CSS identity translator. It adds no public
Q or CSS API. Cut 9B-0 also derives ordinary Library capture and local rendering
correspondence from current managed CSS demand, using the same owner, envelope
and carrier planner. No public demand argument is added. Incremental hosted CSS
correspondence remains unsupported behind explicit admission and codec guards.

## Candidate and opt-in input

`capture_document_ssr_internal(document, demanded)` accepts a selected document
Library facade and an exact array of demanded, already owner-issued QUIDs.
`render_document_ssr_internal(document, demanded)` realizes that candidate.
`cut_document_ssr_internal(map, options, demanded)` returns local SSR HTML and
portable Library siblings using the same selected candidate. These functions
live in `src/api/livemap/livemap.libraries.ts` and are not package exports.
An empty demand array still includes all legitimate authored QUAD subjects.
The public `map.cut` uses a one-argument wrapper: surplus JavaScript arguments,
including `Array.map` callback indices/arrays, are ignored. Only the private
`DOCUMENT_SSR_CUT` capability forwards the demand array to the internal cut.

Managed Library CSS already accepts selectors, including genuine exact
`[hson\:quid="payload"]` references. The bounded internal input is only the
subject demand array: no stylesheet override, new CSS store, component selection,
or runtime-wide LiveTree CSS import is involved. A subject reference omitted
from demand must resolve through authored correspondence or translation rejects.

The owning aggregate's `captureDocumentSsr` starts `capture_fence` before it reads
the source graph, sparse subject overlay, authored bindings, issued ledger, and
Library stylesheet. It projects correspondence, detaches a QUID-free graph,
translates the detached stylesheet, and checks the same fence before returning.
The fence includes graph/CSS revision, identity generation, incomplete identity
transactions, registry and authority changes. It catches identity-only changes
that do not advance the revision. No projection or rendering step acquires QUIDs.

The local opt-in cut additionally fences its selected aggregate snapshot and SSR
candidate together. Its selected Library envelope gets the candidate's root,
portable QUADs and translated CSS. Once this complete detached cut is assembled
and the fence checked, source mutations during size validation or realization do
not change either sibling. The internal candidate's correspondence contains
local QUIDs for inspection; those records are not published in the cut envelope.

## Carrier and exact matching

The derived browser attribute is `hson:quad="name"`. Its name is shared with
Cut 8C through `PORTABLE_DOCUMENT_QUAD_ATTRIBUTE`. Chrome matches the serialized
attribute using `[hson\:quad="name"]`: the escaped colon belongs to the literal
attribute name, not a CSS namespace qualifier.

`plan_portable_document_subjects` validates portable associations and resolves
canonical paths against the detached root. It associates those exact canonical
objects with ordinary elements in the browser realization plan, including roots
and descendants through virtual document wrappers. Every association must have
exactly one rendered element. Name, path and subject uniqueness retain Cut 8B's
validation; rendered duplication or loss rejects. The planner changes derived
attributes only. Canonical authored attributes and metadata remain unchanged.

Authored names remain authored, including names beginning with an underscore.
An anonymous demanded subject has explicit disposable disposition and the name
`_` plus its exact nine-character active QUID payload, even when that payload
begins with a digit. The carrier is a portable address, never a receiving QUID
claim. No random alias, synthetic class, persistent scope or identity authority
is introduced. Only correspondence subjects get carriers.

## CSS and failure behavior

A conservative CSSTree token gate identifies reserved identity identifiers in
selectors and group headers. It never resolves or replaces text. Identity-free
CSS retains its existing selectors and serialization, including opaque future
syntax and quoted lookalikes. If reserved identity syntax occurs, the entire
record passes through the committed syntax-aware translator with the same
correspondence. Non-exact, unresolved, mixed, namespaced and opaque identity
references reject before any SSR result is returned.

Rules, declarations, specificity, group/layer occurrences, opaque rule keys and
stylesheet ordering retain Cut 8C's contract. Authored head styles precede the
managed style as before. Nonempty managed CSS still requires explicit html/head,
and managed-marker collisions and raw-text serialization hazards still reject.
Lowercase `hson:quad` node attributes reject at exact Library admission. An
admissible uppercase `HSON:QUAD` attribute lowers to the reserved browser spelling
and reaches the carrier-planner collision check. A full `html` document without
`head` cannot reach the managed-style missing-head guard: browser planning first
requires exactly ordered canonical `head` and `body`. A valid non-html fragment
with nonempty managed CSS reaches the explicit html/head shell requirement.
Unsafe style sentinels reject at stylesheet admission, and the direct realization
boundary independently rejects their rawtext serialization.

The opt-in planner also rejects authored use of the reserved portable carrier,
even with empty CSS or no projected subjects. Portable admission continues to
reject unknown `hson:quad` metadata; it is not added to the canonical registry.

Failed projection, translation or planning publishes no graph, identity or CSS.
A reentrant authorized mutation is not rolled back by an observational render;
it invalidates capture so no mixed candidate escapes. Repeated rendering issues
no identities and changes no source state.

## Acceptance and boundary

`tests/document-ssr-subjects.acceptance.mts` runs focused assertions in Node and
an actual Worker, and is included in `npm run test:document-ssr`.
`npm run test:document-ssr-subjects-browser` runs source-only Chrome acceptance
with page JavaScript disabled before navigation. Inspector evaluation observes
computed styles; the served script probe remains unexecuted. It checks root,
multiple instances and descendants, anonymous numeric subjects, unrelated
nonmatching, ordinary managed CSS, layer declarations, stylesheet ordering,
sparse markers, exact selectors and absence of foreign QUID attributes. Its CSS
order assertion requires both complete ordinary rules; negative checks remove
either rule or reverse them to prove rejection. Shared Node/Worker assertions
cover public callback isolation, omitted-demand and opaque-reference failures,
incomplete identity transactions, reentrant authority mutation, and final-only
composed-page SSR without source component Libraries. It uses
a temporary Chrome profile and does not rebuild tracked distribution.

Current grafting rejects these marker-bearing results: its ordinary realization
plan does not contain `hson:quad`, and exact DOM validation rejects unplanned
attributes. This cut does not consume markers, bind portable CSS to receiving
QUIDs, transfer component CSS, or support hosted replay/continuation. Those
require a separately authorized cut. An opt-in local SSR envelope is portable
state, not a promise of successful browser continuation.
