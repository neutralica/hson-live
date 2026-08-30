# LiveMap capture, restore, and replay

This is the canonical contract for LiveMap capture shapes, identity treatment,
revision effects, and reconstruction operations. The current public types and
implementation are authoritative.

## Two capture families

Data maps and document maps do not share a capture envelope.

### Data capture

```ts
type LiveMapCapture = Readonly<{
  rev: number;
  root: HsonNode;
  format: "structural-json";
  payload: string;
}>;
```

At runtime, `capture()` returns an immutable object whose enumerable transport
fields are `rev`, `format`, and `payload`. `root` is a detached exact canonical
graph carried as a non-enumerable property. The `structural-json` payload is the
current format-discriminated transport form: it preserves ordered object entries,
dangerous property names, and `-0` without relying on JavaScript plain-object
enumeration.

Data captures do not contain `value` or `formatVersion`. Malformed transport
and the former value/op-only forms reject rather than falling back to an older
interpretation.

```ts
const capture = dataMap.capture();

capture.rev;
capture.format;  // "structural-json"
capture.payload; // exact ordered payload
capture.root;    // detached canonical Hson graph
```

### Document capture

```ts
type DocumentLiveMapCapture = Readonly<{
  kind: "hson-document";
  mode: "document";
  rev: number;
  root: HsonNode;
}>;
```

All four fields are enumerable. The root is detached canonical Hson and the
capture preserves admitted sparse element QUID metadata unless identity is
explicitly stripped.

`DocumentLiveMapCapture` is not versioned. It has no `version` or
`formatVersion` field. Locus may serialize a document capture into a separate
`view-state` envelope for persistence or recovery; that wire envelope
must not be confused with the public LiveMap capture object.

## Capture identity categories

Both families accept the explicit capture identities `same-epoch`,
`preserve-metadata`, and `strip`:

```ts
const localCapability = map.capture({ identity: "same-epoch" });
const durable = map.capture({ identity: "preserve-metadata" });
const identityFree = map.capture({ identity: "strip" });
```

Omitting options behaves as durable `preserve-metadata` capture, but only an
explicit options-bearing capture receives the private provenance needed for a
later `same-epoch` restore or install.

- `same-epoch` retains QUID metadata and records an exact-object, owner, epoch,
  revision, and graph proof. It is a local capability, not serializable data.
- `preserve-metadata` retains valid QUID bytes for durable reconstruction. The
  receiving owner validates them and starts a new live identity epoch.
- `strip` removes QUID metadata from the detached graph without changing the
  source map.

Copying, cloning, serializing, or decoding a same-epoch capture preserves at
most its data. It does not preserve the private capability. Equal QUID bytes do
not prove continuity.

## Data restoration and replay

```ts
dataMap.restore(capture, { identity?: policy });
dataMap.apply({ prevRev, format: "structural-json", payload });
dataMap.replay({ prevRev, format: "structural-json", payload });
```

`restore` validates agreement between the canonical `root` and structural data
payload, validates the map mode and attached schema, then replaces state and
sets the map revision to `capture.rev`. It emits a snapshot observation and
notifies active watchers once, but it creates no commit, publishes no feed
event, and does not increment the captured revision.

Data restore accepts the admission policies `same-epoch`,
`preserve-metadata`, `strip`, and `reject`. `same-epoch` requires the exact
active capture capability from the same owner epoch. Every other policy creates
a new identity epoch; `strip` removes QUID metadata and `reject` refuses a
QUID-bearing root.

`apply` is conditional whole-state replacement. Its `prevRev` must equal the
current revision; a changed result becomes one ordinary data commit.

`replay` accepts either a current structural operation envelope or the public
projected `ensure-quid` graph commit. Operation replay requires exact
`prevRev`, verifies recorded previous and next witnesses, validates the
prospective schema, and emits the accepted replay commit. It does not silently
repair a gap or accept an old transport shape.

## Document installation, restoration, and replay

```ts
documentMap.install(capture, { expectedRev?, identity? });
documentMap.restore(capture, { expectedRev?, identity? });
documentMap.replay(commit);
```

Both `install` and `restore` require an exact four-field document capture whose
declared `mode` matches both its canonical root and the target map. They clone
and validate the complete root, attached document schema, sparse QUID claims,
and identity policy before publishing anything. `expectedRev`, when present,
is an optimistic guard against the target map's current revision.

`install` is a current transition. A changed install advances the target from
its current revision by exactly one and returns one graph `replace-root`
commit. It does not adopt `capture.rev`. An exact-equal root produces a no-op
commit and retains the unchanged local epoch; a changed non-same-epoch install
starts a new epoch and fences old identity handles.

`restore` is reconstruction. It installs the state at exactly `capture.rev`,
creates no ordinary commit or local increment, and publishes a snapshot
observation to watchers and commit observers.

Document admission accepts `same-epoch`, `preserve-metadata`, `strip`, and
`reject`. The default is `preserve-metadata`. Only an exact explicit
same-epoch capture from the same current owner epoch can retain existing live
identity continuity. Other successful complete-root admissions start a new
owner epoch and invalidate prior identity handles even when QUID bytes remain
equal.

`replay` accepts one canonical graph commit whose `prevRev` equals the current
revision and whose `rev` is exactly `prevRev + 1`. It validates the operation
domain, paths, graph witnesses, schema, and identity effects before applying the
commit. Replay is ordered reconstruction; it is not application intent or a
merge protocol.

## Persistence boundary

LiveMap supplies local captures and deterministic reconstruction operations. It
does not define storage retention, remote recovery choice, or multi-client
authority. Locus owns those policies and may encode document captures as Hson
or exact `view-state`, retain ordered canonical commits, and choose current,
replay, or replacement-snapshot recovery.

A revision is meaningful only within the map history or authority incarnation
that issued it. Equal revision numbers, QUID bytes, or serialized content from
different owners do not establish shared history or identity continuity.
