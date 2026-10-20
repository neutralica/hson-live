import assert from "node:assert/strict";
import { Hson, hsonLiveMap, bind_locus_http } from "../../src/index.js";
import { internal_livemap_aggregate_authority } from "../../src/api/livemap/livemap.internal.js";
import { enumerate_livemap_issued_quids } from "../../src/api/livemap/livemap.identity-epoch.js";
import type { ReadDataLocation } from "../../src/types/governor.types.js";

export async function library_evidence_cases() {
  const earlier = Hson.schema`<type "data" content <earlier "number">>`;
  const later = Hson.schema`<type "data" content <later "string">>`;
  const definitions: { seed: { data: number }; maybe?: { data: { earlier: number }; schema: typeof earlier } } = { seed: { data: 1 } };
  const optionalMap = hsonLiveMap.fromLibraries(definitions);
  const receipt = optionalMap.addLibraries({ maybe: { data: { later: "present" }, schema: later } });
  assert.equal(receipt.libraries.maybe.schema.get(), later);
  assert.deepEqual(receipt.libraries.maybe.snap(), { later: "present" });
  const groups: { maybe?: { data: { earlier: number }; schema: typeof earlier } } = {};
  const optionalLocus = hsonLiveMap.locus.create(groups);
  try {
    await optionalLocus.admit({ "maybe": { data: { later: "present" }, schema: later, access: "shared" } });
    assert.equal(optionalLocus.data.must("maybe", later).schema.get(), later);
  } finally { optionalLocus.dispose(); }

  const map = hsonLiveMap.fromLibraries({ state: { data: { value: [1], parent: { value: { count: 1 } } } }, array: { data: [1] } });
  const state = map.data.must("state");
  const aggregate = internal_livemap_aggregate_authority(map);
  const before = map.capture(), issued = aggregate.identityEpoch().issued(), issuedBefore = enumerate_livemap_issued_quids(issued);
  const value = state.at(["value"]), array = value.asArray()!;
  const child = array.at([]);
  const parent = state.at(["parent"]).asObject()!;
  const object = parent.at(["value"]).asObject()!;
  const count = object.at(["count"]);
  array.snap(); array.data(); array.array.map(x => x); object.object.keys(); count.snap();
  assert.deepEqual(map.capture(), before);
  assert.equal(aggregate.identityEpoch().issued(), issued);
  assert.deepEqual(enumerate_livemap_issued_quids(aggregate.identityEpoch().issued()), issuedBefore);
  const watched: unknown[] = [], descendants: unknown[] = [];
  const stop = array.watch(next => watched.push(next));
  const stopChild = child.watch(next => descendants.push(next));
  value.replace({ count: 2 });
  assert.equal(array.snap(), undefined);
  assert.equal(array.data(), undefined);
  assert.equal(child.snap(), undefined);
  assert.equal(array.at([]).snap(), undefined);
  assert.equal(array.asObject(), undefined);
  assert.throws(() => array.array.map(() => assert.fail("stale collection callback")), /array/);
  assert.throws(() => array.array.push(2), /array/);
  assert.throws(() => array.update(() => { assert.fail("stale updater callback"); return []; }), /refinement/);
  value.delete();
  assert.equal(array.snap(), undefined);
  assert.equal(array.present(), undefined);
  assert.deepEqual(watched, [undefined, undefined]);
  assert.deepEqual(descendants, watched);
  state.at([]).object.setKey("value", [3]);
  assert.deepEqual(array.snap(), [3]);
  assert.deepEqual(watched.at(-1), [3]);
  const captured = map.capture();
  value.replace({ next: true });
  assert.equal(array.snap(), undefined);
  map.restore(captured);
  assert.deepEqual(array.snap(), [3]);
  assert.deepEqual(watched.at(-1), [3]);
  stop(); stopChild();
  const stopReentry = value.watch(next => { if (next !== undefined && !Array.isArray(next)) value.replace([9]); });
  const stopChecked = array.watch(next => { assert.ok(next === undefined || Array.isArray(next), "Reentrant watches must not leak an incompatible event value"); });
  value.replace({ reentrant: true });
  stopChecked(); stopReentry();

  const objectValues: unknown[] = [];
  const stopObject = object.watch(next => objectValues.push(next));
  state.at(["parent", "value"]).replace([4]);
  assert.equal(object.snap(), undefined);
  assert.equal(count.snap(), undefined);
  assert.throws(() => object.object.keys(), /object/);
  assert.throws(() => object.object.setKey("count", 2), /object/);
  assert.equal(state.at(["parent"]).asObject()!.object.getKey("missing"), undefined);
  assert.deepEqual(state.at(["parent"]).asObject()!.object.pick(["missing"]), {});
  state.at(["parent"]).delete();
  assert.equal(parent.snap(), undefined);
  assert.equal(object.snap(), undefined);
  assert.equal(parent.at(["value"]).snap(), undefined);
  assert.deepEqual(objectValues, [undefined, undefined]);
  stopObject();

  const roots = map.data.must("array").at([]);
  roots.array.push({ fresh: true });
  assert.deepEqual(roots.snap(), [1, { fresh: true }]);
  assert.throws(() => Reflect.apply(roots.replace, undefined, [{}]), /root|mode|array/i);
  assert.throws(() => Reflect.apply(state.at([]).replace, undefined, [[]]), /root|mode|object/i);
  const current = map.capture();
  assert.throws(() => map.batch(writer => {
    const raw = writer.data.must("state").at(["value"]);
    const checked = raw.asArray();
    raw.replace({ count: 1 });
    // Recheck the retained assertion even when the later operation is a generic write.
    checked.at([]).replace([]);
  }), /array/);
  assert.deepEqual(map.capture(), current);
  let expired: (() => void) | undefined;
  map.batch(writer => { const checked = writer.data.must("state").at(["value"]).asArray(); expired = () => checked.array.push(9); });
  assert.throws(() => expired!(), /expired/i);

  const staleMap = hsonLiveMap.fromLibraries({ old: { data: [1] } });
  const stale = staleMap.data.must("old").at([]).asArray()!;
  internal_livemap_aggregate_authority(staleMap).restorePortableLibraries(hsonLiveMap.fromLibraries({ next: { data: [2] } }).capture());
  assert.throws(() => stale.snap(), /another map authority/i);
  assert.throws(() => stale.array.push(3), /another map authority/i);

  const schema = Hson.schema`<type "data" content <value <optional "any"> parent <optional <content <value "any">>>>>`;
  let retainedRead: ReturnType<ReadDataLocation["asArray"]>;
  const locus = hsonLiveMap.locus.create({ "state": { data: { value: [1], parent: { value: { n: 1 } } }, schema, access: "shared" } }, { actions: { inspect(context) {
      retainedRead = context.data.must("state").at(["value"]).asArray();
      assert.ok(retainedRead);
      assert.equal("set" in retainedRead, false);
      const checked = retainedRead.asArray()!;
      assert.equal("push" in checked.array, false);
      assert.equal("delete" in checked.at([0]), false);
    } } });
  try {
    assert.equal((await locus.dispatchAction({ type: "action", id: "inspect", name: "inspect" })).type, "ack");
    const raw = locus.data.must("state").at(["value"]);
    const checked = raw.asArray()!;
    const nested = checked.at([]);
    const parent = locus.data.must("state").at(["parent"]).asObject()!;
    const nestedObject = parent.at(["value"]).asObject()!;
    const watched: unknown[] = [];
    const stop = checked.watch(value => watched.push(value));
    await raw.replace({ n: 2 });
    assert.equal(checked.snap(), undefined);
    assert.equal(nested.snap(), undefined);
    assert.equal(retainedRead!.snap(), undefined);
    assert.equal(retainedRead!.at([]).snap(), undefined);
    assert.throws(() => checked.array.length(), /array/);
    await assert.rejects(checked.array.push(2), /array/);
    assert.equal(retainedRead!.asObject(), undefined);
    await locus.data.must("state").at(["parent"]).delete();
    assert.equal(nestedObject.snap(), undefined);
    assert.throws(() => nestedObject.object.keys(), /object/);
    await assert.rejects(nestedObject.object.setKey("n", 2), /object/);
    await raw.delete();
    assert.equal(checked.snap(), undefined);
    assert.equal(retainedRead!.snap(), undefined);
    await locus.data.must("state").at([]).asObject()!.object.setKey("value", [2]);
    assert.deepEqual(checked.snap(), [2]);
    assert.deepEqual(retainedRead!.snap(), [2]);
    assert.deepEqual(watched, [undefined, undefined, [2]]);
    stop();
    let expired: (() => void) | undefined;
    await locus.stage(writer => { const path = writer.data.must("state").at(["value"]).asArray(); expired = () => path.array.clear(); });
    assert.throws(() => expired!(), /expired/i);
  } finally { locus.dispose(); }
}

