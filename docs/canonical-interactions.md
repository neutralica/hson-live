# Canonical interactions

Canonical interactions store portable interaction intent in one canonical `LiveMap` system root: `{ descriptors: [...] }`. A descriptor contains no executable capability. Activation combines the current descriptors with an active `LiveTree`, a fixed behavior table, and an optional application-supplied dispatcher to derive listeners.

The current public functions are:

```ts
import {
  activate_interactions,
  add_interaction,
  enable_interactions,
  remove_interaction,
  replace_interaction,
} from "hson-live";
```

The corresponding public types are `InteractionDescriptor`, `InteractionListener`, `BrowserInteractionDescriptor`, `LocusInteractionDescriptor`, `InteractionLocalBehavior`, `InteractionLocalBehaviors`, `InteractionActionDispatcher`, `InteractionFailure`, and `InteractionActivationOptions`.

## Canonical storage and Schema

`enable_interactions(map)` adds one schema-governed reserved data Library inside the same aggregate. Repeated enablement is idempotent. Standalone maps enable it before the first transition. An Echo map with a local document may establish local interaction capability after management begins; the first local `add_interaction` does this lazily if needed. This local operation changes the composed map and its revision, but not the projected registry, authority cursor, or Locus state.

The reserved Library contributes to aggregate revision and capture, but is hidden from normal application Library selection and commit operation enumeration. Echo can retain this composed system slot for local descriptors while the projected registry omits the shared `interactions` feature. The projected registry digest and authority fingerprint cover authority state only. Local initializers still contain root, Schema, CSS, and definition identity; they do not seed descriptors.

Hson owns one fixed, closed Schema. Its semantic shape is:

```hson
<type "data" content <descriptors <array <union [
  <content <
    id "string"
    subject <content <library "string" path <array <number <int true min 0>>>>>
    listener <content <
      event "string"
      target <union [<exact "element">, <union [<exact "document">, <exact "window">]>]>
      capture "boolean"
      once "boolean"
      passive "boolean"
      missingTarget <union [<exact "ignore">, <union [<exact "warn">, <exact "throw">]>]>
      preventDefault "boolean"
      stopPropagation "boolean"
      stopImmediatePropagation "boolean"
    >>
    kind <exact "browser">
    key "string"
    args "any"
  >>,
  <content <
    id "string"
    subject <content <library "string" path <array <number <int true min 0>>>>>
    listener <content <
      event "string"
      target <union [<exact "element">, <union [<exact "document">, <exact "window">]>]>
      capture "boolean"
      once "boolean"
      passive "boolean"
      missingTarget <union [<exact "ignore">, <union [<exact "warn">, <exact "throw">]>]>
      preventDefault "boolean"
      stopPropagation "boolean"
      stopImmediatePropagation "boolean"
    >>
    kind <exact "locus">
    key "string"
    payload "any"
  >>
]>>>>
```

Unknown fields, hybrid variants, malformed listener settings, invalid document paths, and duplicate IDs fail canonical admission before publication or revision movement. Descriptor IDs are globally unique across the entire root, including shared and local partitions. `replace_interaction` and `remove_interaction` select that global ID and reject missing IDs. Lower-level transitions, portable restoration, authority snapshots, replay, and reconcile enforce the same uniqueness rule.

## Ownership and dispatch

Descriptor ownership comes solely from `descriptor.subject.library`:

| Subject document | Canonical owner | Transfer |
| --- | --- | --- |
| Private | Locus | Not projected to clients |
| Shared | Locus | Synchronized through Echo |
| Local | Client | Retained on the composed map |

There is one interaction system root. Its shared partition `S` contains descriptors for projected shared documents; its local partition `L` contains descriptors for local documents. Echo exposes `S + L`. Direct client authoring may change only `L`; Locus drafts may change private or shared descriptors in the authority map. Locus has no local document Library, so it rejects local subjects. A shared descriptor remains authority-owned even when `kind` is `"browser"`.

`kind` chooses execution, independently of ownership. `"browser"` calls the activation-side behavior table (named `local` in the current activation options); it does not assert a browser-only platform. `"locus"` calls the supplied dispatcher. Hosted Echo composition normally dispatches through `echo.action`, where Locus authorizes the action independently. Shared/browser, shared/locus, local/browser, and local/locus are all valid.

Local descriptors can be authored after their local document exists without a shared `interactions` grant or a server round trip. Shared authoring belongs in a Locus `stage` or action `ctx.stage`, where document edits and descriptor maintenance can commit atomically.

The descriptor ID identifies only the descriptor. The subject uses the fixed application document Library name and canonical numeric document path. Runtime-local QUIDs may follow an activated subject but are never serialized into interaction state.

An established subject that moves keeps its interaction: the owning map rewrites its path in the same transition as the document edit. Local edits rewrite only local descriptors; shared edits rewrite only shared descriptors. Deletion or identity-destroying replacement removes the descriptor in that transition, so a new subject at the old path cannot inherit it. A descriptor authored before its subject exists remains at its authored path and can activate if a subject appears there.

Generated QUIDs are scoped to one runtime. A runtime can map local QUIDs to and from paths for live continuity; portable interaction state uses the document Library and path. Ordinary Hson, structural JSON, and Transform HTML now omit generated QUIDs on output and reject serialized QUID claims on input. Same-runtime exact capture is separate. Browser continuation and hosted graph identity remain later migration boundaries.

