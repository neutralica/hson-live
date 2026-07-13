// livemap-lifecycle.md

# Lifecycle and Disposal Contract
## Status
This document defines the common lifecycle expectations for LiveTree, LiveMap, LiveHost, bindings, sessions, and test-run resources.
Lifecycle is part of correctness.
## Core rule
Every resource that subscribes, observes, registers, attaches, or retains external state must have one deterministic disposal path.
Disposal must be:
- explicit;
- idempotent;
- observable where useful;
- composable;
- safe during partial initialization.
## Common shape
The common conceptual surface is:
```ts
type Disposable = {
  dispose(): void;
  readonly disposed: boolean;
};

Exact interfaces may vary by subsystem, but their semantics must remain compatible.

Calling dispose() more than once must not repeat side effects or throw merely because disposal already occurred.

Owned resources

Lifecycle-managed resources may include:

* LiveMap subscriptions;
* feed listeners;
* selected subscriptions;
* LiveTree bindings;
* DOM event listeners;
* mutation or resize observers;
* Canvas watchers;
* animation frames;
* timers;
* CSS scoped by QUID;
* host registry entries;
* client sessions;
* socket listeners;
* pending action requests;
* test runs;
* streamed report subscriptions;
* keyed child scopes.

Ownership

Every disposable resource must have a clear owner.

Examples:

* a LiveTree subtree owns its nested bindings;
* a keyed child scope owns that child’s event listeners and CSS;
* a LiveHost session owns its subscriptions and pending requests;
* a test run owns its execution and result-stream resources;
* a client adapter owns its socket listeners.

A resource must not rely on unrelated global cleanup.

Scopes

A lifecycle scope groups child resources.

Conceptually:

const scope = make_scope();
scope.add(subscription);
scope.add(binding);
scope.add(timer);
scope.dispose();

Disposing a scope disposes all owned children.

Adding a child to an already disposed scope must either:

* dispose the child immediately; or
* reject deterministically.

The chosen behavior must be consistent.

Parent-child disposal

Parent disposal cascades to children.

Child disposal does not automatically dispose the parent.

A child removed from a parent collection must be disposed exactly once when the parent no longer owns it.

LiveMap subscriptions

A LiveMap subscription must stop receiving events immediately after disposal.

Disposal must release references held by the feed or subscription registry.

A disposed subscription must not resume if the same path later becomes valid again.

LiveTree subtree lifecycle

A LiveTree subtree may own:

* bindings;
* DOM listeners;
* CSS registrations;
* observers;
* nested child scopes.

Removing or replacing the subtree must dispose those resources deterministically.

DOM removal alone is not sufficient lifecycle management unless the system explicitly observes and disposes removed nodes.

Keyed reconciliation

Each keyed child receives a lifecycle scope.

When a key is:

* retained:
    * preserve the existing child scope;
* moved:
    * preserve the existing child scope;
* removed:
    * dispose the child scope;
* replaced by a different identity:
    * dispose the old scope and create a new scope.

A list-wide replacement may dispose all children unless identity-preserving reconciliation is explicitly supported.

CSS lifecycle

CSS associated with a QUID or subtree must have an owner.

When the owning subtree or identity is disposed:

* scoped CSS must be removed or released;
* shared CSS must use reference or registry semantics;
* stale QUID rules must not accumulate indefinitely.

LiveHost session lifecycle

A host session owns all resources created on behalf of one client connection or resumable session.

Session disposal must release:

* subscriptions;
* socket listeners;
* pending requests;
* timers;
* temporary registries;
* backpressure queues;
* run-specific resources.

Disconnection and disposal are related but not necessarily identical.

A temporarily disconnected resumable session may retain bounded state.

An expired or explicitly disposed session must release it.

Test-run lifecycle

A host-run test execution has a distinct lifecycle.

A test run owns:

* execution state;
* cancellation;
* streamed result publication;
* its report LiveMap or report subtree;
* timers and measurements;
* host/session associations.

A run reaches one terminal state:

* completed;
* failed;
* cancelled;
* superseded.

After a terminal state:

* no new case result may be published;
* no revision may be emitted for that run;
* execution resources must be released;
* subscribers may inspect retained final state according to retention policy.

Cancellation

Cancellation is explicit lifecycle transition, not ordinary failure.

Cancellation should be idempotent.

A cancelled resource must stop producing externally observable work as soon as practical.

Any unavoidable late callback must check the disposed or cancelled state before publishing.

Replacement and supersession

Starting a new resource may supersede an old one.

Examples:

* a new test run replaces the active run;
* a new binding replaces an old binding at the same target;
* a client reconnect replaces an obsolete socket attachment.

Supersession must explicitly dispose or detach the replaced resource.

Silent coexistence is not allowed unless multiple ownership is intentional.

Errors during initialization

Partially initialized resources must still be disposable.

If setup fails after some children have been registered, cleanup must release those children before propagating the error.

Factories should prefer constructing under a scope so failure can dispose accumulated resources.

Disposal order

Children should ordinarily be disposed in reverse acquisition order.

This reduces dependency hazards where later resources depend on earlier ones.

Subsystems may define another order when required, but it must be deliberate.

Post-disposal behavior

After disposal:

* subscription callbacks do not run;
* host actions are not accepted for the disposed session;
* bindings do not update DOM;
* observers do not publish;
* timers do not mutate state;
* repeated disposal is harmless.

Methods unrelated to active behavior may remain readable for diagnostics.

Mutation methods on disposed objects should either:

* throw a stable disposal error; or
* become documented no-ops.

The choice must not vary accidentally between implementations.

Retention

Disposal releases active resources.

It does not necessarily erase retained diagnostic or final-state data.

Retention must be explicit.

Examples:

* a completed test report may remain readable;
* a disposed session may leave an audit entry;
* a removed LiveTree child should not retain active listeners.

Garbage collection

Garbage collection is not the disposal mechanism.

Weak references may supplement lifecycle management, but correctness must not depend on when garbage collection runs.

Non-goals

This contract does not require:

* one concrete lifecycle class for every subsystem;
* automatic disposal solely from JavaScript reachability;
* implicit global cleanup;
* framework-style component hooks;
* finalization-registry correctness.

Required invariants

Tests must continue to prove:

* disposal is idempotent;
* disposed subscriptions receive no events;
* parent disposal releases child resources;
* keyed moves preserve scopes;
* keyed removals dispose scopes once;
* subtree replacement removes listeners and scoped CSS;
* session disposal stops network and subscription activity;
* cancelled test runs publish no later results;
* initialization failure cleans up partial resources;
* repeated create/dispose cycles do not grow registries without bound.

These four establish the immediate contracts needed before the LiveHost test-run vertical slice expands.