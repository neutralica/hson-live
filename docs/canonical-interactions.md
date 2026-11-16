# Canonical interactions

Canonical interactions store portable interaction intent in one canonical `LiveMap` system root. Activation combines the current descriptors with an active `LiveTree`, the map's local action registry, and an optional application-supplied dispatcher to derive listeners.

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

LiveMap owns the canonical graph. Locus governs admission, durable commits, sessions, and publication. The optional Locus `interactions` configuration can seed Descriptors. A runtime `locus.admit` or `map.addLibraries` installs Documents and their generated Descriptors in one revision. Echo carries authority Descriptors only for authorized subject Documents and only with the `interactions` feature. A featureless Echo map still owns its local store. Its projected registry digest and authority fingerprint cover only the authorized authority state. Local initializers contain root, Schema, CSS, definition identity, and any canonical `interactionAdds`; the fingerprint covers those contributions. First installation admits them atomically, while existing client Library and Event state retains precedence.

The 4 MiB exact-value bound applies to the whole prospective interaction root at transition preparation. Each encoded Descriptor delta also has its own exact-value bound. The 16 MiB hosted transition limit applies to the encoded transition envelope, including its Library roots and Descriptor delta. Hosted preaccept uses the actual before and after interaction roots for publication and retained history.

Durable Locus checkpoints require the fixed interaction binding. Replay validates each original transition at its accepted boundary. Resume installs the validated checkpoint and replay result together, using the checkpoint format's manifest and chunk bounds for stored material. The final recovered topology can exceed the size of a single Library-add envelope. Recovery restores the accepted Descriptors in order with their original IDs, subjects, and exact Data.

The reserved slot and registry use the same current structural Schema, including Document subjects and `eventArgs`. Its digest is `ec621c2e3d254641b24a07cbb9309f427605d5446dfdaeaab5fd9327025e68be`. Admission and recovery also enforce exact subject alternatives and the cross-field rules below; there is no legacy Schema binding.

```hson
<type "data" content <descriptors <array <union [
  <content <
    id "string"
    subject <content <library "string" path <optional <array <number <int true min 0>>>> kind <optional <exact "document">>>>
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
    args <optional "any">
    eventArgs <optional <array <array "any">>>
  >>,
  <content <
    id "string"
    subject <content <library "string" path <optional <array <number <int true min 0>>>> kind <optional <exact "document">>>>
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
    payload <optional "any">
    eventArgs <optional <array <array "any">>>
  >>
]>>>>
```

Unknown fields, hybrid variants, malformed listener settings, invalid document paths, and duplicate IDs fail canonical admission before publication or revision movement. Descriptor IDs are globally unique across the entire root, including shared and local partitions. `replace_interaction` and `remove_interaction` select that global ID and reject missing IDs. Lower-level transitions, portable restoration, authority snapshots, replay, and reconcile enforce the same uniqueness rule.

`subject` is required and has exactly one of two shapes: `{ library, path }` for an element, or `{ library, kind: "document" }` for the Document Library itself. Both name an existing Document Library. Document subjects forbid `path` and native `listener.target: "element"`; a missing path never implies Document ownership. Structural optional fields above are constrained by this exact semantic admission at every canonical boundary, including retained history.

## Ownership and dispatch

Descriptor ownership comes solely from `descriptor.subject.library`:

| Subject document | Canonical owner | Transfer |
| --- | --- | --- |
| Private | Locus | Not projected to clients |
| Shared | Locus | Synchronized through Echo |
| Local | Client | Retained on the composed map |

There is one interaction system root. Its shared partition `S` contains descriptors for projected shared documents; its local partition `L` contains descriptors for local documents. Echo exposes `S + L`. Direct client authoring may change only `L`; Locus drafts may change private or shared descriptors in the authority map. Locus has no local document Library, so it rejects local subjects. A shared descriptor remains authority-owned even when `kind` is `"browser"`.

`kind` chooses execution, independently of ownership. `"browser"` resolves the action name through `map.actions`. `"locus"` calls the supplied dispatcher. Hosted Echo composition normally dispatches through `echo.action`, where Locus authorizes the action independently. Shared/browser, shared/locus, local/browser, and local/locus are all valid.

