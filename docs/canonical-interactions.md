# Canonical interactions

Canonical interactions store portable interaction intent in one canonical `LiveMap` system root. Activation combines the current descriptors with an active `LiveTree`, the map's local behavior registry, and an optional application-supplied dispatcher to derive listeners.

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

Every LiveMap starts with one reserved, Schema-governed interaction Library. This includes standalone maps and the maps owned by Locus and Echo. `enable_interactions(map)` is idempotent. The reserved binding occupies one of the registry's 1,024 entries and is hidden from application Library selection and public commit operations.

LiveMap owns the canonical graph. Locus governs admission, durable commits, sessions, and publication. The optional Locus `interactions` configuration can seed Descriptors. A runtime `locus.admit` or `map.addLibraries` installs realized Documents and their generated Descriptors in one revision. Echo carries authority Descriptors only for authorized subject Documents and only with the `interactions` feature. A featureless Echo map still owns its local store. Its projected registry digest and authority fingerprint cover only the authorized authority state. Local initializers contain root, Schema, CSS, and definition identity.

The 4 MiB exact-value bound applies to the whole prospective interaction root at transition preparation. Each encoded Descriptor delta also has its own exact-value bound. The 16 MiB hosted transition limit applies to the encoded transition envelope, including its Library roots and Descriptor delta. Hosted preaccept uses the actual before and after interaction roots for publication and retained history.

Durable Locus checkpoints require the fixed interaction binding. Replay validates each original transition at its accepted boundary. Resume installs the validated checkpoint and replay result together, using the checkpoint format's manifest and chunk bounds for stored material. The final recovered topology can exceed the size of a single Library-add envelope. Recovery restores the accepted Descriptors in order with their original IDs, subjects, and exact Data.

Hson owns one fixed, closed Schema. Its semantic shape is:

```hson
<type "data" content <descriptors <array <union [
  <content <
    id "string"
    subject <content <library "string" path <array <number <int true min 0>>>>>
    listener <content <
      event "string"
      target <union [<exact "element">, <exact "document">, <exact "window">]>
      capture "boolean"
      once "boolean"
      passive "boolean"
      missingTarget <union [<exact "ignore">, <exact "warn">, <exact "throw">]>
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
      target <union [<exact "element">, <exact "document">, <exact "window">]>
      capture "boolean"
      once "boolean"
      passive "boolean"
      missingTarget <union [<exact "ignore">, <exact "warn">, <exact "throw">]>
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

`kind` chooses execution, independently of ownership. `"browser"` resolves the behavior name through `map.behaviors`. `"locus"` calls the supplied dispatcher. Hosted Echo composition normally dispatches through `echo.action`, where Locus authorizes the action independently. Shared/browser, shared/locus, local/browser, and local/locus are all valid.

On writable, element-qualified Document `.at()` and `.q()` handles, `.listen.local.onClick(key, input)` and `.listen.host.onClick(key, input)` author a click Descriptor. Standalone LiveMap and Echo client-local calls return the accepted Descriptor ID synchronously. Locus-governed calls return `Promise<string>` resolving to that ID after authoritative acceptance. Local descriptors can be authored after their local document exists without a shared `interactions` grant or a server round trip. A Locus `stage` or action `ctx.stage` can commit grouped document edits and Descriptor changes atomically.

The descriptor ID identifies only the descriptor. The subject uses the fixed application document Library name and canonical numeric document path. Runtime-local QUIDs may follow an activated subject but are never serialized into interaction state.

An established subject that moves keeps its interaction: the owning map rewrites its path in the same transition as the document edit. Local edits rewrite only local descriptors; shared edits rewrite only shared descriptors. Deletion or identity-destroying replacement removes the descriptor in that transition, so a new subject at the old path cannot inherit it. A descriptor authored before its subject exists remains at its authored path and can activate if a subject appears there.

Generated QUIDs are scoped to one runtime. A runtime can map local QUIDs to and from paths for live continuity; portable interaction state uses the document Library and path. Ordinary Hson, structural JSON, and Transform HTML now omit generated QUIDs on output and reject serialized QUID claims on input. Same-runtime exact capture is separate. Hosted continuation and graph effects use portable subject correspondence and receiving-owned identity; they never import server QUIDs.

## Exact interaction data

Descriptor inputs accept supported JavaScript values or authenticated carriers. Ordinary strings are literal Data; encoded JSON/Hson requires explicit `Hson.data.fromSource()`. Browser `args` and locus `payload` use Schema `"any"` and represent canonical data-mode values. The interaction layer retains exact `HsonDataValue`; it does not materialize through ordinary JavaScript or stringify and reparse during reconciliation or dispatch. Signed zero, object member order, integer-like member order, dangerous valid names such as `__proto__`, and nested combinations therefore retain their semantics. Shared `args` and `payload` are shared canonical data: no general taint tracking redacts values an authority author places there. Private-subject descriptors are filtered from projection.

Register local behaviors on the operating map before activation. Each `define` adds one function for the life of that map. Invalid definitions and duplicate names throw before insertion. Executable definitions stay in memory across Document and activation disposal and are omitted from canonical state and captures.

```ts
map.behaviors.define("panel.set", (ctx, input, message) => {
  updatePanel(ctx.map, ctx.subject, input?.materialize());
  return { behavior: message.name };
}, { input: { required: true, schema: panelSchema } });

