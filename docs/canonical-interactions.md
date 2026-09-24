# Canonical interactions

Canonical interactions store portable browser interaction intent as ordinary canonical data in an application's aggregate `LiveMap`. An interaction descriptor contains no executable capability. Activation combines current descriptors with an active `LiveTree`, a fixed local behavior table, and an optional application-supplied authoritative dispatcher to derive native listeners.

The public surface is intentionally provisional and loose:

```ts
import {
  activate_interactions,
  add_interaction,
  enable_interactions,
  remove_interaction,
  replace_interaction,
} from "hson-live";
```

The corresponding public types are `InteractionDescriptor`, `InteractionListener`, `LocalInteractionDescriptor`, `AuthoritativeInteractionDescriptor`, `InteractionLocalBehavior`, `InteractionLocalBehaviors`, `InteractionActionDispatcher`, `InteractionFailure`, and `InteractionActivationOptions`.

## Canonical storage and Schema

`enable_interactions(map)` adds one schema-governed reserved data Library inside the same aggregate authority. Repeated enablement is idempotent. Enablement must happen before the aggregate's first transition and before exclusive authority management begins; late enablement rejects rather than reconfiguring a live topology.

The reserved Library contributes to aggregate revision, capture, replay, hosted registry construction, Echo mirror construction, snapshot recovery, and authority transitions. Its structural scope excludes it from normal application Library selection and commit operation enumeration. Its transport name is not a public selection authority, and no Library handle is exposed.

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
    kind <exact "browser-local">
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
    kind <exact "locus-authoritative">
    key "string"
    payload "any"
  >>
]>>>>
```

Unknown fields, hybrid variants, malformed listener settings, and invalid library or document paths fail canonical admission before publication or revision movement. `add_interaction` rejects duplicate descriptor IDs, `replace_interaction` rejects missing IDs, and `remove_interaction` rejects missing IDs. These writes are ordinary aggregate mutations: local maps commit locally, Locus-managed maps must author through an authoritative mutation draft, and fenced Echo replicas remain read-only.

The descriptor ID identifies only the descriptor. The subject uses the fixed application document Library name and canonical numeric document path. Runtime-local QUIDs may follow an activated subject but are never serialized into interaction state.

An established subject that moves keeps its interaction: the authority rewrites its path in the same transition as the document edit. Deletion or identity-destroying replacement removes the descriptor in that transition, so a new subject at the old path cannot inherit it. A descriptor authored before its subject exists remains at its authored path and can activate if a subject appears there.

Generated QUIDs are scoped to one runtime. A runtime can map local QUIDs to and from paths for live continuity; portable interaction state uses the document Library and path. Ordinary Hson, structural JSON, and Transform HTML now omit generated QUIDs on output and reject serialized QUID claims on input. Same-runtime exact capture is separate. Browser continuation and hosted graph identity remain later migration boundaries.

## Exact interaction data

Local `args` and authoritative `payload` use Schema `"any"` and represent canonical data-mode values. The interaction layer retains exact `HsonData`; it does not materialize through ordinary JavaScript or stringify and reparse during reconciliation or dispatch. Signed zero, object member order, integer-like member order, dangerous valid names such as `__proto__`, and nested combinations therefore retain their semantics.

A local behavior receives the native `Event`, the exact resolved `LiveTree` subject, and exact `HsonData` args. Activation snapshots only explicitly supplied own string-keyed data properties whose values are behavior functions. Prototype members are not capabilities, and accessor-backed or non-function capability entries are invalid activation configuration. The resulting behavior table is fixed for one activation and application context normally comes from closure.

An authoritative descriptor invokes only the optional generic dispatcher:

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

The interaction subsystem has no Echo dependency and no action-handler registry. Locus remains the configured action authority. Authoritative dispatch never consults local behaviors and has no local fallback.

## Listener realization

`InteractionListener` is the normalized portable form of current `LiveTree.listen` semantics: event, element/document/window target, capture, once, passive, missing-target policy, prevent-default, propagation stop, and immediate-propagation stop. Activation installs through `LiveTree.listen`; it does not implement a second native listener engine.

Activation observes before its initial read, then reconciles full current descriptor state. Every relevant aggregate commit, restore boundary, and exact tree realization transition causes another full-state comparison. Stale or mismatched records are disposed before missing records are installed, while unaffected records remain. Fingerprints use exact canonical data encoding rather than ordinary-object normalization.

Each activation captures one tree/root, one local capability table, one optional authoritative dispatcher, and one optional failure observer. Later mutation of the caller-owned options object or capability table has no effect. There is no rebind operation: moving realization to another tree requires disposing the activation and creating another one.

Multiple activations against the same map and tree are allowed and independent. Each owns its capability snapshot, dispatcher, failure observer, runtime records, native listeners, and disposer. If two activations materialize the same descriptor on the same subject and event, both listeners may run; each activation must be disposed independently.

Each installed listener belongs to the exact current HsonNode realization. The descriptor ID and QUID are lookup evidence, not runtime-resource owners. If a QUID later resolves to a fresh exact realization, the outgoing node's listener is disposed and a new listener is installed on the replacement. Listener materialization never mints a QUID or changes canonical state.

`once` means once per concrete materialization. An unrelated reconciliation does not reinstall a consumed listener on the same descriptor semantics and exact node. Descriptor replacement, remove and re-add, activation disposal and reactivation, or a fresh exact subject realization creates a fresh materialization. Consumption is runtime-only.

## Failures, recovery, and disposal

Missing subjects, unknown local keys, absent authoritative dispatchers, listener installation failures, and rejected invocation promises are isolated per descriptor. The optional failure observer receives the descriptor, a broad phase, and the underlying cause. Descriptors remain canonical; unrelated descriptors continue to function. No invocation status is added to canonical state.

Activation construction is exception-safe. Input capture and validation happen before observers or listeners are installed. If later initialization cannot complete, every observer, runtime record, and listener created by that activation attempt is rolled back before the error escapes.

Hosted capture and recovery include the hidden Library atomically. Restored current descriptors become reconciliation truth: stale listeners disappear and current descriptors materialize once against the compatible active tree. Runtime records are never replayed and are reconstructable from canonical state, fixed application capabilities, and the active tree.

The activation disposer is idempotent. It stops observation and removes only listeners owned by that activation. Canonical descriptors, the `LiveTree`, Mirror, and unrelated imperative listeners remain intact. Mirror and interaction activation have independent lifecycles.

Canonical interactions do not infer forms, routes, HTTP requests, redirects, or other no-JavaScript behavior. They also do not describe exact document mutations. Browser ingress and native server ingress may converge on the same configured domain action, but that application relationship is outside the listener descriptor.
