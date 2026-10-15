# Cut 9C-3 correctness repair report

The original three blockers, both second-review P2 defects and the live
retained-root native CSS carrier defect are repaired and covered by the focused
validation below. Two test-fixture corrections are also complete.
The automatic Part admission contract, realized-only storage, existing Library
authority, public API, identity epoch and stylesheet ownership mechanisms remain
in place. All work is unstaged and uncommitted for a new independent read-only
re-review. The latest repair is documented first; earlier repair evidence follows.

## Live retained-root CSS carrier repair and test-only validation continuation

The latest preflight verified `main`, HEAD
`f83e36916ea512b7708c1cd8f44ae45d35e0f326`, empty index, exactly 30 modified
tracked paths and the original two untracked paths. All incoming file hashes
matched the preceding diagnostic snapshot. README and tracked dist were unchanged.
This final continuation changes only `tests/livetree-attrs.acceptance.mts` and this
existing report. No production source, public type or contract changed in this
continuation. The final inventory is 31 modified tracked paths and two untracked
paths, listed at the end of this report.

### Accepted identity demand to retained native Element

The prior live repair found that `bind_document_css_tree` switched the managed
stylesheet without projecting newly demanded identity onto a previously continued
Element. Structural reconciliation reached that retained subject, but equal public
attrs bypassed attribute replacement, and that path did not itself represent CSS
identity demand. Correct canonical CSS and an existing receiving QUID therefore
coexisted with a missing native `hson:quid` marker.

The existing CSS binding now derives the exact demanded subjects from the accepted
stylesheet using the existing identity extractor. It resolves them through the
selected runtime and owning Mirror registration. Its previous-demand set is a
derived projection checkpoint, not identity authority. Mirror's internal
`projectCssIdentity` callback validates correspondence and requests native
projection through `apply_projected_attrs_replacement`. The attribute manager
keeps public-attribute equality and writes separate from this explicit native
identity request. Ordinary unchanged attrs still cause no public writes.

New carriers are present before stylesheet text/placement becomes active. Removed
demand is projected only after the old stylesheet is replaced or removed. Mirror
updates its native-identity observation state for intentional carrier removal,
so subsequent ordinary attrs remain valid without exposing an unused identity.
No QUID is minted, no canonical/public identity attr is added, no Element is
replaced, and no transport, source graph or new identity registry is introduced.

The production paths changed by that prior repair are:

- `src/api/livetree/managers/bound-document-css.ts`
- `src/api/livetree/lifecycle/document-binding-state.ts`
- `src/api/livetree/managers/attr-handle.ts`
- `src/api/mirror/mirror.document.ts`

The permanent browser group is
`already continued retained roots acquire and retire CSS carriers through direct and staged graph replacement`.
It starts with rendered markup and public `continue_document`, before any managed
CSS demand. Both direct and staged equivalent replacements retain the exact
Element and linked node, existing QUID, receiving QUAD and issued `.q()` handle;
they publish exactly once at revision one with the expected scoped stylesheet.
At synchronous stylesheet placement, the carrier already exists and computed
styles are `rgb(10, 20, 30)` and `13px`. Exactly one carrier is present despite
another QUAD-marked outside button; the outside control stays black/default `6px`.
True unchanged no-CSS replacements publish nothing, and later equal replacements
with valid lineage preserve the already accepted owned CSS as no-ops.

The same group moves the retained Element, replaces owned CSS with independently
authored CSS still demanding that QUID, and then uses supported `css.clearAll()`
to remove the last demand. The carrier remains while independent CSS requires it;
the last stylesheet retires before native carrier removal. Synchronous teardown
observes default styles, and the subject, handle and original Elements survive.
A later handle-driven attr update leaves Mirror active without restoring an
unused carrier. The original 20 graft groups, including portable restoration and
owned occurrence retirement, remain enabled; the new group makes 21.

### Two fixture corrections and preserved guarantees

The added DOM-free group
`retained-root CSS demand publishes with existing receiving identity and retires without retiring its QUAD`
checks both direct and staged publication, exact stylesheet demand, existing QUAD
and handle continuity, genuine no-ops and identity survival after CSS removal.
Its original assertions incorrectly spread `LiveMapIssuedQuidLedger`, an immutable
`size`/`has` facade. The preceding continuation replaced both spreads with the
existing `enumerate_livemap_issued_quids` helper used by QUAD/ledger tests. Exact
before/after issued contents are compared, detecting extra minting or lost claims.
Composition retains all previous 48 groups and adds this one: 20 admission +
17 styled + 12 retained = 49 groups per runtime. Portable QUAD remains 53.

