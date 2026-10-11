# HsonNode compact representation

Hson 3.0 stores only `$_tag` and `$_content` on a node with no attributes or
metadata. `$_content` remains required. `$_attrs` and `$_meta` are optional
storage containers. Canonical no-attribute state requires `$_attrs` to be
absent; a present empty `$_attrs` rejects at generic public portable `fromNode()`.
Present-empty `$_meta` likewise rejects rather than being removed. Absence is
the sole canonical no-metadata state. Runtime construction helpers and external
format lowering may omit empty accumulators at their own boundaries; they do
not define the exact raw node admission contract.

## Construction and mutation rules

- `CREATE_NODE()` omits an optional container when it is absent or has no own
  enumerable entries. Populated input containers retain their existing shallow
  ownership behavior.
- Attribute, form, style, and metadata writers create a container immediately
  before the first real write.
- Attribute, style, document mutation, and QUID deletion paths delete the container
  property after removing its final entry.
- Reads use optional access and never call the write-side materialization
  helpers.
- Cloning copies only populated containers. LiveTree identity reminting may then
  create populated QUID metadata on the clone.
- An explicitly authored `style` attribute may retain `$_attrs.style = {}` as a
  semantic attribute entry for wire round trips; deleting the style through a
  mutation API removes that entry and then prunes `$_attrs` when otherwise empty.

LiveMap does not expose live canonical nodes publicly. Detached `root()` and
document observations never install optional containers on the owned graph.

The internal parser staging helpers `split_attrs_meta()` and
`parse_html_attrs()` still use mutable empty accumulators while parsing. Those
objects are not installed on a node unless populated. Serializer helpers may
also create ephemeral empty output maps; no public node API materializes an
empty storage container for inspection.

## Construction-path audit

- Canonical factory: changed to emit one of the four exact shapes: required
  fields only, attrs only, metadata only, or both.
- Hson token, JSON, and HTML parsers: obsolete explicit empty metadata arguments
  were removed; populated parser accumulators remain deliberate.
- SVG DOM conversion: migrated its two direct node literals to `CREATE_NODE()`.
- Root/object unwrap helpers and form VSN construction: removed explicit empty
  bags.
- LiveTree detached creation and LiveMap JSON construction already used the
  canonical factory; their populated SVG attrs and array-index metadata remain
  intentional.
- LiveMap cloning/overwrite and LiveTree branch cloning now remove absent or
  empty optional storage instead of copying placeholders.
- The diagnostics `_bad` node literal remains an intentional failure sentinel.
- Demo render constants remain serialized application fixtures with populated
  attributes. Lifecycle and representation tests retain a few direct literals
  specifically to exercise malformed or explicitly empty storage shapes and
  verify strict rejection.

## Historical normalization and current exact admission

Before Pass 1, generic Transform node ingress removed undefined, empty-record,
and legacy empty-array attribute candidates, stringified primitive ordinary
attribute values, and elided a sole empty `_hson_elem` relationship. Those are
historical behaviors, not current public admission rules.

Current generic portable `fromNode()` admits an exact snapshot or rejects
eagerly. Present undefined, empty, or array-valued attrs/meta reject; ordinary
attribute values must be strings; an empty `_hson_elem` relationship rejects.
Strict equality preserves numeric `0` versus string `"0"` and absent versus
present fields. An empty named element uses `$_content: []` in its proper
enclosing role. Empty complete `_hson_obj` and `_hson_arr` remain distinct.
Internal runtime construction and external-format lowering retain their actual
context-specific helpers pending their separate migrations. They are not
routed through forgiving public `fromNode()` admission.

Invariant validation rejects non-plain node objects, missing/non-array
`$_content`, non-empty array/null/class-instance containers, malformed
attribute or metadata values, illegal header names, legacy
`$_meta.attrs`/`flags`, populated attrs on VSN nodes, cycles, and non-finite
Hson numeric values. Shared acyclic references are allowed; Hson serialization
emits each occurrence by value and does not preserve JavaScript reference
identity.