On writable, element-qualified Document `.at()` and `.q()` handles, `.listen.local.onClick(key, input?)` and `.listen.host.onClick(key, input?)` author a click Descriptor. Standalone LiveMap and Echo client-local calls return the accepted Descriptor ID synchronously. Locus-governed calls return `Promise<string>` resolving to that ID after authoritative acceptance. Local descriptors can be authored after their local document exists without a shared `interactions` grant or a server round trip. A Locus `stage` or action `ctx.stage` can commit grouped document edits and Descriptor changes atomically.

The individual Library handle also exposes `.listen`. Its owner is the Library, and its native default is Document placement. A complete `.listen.event(source)` declaration supplies its Action destination and listener flags. Local LiveMap and Echo-local receivers return a distinct canonical Descriptor ID on every call; Locus receivers return `Promise<string>` after acceptance. Element receivers support the same authored method, retaining element ownership even with a `document` or `window` flag. `LiveTree.listen.event(source)` continues to return a native `ListenerSub`. Pending fluent native options cannot be combined with authored `.event(source)`.

Document definitions can declare Events directly:

```ts
const map = hsonLiveMap.fromLibraries({
  page: {
    document: "<main/>",
    events: {
      shortcut: '<hson:event on:key:down local:SHORTCUT pressed:str=^{key.key} <> >',
    },
  },
});
const page = map.doc.must("page");
const id = page.listen.event('<hson:event on:click window local:CLOSE <> >');
```

Each named declaration creates one Document-owned Descriptor with ID `document-event/<library>/<eventName>`. Existing ID collisions reject the entire admission. No element `event:name` attachment or implicit Part scope is required. Part-local and incoming references reject with source diagnostics; literal Data and supported event-time native lookups use the existing Event parser. Explicit `window` selects the realization's Window. Part Events retain their existing attachment and lexical behavior.

The source record is construction input only. Ordinary root edits and restore do not regenerate declarations. Supported public local Library-add replay carries `interactionAdds`, so replay, snapshots, initializers, and checkpoints preserve the accepted canonical relationships without another Event registry.

### Authored Event arguments

Authored Events use named arguments of the form `name:type=value`. For example, `<hson:event on:click host:deck.advance step:num="3" title:str="Next" settings:data={<speed 5>} <> >` sends an ordered Data object with `step`, `title`, and `settings`. A field spelled `input:data` has the name `input`, and its value stays nested under that name. The empty outcome `<>` is required.

Use `str` for strings, `num` for finite numbers, and `data` for Hson Data. Numeric literals are double-quoted finite JSON numbers and preserve signed zero. In Parts, whole `%{incoming}` and `^{local}` references preserve the resolved value, and a quoted `str` can interpolate primitive Part values. Each attachment resolves in its own occurrence scope. An absent optional operand omits its field. A declaration with zero arguments supplies `undefined`. A declaration whose optional fields are all absent supplies an empty object.

| Authored selector | Native event | Event-local root |
| --- | --- | --- |
| `on:click` | `click` | |
| `on:pointer:down` | `pointerdown` | `pointer` |
| `on:pointer:move` | `pointermove` | `pointer` |
| `on:pointer:up` | `pointerup` | `pointer` |
| `on:pointer:cancel` | `pointercancel` | `pointer` |
| `on:key:down` | `keydown` | `key` |
| `on:key:up` | `keyup` | `key` |

| Event-local root | `num` or `data` | `str` or `data` | Boolean `data` |
| --- | --- | --- | --- |
| `pointer` | `clientX`, `clientY`, `movementX`, `movementY`, `pointerId`, `button`, `buttons` | `pointerType` | `isPrimary`, `altKey`, `ctrlKey`, `metaKey`, `shiftKey` |
| `key` | `location` | `key`, `code` | `repeat`, `isComposing`, `altKey`, `ctrlKey`, `metaKey`, `shiftKey` |

Use native lookups as whole argument values. They require the matching native Event class and a value of the expected type, including for references ending in `?`. Pointer movement values come directly from the browser. `button` reports the changed button, `buttons` carries the button-state bitmask, and `pointerId` has the lifetime defined by the browser's pointer model. Release and cancellation dispatch separately. Keyboard `key` reports the logical value and `code` identifies the physical key.

The selected family establishes its root within the Event declaration. A visible Part local or iterator alias with that name conflicts at the attachment. The same name can be used as an ordinary local outside that Event scope. Incoming `%{...}` placeholders use their usual Part bindings. `part:optional` continues to depend on composition-time references.

```hson
<hson:event on:pointer:move host:deck.move x:num=^{pointer.clientX} slide:data=^{currentSlide} y:num=^{pointer.clientY} <> >
<hson:event on:key:down local:SHORTCUT pressed:str=^{key.key} code:str=^{key.code} repeat:data=^{key.repeat} <> >
```

