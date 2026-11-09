import assert from "node:assert/strict";
import { add_interaction, replace_interaction, remove_interaction, enable_interactions, hsonLiveMap,
  type InteractionDescriptor, type LiveMapStagedWriter } from "../src/index.ts";
import { internal_livemap_aggregate_authority, register_internal_livemap_aggregate_owner } from "../src/api/livemap/livemap.internal.ts";
import { locus_map_internal } from "../src/internal/governor-maps.ts";

import { create_locus_hosted_aggregate_internal } from "../src/api/locus/locus.aggregate.ts";
import { registry_from_entries } from "../src/api/livemap/livemap.hosted.ts";
import { make_locus_hosted_projection_policy } from "../src/api/locus/locus.projection.ts";

const descriptor: InteractionDescriptor = {
  id: "initialization", subject: { library: "page", path: [0] }, kind: "browser", key: "run", args: null,
  listener: { event: "click", target: "element", capture: false, once: false, passive: false,
    missingTarget: "warn", preventDefault: false, stopPropagation: false, stopImmediatePropagation: false },
};
type Target = Parameters<typeof add_interaction>[0];
const mutations: readonly ((target: Target) => void)[] = [
  target => add_interaction(target, descriptor),
  target => replace_interaction(target, { ...descriptor, key: "next" }),
  target => remove_interaction(target, descriptor.id),
];
for (const mutate of mutations) {
  const map = hsonLiveMap.fromLibraries({ page: { document: "<main/>" } });
  let expired: LiveMapStagedWriter<typeof map, void> | undefined;
  map.batch(draft => { expired = draft; });
  assert.equal(map.rev, 0);
  assert.ok(expired);
  const expiredWriter = expired;
  assert.throws(() => mutate(expiredWriter), /Expired staged authoring scope/);
  assert.throws(() => Reflect.apply(mutate, undefined, [{}]), /internal aggregate authority is unavailable/);
  assert.throws(() => Reflect.apply(mutate, undefined, [{ doc: map.doc, data: map.data, parts: map.parts }]), /internal aggregate authority is unavailable/);
}

// Both direct and batch ownership retain their existing mutation behavior.
const map = hsonLiveMap.fromLibraries({ page: { document: "<main/>" } });
const aggregate = internal_livemap_aggregate_authority(map);
const initialRegistry = aggregate.hostedRegistry();
assert.equal(initialRegistry.libraries.filter(entry => entry.scope === "hson-internal").length, 1);
add_interaction(map, descriptor);
replace_interaction(map, { ...descriptor, key: "next" });
remove_interaction(map, descriptor.id);
map.batch(draft => {
  add_interaction(draft, descriptor);
  replace_interaction(draft, { ...descriptor, key: "batched" });
});
map.batch(draft => remove_interaction(draft, descriptor.id));
assert.equal(map.rev, 5);
enable_interactions(map);
enable_interactions(map);
assert.equal(map.rev, 5);
assert.equal(aggregate.hostedRegistry(), initialRegistry);

const limit = hsonLiveMap.fromLibraries(Object.fromEntries(
  Array.from({ length: 1_023 }, (_, index) => [`lib${index}`, { json: null }])));
const maxRegistry = internal_livemap_aggregate_authority(limit).hostedRegistry();
assert.equal(maxRegistry.libraries.length, 1_024);
assert.equal(maxRegistry.libraries.at(-1)?.scope, "hson-internal");
assert.throws(() => limit.addLibraries({ extra: { json: 0 } }), /registry library count/);
assert.equal(limit.rev, 0);
assert.equal(internal_livemap_aggregate_authority(limit).hostedRegistry(), maxRegistry);
add_interaction(map, descriptor);
let enabledExpired: LiveMapStagedWriter<typeof map, void> | undefined;
map.batch(draft => { enabledExpired = draft; });
assert.ok(enabledExpired);
const enabledExpiredWriter = enabledExpired;
assert.throws(() => add_interaction(enabledExpiredWriter, { ...descriptor, id: "late" }), /Expired staged authoring scope/);
assert.throws(() => replace_interaction(enabledExpiredWriter, { ...descriptor, key: "late" }), /Expired staged authoring scope/);
assert.throws(() => remove_interaction(enabledExpiredWriter, descriptor.id), /Expired staged authoring scope/);

const invalid = hsonLiveMap.create(), invalidOwner = internal_livemap_aggregate_authority(invalid);
const slotless = registry_from_entries([]);
const position = invalidOwner.hostedPosition();
assert.throws(() => make_locus_hosted_projection_policy(slotless, position.authority, [],
  { libraries: [], systemFeatures: ["interactions"] }, ({ requested }) => requested),
  /required canonical interaction binding/);
register_internal_livemap_aggregate_owner(invalid, { ...invalidOwner, systemState: () => undefined });
assert.throws(() => create_locus_hosted_aggregate_internal({ map: invalid }), /required canonical interaction binding/);

const locus = hsonLiveMap.locus.create({ page: { document: "<main/>" } }, {
  actions: { register(context) { add_interaction(context.stage, descriptor); } },
});
try {
  for (const mutate of mutations) {
    assert.throws(() => Reflect.apply(mutate, undefined, [locus]), /internal aggregate authority is unavailable/);
    await locus.stage(draft => mutate(draft));
  }
  assert.equal(locus.rev, 3);
  assert.throws(() => add_interaction(locus_map_internal(locus), descriptor), /exclusive Locus authority/i);
  const result = await locus.dispatchAction({ type: "action", id: "register", name: "register" });
  assert.equal(result.type, "ack");
  assert.equal(locus.rev, 4);
  await assert.rejects(locus.stage(draft => add_interaction(draft, descriptor)), /already exists/);
  await assert.rejects(locus.stage(draft => replace_interaction(draft, { ...descriptor, subject: { library: "missing", path: [0] } })), /document Library/);
  assert.equal(locus.rev, 4);
} finally { locus.dispose(); }
await assert.rejects(locus.stage(draft => add_interaction(draft, descriptor)), /disposed|closed or faulted/i);
const seeded = hsonLiveMap.locus.create({ page: { document: "<main/>" } }, { interactions: [descriptor] });
try {
  const registry = internal_livemap_aggregate_authority(locus_map_internal(seeded)).hostedRegistry();
  assert.equal(registry.libraries.filter(entry => entry.scope === "hson-internal").length, 1);
  await assert.rejects(seeded.stage(draft => add_interaction(draft, descriptor)), /already exists/);
} finally { seeded.dispose(); }
console.log("universal interaction storage, registry limit and ownership passed");
