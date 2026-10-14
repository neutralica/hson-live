# Internal CSS subject correspondence translation

`translate_document_css_identities(record, direction, correspondence)` lives in
`src/internal/css/css-identity-translation.ts`. It consumes and returns the
existing `PortableDocumentStylesheetRecord`. It has no public export. Cut 9B-0
connects it to ordinary document Library admission, capture, restoration and
final-candidate validation. Cut 8D's explicit internal SSR consumer remains;
see [portable subject SSR](document-ssr-subjects.md).

The caller selects exactly one Library and supplies its validated associations
as `{ name, quid, disposition }` records plus `assertCurrent()`. The CSS layer
checks own data fields, canonical QUID and QUAD vocabulary, explicit disposition,
and one-to-one names and identities. Subject eligibility, owner issuance, Library
qualification and authored precedence remain the caller's existing Cut 8B
admission/projection responsibilities. Additional qualification fields on Cut 8B
restoration associations may accompany the compact records.

For outbound disposable correspondence, `name` must be exactly `_` followed by
`quid`. For inbound disposable correspondence, that portable payload must differ
from the receiving `quid`. Authored correspondence has no underscore inference:
`_xxxxxxxxx` remains authored, even when a legitimately issued receiving identity
happens to be `xxxxxxxxx`. Inbound translation always uses the supplied local
`quid`; it never extracts a new local identity from a portable name. Duplicate
mapping entries, including identical entries, reject. Repeated selector references
to one valid mapping are allowed.

## Selector representation

Runtime selectors use the existing exact attribute spelling:

```css
[hson\:quid="abcde1234"]
```

The portable selector spelling is:

```css
[hson\:quad="_abcde1234"]
```

The latter is ordinary CSS data referencing explicit correspondence. Cut 8D
realizes that address as derived `hson:quad` HTML metadata in its opt-in SSR mode.
It is not canonical document metadata, a permanent QUAD namespace, or another
identity authority.

## Syntax and preservation

The facility reuses the browser-compatible CSSTree ESM parser, walker, identifier
codec and generator already used by managed CSS, plus existing portable
stylesheet admission and serialization. It rewrites only structured equality
attribute nodes with an unqualified, exactly case-sensitive `hson:quid` name
(outbound) or `hson:quad` name (inbound), no flags, and a resolvable identifier or
string value. CSSTree decodes escaped names and values, including hexadecimal
escapes. Namespace recognition uses CSS delimiter tokens before identifier
decoding; an escaped literal pipe inside an identifier is not a separator.
Each rewritten attribute stays one equality attribute, preserving
specificity and the surrounding selector structure.

Selector lists, combinators, ordinary pseudos, pseudo-elements and structured
functional selectors such as `:is`, `:where`, `:not`, `:has`, and `:nth-child`
of-selectors use the same AST traversal. The existing admitted `@media`,
`@supports`, `@layer`, `@container`, `@scope` and `@starting-style` groups use that
traversal too. In particular, `@supports selector(...)` and both `@scope` root and
limit selectors translate. Group headers, rule scopes and ordered leaf scopes
are updated together, then readmitted as one candidate.

Declaration ASTs in conditions, including `@container style(...)`, are skipped.
Rule declarations, strings, URLs, custom-property values, animation and keyframe
names, property registrations and keyframe steps are retained through the
existing codec. Quoted selector lookalikes and ordinary attributes are not
interpreted as references. Opaque rule keys are unchanged, including keys whose
text contains a selector. Group occurrences, empty layers, source/declaration
order and layer order remain structural; equal header text does not merge groups.
Serialization may normalize CSS spelling without changing its meaning. Text
with no translated references is retained after existing canonical admission.

## Fail-closed boundaries and lifetime

Unresolved references, invalid mappings and mixed runtime/portable identity
selectors reject. Identity attribute presence tests, non-equality operators,
every flag (including `s`), different casing and namespace-qualified identity
attributes are unsupported and reject rather than survive as stale addresses.
Other ordinary attribute names remain ordinary selectors.