Structured inline-style entries are enumerable own data properties. A typed
declaration leaf requires an enumerable own data property `value`; its optional
`unit`, when present, is likewise an enumerable own data property. Inherited,
accessor-backed, and non-enumerable semantic fields reject without invoking a
getter. Writable and configurable descriptor flags are not graph semantics.
The three value states `unit` absent, own-present `undefined`, and own-present
string remain distinct canonical states.

Style storage and CSS text have distinct contracts. Canonical structured storage,
Binary, tagged transport, captures and copies preserve lawful finite numbers
(including `-0`), strings, booleans, null, empty/whitespace-bearing strings,
property names and typed-unit field presence. CSS projection does not change
that storage; it uses ordinary string coercion (`-0` projects as `0`), omits
null/empty declarations, and applies the existing CSS property-name projection.
Ordinary HTML style text does not promise an exact typed-style round trip.

Readable `style="..."` authoring and HTML-to-structured-style parsing admit a
complete CSS declaration list strictly. Malformed tokens, declarations or
priorities reject the entire input. Unsupported values and sequences reject;
there is no browser-like partial recovery. Unknown property names are allowed
when their spelling is representable. Native browser interpretation of projected
CSS remains a separate boundary.

The flat map retains one value per property. Valid supported duplicates select
important over normal and the last occurrence at equal priority. Differing
duplicates collapse only for the established literal color, display, opacity
and sizing cases in `collapse_safe_literal`; identical duplicates and custom
properties also collapse. Other differing fallback duplicates (including
unknown/vendor, variable-dependent and newer unsupported values) reject. Canonical
projection sorts native property names: admission never reverses distinct names
unless they are custom properties or the explicitly supported independent
longhands listed in `src/internal/css/inline-css.ts`. Thus
`margin:10px;margin-top:5px` admits, while the reversed sequence rejects.
Escapes that cannot survive name projection or boundary trimming, and empty CSS
values the projection would omit, also reject. This is a bounded supported CSS
domain, not a promise to admit every browser-valid declaration list.
Boundary checks use CSS token whitespace, including at the leading boundary;
Unicode separators such as NBSP are significant content and reject if the
existing projection would trim them. Inline setters check before coercion, and
complete-state edits also preflight untouched leaves without narrowing storage.
A leading declaration-list BOM also rejects; stylesheet BOM trivia is not an
inline-style admission rule.
`calc()` uses a bounded headless dimensional check: sums require compatible
types, products require a proven numeric factor, and division requires a proven
nonzero numeric divisor. Length/percentage combinations, numeric and time results
admit only in the receiving-property domains listed in `math_domain`.
Parentheses and nested literal `calc()` are supported. `var()` operands inside
typed arithmetic reject: neither a fallback nor a present runtime custom
property establishes a static dimensional proof. Ordinary non-arithmetic
`var()` and custom-property component values remain supported. Other nested
functions, unproven property domains and dimensional divisors reject.
The math guard runs before the lexer variable exemption and inspects decoded
function names, including raw variable fallbacks. Unsupported comparison,
stepped, trigonometric, exponential and other unproved math functions reject;
adding `var()` cannot bypass the literal grammar restriction on `min()`,
`max()` or `clamp()`. Existing vendor `calc()` spellings receive the same
bounded proof. Quoted text and custom-property component values remain separate.
Grammar-library balanced-function shortcuts do not authorize malformed
arithmetic. Native CSSOM support is not canonical admission authority.
Negative literals also reject for the explicitly
nonnegative sizing, padding, border-width, font-size, line-height, gap and flex
factor properties. Custom values remain CSS component values.