The subsequent LiveTree inline-style failure was independently reproduced both
with working source and with the unchanged complete test bundled from HEAD
source read in memory via `git show`. The test and style-manager path were
unchanged from HEAD. `StyleManager.publishStyle` correctly writes the native
attribute `width: 2px`, and canonical state is `{ width: "2px" }`. The synthetic
Element's `setAttribute` updates its attribute map but never synchronizes its
separate `style.values` map. The failing assertion read that disconnected map.
There is no document binding on this path, so the new carrier logic is not invoked.
The diagnosis logs remain at `/tmp/9c3-inline-diagnosis-repro.log` and
`/tmp/9c3-inline-diagnosis-head.log`; the instrumented reproduction also confirmed
the correct attribute write. No production repair was made for this baseline issue.

The authorized test-only correction reads
`element.getAttribute("style") === "width: 2px"`, retaining the canonical typed
leaf assertion. Rejected pseudo and selector maps now compare the existing full
graph/native-attribute snapshot, strengthening the previous canonical-only check.
No expectation was skipped, no expected CSS value changed and no fake CSS parser
was introduced. All 13 LiveTree attrs cases pass.

### Completed targeted validation

For each acceptance name below, the exact command is
`node --import=tsx tests/<name>.acceptance.mts`. These were rerun in the final
test-only continuation, with every listed result passing:

| Acceptance name | Result |
| --- | --- |
| livetree-attrs | 13 Node/synthetic-DOM checks |
| livemap-document-composition | 49 Node + 49 actual Worker groups |
| livemap-document-quad | 41 Node + 41 actual Worker groups |
| livemap-document-quad-portable | 53 Node + 53 actual Worker groups |
| managed-stylesheet-fidelity | 23 Node + 23 actual Worker groups |
| inline-style | 17 Node + 17 actual Worker cases |
| livetree-css-lazy | 5 Node + 5 actual Worker groups; embedded hosted-continuation acceptance passed |
| livetree-css-public-api | passed |
| document-continuation | passed |
| mirror-document-attrs | 13 checks |
| mirror-document-correspondence | 21 checks |
| mirror-document-continuity | 19 checks |
| mirror-document-structure | 10 checks |
| livetree-livemap-attrs-convergence | 9 checks |
| livemap-runtime-local-identity | 9 checks |
| document-ssr-subjects | 20 Node + 20 actual Worker cases |
| document-portable-graft | 10 Node + 10 actual Worker cases |

The following passed in the preceding validation continuation after the native
carrier repair. Hash comparison confirms the production sources and these suites
are unchanged; they were retained as completed evidence rather than rerun:

| Acceptance name, same command form | Result |
| --- | --- |
| livemap-document-css | Node + actual Worker passed |
| portable-document-stylesheet | Node/Worker comparison passed |
| livemap-stylesheet-ingress | passed |
| hosted-document-css-phase-c | passed |
| document-replacement-lineage | 5 checks |
| document-same-quid-replacement-continuity | 8 checks |
| livemap-document-mutation | 13 checks |
| livemap-document-replay | 11 checks |
| livemap-document-operation-identity-effects | 22 checks |
| livemap-issued-quid-ledger | 9 checks |

`node --import=tsx scripts/run-document-ssr-subjects-browser.mjs` passed in real
Chrome. The initial sandbox `listen EPERM 127.0.0.1` was handled with normal
elevated execution of the unchanged command. All seven JavaScript-disabled
first-paint result groups pass: base SSR, composed Parts, selector root/descendant
coverage, move, portable restoration, retirement, and equivalent/colon nesting.
All 21 JavaScript-enabled graft groups pass, including the new continued retained
root group. Both direct/staged evidence records report one publication, revision
one, retained Element, one correct carrier and synchronous color/padding above.
The original root-inclusive specificity, implicit/colon nesting and outside
isolation checks remain green. Latest browser log: `/tmp/9c3-final-chrome.log`.

TypeScript commands all passed:

- `node_modules/.bin/tsc -p tsconfig.json --noEmit`
- `node_modules/.bin/tsc -p tests/tsconfig.json --noEmit`
- `node_modules/.bin/tsc -p scripts/tsconfig.json --noEmit`
- `node_modules/.bin/tsc -p tsconfig.json --emitDeclarationOnly --outDir <temporary-directory>`
- `node_modules/.bin/tsc -p /tmp/hson-9c3-final-consumers-mg6rqmg9/tests/entrypoints/public/tsconfig.json`
- `node_modules/.bin/tsc -p /tmp/hson-9c3-final-consumers-mg6rqmg9/tests/entrypoints/worker/tsconfig.json`

Fresh stripped declarations were emitted outside the repository and placed at
`/tmp/hson-9c3-final-declarations-x0__9jmm`. Fresh copies of the complete original
public/Worker fixture sets resolve package exports only to that declaration tree,
with strict checking and `skipLibCheck:false`. The public fixture explicitly
selects Node ambient types; the Worker fixture retains WebWorker libs and no
ambient types. Repository dist was neither built nor regenerated.

`git diff --check` passed. Both untracked files pass LF, single-final-newline,
no-trailing-whitespace and no-BOM checks. The final report and inventory are
audited again after this documentation update. No full gate, hook, staging,
commit, push, branch, stash or worktree operation was performed. Unsupported
boundaries remain exactly those documented below; neither fixture correction
changes the supported grammar or native carrier contract.