For a declaration containing a native lookup, the internal `eventArgs` field holds one ordered plan. Its entries are `[name, type, capturedValue]` for a resolved field, `[name, type]` for a capture omitted during composition, and `[name, type, family, property]` for a native lookup. `family` is `"pointer"` or `"key"`. Admission requires unique argument names, matching value types, and at least one supported lookup from the listener's Event family. Descriptors carry the plan in place of resolved `args` or `payload`. Listener equivalence includes the full plan.

Each browser dispatch uses the native Event to construct the exact ordered Data object, then applies the normal Action argument admission. A failed extraction rejects the invocation through the existing failure reporting. A hosted Action receives that Data through Echo and Locus. Echo retries retain the original arguments and request ID. Client-reported native values are application input subject to the Action Schema and authorization.

The descriptor ID identifies only the descriptor. Element subjects use the fixed application Document Library name and canonical numeric document path; Document subjects use the Library name and explicit `kind`. Runtime-local QUIDs may follow an activated element subject but are never serialized into interaction state.

An established subject that moves keeps its interaction: the owning map rewrites its path in the same transition as the document edit. Local edits rewrite only local descriptors; shared edits rewrite only shared descriptors. Deletion or identity-destroying replacement removes the descriptor in that transition, so a new subject at the old path cannot inherit it. A descriptor authored before its subject exists remains at its authored path and can activate if a subject appears there.

Document subjects bypass element path rewriting and retirement. Replacing an ordinary root element preserves their canonical intent and their compatible native registrations.

Generated QUIDs are scoped to one runtime. A runtime can map local QUIDs to and from paths for live continuity; portable interaction state uses the document Library and path. Ordinary Hson, structural JSON, and Transform HTML now omit generated QUIDs on output and reject serialized QUID claims on input. Same-runtime exact capture is separate. Hosted continuation and graph effects use portable subject correspondence and receiving-owned identity; they never import server QUIDs.

## Exact interaction data

Descriptor inputs accept supported JavaScript values or authenticated carriers. Ordinary strings are literal Data; encoded JSON/Hson requires explicit `Hson.data.fromSource()`. Browser `args` and locus `payload` are optional canonical Data fields. When input is `undefined`, the field is absent from canonical storage and transport. Explicit `null` is stored as Data. The interaction layer retains exact `HsonDataValue`; it does not materialize through ordinary JavaScript or stringify and reparse during reconciliation or dispatch. Signed zero, object member order, integer-like member order, dangerous valid names such as `__proto__`, and nested combinations therefore retain their semantics. Shared `args` and `payload` are shared canonical data: no general taint tracking redacts values an authority author places there. Private-subject descriptors are filtered from projection.

Register local actions on the operating map before activation. Each `define` adds one function for the life of that map. Invalid definitions and duplicate names throw before insertion. Executable definitions stay in memory across Document and activation disposal and are omitted from canonical state and captures.

```ts
map.actions.define("panel.set", (ctx, args) => {
  if (ctx.subjectKind !== "document") updatePanel(ctx.map, ctx.subject, args?.materialize());
}, { args: { required: true, schema: panelSchema } });

const result = await map.actions.trigger("panel.set", { open: true });
```

Direct and native invocations call `(ctx, args)`. `ctx.map` is the operating LiveMap. Element-owned native invocations retain `ctx.subject: LiveTree` and `ctx.event`. Document-owned invocations supply `ctx.subjectKind: "document"`, `ctx.subject` as the existing Document Library handle, and `ctx.event`. Narrow on `subjectKind` before using element-only methods. Direct `map.actions.trigger()` supplies only `{ map }`. Hosted Locus handlers continue to receive governed context and admitted Data, without browser events or subjects.

`args` is `HsonDataValue | undefined`. Present registered Action arguments must be a Data object. A supplied Schema validates that exact object, including required fields. `args.required` defaults to `false`. An explicit `{}` counts as present.

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

`InteractionListener` is the normalized portable form of current `LiveTree.listen` semantics: event, element/document/window target, capture, once, passive, missing-target policy, prevent-default, propagation stop, and immediate-propagation stop. Activation uses the shared LiveTree listener installer and lifecycle registry. Canonical intent needs no browser realization.

