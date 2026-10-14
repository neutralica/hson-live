# Styled Part composition (Cut 9B)

The private composer expands validated keyed Parts from governed data Libraries
into one ordinary new document Library. It retains `lib`/`at`, recursive `at`
configuration, `use: { at, lib? }`, root overrides and explicit receiving `as`.
No public template or fragment API is introduced.

Each selected Part contributes its entire optional managed stylesheet. Stylesheet
order follows depth-first preorder selection: a parent's stylesheet precedes the
stylesheets of its expanded connectors, and siblings follow actual traversal
order. Unvisited members contribute no CSS. The collection's complete validation
contract still applies to reads, including unvisited members' syntax.

An exact `[hson\:quad="label"]` subject reference resolves through that Part's
validated local authored QUAD path. Traversal records the exact final destination
path for that occurrence, including connector replacement roots. Root and descendant
references demand only those receiving subjects. Each occurrence is translated
separately by the existing syntax-aware CSS translator; local names may repeat
freely across occurrences. Names from Parts are never installed in the receiving
authored registry. Shell names and explicit `as` promotions retain existing rules.

Part definitions have no anonymous subject coordinate beyond authored local QUADs.
Generated QUID claims, unresolved names, non-exact identity selectors and opaque
identity syntax reject. An anonymous *receiving* instance is supported: its local
Part landmarks still supply exact occurrence coordinates. Ordinary selectors
retain document-wide CSS semantics, including specificity, cascade and inheritance.
Composition supplies no encapsulation or selector isolation.

The receiving owner prepares the complete graph and authored associations, then
uses its existing allocator and identity overlay for demanded subjects lacking an
authored receiving association. Per-occurrence correspondence is detached candidate
work, never a portable field, stored component scope or provenance ledger. Ordinary
preparation publishes the graph, sparse issued ledger, QUAD bindings and merged CSS
in one topology transition. Failed preparation publishes nothing; independently
accepted reentrant work is preserved. Source fencing ends only after coherent
detachment. Subsequent source changes do not change that detached graph or CSS;
the receiving preparation retains its own authority and revision fences.

Raw Part CSS has locally generated `stylesheet:N` rule keys from the ordinary
parser. The complete rendered occurrence stylesheets are admitted by that same
parser as one stylesheet. Its ordinary sequential key allocator gives every rule
occurrence a distinct key; no rules are deduplicated. This reconciles only the
parser's local administrative keys, with no selector or global CSS-name changes.
The portable record decoder continues to reject duplicate keys and inconsistent
order records. Custom properties, supported groups, repeated group occurrences,
empty semantic layer entries, declaration order and global definitions retain
ordinary parser/render semantics. Named layers repeat under standard CSS ordering;
layer-order statements remain unsupported by the current parser. Duplicate
keyframes and property registrations reject, including identical definitions from
two instances. Global conflicts are checked before candidate identity allocation.
There is no renaming of keyframes or rewriting of animation declarations.

After admission, Cut 9B-0 owns ordinary capture, restoration and strict retirement.
Final-only document cuts omit Part collections and shell Libraries. Authored
receiving names remain authored, while CSS-only subjects project disposable portable
correspondence and receive fresh QUIDs on every new runtime admission. Capture,
source reads and rendering issue no additional identities. Moves and legitimate
lineage retain subject CSS; retirement requires dependent CSS to change in the same
atomic graph/CSS transition. Rules are never automatically removed.

Nonempty managed CSS rendering retains the existing explicit `html`/`head`
requirement. Portable SSR emits the existing derived subject carriers and one
managed style. The existing synchronous graft writes receiving QUID metadata while
portable carriers remain, switches the retained stylesheet, then consumes carriers.
Cut 9B's Chrome acceptance flushes computed styles at that switch and during carrier
removal, checks original Elements, live edits and final-only restoration/grafting.
It also measures the server-rendered styled page with JavaScript disabled and an
unrelated element control.

Styled document shells remain unsupported composition sources. Hosted incremental
subject-CSS topology, operations and durable transport remain rejected by Cut 9B-0;
this cut does not add hosted correspondence ordering, broaden initializer admission
or change full-snapshot routes.