## Second targeted repair: graph-equivalent composition effects and colon nesting

Preflight again verified `main`, HEAD
`f83e36916ea512b7708c1cd8f44ae45d35e0f326`, empty index, the exact original
27 modified tracked paths and two untracked paths, unchanged README and no tracked
dist paths. SHA-256 hashes of all 29 files matched the previous repair's saved
final state. This repair changes only seven of those paths: the core planner,
Part stylesheet lowerer, two existing composition fixtures, existing Chrome
runner, stylesheet contract and this report. No new repository file is added.

### P2: graph-equivalent replacements

Independent reconstruction `/tmp/9c3-second-repro.mts` first reproduced all four
combinations (direct/staged graph, unmarked/QUAD-marked root with valid lineage)
in Node and an actual DOM-free Worker: `changed:false`, revision zero, no
publication and an empty stylesheet. After repair all four return `changed:true`,
revision one, one publication and the expected scoped stylesheet. Marked handles
remain active.

The exact cause was the graph/overlay equality guard around occurrence styling
in `prepare_authority_transition`: equal realized markup and equal initial
identity overlay prevented `compose_styles` from running. The smallest repair
plans occurrence styles against the ordinary prepared graph/overlay before the
no-op decision, then compares the final overlay and complete portable stylesheet,
including ordered ownership metadata. Recording/installation still uses the
existing candidate, incoming-fragment identity proof and one authority transition.
No registry, source graph or new public API was added. Explicit destination-lineage
translation and `scope_part_stylesheet` are unchanged by this repair.

The complete effects are staged only when graph, overlay or governed stylesheet
state differs. Plain and empty-CSS equivalent Parts remain no-ops; empty-CSS
replacement with valid root lineage also remains a no-op after owned styling has
already been accepted. Controls assert `changed:false`, unchanged revision,
identical capture/overlay/issued-ledger objects and zero publications. Positive
cases assert one revision, one commit and one authority-position publication,
unchanged canonical markup, exactly one demanded root identity, actual scoped
rules and the correct authored QUAD/handle behavior. An existing legitimate
identity is reused; an allocator that would throw is never called in that case.
Derived replacement evidence may pair structural retire/introduce effects for
the same QUID; the final active overlay, handle and issued lifetime are preserved.

Allocation exhaustion, duplicate keyframes and managed-authority rejection use
specific error assertions and verify atomic rollback. Allocation-time reentrancy
retains the completed inner data edit while rejecting the outer candidate without
CSS or identity publication. Independently authored ancestor CSS survives valid
lineage, and unsafe ancestor removal still rejects with the active-subject error.
An empty ordered layer is also tested as an accepted ownership/order effect even
without declarations. Each initially identical occurrence is moved, transported
A→B→C with fresh receiving IDs and no Part definitions, and retired with its owned
CSS removed while the issued ledger retains its retired local claim.

### P2: colon-bearing implicit selectors

The independent reproduction confirmed that `button:is(.b)`, `button:not(.x)`,
`button:first-child`, `button::before`, and the implicit-first mixed list rejected;
the explicit-first list already admitted. CSSTree classified the failing nested
rule as a `Declaration` whose value was `Raw`, rather than a block-level `Raw`.
The lowerer's existing recovery therefore missed it.

The same bounded token splitter now also handles non-custom declarations with
raw values. Exact CSSTree source positions and the current parse fragment's source
are threaded through recovery: regenerating the mistaken declaration would remove
whitespace before a colon and change `button :is(...)` into `button:is(...)`.
Source slices preserve that distinction, comments, strings and escapes. This
extends the existing CSSTree/lowering seam; it is not a second declaration grammar.
Strict declaration parsing still handles actual property/value sequences, while
custom properties retain their complete raw values and balanced blocks. Selector
lists and explicit nesting continue through the existing structural selector
lowering and zero-specificity inclusive scoping, without changing their cascade.

Permanent equality checks cover all six requested forms, reversed mixed-list
order, functional selector lists, whitespace/comment-separated descendant pseudos,
escaped colon identifiers, interleaved declarations, all supported grouping
contexts, literal colon/brace strings, data URLs, custom-property blocks and
colon-bearing custom values. Actual declaration records equal the ordinary
managed parser's records exactly. Specific diagnostics reject missing colons,
unbalanced delimiters, opaque pseudo arguments, nested style-rule @scope and
malformed ordinary function values. These malformed inputs also exercise failed
Library admission with unchanged capture, issued ledger and publication count.
No rule or parse error is silently dropped.
All six independent selector probes now admit in Node and an actual Worker.

### Specific permanent regressions and coverage mapping

All eight additions run in both Node and the actual Worker via the existing
composition fixture/runner; no old group was removed:

- `direct graph-equivalent Part replacement admits complete effects and preserves true no-ops`
- `batch graph graph-equivalent Part replacement admits complete effects and preserves true no-ops`
- `direct graph-equivalent Part effects fail atomically and retain reentrant inner work`
- `batch graph graph-equivalent Part effects fail atomically and retain reentrant inner work`
- `graph-equivalent Part replacement reuses receiving identity and preserves independent ancestor CSS and ownership-only effects`
- `colon-bearing implicit nesting equals explicit nesting in either list order and preserves declaration serialization`
- `equivalent replacement and colon-bearing nested selectors share source-free scoped ownership`
- `retained styled coverage: configured cross-collection selection preserves stylesheet preorder and connector/root identity equality`

The first repair's escaped-identity/preorder group retained fixed same-collection
preorder, and its configuration groups retained cross-collection graph selection.
They did not explicitly combine configured cross-collection stylesheet selection
and preorder, nor assert exact parent-connector/selected-child-root identity
equality. The earlier coverage mapping overstated these two points. The new
retained-styled group restores both without widening source behavior: a detached
private traversal selects `other/cross` through recursive `use`, proves CSS order
`outer → cross → inner` and equal parent-connector/selected-root paths. Ordinary
automatic admission of that same selected topology then proves equal actual
parent/child subject selector strings, the same receiving QUID and child root
scope, an `aside` at that identity, and exactly three demanded subjects.

| Composition mapping per runtime | Groups |
| --- | --- |
| Before second repair | 14 admission + 14 styled + 12 retained = 40 |
| Added by second repair | 5 integrated-candidate + 2 colon/shared-fixture + 1 narrow coverage = 8 |
| Final | 19 admission + 17 styled + 12 retained = 48 |

Portable QUAD remains 37 + 16 = 53 groups per runtime; its previous cases are
unchanged in this second repair.

### Latest observed validation

`node --import=tsx tests/<name>.acceptance.mts` passed for:

| Acceptance | Latest result |
| --- | --- |
| livemap-document-composition | 48 Node + 48 actual Worker groups |
| livemap-document-quad | 41 Node + 41 actual Worker groups |
| livemap-document-quad-portable | 53 Node + 53 actual Worker groups |
| managed-stylesheet-fidelity | 23 Node + 23 actual Worker groups |
| livemap-document-css | Node + actual Worker passed |
| document-ssr-subjects | 20 Node + 20 actual Worker cases |
| document-portable-graft | 10 Node + 10 actual Worker cases |
| livemap-part-collections | 28 Node + 28 actual Worker groups |
| document-replacement-lineage | 5 checks |
| document-same-quid-replacement-continuity | 8 checks |
| livemap-document-mutation | 13 checks |
| livemap-document-replay | 11 checks |
| livemap-document-operation-identity-effects | 22 checks |
| livemap-runtime-local-identity | 9 checks |
| portable-document-stylesheet | passed |
| livemap-stylesheet-ingress | passed |
| mirror-document-correspondence | 21 checks |
| hosted-document-css-phase-c | passed |

Source, test and tooling TypeScript checks passed. Fresh stripped declarations
were emitted to `/tmp/hson-9c3-second-declarations`; copied complete public and
WebWorker consumer suites in `/tmp/hson-9c3-second-consumers` passed with strict
checking and `skipLibCheck:false`, including added lineage/changed-result checks
and expected rejection of public `.template()`, `.compose()` and `.source`.

Real Chrome ran the normal unchanged command
`node --import=tsx scripts/run-document-ssr-subjects-browser.mjs`. The sandbox's
loopback `listen EPERM` was handled by normal elevated execution. All previous
disabled-JavaScript first-paint pages and all 20 enabled graft groups pass.
The added `/second-repair` page is also checked with page JavaScript disabled:

- Four initially identical button replacements (direct/staged, each unmarked and
  marked) show `rgb(10, 20, 30)` and `13px` left padding.
- Both repeated colon-selector occurrences show `button:is(.b)` color
  `rgb(10, 20, 30)`, `button:not(.x)` padding `13px`, `button:first-child` border
  `5px`, and `button::before` content `"hello"`.
- Implicit-first mixed list yields `17px` right padding; explicit-first mixed list
  yields `19px` left margin. Functional pseudo specificity yields `23px` right
  margin over a later plain selector, and layer/media/supports nesting yields
  `3px` letter spacing.
- An independently styled sibling remains `rgb(70, 80, 90)` with `21px` padding,
  default border and no pseudo content. The outside control remains black with
  `6px` padding, zero margins, normal letter spacing and no pseudo content.
- Seven portable carriers, zero runtime foreign claims, zero residual connectors,
  and a negative page script that never executes.

`git diff --check` and explicit tracked/untracked whitespace and final-newline
checks pass. No full check gate, Git hook, dist build/regeneration, staging,
commit, push, branch, worktree, stash, or Deck work occurred. The unsupported
boundaries remained unchanged at that stop. The original inventory was 29 paths;
the current final inventory below also includes the later carrier and test repair.

## First repair starting state