Inline LiveTree setters accept single supported CSS values, interpret priority,
and preflight batches and write ordering before mutation. They realize the
complete retained style map; rejected operations do not publish partial graph
state. A shorthand write after a conflicting retained longhand may reject.
Scalar runtime style attributes remain exact storage; declaration edits on them
reject until the caller explicitly replaces or clears that attribute. Unchanged
writes are no-ops. Hosted synchronous style authoring still requires
the existing async attribute-authoring boundary; no async style API is added.
Graph-owned structured attribute replacement remains
an exact-storage operation with a deterministic browser projection.
Public reads and edits resolve current camel/kebab spellings and `cssFloat`
against their native property. Edits retain an existing key spelling, remove
equivalent duplicates only for the edited property, and leave unrelated keys
and leaves intact. Inline vendor JS names project with their leading native
hyphen; authored CSS identifiers still have their separate receiving rules.
Batch names colliding after full native resolution reject before publication.
Accepted graph attribute effects use the existing exact graph codec in their
attribute/style context, preserving retained typed-unit presence through local
Mirror commits. Portable client authoring retains its stricter projected-value
admission; this does not authorize generic undefined or portable QUID claims.

`HsonDocument.fromNode()` still requires exact readable notation closure of the
original graph. Rich typed styles that cannot close under current CSS-string
notation reject there without narrowing generic storage. No structured-attribute
syntax or generic undefined primitive is introduced.


The optional `$_attrs` and `$_meta` fields, when present and populated, and every string-keyed
entry within their record values are likewise enumerable own data properties.
Accessor-backed, non-enumerable, or custom-prototype record state rejects before
any getter can run. Writable/configurable descriptor flags are not graph
semantics. Public portable admission rejects own symbols on all semantic
records and content arrays. `$_meta: {}` and `$_attrs: {}` reject; the operation
emptying an optional bag must omit it rather than relying on admission repair.

Every canonical node stores `$_tag` and `$_content` as required enumerable own
Data properties. `$_content` is a dense array whose semantic slots are
enumerable own data properties. Inherited, accessor-backed, hidden, or sparse
required storage rejects without executing user code. Canonical node objects
use `Object.prototype` or `null`; writable/configurable flags remain outside
graph meaning. Own array extras, methods and iterator overrides reject.
Inherited ordinary array behavior is permitted and is not used for capture.
Mutable Transform observation copies use null-prototype semantic records, so
later inherited properties cannot become graph fields. Copy construction uses
own descriptors and does not invoke inherited semantic getters.

Element and object structural modes apply recursively to their full branches.
Contradictory wrappers, cross-mode ordinary children, empty retained
`_hson_elem` nodes, and direct ordinary children beneath `_hson_ii` reject at
admission. Direct Hson serialization validates before normalization and never
uses the narrow legacy empty-element normalization to repair malformed egress.
It does not compensate for structural crossings with explicit VSN syntax.
Structural Hson serialization preserves application order, primitive typing,
negative zero, array indexes and structural mode on its supported domain.
Style notation closure remains unresolved as recorded below; successful output
alone does not certify graph equality. Generated element QUIDs are omitted. `_hson_root`, object-member metadata, cross-mode arrays,
and detached scalar carrier clusters are outside that serialization domain and
reject rather than projecting lossily.

Serializer projection is intentionally lossy only for implementation
scaffolding that Hson syntax reconstructs: `_hson_ii` wrappers and their
`index` metadata are represented by array position, and structural VSN names
are represented by notation rather than literal tags. Ordinary attributes retain
their portable representation. Generated element QUID metadata remains runtime-local and is omitted without
mutating its source graph. This cannot legalize object metadata.

Transform `fromNode()` exactly admits complete portable STR, VAL, canonical
OBJ and ARR, and nonempty ELEM ordered content except a sole STR. Complete
OBJ/STR, OBJ/VAL, ELEM/STR, ordinary named branches, II and ROOT reject.
Receiving parents supply object-member and element-content relationships;
valid nested scalar carriers remain intact. OBJ/OBJ, OBJ/ARR, nested ROOT,
cross-mode element content and empty ELEM relationships reject.

