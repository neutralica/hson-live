# LiveTree 3.0 lifecycle migration

Use lifecycle names according to whether identity survives:

| 2.x usage | 3.0 replacement | Identity |
| --- | --- | --- |
| `tree.empty()` | `tree.empty()` | caller survives; all contents are terminal |
| reusable content removal | `tree.detachContents()` | retained content survives |
| reusable self removal | `tree.detach()` | complete branch survives |
| terminal self removal | `tree.remove()` | root and descendants are disposed |
| `tree.removeSelf()` | `tree.remove()` or `tree.detach()` | deprecated terminal alias |
| `tree.removeChildren()` | `tree.empty()` or `tree.detachContents()` | deprecated specialized filter |

`DetachedLiveContent` preserves exact ordered graph contents, including
structural nodes and primitives, and exposes one explicit `appendTo(target)`
transfer. A detached `LiveTree` itself is reattached with `target.append(tree)`.
Attaching a branch that still has a parent throws `LiveTreeAlreadyAttachedError`.

QUID metadata and registry ownership both survive detach. Terminal operations
remove both, scrub mapped DOM identity attributes, remove runtime registrations,
and make all retained handles throw `LiveTreeDisposedError`. Browser-owned
`documentElement`, `head`, and `body` roots are protected by
`LiveTreeProtectedRootError`; ordinary owned roots may be removed.

The retained off-document projection keeps listeners, CSS, TreeEvents, canvas
watches, and LiveMap bindings functional through direct reattachment. LiveMap
updates continue to mutate the detached HSON graph, so reattachment projects the
latest state without rebinding.

Continuing resources created for a LiveTree are owned by its QUID in the
lifecycle registry. Terminal removal automatically releases LiveMap bindings,
element/document/window listeners, TreeEvents subscriptions, and canvas resize
watches before QUID destruction. Their manual `off()`/`dispose()` functions
remain supported, are idempotent, and remove their lifecycle ownership so later
terminal cleanup cannot run them twice.