export async function echo_refinement_cases() {
  const locus = hsonLiveMap.locus.create({ "state": { data: { value: [1] }, access: "shared" } }, { local: [{ name: "ui", initializer: { data: { value: { n: 1 } } } }], authorizeProjection: () => ({ libraries: ["state", "ui"] }) });
  const session = await locus.session.create({ libraries: ["state", "ui"] });
  const binding = bind_locus_http(locus, { endpoint: "/evidence" });
  const transport = hsonLiveMap.echo.transport.http({ endpoint: "http://evidence.test/evidence",
    fetch: (input, init) => binding.handle(new Request(input, init), {}) });
  const echo = await hsonLiveMap.echo.create({ now: session.now(), credential: session.credential!, transport });
  try {
    const state = echo.data.must("state"), ui = echo.data.must("ui");
    if (String(state.mode) === "document" || state.source !== "authority-projected" || String(ui.mode) === "document" || ui.source !== "client-local") throw Error("Expected data ownership");
    const array = state.at(["value"]).asArray()!;
    assert.equal("push" in array.array, false);
    assert.equal("replace" in array, false);
    const watched: unknown[] = [];
    const stop = array.watch(value => watched.push(value));
    await locus.data.must("state").at(["value"]).replace({ n: 2 });
    await until(() => state.at(["value"]).kind() === "object");
    assert.equal(array.snap(), undefined);
    assert.equal(array.at([]).snap(), undefined);
    assert.throws(() => array.array.map(() => assert.fail("stale Echo callback")), /array/);
    await locus.data.must("state").at(["value"]).delete();
    await until(() => state.at(["value"]).kind() === "missing");
    assert.equal(array.snap(), undefined);
    assert.deepEqual(watched, [undefined, undefined]);
    stop();
    const object = ui.at(["value"]).asObject()!;
    ui.at(["value"]).replace([1]);
    assert.equal(object.snap(), undefined);
    assert.throws(() => object.object.setKey("n", 2), /object/);
  } finally { echo.dispose(); transport.dispose(); binding.dispose(); locus.dispose(); }
}

async function until(test: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (test()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail("Echo did not observe the committed transition");
}
