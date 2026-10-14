# Document Library `.q(name)`

Every ordinary document Library facade, including composed and restored Libraries,
exposes `.q(name)`. It observes an existing authored Library-local QUAD and returns
`LiveMapDocumentQuadLocation`, or `undefined` for an unknown or retired name.
Names such as `constructor`, `__proto__`, and `_subject` are ordinary names.
A non-string argument rejects with `TypeError`. Lookup issues no identity, changes
no revision, and publishes nothing. Data Libraries and uninstantiated Parts have
no `.q()` capability. Composition preserves shell names and explicit receiving
promotions; Part-local landmarks remain absent unless explicitly promoted.

Each returned capability captures one existing subject identity and its runtime
epoch. Before every read or edit it checks that identity against the current
Library owner and overlay, derives the current canonical-to-logical correspondence,
and delegates to the ordinary document location engine. Moving the subject changes
`.path()` without changing the target. Explicit valid replacement lineage preserves
the identity under ordinary owner rules. Retirement, unrelated replacement, owner
incarnation replacement, or epoch replacement invalidates the capability. It never
looks the name up again. Ordinary portable restoration issues fresh QUIDs and requires fresh
handles, even when Library and QUAD spellings repeat.

Retirement is terminal for this public capability, including when a privileged
same-runtime exact snapshot later reinstates the original QUID. A newly acquired
`.q(name)` capability may address that restored subject. Identity-preserving exact
restoration does not retire a handle when the subject has remained continuously
present. Generic internal identity handles retain their existing exact-restoration
semantics.

Each `.q` family subscribes to the existing owner's private installed-position
phase. It checks the final coherent overlay and epoch before publication or
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
Final-state checking preserves movement and valid replacement lineage, rather than
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
another `.q(name)` lookup has independent disposal. Missing child snapshots return
`undefined`. An invalid root lifetime makes `active` false and `snap()` undefined;
other reads/edits reject with the existing `DOCUMENT_TARGET_NOT_FOUND` mutation
error. Ordinary Library `.at(path)` keeps its fixed-coordinate semantics.

This cut exposes no watch, ID discovery, raw mutable node, allocator, public
template API, or lowercase configuration `q`. The public nameable type references
only declaration-safe public location/commit types.