Before edits: branch `main`, HEAD
`f83e36916ea512b7708c1cd8f44ae45d35e0f326`, empty index, exactly the supplied
27 tracked modifications and two untracked files. README and tracked dist were
unchanged. No unrelated work was found. The final inventory is still those same
29 paths. This repair changed ten of them relative to the incoming patch,
including this report; the other nineteen incoming files were preserved.

## P1: replacement lineage through connector expansion

Root cause: `realizeOperation` replaced all replacement lineage with `[]` after
expansion. The second ordinary graph-planning pass consequently retired surviving
subjects, removed authored QUAD bindings, invalidated retained handles, and could
reject independently authored CSS that referenced the surviving ancestor.

`expand_document_composition` now returns transient, detached correspondence from
actual authored shell paths to final realized subject paths. Connector completion
records its single realized root. Part-generated descendants receive no shell
correspondence. `realizeOperation` normalizes the caller's partial bijection,
translates requested destination paths through that construction evidence, and
hands the result to the existing replacement planner. Source paths continue to
refer to the old graph. Missing destinations reject; the ordinary planner still
checks final endpoints, exact identity evidence and bijectivity. This is neither
stored source provenance nor another identity authority.

Permanent regression names in `livemap-document-composition-cases.mts`:

- `direct replacement translates explicit lineage through Parts and preserves the complete receiving state`
- `batch graph replacement translates explicit lineage through Parts and preserves the complete receiving state`
- `connector replacement correspondence is explicit and cannot name generated Part descendants`

Both direct and staged graph cases retain the root QUID, descendant QUID after
rearrangement, authored `keep`/`child` bindings and old handles. They assert the
complete three-subject receiving overlay, the old issued claims plus exactly one
new Part claim, one revision, one commit and one authority-position publication.
An outgoing styled descendant and its keyframes retire atomically while the
independent ancestor rule survives. Removing the new Part removes its rule and
keyframes alone. Retiring the independently styled surviving ancestor still
rejects. Missing sources, carrier destinations, invented Part-descendant paths
and duplicate destinations roll back graph, CSS, registry, overlays, epoch,
issued-ledger object, revision and publications. Explicit connector-root lineage
preserves the requested lifetime; empty lineage invents no continuity.

The original `/tmp/9c3-review-lineage.mts` now reports an active old handle,
present QUAD and no error for control, direct, batch and independent-CSS modes.
The five existing replacement-lineage and eight same-QUID continuity checks pass.
The new regressions execute in Node and an actual DOM-free Worker.

## P2: root-inclusive ordinary Part selectors

Root cause: unmodified ordinary selectors inside native `@scope` acquire an
implicit descendant relationship and miss both the root and selectors that need
that root as an ancestor. Existing fixtures used `&` for the root.