## Exact interaction data

Browser `args` and locus `payload` use Schema `"any"` and represent canonical data-mode values. The interaction layer retains exact `HsonData`; it does not materialize through ordinary JavaScript or stringify and reparse during reconciliation or dispatch. Signed zero, object member order, integer-like member order, dangerous valid names such as `__proto__`, and nested combinations therefore retain their semantics. Shared `args` and `payload` are shared canonical data: no general taint tracking redacts values an authority author places there. Private-subject descriptors are filtered from projection.

A local behavior receives the native `Event`, the exact resolved `LiveTree` subject, and exact `HsonData` args. Activation snapshots only explicitly supplied own string-keyed data properties whose values are behavior functions. Prototype members are not capabilities, and accessor-backed or non-function capability entries are invalid activation configuration. The resulting behavior table is fixed for one activation and application context normally comes from closure.

A locus descriptor invokes only the optional generic dispatcher:

```ts
const dispose = activate_interactions({
  map,
  tree,
  document: "page",
  local: localBehaviors,
  dispatch: async (actionKey, payload) => {
    const result = await echo.action(actionKey, payload);
    if (result.type !== "ack") throw result.error;
  },
});
```

The interaction subsystem has no Echo dependency and no action-handler registry. Locus remains the configured action authority. Locus dispatch never consults browser behaviors and has no fallback to them.

## Listener realization

`InteractionListener` is the normalized portable form of current `LiveTree.listen` semantics: event, element/document/window target, capture, once, passive, missing-target policy, prevent-default, propagation stop, and immediate-propagation stop. Activation installs through `LiveTree.listen`; it does not implement a second native listener engine.

Activation observes before its initial read, then reconciles the current system slot on every relevant aggregate commit, restore boundary, and exact tree realization transition. If an established activation sees the slot removed, its desired descriptors become empty and its listeners are disposed. Initial activation still rejects when no interaction capability exists. Stale or mismatched records are disposed before missing records are installed, while unaffected records remain. Fingerprints use exact canonical data encoding rather than ordinary-object normalization.

Within one selected document activation, canonical descriptor order is listener installation order. A reorder retains the longest active listener prefix already in canonical order and reattaches only active listeners that must move after it. An unchanged descriptor keeps consumed `once` state even if its canonical position moves; changing or replacing the descriptor starts a new materialization. Separate activations remain independent, including when their `document` or `window` listeners share an EventTarget; their relative order follows activation/install timing and has no global canonical guarantee.

Each activation captures one tree/root, one local capability table, one optional authoritative dispatcher, and one optional failure observer. Later mutation of the caller-owned options object or capability table has no effect. There is no rebind operation: moving realization to another tree requires disposing the activation and creating another one.

Multiple activations against the same map and tree are allowed and independent. Each owns its capability snapshot, dispatcher, failure observer, runtime records, native listeners, and disposer. If two activations materialize the same descriptor on the same subject and event, both listeners may run; each activation must be disposed independently.

Each installed listener belongs to the exact current HsonNode realization. The descriptor ID and QUID are lookup evidence, not runtime-resource owners. If a QUID later resolves to a fresh exact realization, the outgoing node's listener is disposed and a new listener is installed on the replacement. Listener materialization never mints a QUID or changes canonical state.

`once` means once per concrete materialization. Reordering unchanged descriptors does not reinstall a consumed listener on the same descriptor semantics and exact node. Descriptor replacement, remove and re-add, activation disposal and reactivation, or a fresh exact subject realization creates a fresh materialization. Consumption is runtime-only.

## Failures, synchronization, and disposal

Missing subjects, unknown local keys, absent authoritative dispatchers, listener installation failures, and rejected invocation promises are isolated per descriptor. The optional failure observer receives the descriptor, a broad phase, and the underlying cause. Descriptors remain canonical; unrelated descriptors continue to function. No invocation status is added to canonical state.

Activation construction is exception-safe. Input capture and validation happen before observers or listeners are installed. If later initialization cannot complete, every observer, runtime record, and listener created by that activation attempt is rolled back before the error escapes.

Locus commits, checkpoints, and replay history contain only private/shared authority interaction state. Echo replay applies `S → S′` to `S + L` as `S′ + L`; reconcile installs current authority `S` while retaining `L`. Both reject shared/local ID collisions before publication. `current` sync compares authority state alone, so local descriptor edits do not force replay or reconcile. Shared feature revocation removes `S` and its listeners while keeping `L` and the composed slot when local capability exists; regrant adds current `S` back without resetting unchanged local listeners. Shared document scope removal similarly removes its shared descriptors while local descriptors survive. Local initializer scope removal and re-add retain existing client Library and descriptor state.

An Echo-composed `map.cut()` or capture may contain both partitions because it is a snapshot of the actual client map. Installing that artifact as a standalone map does not preserve former Echo ownership provenance. Runtime records are never replayed and are reconstructed from canonical state, fixed application capabilities, and the active tree.

The activation disposer is idempotent. It stops observation and removes only listeners owned by that activation. Canonical descriptors, the `LiveTree`, Mirror, and unrelated imperative listeners remain intact. Mirror and interaction activation have independent lifecycles.

Canonical interactions do not infer forms, routes, HTTP requests, redirects, or other no-JavaScript behavior. They also do not describe exact document mutations. Browser ingress and native server ingress may converge on the same configured domain action, but that application relationship is outside the listener descriptor.