CSSTree `Raw` outside a declaration rejects when its CSS tokens contain a
potential identity attribute reference: opaque pseudo arguments and selector-bearing
group preludes cannot prove that reference's interpretation. The lexical gate
recognizes attribute-name positions, including namespaces, before decoding names;
classes, pseudo-element arguments, strings and namespace-prefix lookalikes remain
ordinary CSS. Harmless opaque arguments can coexist with exact translated selectors.
Syntax rejected by existing managed
source admission, such as imports, layer-order statements or nested style rules,
remains unsupported; this cut does not broaden that grammar. If rewritten scopes
cause existing compound `(scopes, ruleKey)` identities to collide, final admission
rejects atomically rather than renaming keys or merging independent occurrences.

Inputs are not mutated. All ASTs and the returned valid portable record are
independent. The caller fence runs before correspondence consumption and again
after final serialization, before a result can escape. A Cut 8B restoration
fence invalidated by topology, identity, graph or authority changes therefore
cannot yield current CSS. Outbound callers use the existing aggregate capture
fence around projection and consumption. The translator proves no long-lived
hosted session authority from this synchronous check.

## Ordinary Library subject demand (Cut 9B-0)

`document_css_subject_identities` uses the same AST traversal and equality
recognition. It extracts references from the current canonical stylesheet without
allocating identity. Structured `@supports selector(...)` feature tests ask about
syntax, not subject membership: ordinary demand mode validates their exact
attribute forms but leaves those tests unchanged. Opaque arguments containing
potential identity attributes still reject. `@scope` roots and limits, negative selectors, lists and functional
selectors remain subject demands. The explicit Cut 8C translator's default mode
continues to translate feature tests as before.

The aggregate owner projects demands through the current Library overlay and
issued ledger using Cut 8B. Existing authored bindings take precedence; anonymous
subjects use explicit disposable `_` plus QUID associations in the existing
`quads` envelope. CSS and associations are captured under one source fence.
Detached bounds and realization run after that coherent source phase closes.
There is no retained disposable binding or second subject ledger.

Portable admission validates graph, CSS and associations together. Unpublished
receiving overlays exclude all disposable payloads in the incoming transition,
mint fresh local QUIDs, and rebind CSS before installation or publication. Only
authored bindings remain registered. Same-runtime exact restoration can reuse a
payload only after the existing snapshot provenance proves its living owner and
epoch; ordinary portable admission never enables that internal translator mode.
The original portable stylesheet retained for Cut 8E is operation-local evidence
behind the restoration fence, never current CSS authority.

Every affected final graph/CSS candidate must project coherently before
acceptance. Movement and valid lineage may retain identities. Retirement with any
remaining subject reference rejects the whole transition. Public synchronous
`map.batch` can combine graph changes and stylesheet replacement in either order;
only the complete candidate is judged. No selectors or rules are deleted or
retargeted implicitly.

Full Library snapshots, selected Locus/Echo snapshots and semantic checkpoints
carry the same associations. Checkpoint equivalence compares disposable references
through their explicit subject paths, allowing fresh-runtime recapture without
persisting a runtime ledger. Incremental hosted changes to a Library with subject
CSS, subject-CSS topology messages, and subject identity CSS operations on portable
incremental codecs reject before publication or durable recording. Portable client
and durable tail replay enforce that same affected-Library boundary even without
a live managed execution owner. An attribute edit may be semantically safe locally
yet unsupported as a hosted incremental operation; its complete final snapshot or
checkpoint remains supported. Unrelated identity-free Library tails remain supported.
Loading rejects unsupported uncovered tails without returning a partially recovered
map or discarding history; checkpoint writing also refuses to overwrite that history.
Local initializer envelopes carry no subject correspondence: graph/CSS admission
rejects their subject references before installation. Identity-free initializer CSS
is installed with its graph and checked seed contract before the first notification.
Asynchronous
hosted CSS ordering/replay remains unsupported. Styled Part composition remains
rejected. Shared Node/Worker transport tests do not establish browser first paint
or flash-free grafting.