`scope_part_stylesheet` now parses each selector list and structurally places
`:where(:scope,:scope *)` in each ordinary selector's first compound, before a
pseudo-element. The compound can match the scope root or its descendants. The
constraint adds zero specificity; each member of a normal selector list keeps its
own specificity. Explicit scope-containing selectors retain their relationship;
top-level `&` still becomes `:scope`. The existing exact receiving-root scope and
owner selectors remain the only identity references. No authored root QUAD is
required. Group order, global-definition ownership, portable translation and
retirement are unchanged. The relevant scope semantics are described in the
[CSS scope specification](https://www.w3.org/TR/css-cascade-6/#scoped-styles).

Permanent regression:
`ordinary selectors include anonymous occurrence roots with zero added specificity and retain portable owned teardown`.
The shared `selector_fixture` is used by Node/Worker admission and real Chrome.
The existing graft fixture now uses ordinary `section` root rules and implicit
`section { button { ... } }` nesting instead of hiding the issue behind `&`.

The original `/tmp/9c3-review-root-css.mts` passes in real Chrome: bare button
color `rgb(10, 20, 30)`, padding `13px`; section border `5px`; child color
`rgb(40, 50, 60)` and margin `17px`; explicit-& button padding `19px`; outside
button remains black with default `6px` padding.

## P2: ordinary implicit CSS nesting

Root cause: CSSTree recognizes an initial `&` as a nested rule, but initially
parses ordinary type/class starts as declarations and recovers them as Raw.
The eager error callback threw before recovery. Simply retrying a whole Raw
stylesheet also cannot preserve declarations interleaved with nested rules.

`parse_part_stylesheet` keeps that recovery until a balanced-token pass separates
style-block declarations, qualified nested rules and supported conditions.
Each declaration and selector is parsed in its appropriate context; nested rules
re-enter the same lowering path. Custom-property blocks remain declarations,
while a `--`-prefixed type selector without a colon remains a selector. Strings,
comments and function/bracket/block delimiters participate in token boundaries.
Malformed or opaque constructs still reject through strict parsing and the
ordinary managed codec. Existing source, depth, token and expansion bounds remain.

Implicit selectors receive the parent's `:is(...)` descendant relationship.
Explicit and implicit list members are lowered separately in either list order.
Nested lists and conditions retain the nesting parent's maximum selector-list
specificity; declaration runs retain their position and parent matching behavior.
These behaviors follow the [CSS nesting specification](https://www.w3.org/TR/css-nesting-1/).

Permanent regression:
`implicit type/class nesting and either mixed-list order equal explicit nesting, including nested conditions and declaration order`.
It compares canonical managed records for type, class and `--widget` selectors,
both mixed-list orders, multiple nesting levels, media/supports conditions,
interleaved declarations, custom-property blocks and quoted delimiter content.
Malformed nesting and unsupported opaque/nested-scope cases reject. All nine
original `/tmp/9c3-review-css-probes.mts` inputs now lower successfully.

## Real Chrome evidence

`node --import=tsx scripts/run-document-ssr-subjects-browser.mjs` passes with real
Google Chrome, source bundled, without generating dist. The initial sandbox
`listen EPERM 127.0.0.1` was an infrastructure denial; the identical command was
rerun with normal elevated execution. No assertions were bypassed.

Page JavaScript is explicitly disabled during first-paint checks. An injected
negative script never executes. Assertions run against all four selector pages:
`/selectors`, `/selectors-moved`, `/selectors-restored` and `/selectors-retired`.

- Anonymous repeated button roots: `rgb(10, 20, 30)`, `13px` padding and generated
  `::before` content. A normal `button,#never` list loses to later `.bare` as it
  should, giving `24px` right padding without an ID specificity leak.
- Section root: `5px` border. `section button` reaches its child, deeper button
  and nested Part button: all `rgb(40, 50, 60)`.
- `.a { button { ... } }`: `14px` left padding on all three buttons.
  `.a { .b { ... } }`: `4px` child border.
- Implicit-first mixed list: `15px` right padding. Explicit-first mixed list:
  `16px` top margin. Media/supports nesting: `18px` bottom padding; condition
  mixed list: `19px` child top padding.
- Parent-list maximum specificity: `23px` child right margin beats a later
  lower-specificity rule. Nested lists: `6px` deep-button word spacing.
  Inner scope root: `7px` border; inner root/descendant selector: `3px` letter spacing.
- Independently styled sibling: `8px` root border, `rgb(70, 80, 90)` child and
  `21px` padding; no leaked ancestor margins/nesting. Outside section/button:
  zero section border, black button, `6px` default padding and zero margin.
- Root moves retain styles and identities. Source-free A→B→C restoration keeps
  styles with fresh receiving IDs. Retirement removes only the ancestor
  occurrence and its CSS; the other four styled roots retain their styles.
  Five portable carriers become four after retirement. There are no connectors,
  generated foreign claims, or executed page scripts.

All 20 enabled-JavaScript portable-graft groups also pass. They now include a live
root move retaining the exact Element and unchanged CSS, ordinary root selectors,
implicit nested Part styling, synchronous handoff before carrier consumption,
sibling independence after a local override, original Elements, strict
independent-rule retirement, owned teardown, source-free re-grafting and runtime
connector insertion/removal with namespace-exhaustion rollback.

## Coverage inventory: retained, merged, superseded and restored

The HEAD versions were compared directly with the incoming patch. The composition
reduction was not merely counting: distinct structural, configuration, identity,
Schema and reentrancy assertions had been removed. They are restored below in
grouped fixtures at the existing pure traversal and ordinary admission seams.
No inert source-document store or new construction API was added.

| Suite | HEAD groups per runtime | Incoming patch | Final repair |
| --- | --- | --- | --- |
| Composition plus styled composition | 52 + 12 | 11 + 10 | 14 admission + 14 styled + 12 retained-coverage = 40 |
| Portable QUAD plus CSS-subject cases | 33 + 16 | 37 + 16 | 37 + 16 = 53 |

Portable QUAD lost no prior group or distinct assertion: its diff adds four
private-Part/Locus/managed-topology/checkpoint groups and changes connector
spelling in existing fixtures. Its 16 CSS-subject groups are unchanged. Two new
Part-CSS text expectations now assert the actual inclusive selector representation.

Concrete composition coverage retained or restored (group titles in the fixtures
start with `retained structural coverage`, `retained admission coverage`,
`retained authority coverage`, `retained private traversal coverage`, or
`retained styled coverage`):

| Prior meaningful cases | Final coverage |
| --- | --- |
| Exact slash/Unicode/empty coordinates; cross-collection context; one read per exact pair; sibling reuse | Existing eager-admission groups plus restored forest/coordinate/read-count group |
| Root/descendant/local connector landmarks; receiving forest offsets; same-name agreement and conflicting names | Existing local-name isolation plus restored canonical coordinates, q agreement, duplicates, cardinality and hostile-name checks |
| Repeated graph/attribute/style independence; unmodified source; one complete topology publication | Restored independent inline storage/selected CSS group; existing repeated styled roots and inert definition-edit tests |
| Reusable configurations; JS/native HsonData/Transform/governed-data equivalence; nested same/cross collection selection | Restored reusable-config group, shared subconfigurations, recursive body/action selection, empty text and explicit promotion |
| Absent versus empty text; existing string attr overrides; wrong immediate content; exact HTML and SVG equivalence | Restored root-customization group; scalar placeholder admission separately exercises the new authored input grammar |
| Own enumerable descriptors; accessors/hidden fields; executable values; cycles; legacy as/use.quad; invalid fields/types | Restored exact-configuration group, null-prototype positive case and data-only negatives |
| Recursive at locality, ordinary-node use rejection, ambiguous self-addressing, missing targets and receiving cardinality | Restored exact-configuration/subtree/cardinality checks and private current-landmark retirement group |
| Direct/indirect/cross/configured cycles; finite graph/configuration budgets; exact control spelling; ungoverned sources | Restored cycle/control group and recursive/configuration resource checks; existing traversal-bound failures |
| Complete-collection revalidation, including an invalid unselected raw member | Restored corruption case verifies no publication or ledger/position change and restores its fixture graph |
| Final candidate Schema and later governed edits | Restored valid Schema admission, retained Schema identity and invalid subsequent replacement; existing failed realized-Schema checks |
| Current moved/retired landmarks; already-composed shells; source identities stripped and destination IDs fresh | Restored private traversal group plus exact-runtime stripping, source-free restoration and same-QUID suites |
| Empty/absent CSS, empty ordered layers, registrations/keyframes, unvisited styles and native style/inline policy | Restored selected CSS/inline group plus existing nested/global positive and duplicate-conflict groups; managed-shell transfer remains rejected |
| Escaped identity attributes, structured :has/:not, literal identity lookalikes and supports selector syntax tests | Restored styled escaped/literal/supports/preorder group and malformed/generated/mixed/opaque identity rejection before allocation |
| Stylesheet preorder and exact parent connector/child root correspondence | Fixed preorder retained in first repair; configured cross-collection CSS preorder and exact runtime selector/QUID equality explicitly restored in the second repair group above |
| CSS/graph takeover in either batch order; strict independent-rule retirement | Restored explicit takeover group; new lineage tests also check old/new owned globals and surviving independent ancestor CSS |
| Batch/exclusive management; discarded/stale/already-accepted transitions; incomplete identity preflight and realize | Restored authority group exercises both phases and ordinary prepared-transition fences |
| Configuration/source reentrancy: data, identity, authority and topology; late management/staleness; detached values; inner styled admission | Three restored authority groups plus existing allocation reentrancy; independently accepted inner state is captured and preserved |
| Sparse allocation, exhaustion, no read allocation, fresh A→B→C CSS correspondence, private projection, hosted incremental rejection and durable boundaries | Retained styled groups, portable QUAD/CSS-subject groups, SSR/graft cases and replay/identity suites |

Assertions tied specifically to an inert Library shell, later re-expansion of its
stored connectors, and the old connector attr/text override grammar are
superseded by the approved realized-only/scalar-placeholder contract. Their
still-supported structural/private configuration behavior is tested directly at
`expand_document_composition`; their public authority/publication behavior is
tested at authored addition and ordinary mutation. Opaque functional selector
arguments remain explicitly unsupported by the incoming documented grammar.
Numeric group equality was not a target.

## First repair validation (historical; latest results are above)

All commands below passed using source entrypoints, without the full check gate.
Unless stated otherwise, commands are
`node --import=tsx tests/<name>.acceptance.mts`.

| Acceptance | Result |
| --- | --- |
| livemap-document-composition | 40 Node + 40 actual Worker groups |
| livemap-document-quad | 41 Node + 41 actual Worker groups |
| livemap-document-quad-portable | 53 Node + 53 actual Worker groups |
| livemap-part-collections | 28 Node + 28 actual Worker groups |
| document-replacement-lineage | 5 Node checks |
| document-same-quid-replacement-continuity | 8 Node checks |
| managed-stylesheet-fidelity, including CSS identity translation | 23 Node + 23 actual Worker groups |
| livemap-document-css | Node + actual Worker passed |
| portable-document-stylesheet | passed |
| livemap-stylesheet-ingress | passed |
| livemap-document-mutation | 13 checks |
| document-portable-graft | 10 Node + 10 actual Worker cases |
| document-ssr-subjects | 20 Node + 20 actual Worker cases |
| livemap-document-replay | 11 checks |
| livemap-identity-replay-provenance | 8 checks |
| livemap-document-operation-identity-effects | 22 checks |
| livemap-identity-aba-prevention | 10 checks |
| livemap-document-identity-handle | 11 checks |
| portable-node-ingress | admission/runtime round trips passed |
| livemap-runtime-local-identity | 9 checks |
| mirror-document-structure | 10 checks |
| mirror-document-correspondence | 21 checks |
| hosted-document-css-phase-c | passed |

Also passed:

- `npx tsc -p tsconfig.json --noEmit`
- `npx tsc -p tests/tsconfig.json --noEmit`
- `npx tsc -p scripts/tsconfig.json --noEmit`
- `npx tsc -p tsconfig.json --emitDeclarationOnly --outDir /tmp/hson-9c3-repair-declarations`
- Fresh public and WebWorker consumers, copied from the complete repository
  consumer fixtures into `/tmp/hson-9c3-repair-consumers`, resolving only the fresh
  stripped declaration package, with strict checking and `skipLibCheck: false`.
  Additional consumers certify direct/staged lineage and expected rejection of
  public `.template()`, `.compose()` and `.source`.
- Original independent lineage/parser probes and original real-Chrome root probe.
- `node --import=tsx scripts/run-document-ssr-subjects-browser.mjs`, with disabled
  first paint and all 20 enabled graft groups.
- `git diff --check`; new-file trailing-whitespace, LF and single-final-newline checks.

Temporary probes, logs, emitted declarations and consumer copies are under `/tmp`.
No full `npm run check`, Git hook, build, staging, commit, push, branch, worktree,
stash or tracked dist regeneration was performed.

## Remaining supported boundaries

The existing boundaries remain: one ordinary Part root; realized-only storage;
exact bounded non-evaluating scalar initial placeholders; native browser @scope
support; strict managed-codec declaration limits; no opaque selector arguments,
imports, namespaces, font-face, layer-order statements, unsupported globals, or
@scope nested inside a style rule. Supported globals retain their names and
conflict on duplicates. Nonempty managed CSS rendering still needs explicit
html/head. Hosted incremental subject-CSS additions/mutations and durable
incremental encoding remain unsupported; full authority snapshots/checkpoints are
supported. Local initializer subject-correspondence limits remain. No additional
unsupported boundary was introduced to avoid any reviewed failure.

## Final Git and file inventory

Branch: `main`. HEAD: `f83e36916ea512b7708c1cd8f44ae45d35e0f326`.
Index: empty. Worktree: 31 modified tracked files and two original untracked files.
This is the latest incoming 30-path tracked inventory plus the authorized
`tests/livetree-attrs.acceptance.mts` baseline correction. README is unchanged and no README update was needed
for these targeted repairs. Tracked dist is unchanged (there are no tracked dist
paths) and was not regenerated.

| State | File |
| --- | --- |
| modified, unstaged | `docs/contracts/css-identity-translation.md` |
| modified, unstaged | `docs/contracts/styled-part-composition.md` |
| modified, unstaged | `docs/hson-authoring-baseline-repair.md` |
| modified, unstaged | `docs/livemap/api-livemap.md` |
| modified, unstaged | `scripts/run-document-ssr-subjects-browser.mjs` |
| modified, unstaged | `src/api/livemap/livemap.core.ts` |
| modified, unstaged | `src/api/livemap/livemap.document.composition.ts` |
| modified, unstaged | `src/api/livemap/livemap.document.mutation.ts` |
| modified, unstaged | `src/api/livemap/livemap.document.registration.ts` |
| modified, unstaged | `src/api/livemap/livemap.document.ts` |
| modified, unstaged | `src/api/livemap/livemap.libraries.ts` |
| modified, unstaged | `src/api/livemap/livemap.parts.ts` |
| modified, unstaged | `src/api/livetree/lifecycle/document-binding-state.ts` |
| modified, unstaged | `src/api/livetree/managers/attr-handle.ts` |
| modified, unstaged | `src/api/livetree/managers/bound-document-css.ts` |
| modified, unstaged | `src/api/mirror/mirror.document.ts` |
| modified, unstaged | `src/internal/css/css-identity-translation.ts` |
| modified, unstaged | `src/internal/css/portable-document-operations.ts` |
| modified, unstaged | `src/internal/css/portable-document-stylesheet.ts` |
| modified, unstaged | `src/internal/exact-runtime-node-admission.ts` |
| modified, unstaged | `src/types/document-css.types.ts` |
| modified, unstaged | `tests/browser/document-portable-graft.entry.mjs` |
| modified, unstaged | `tests/fixtures/document-portable-graft-cases.mts` |
| modified, unstaged | `tests/fixtures/document-ssr-subjects-cases.mts` |
| modified, unstaged | `tests/fixtures/livemap-document-composition-cases.mts` |
| modified, unstaged | `tests/fixtures/livemap-document-quad-cases.mts` |
| modified, unstaged | `tests/fixtures/livemap-document-quad-portable-cases.mts` |
| modified, unstaged | `tests/fixtures/livemap-part-collections-cases.mts` |
| modified, unstaged | `tests/fixtures/livemap-styled-composition-cases.mts` |
| modified, unstaged | `tests/livemap-document-composition.acceptance.mts` |
| modified, unstaged | `tests/livetree-attrs.acceptance.mts` |
| untracked | `docs/contracts/cut-9c3-implementation-report.md` |
| untracked | `src/internal/css/part-stylesheet.ts` |

Stop state: ready for fresh independent read-only re-review; all work remains unstaged and uncommitted.