An active Library realization also supports managed native callbacks: `page.listen.onKeyDown(handler)`, `page.listen.window.onKeyDown(handler)`, generic `.on(...)`, `.onCustom(...)`, `.onCustomDetail(...)`, and the current LiveTree convenience methods and fluent options. These return subscriptions with `.off()`. Targets come from that realization's owning Document and `defaultView`, including iframe realms. Echo-projected handles expose these callbacks without canonical `.event`, `.local`, or `.host` authoring; read and staged handles expose no runtime listener builder.

Activation observes before its initial read, then reconciles the canonical store on every relevant aggregate commit, restore boundary, and exact tree realization transition. An empty store leaves activation ready for later Descriptors. Stale or mismatched records are disposed before missing records are installed, while unaffected records remain. Fingerprints use exact canonical data encoding rather than ordinary-object normalization.

Within one selected document activation, canonical descriptor order is listener installation order. A reorder retains the longest active listener prefix already in canonical order and reattaches only active listeners that must move after it. An unchanged descriptor keeps consumed `once` state even if its canonical position moves; changing or replacing the descriptor starts a new materialization. Separate activations remain independent, including when their `document` or `window` listeners share an EventTarget; their relative order follows activation/install timing and has no global canonical guarantee.

Each public activation captures one tree/root, an optional authoritative dispatcher, and an optional failure observer. Later mutation of the caller-owned options object has no effect. To switch trees, dispose the activation and create another one.

Each LiveMap owns one executable action registry. Activations on that map share its definitions, and the functions stay outside canonical state. Each activation installs and disposes its own native listeners. If two activations materialize the same descriptor on the same subject and event, both listeners may run.

A missing definition reports `browser-capability-resolution` with the action name. After registration, new descriptors can resolve the action. An unchanged relationship stays unresolved, even if its subject moves. A fresh activation, a retarget to a different subject, or a change to the invocation intent can resolve the registered action.

An element listener belongs to the exact current HsonNode realization. If a QUID later resolves to a fresh exact realization, the outgoing node's listener is disposed and a new listener is installed on the replacement. A Document listener belongs to its Library realization binding independently of the root element. Equivalence includes the logical Library identity and native placement; sharing a native Document does not merge owners. Listener materialization never mints a QUID or changes canonical state.

`once` means once per concrete materialization. Reordering unchanged descriptors does not reinstall a consumed listener on the same descriptor semantics and owner. Document root edits preserve consumed state in a compatible Library realization. Descriptor replacement, remove and re-add, activation disposal and reactivation, or a fresh subject realization creates a fresh materialization. Consumption is runtime-only and independent across activations.

## Failures, synchronization, and disposal

Missing subjects, unknown local keys, absent authoritative dispatchers, listener installation failures, and rejected invocation promises are isolated per descriptor. The optional failure observer receives the descriptor, a broad phase, and the underlying cause. Descriptors remain canonical; unrelated descriptors continue to function. No invocation status is added to canonical state.

Activation construction is exception-safe. Input capture and validation happen before observers or listeners are installed. If later initialization cannot complete, every observer, runtime record, and listener created by that activation attempt is rolled back before the error escapes.

Locus commits, checkpoints, and replay history contain only private/shared authority interaction state. Echo replay applies `S → S′` to `S + L` as `S′ + L`; reconcile installs current authority `S` while retaining `L`. Both reject shared/local ID collisions before publication. `current` sync compares authority state alone, so local descriptor edits do not force replay or reconcile. Shared feature revocation removes `S` and its listeners while keeping `L` in the composed store; regrant adds current `S` back without resetting unchanged local listeners. Shared document scope removal similarly removes its shared descriptors while local descriptors survive. Local initializer scope removal and re-add retain existing client Library and descriptor state.

An Echo-composed `map.cut()` or capture may contain both partitions because it is a snapshot of the actual client map. Installing that artifact as a standalone map does not preserve former Echo ownership provenance. Fresh activation derives runtime records from canonical state, the operating map's registered actions, and the active tree.

The activation disposer is idempotent. It stops observation and removes only listeners owned by that activation. Canonical descriptors, the `LiveTree`, Mirror, and unrelated imperative listeners remain intact. Mirror disposal or Library projection revocation releases its native Library registrations, including canonical materializations, without deleting authority-side intent.

Canonical interactions do not infer forms, routes, HTTP requests, redirects, or other no-JavaScript behavior. They also do not describe exact document mutations. Browser ingress and native server ingress may converge on the same configured domain action, but that application relationship is outside the listener descriptor.