const result = await map.behaviors.trigger("panel.set", { open: true });
```

Both invocation paths call `(ctx, input, message)`. `ctx.map` is the operating LiveMap. Native invocations also supply `ctx.event` and the exact `ctx.subject`. `input` is `HsonDataValue | undefined`, and `message` carries the behavior name and a runtime-local invocation ID. A supplied Schema validates present exact Data. Requiredness defaults to `false`. Explicit `null` counts as present input. Canonical Descriptors still supply Data in their existing `args` or `payload` field.

`trigger` starts execution immediately. The Promise resolves to `{ ok: true, result? }` with optional exact returned Data or `{ ok: false, error }` with the failure message and original cause. Functions may return Data synchronously or asynchronously.

A locus descriptor invokes only the optional generic dispatcher:

```ts
const dispose = activate_interactions({
  map,
  tree,
  document: "page",
  dispatch: async (actionKey, payload) => {
    const result = await echo.action(actionKey, payload);
    if (result.type !== "ack") throw result.error;
  },
});
```

The supplied dispatcher provides hosted transport. Locus remains the configured action authority.

## Listener realization

`InteractionListener` is the normalized portable form of current `LiveTree.listen` semantics: event, element/document/window target, capture, once, passive, missing-target policy, prevent-default, propagation stop, and immediate-propagation stop. Activation installs through `LiveTree.listen`; it does not implement a second native listener engine.

Activation observes before its initial read, then reconciles the canonical store on every relevant aggregate commit, restore boundary, and exact tree realization transition. An empty store leaves activation ready for later Descriptors. Stale or mismatched records are disposed before missing records are installed, while unaffected records remain. Fingerprints use exact canonical data encoding rather than ordinary-object normalization.

Within one selected document activation, canonical descriptor order is listener installation order. A reorder retains the longest active listener prefix already in canonical order and reattaches only active listeners that must move after it. An unchanged descriptor keeps consumed `once` state even if its canonical position moves; changing or replacing the descriptor starts a new materialization. Separate activations remain independent, including when their `document` or `window` listeners share an EventTarget; their relative order follows activation/install timing and has no global canonical guarantee.

Each public activation captures one tree/root, an optional authoritative dispatcher, and an optional failure observer. Later mutation of the caller-owned options object has no effect. To switch trees, dispose the activation and create another one.

Each LiveMap owns one executable behavior registry. Activations on that map share its definitions, and the functions stay outside canonical state. Each activation installs and disposes its own native listeners. If two activations materialize the same descriptor on the same subject and event, both listeners may run.

A missing definition reports `browser-capability-resolution` with the behavior name. After registration, new descriptors can resolve the behavior. An unchanged relationship stays unresolved, even if its subject moves. A fresh activation, a retarget to a different subject, or a change to the invocation intent can resolve the registered behavior.

Each installed listener belongs to the exact current HsonNode realization. The descriptor ID and QUID are lookup evidence, not runtime-resource owners. If a QUID later resolves to a fresh exact realization, the outgoing node's listener is disposed and a new listener is installed on the replacement. Listener materialization never mints a QUID or changes canonical state.

`once` means once per concrete materialization. Reordering unchanged descriptors does not reinstall a consumed listener on the same descriptor semantics and exact node. Descriptor replacement, remove and re-add, activation disposal and reactivation, or a fresh exact subject realization creates a fresh materialization. Consumption is runtime-only.

## Failures, synchronization, and disposal

Missing subjects, unknown local keys, absent authoritative dispatchers, listener installation failures, and rejected invocation promises are isolated per descriptor. The optional failure observer receives the descriptor, a broad phase, and the underlying cause. Descriptors remain canonical; unrelated descriptors continue to function. No invocation status is added to canonical state.

Activation construction is exception-safe. Input capture and validation happen before observers or listeners are installed. If later initialization cannot complete, every observer, runtime record, and listener created by that activation attempt is rolled back before the error escapes.

Locus commits, checkpoints, and replay history contain only private/shared authority interaction state. Echo replay applies `S → S′` to `S + L` as `S′ + L`; reconcile installs current authority `S` while retaining `L`. Both reject shared/local ID collisions before publication. `current` sync compares authority state alone, so local descriptor edits do not force replay or reconcile. Shared feature revocation removes `S` and its listeners while keeping `L` in the composed store; regrant adds current `S` back without resetting unchanged local listeners. Shared document scope removal similarly removes its shared descriptors while local descriptors survive. Local initializer scope removal and re-add retain existing client Library and descriptor state.

An Echo-composed `map.cut()` or capture may contain both partitions because it is a snapshot of the actual client map. Installing that artifact as a standalone map does not preserve former Echo ownership provenance. Fresh activation derives runtime records from canonical state, the operating map's registered behaviors, and the active tree.

The activation disposer is idempotent. It stops observation and removes only listeners owned by that activation. Canonical descriptors, the `LiveTree`, Mirror, and unrelated imperative listeners remain intact. Mirror and interaction activation have independent lifecycles.

Canonical interactions do not infer forms, routes, HTTP requests, redirects, or other no-JavaScript behavior. They also do not describe exact document mutations. Browser ingress and native server ingress may converge on the same configured domain action, but that application relationship is outside the listener descriptor.
