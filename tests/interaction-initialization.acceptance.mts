import assert from "node:assert/strict";
import { add_interaction, replace_interaction, remove_interaction, enable_interactions, hsonLiveMap,
  type InteractionDescriptor, type LiveMapStagedWriter } from "../src/index.ts";
import { locus_map_internal } from "../src/internal/governor-maps.ts";

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
const disabled = /Canonical interaction storage is not enabled.*initial LiveMap\/Locus configuration.*enable_interactions\(map\).*interactions: \[\]/;

for (const mutate of mutations) {
  const map = hsonLiveMap.fromLibraries({ page: { document: "<main/>" } });
  assert.throws(() => mutate(map), disabled);
  let expired: LiveMapStagedWriter<typeof map, void> | undefined;
  assert.throws(() => map.batch(draft => { expired = draft; mutate(draft); }), disabled);
  assert.equal(map.rev, 0);
  assert.ok(expired);
  const expiredWriter = expired;
  assert.throws(() => mutate(expiredWriter), /Expired staged authoring scope/);
  // Authentic disabled writers must not turn arbitrary lookalikes into valid targets.
  assert.throws(() => Reflect.apply(mutate, undefined, [{}]), /internal aggregate authority is unavailable/);
  assert.throws(() => Reflect.apply(mutate, undefined, [{ doc: map.doc, data: map.data, parts: map.parts }]), /internal aggregate authority is unavailable/);

  const locus = hsonLiveMap.locus.create({ page: { document: "<main/>" } });
  try {
    await assert.rejects(locus.stage(draft => mutate(draft)), disabled);
    assert.equal(locus.rev, 0);
    assert.throws(() => Reflect.apply(mutate, undefined, [locus]), /internal aggregate authority is unavailable/);
  } finally { locus.dispose(); }
  await assert.rejects(locus.stage(draft => mutate(draft)), /disposed|closed or faulted/i);
}

// Both direct and batch ownership retain their existing mutation behavior.
const map = hsonLiveMap.fromLibraries({ page: { document: "<main/>" } });
enable_interactions(map);
add_interaction(map, descriptor);
replace_interaction(map, { ...descriptor, key: "next" });
remove_interaction(map, descriptor.id);
map.batch(draft => {
  add_interaction(draft, descriptor);
  replace_interaction(draft, { ...descriptor, key: "batched" });
});
map.batch(draft => remove_interaction(draft, descriptor.id));
assert.equal(map.rev, 5);
add_interaction(map, descriptor);
let enabledExpired: LiveMapStagedWriter<typeof map, void> | undefined;
map.batch(draft => { enabledExpired = draft; });
assert.ok(enabledExpired);
const enabledExpiredWriter = enabledExpired;
assert.throws(() => add_interaction(enabledExpiredWriter, { ...descriptor, id: "late" }), /Expired staged authoring scope/);
assert.throws(() => replace_interaction(enabledExpiredWriter, { ...descriptor, key: "late" }), /Expired staged authoring scope/);
assert.throws(() => remove_interaction(enabledExpiredWriter, descriptor.id), /Expired staged authoring scope/);

const locus = hsonLiveMap.locus.create({ page: { document: "<main/>" } }, {
  interactions: [],
  actions: { register(context) { add_interaction(context.stage, descriptor); } },
});
try {
  for (const mutate of mutations) {
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
console.log("interaction initialization diagnostics and enabled capabilities passed");