Direct raw capture inspects descriptors before evidence can disappear, without
getters, custom serialization hooks or array methods. Capture, role checking,
cycle tracking, private freezing and output copying are iterative. Acyclic
sharing is permitted, but every occurrence must qualify in its actual role and
each II index must equal its physical position. No semantic depth cutoff is
introduced. Proxy reflection failures are structured errors; reflection is not
an atomic view of a hostile target.

All generic sources own stable private snapshots. Every `toNode()` returns an
independent exact mutable copy. Source-specific parser ROOT/branch shapes remain
distinct from portable direct admission pending Pass 2. Binary ingress and
egress use the portable complete-value domain; richer runtime codecs retain
their explicit authority boundaries. Shared `assert_invariants`, normalizers
and runtime cloning contracts are unchanged by this private admission seam.

Generic raw ROOT admission rejects, including ROOT[]. Internal empty-root
ownership remains valid through its existing owner APIs. Public Document
remains nonempty. Pass 1 does not migrate runtime owner normalization.

`$_meta` is a reserved, closed, internally extensible metadata plane. Each
registered member defines its own value domain and exact node placement;
unknown members reject. Structural VSN metadata is therefore an explicit
member exception rather than a general user-data channel. `_hson_ii` must carry
canonical string ordering metadata at `index`; other currently registered
structural VSN metadata is invalid. Wrapper-bearing admission accepts
only exact physical indexes `"0"` through `String(wrapperCount - 1)` in that
order. Direct node/Binary admission never sorts a permutation. Native JSON and
Hson arrays generate sequential indexes from intrinsic source order; existing
external HTML lowering and internal recovery normalization remain separate.

| Node category | Valid `$_meta` keys |
| --- | --- |
| Eligible non-VSN ordinary tag | `$_meta.quid`, projected as `hson:quid`, with the canonical QUID placement and value contract |
| `_hson_ii` | Required `$_meta.index`, projected as `hson:index`, using exact canonical zero-based decimal spelling |
| `_hson_root`, `_hson_elem`, `_hson_obj`, `_hson_arr`, `_hson_str`, `_hson_val` | None |

Metadata validity is authorized only by the exact table above. Unknown
`$_meta` keys and unknown `hson:*` markup names reject. Every `data-*` name,
including names beginning with `data-_`, is an ordinary application attribute
stored in `$_attrs`. QUID is categorically unavailable on every `_hson_*` tag,
including future structural tags; `_hson_ii.index` is the narrow current VSN
metadata exception. Future metadata members are added centrally with their own
value and placement rules rather than inheriting placement from `quid` or
`index`.

Hson `//` comments and HTML `<!-- ... -->` comments are ingress/source trivia.
Neither creates a graph node or metadata, participates in equality, survives
serialization, or changes this registry.

### Pass 1 deferred failure ledger

Exact storage admission and one semantic snapshot are established independently
of complete format closure. Known failures must not be described as round-trip
success or hidden by normalizing an admitted graph:

- Pass 2: parser/source carrier alignment (including explicit JSON ELEM/string
  carriers and standalone SVG branches), runtime raw ingress, and exact
  recovery codecs that still normalize bags/index order. Generic Hson/Binary
  egress explicitly rejects nonqualifying source shapes after existing owner
  extraction. Owner APIs retain ROOT[], ordered content and identity authority.
- Pass 3: style empty declarations, whitespace trimming, typed leaves,
  negative zero, projected name collisions, and raw/structured notation
  differences. Valid style storage is admitted unchanged, including empty maps
  and absent/undefined/string unit distinctions; Binary preserves it. Hson
  exact readable admission is limited to graphs that pass the closure check.
  General structured style-attribute notation remains deferred; current
  CSS-string admission is strict as specified above.
- Later transport work: JSON sidecar/key collisions and metadata ambiguity;
  ordinary JavaScript `.value()` integer-key ordering differs from exact JSON
  text ordering. HTML casing, text boundaries, SVG ownership, void elements,
  encoded names and raw-text transport still have representation gaps. No name
  bans or compatibility repairs are added by Pass 1.
