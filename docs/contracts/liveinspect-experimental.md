# Live inspector experimental contract

`hson.inspect` is a neutral, read-only projection of supported structured data into a navigable `LiveTree`. It is diagnostic infrastructure, not a component system, schema form generator, or general application renderer.

> The inspector never mutates its source. Editing and mutation controls are outside Patch 7B and are not implied by this API.

## Sources and ownership

`hson.inspect.create({ source, host })` accepts a `LiveMap` or `LiveMapPathHandle`. The `host` must be active, dedicated, and empty. The caller owns an externally supplied source; the inspector owns its projection, scoped CSS, delegated interaction, renderer-local resources, and selection/expansion state.

`hson.inspect.fromJson({ value, host })` and `hson.inspect.fromHson({ value, host })` explicitly create an inspector-owned `LiveMap`. Plain values are not silently copied by `create`.

The inspector is layered on `hson.liveProject.keyedCollection`. Object properties are keyed by property name. Arrays use an explicit `arrayKey` result only when every item has one; otherwise an entirely unkeyed array uses honest positional identity. Mixed key coverage and duplicate keys fail with classified errors. Positional rows represent positions and do not promise logical continuity when values move.

The inspector keeps no second authoritative source graph, serialized mirror, hash-key table, mutation adapter, or transport state. Nested adapters are thin source views consumed by the Patch 7A engine.

## Rendering grammar

Every value has one stable semantic row with a label, type, neutral preview, and real button controls. Objects project named property rows. Arrays project ordered item rows. Empty object and array states remain distinct. Long strings are previewed with `longStringLimit`; the source value is unchanged. Stable attributes such as `data-hson-inspect-kind`, `data-hson-inspect-role`, and `data-hson-inspect-depth` are styling and test hooks.

`initialDepth` bounds eager materialization. A collapsed unvisited branch has no descendant projector. First expansion creates it through keyed projection. Later collapse hides rather than destroys materialized descendants, so expansion state and row identity remain local and stable. `expandAll` is guarded by `expandAllLimit`.

One branch can be selected. The details surface reports canonical path, semantic role and type, key/index, array identity mode, source revision, current path-handle QUID context, view QUID, child count, and effective schema information when the source is a `LiveMap` with a schema. Selection follows keyed movement and compatible source replacement. Removing a selected row selects its nearest surviving parent.

The default tree uses `tree`/`treeitem`/`group` semantics, `aria-level`, `aria-expanded`, and `aria-selected`. Disclosure and selection use native buttons. Interaction is handled by one listener on the inspector root. Collapsing a subtree moves contained focus to its disclosure control.

## HSON, conversion, and extensions

`hsonMode: "friendly"` summarizes canonical HSON tag, attributes, ordered content, and virtual-node role in selection details. `"canonical"` displays the canonical node. A path-handle-only source has no schema/node authority, so those details are reported as unavailable.

`serialize("json" | "hson" | "html" | "canonical-node", path?)` delegates to the existing transform pipeline and returns a string on demand. HTML and canonical-node conversion require a representable HSON-derived `LiveMap`; unsupported or unrepresentable requests are classified. Ordinary source commits never serialize the full source.

Semantic renderer hooks and prioritized specializations receive only a mutation-free read handle plus semantic context. They may return a `LiveTree` or `{ tree, update, dispose }`. Matching is deterministic by priority then declaration order. Extension failure is isolated, diagnosed, and replaced by neutral rendering. Renderer resources are terminally disposed with their owning branch.

## Replacement and disposal

`replaceSource(next)` validates before reconciling. Compatible replacement preserves property rows by name and array rows by application key, including surviving expansion and selection; handles and canonical paths change to the new source context. Failed validation leaves the previous subscription and view active and preserves the underlying classified cause.

`dispose()` is terminal and idempotent. It removes inspector-owned branches, projections, subscriptions, delegated listeners, scoped CSS, selection/expansion state, and renderer resources. Removing the inspector root externally invokes the same cleanup. Later source commits do nothing. Mutating methods on a disposed handle throw `LIVE_INSPECTOR_DISPOSED`.

## Examples

```ts
const raw = hson.inspect.fromJson({ value: { ok: true }, host });

const map = hson.liveMap.fromJson({ users: [{ id: "ada", name: "Ada" }] });
const direct = hson.inspect.create({
  source: map,
  host,
  arrayKey: (item) => typeof item === "object" && item !== null && !Array.isArray(item)
    ? item.id as string | undefined
    : undefined,
});

const subtree = hson.inspect.create({ source: map.at(["users"]), host });

// A LiveHost client mirror is still only a LiveMap to the inspector.
const mirrorView = hson.inspect.create({ source: client.map, host });
clientRecovery.onSnapshot((replacementMap) => mirrorView.replaceSource(replacementMap));

const canonical = hson.inspect.fromHson({ value: serializedHson, host, hsonMode: "canonical" });
```

## Known limits

- Only finite JSON-shaped values are accepted; cycles, class instances, DOM nodes, functions, symbols, bigints, `NaN`, and infinities are rejected.
- Unkeyed arrays provide positional continuity only.
- Schema and canonical HSON-node inspection require a full `LiveMap`, not an isolated path handle.
- This experimental surface has no clipboard contract, editing controls, custom elements, Shadow DOM, drag/drop, transport logic, or LiveHost action submission.
