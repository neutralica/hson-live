# Document Library `.q(name)`

Every ordinary document Library facade, including composed and restored Libraries,
exposes `.q(name)`. It observes an existing authored Library-local QUAD and returns
`LiveMapDocumentQuadLocation`, or `undefined` for an unknown or retired name.
Names such as `constructor`, `__proto__`, and `_subject` are ordinary names.
A non-string argument rejects with `TypeError`. Lookup issues no identity, changes
no revision, and publishes nothing. Data Libraries and uninstantiated Parts have
no `.q()` capability. Composition preserves shell names and connector-to-root receiving bindings.
Each realized Part occurrence retains its own namespace, including repeated and
unnamed occurrences. Authored names are unique throughout each Library Document
or Part definition; ordinary element nesting does not reset uniqueness.

`page.q("nav")?.q("buttonOne")` enters the exact child occurrence named by a
`part` binding. An `element` binding has no child namespace: its `.q()` returns
`undefined`, even when it addresses the same root as a Part binding. Named
boundaries are never searched recursively. Every namespace first resolves its
own direct binding. Only when absent does lookup traverse its registered unnamed
child occurrences, applying the same precedence at each boundary. Exactly one
eligible binding succeeds; multiple matches return `undefined`, regardless of
order. Namespaces and occurrence identities remain separate. Give repeated
ambiguous invocations authored connector names to distinguish them.

Every successful `.q()` acquisition owns an independent selection family. It
retains its binding role, owning namespace and entered occurrence lifetime using
existing installed evidence. No generated identifier or path is a public name.
This navigation is a LiveMap capability; Locus and Echo retain their existing
QUAD surfaces pending Q2.

Each returned capability captures one existing subject identity and its runtime
epoch. Before every read or edit it checks that identity against the current
Library owner and overlay, derives the current canonical-to-logical correspondence,
and delegates to the ordinary document location engine. Moving the subject changes
`.path()` without changing the target. Internal exact replacement correspondence preserves
the identity under ordinary owner rules. Retirement, unrelated replacement, owner
incarnation replacement, or epoch replacement invalidates the capability. It never
retargets by looking the name up again. The captured binding and occurrence must
also remain live; a surviving root QUID alone does not prove occurrence survival.
Ordinary portable restoration issues fresh QUIDs and requires fresh handles, even
when Library and QUAD spellings repeat.

Retirement is terminal for this public capability, including when a privileged
same-runtime exact snapshot later reinstates the original QUID. A newly acquired
`.q(name)` capability may address that restored subject. Identity-preserving exact
restoration does not retire a handle when the subject has remained continuously
present. Generic internal identity handles retain their existing exact-restoration
semantics.

Each `.q` family is guarded by the existing owner's private installed-position
phase. Weak subscription bookkeeping permits discarded intermediate handles to
be collected; live-handle retirement never depends on garbage collection. The
guard checks the final coherent overlay and epoch before publication or
topology callbacks can reenter, latches absence permanently, and unsubscribes on
retirement or disposal. No caller must poll `active` during a retirement gap.
The family also captures the canonical owning hosted `logicalMapId` and
`incarnationId`. A successfully installed change to that pair retires it in this
same pre-publication phase, even if exact restoration retains its QUID, epoch,
overlay and path. Equal identity values preserve the family when a restore
replaces only the fence object. Client-local Libraries are excluded using the
owner's projected-Library identity set: replacing a remote authority does not
retire their otherwise surviving local families. Reading this owner identity
does not initialize an absent hosted authority or mint identity.
Final-state checking preserves movement and internal exact correspondence, rather than
mistaking intermediate structural replacement effects for terminal retirement.

The bounded surface provides `active`, `rev`, `path()`, detached `snap()`, `attrs`,
`flags`, `replace`, `delete`, `insert`, `move`, relative `at()`, and `dispose()`.
Attribute, flag, and content operations retain existing target-kind, exactness,
Schema, authority, capture, publication, and managed-CSS retirement rules. In
particular a root element location remains ineligible for item replacement/deletion,
and a text location has no element attributes. No hosted write pathway is added.
Projected or managed facades remain guarded by their existing mutation owner.
Edit admission also checks the subject again before the existing controller
accepts a candidate, using the existing aggregate `captureFence()` to cover
revision, identity generation, registry, authority and incomplete identity
transactions. Same-revision exact restoration therefore invalidates a planned
outer edit even when the epoch and overlay object are unchanged. Input
reentrancy cannot redirect the outer edit; independently accepted inner work
remains published.

`.at(relativePath)` on this capability follows the root subject and then applies
fixed relative content indices. It does not capture each child's independent
identity; changing the subject's children may change the child coordinate's
occupant. All derived locations share disposal of this one captured capability;
another `.q(name)` lookup, including a chained child, has independent disposal.
Disposing a parent releases its family without destroying the occurrence or its
independently acquired children. Actual occurrence retirement invalidates all
dependent selections. Relative aliases retain their anchor's navigation context:
`nav.at([0]).q("buttonOne")` resolves in the same namespace as
`nav.q("buttonOne")`, including when that relative coordinate is absent.
Missing child snapshots return
`undefined`. An invalid root lifetime makes `active` false and `snap()` undefined;
other reads/edits and `.q()`/`.at()` navigation reject with the existing
`DOCUMENT_TARGET_NOT_FOUND` mutation error. Required reads retain their existing
absent-endpoint error. Ordinary Library `.at(path)` keeps its fixed-coordinate semantics.

This cut exposes no watch, ID discovery, raw mutable node, allocator, public
template API, or lowercase configuration `q`. The public nameable type references
only declaration-safe public location/commit types.