- Resource policy: parser, projection and codec limits remain implementation
  capacities. Deep admitted graphs may exceed a terminal's existing capacity;
  their semantic validity is not reduced to the narrowest transport limit.

### Internal root boundary

Every document-mode LiveMap and Locus graph is owned by an internal
`_hson_root`. Its ordered content may be empty or contain one or many document
nodes. The root is authority structure rather than authored Hson:
`serialize_hson()` rejects every `_hson_root` and does not substitute, melt, or
silently unwrap it. Hson-source public terminals detach validated semantic
content before target projection, while canonical equality remains
root-sensitive.

Canonical equality traverses the supplied graphs directly. It does not invoke
node normalization, rebuild indexes, sort content, detach roots, remove
metadata, repair wrappers, or coerce attribute values. Admission and projection
boundaries must establish their own canonical inputs before invoking equality.

The runtime root does not require authored syntax. Empty document content is a
runtime content shape, and public Hson boundaries continue to expose only
detached authored content.

## Measurements

The benchmark uses fresh processes, six forced collections before and after
construction, and the median of five runs. The pre-change build was exported
from the same Git index and compiled with the same dependencies. Projection
uses the same JSDOM fixture and bundled Node runtime for both builds.

| Retained scenario | Before | After | Own props before → after | Serialized bytes before → after |
| --- | ---: | ---: | ---: | ---: |
| 1,000 simple nodes | 282,304 B | 157,248 B | 4 → 2 | 55 → 30 |
| 100,000 simple nodes | 20,877,072 B | 8,081,064 B | 4 → 2 | 55 → 30 |
| 1,000 nodes with attrs | 283,448 B | 263,264 B | 4 → 3 | 65 → 53 |
| 1,000 nodes with metadata | 284,096 B | 221,616 B | 4 → 3 | 67 → 54 |
| 1,000 nodes with both | 283,728 B | 286,552 B | 4 → 4 | 77 → 77 |
| 100 parse-heavy fixtures | 12,827,584 B | 5,789,216 B | root 4 → 2 | 2,894 → 2,894 |
| 100 LiveTree projections | 19,389,160 B | 18,232,808 B | root 4 → 3 | 988 → 988 |

Nodes that genuinely need both containers have no expected representation
reduction; the measured retained-heap delta for that cell was approximately 1%
and is treated as neutral. Projection roots retain metadata because LiveTree
persists their QUID, but omit the otherwise empty attrs bag.

Median construction times in milliseconds were: simple 1,000 `0.136 → 0.207`,
simple 100,000 `160.40 → 15.00`, attrs `0.984 → 0.590`, metadata
`0.183 → 0.336`, both `0.253 → 0.500`, parse-heavy `257.49 → 86.10`, and
projection `66.67 → 67.44`. Sub-millisecond cells and the bimodal 100,000-node
baseline are sensitive to JIT/process scheduling; retained shape and heap are
the representation claims, not those micro-timings.

Run after `npm run build`:

```sh
node --expose-gc benchmarks/hson-node-representation.mjs 1000 simple
node --expose-gc benchmarks/hson-node-representation.mjs 100 parse
```

The projection harness lives in `hson-demo2/benchmarks` because JSDOM is a demo
test dependency rather than an hson-live runtime dependency.

## LiveTree runtime observations

Public `tree.node` and `tree.hostRootNode()` copy actual retained storage into
fresh detached, deeply frozen `ReadonlyHsonNode` observations. They never
materialize containers on the owner, issue QUIDs, or run public raw admission.
They preserve present empty optional containers or noncanonical relationships
left by earlier runtime mutations; observation does not repair the graph.
Runtime scalar styles, form-value arrays and own-present typed style
`unit: undefined` are included in the observation type. The mutable `HsonNode`
authoring type and its admission requirements remain separate. Authorized
internal code uses registered subjects and the stored historic-root context;
it never uses public observations as identity-bearing or writable graph storage.
