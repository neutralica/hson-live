# Internal CSS subject correspondence translation

`translate_document_css_identities(record, direction, correspondence)` lives in
`src/internal/css/css-identity-translation.ts`. It consumes and returns the
existing `PortableDocumentStylesheetRecord`. It has no public export and is not
wired into runtime CSS ownership, capture, rendering, SSR, or continuation.

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

## Provisional selector representation

Runtime selectors use the existing exact attribute spelling:

```css
[hson\:quid="abcde1234"]
```

This translator alone uses a provisional portable selector spelling:

```css
[hson\:quad="_abcde1234"]
```

The latter is ordinary CSS data referencing explicit correspondence. It does not
establish an HTML carrier, SSR markup contract, canonical document marker,
permanent QUAD namespace, or another identity authority.

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

Any CSSTree `Raw` outside a declaration is conservatively rejected, even if it
appears identity-free: opaque pseudo arguments and selector-bearing group
preludes cannot prove complete translation. Syntax rejected by existing managed
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

SSR carriers, realization, graft-time stylesheet handoff, managed subject CSS
demand and ownership transfer, component CSS composition, and Locus/Echo
transport correspondence lifetimes remain separate seams. Shared Node/Worker
tests establish selector and portable-data behavior, not browser first paint or
flash-free grafting. Styled source-Library composition remains rejected.
