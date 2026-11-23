import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { Hson, hsonLiveMap, bind_locus_http } from "../../src/index.js";
import type { JsonValue } from "../../src/core/types.js";
import { internal_livemap_aggregate_authority } from "../../src/api/livemap/livemap.internal.js";
import { enumerate_livemap_issued_quids } from "../../src/api/livemap/livemap.identity-epoch.js";
import { locus_map_internal } from "../../src/internal/governor-maps.js";
import type { LocusHostedAggregatePersistedCommit } from "../../src/api/locus/locus.aggregate.persistence.js";
import type { ReadDataLocation } from "../../src/types/governor.types.js";
import type { LiveMapCommit, LiveMapStagedWriter } from "../../src/types/livemap.types.js";
import { deferred, MemoryCheckpointAdapter } from "../helpers/memory-checkpoint-adapter.mts";

function during_capture<T extends object>(value: T, run: () => void): T {
  return new Proxy(value, {
    ownKeys(target) {
      run();
      return Reflect.ownKeys(target);
    },
  });
}

async function retained_data_write_cases() {
  const schema = Hson.schema`<type "data" root <object <value <optional "any"> required "number">>>`;
  const definitions = { state: { json: { value: [{ n: 1 }], required: 1 }, schema } };
  const logicalMapId = "retained-data-writes";
  class PausedAppendAdapter extends MemoryCheckpointAdapter {
    pause: { entered: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> } | undefined;
    override async appendCommit(record: LocusHostedAggregatePersistedCommit): Promise<void> {
      const pause = this.pause;
      this.pause = undefined;
      if (pause !== undefined) {
        pause.entered.resolve();
        await pause.release.promise;
      }
      await super.appendCommit(record);
    }
  }
  const persistence = new PausedAppendAdapter();
  const local = hsonLiveMap.fromLibraries(definitions);
  const locus = await hsonLiveMap.locus.resume({ state: { ...definitions.state, access: "shared" } }, { logicalMapId, persistence });
  const hostedMap = locus_map_internal(locus);
  try {
    for (const authority of [local, locus]) {
      const governed = authority === locus;
      const map = governed ? hostedMap : local;
      const state = authority.data.must("state");
      const raw = state.at(["value"]);
      let commits = 0, notifications = 0;
      const stopCommits = authority.commits.observe(() => commits++);
      const stopWatch = state.at([]).watch(() => notifications++);
      const snapshot = () => ({
        rev: authority.rev, graph: map.capture(), commits, notifications,
        appendCount: persistence.appendCalls.length, durable: persistence.state(logicalMapId),
      });
      const rejects_atomically = async (write: () => unknown, reason: RegExp) => {
        const before = snapshot();
        await assert.rejects(async () => { await write(); }, reason);
        assert.deepEqual(snapshot(), before);
      };
      const only_inner_commits = (before: ReturnType<typeof snapshot>, expected: unknown) => {
        assert.deepEqual(state.snap(), { value: expected, required: 1 });
        assert.equal(authority.rev, before.rev + 1);
        assert.equal(commits, before.commits + 1);
        assert.equal(notifications, before.notifications + 1);
        assert.equal(persistence.appendCalls.length, before.appendCount + Number(governed));
        assert.equal(persistence.state(logicalMapId)?.commits.length, (before.durable?.commits.length ?? 0) + Number(governed));
      };
      try {
        const array = raw.asArray()!;
        const direct: typeof array.array = Reflect.get(raw, "array");
        const scalarChild = array.at([0, "n"]).asScalar()!;
        await array.array.push({ n: 2 });
        assert.deepEqual(raw.snap(), [{ n: 1 }, { n: 2 }]);
        const present = raw.present()!;
        await raw.replace({ n: 3 });
        for (const write of [() => array.set([]), () => array.replace([]), () => array.delete(),
          () => array.at([]).replace([]), () => scalarChild.set(4), () => direct.removeValue({ n: 3 })]) {
          await rejects_atomically(write, /array/);
        }
        await present.set({ extra: true });
        assert.deepEqual(raw.snap(), { n: 3, extra: true }, "Presence permits a shape change and ordinary object merge");
        const object = raw.asObject()!;
        await raw.replace(2);
        await rejects_atomically(() => object.set({ n: 4 }), /object/);
        await rejects_atomically(() => object.replace({ n: 4 }), /object/);
        await rejects_atomically(() => object.delete(), /object/);
        await rejects_atomically(() => object.object.setMany({}), /object/);
        const scalar = raw.asScalar()!;
        await raw.replace([{ n: 5 }]);
        await rejects_atomically(() => scalar.set(6), /scalar/);
        await rejects_atomically(() => scalar.replace(6), /scalar/);
        await rejects_atomically(() => scalar.delete(), /scalar/);
        await scalarChild.set(6);
        await array.array.push({ n: 7 });
        assert.deepEqual(raw.snap(), [{ n: 6 }, { n: 7 }], "Compatible replacement restores both retained handles");

        const nested = array.at([0]).asObject()!.at([]);
        await raw.replace([[]]);
        await rejects_atomically(() => nested.replace({ n: 9 }), /object/);
        await raw.delete();
        await rejects_atomically(() => present.replace([]), /present/);
        await state.at([]).set({ value: [{ n: 1 }] });

        if (governed) {
          const before = snapshot(), entered = deferred(), release = deferred();
          persistence.pause = { entered, release };
          const change = raw.replace({ queued: true });
          await entered.promise;
          const stale = assert.rejects(async () => { await array.set([]); }, /array/);
          try {
            assert.deepEqual(snapshot(), before, "The pending durable shape change is invisible while the later write queues");
          } finally { release.resolve(); }
          await change;
          await stale;
          only_inner_commits(before, { queued: true });

          const beforeRestore = snapshot();
          const restore = raw.replace([{ n: 11 }]);
          const useRestoredArray = array.array.push({ n: 12 });
          await Promise.all([restore, useRestoredArray]);
          assert.deepEqual(raw.snap(), [{ n: 11 }, { n: 12 }]);
          assert.equal(authority.rev, beforeRestore.rev + 2);
          assert.equal(commits, beforeRestore.commits + 2);
          assert.equal(notifications, beforeRestore.notifications + 2);
          assert.equal(persistence.appendCalls.length, beforeRestore.appendCount + 2);
        }
        for (const collection of [array.array, direct]) {
          await raw.replace([{ n: 1 }]);
          const before = snapshot();
          let inner: unknown;
          await assert.rejects(async () => {
            await collection.removeValue(during_capture({ n: 1 }, () => { inner = raw.replace({ inner: "array" }); }));
          }, /array/);
          assert.ok(inner);
          await inner;
          only_inner_commits(before, { inner: "array" });
        }

        const beforeObjectCapture = snapshot();
        const directObject: typeof object.object = Reflect.get(state.at(["value"]), "object");
        let objectInner: unknown;
        await assert.rejects(async () => {
          await directObject.setMany(during_capture({}, () => { objectInner = raw.replace(8); }));
        }, /object/);
        assert.ok(objectInner);
        await objectInner;
        only_inner_commits(beforeObjectCapture, 8);

        const stage = (write: (writer: LiveMapStagedWriter<typeof local, void>) => void) =>
          governed ? locus.stage(write) : local.batch(write);
        await raw.replace([{ n: 1 }]);
        const beforeGenericCapture = snapshot();
        let genericInner: unknown;
        await assert.rejects(async () => {
          await array.replace(during_capture([{ n: 2 }], () => { genericInner = raw.replace({ inner: "replace" }); }));
        }, /array/);
        assert.ok(genericInner);
        await genericInner;
        only_inner_commits(beforeGenericCapture, { inner: "replace" });
        await raw.replace([{ n: 1 }]);
        await rejects_atomically(() => stage(writer => {
          const staged = writer.data.must("state").at(["value"]);
          const retained = staged.asArray();
          retained.set(during_capture([{ n: 2 }], () => { staged.replace({ inner: "stage" }); }));
        }), /array/);
        await rejects_atomically(() => stage(writer => {
          writer.data.must("state").at(["value"]).asArray().array.push({ n: 2 });
          Reflect.apply(writer.data.must("state").at(["required"]).set, undefined, ["invalid"]);
        }), /schema/i);

        if (!governed) {
          const localRaw = local.data.must("state").at(["value"]);
          const localArray = localRaw.asArray()!;
          const before = snapshot();
          assert.throws(() => localArray.update(previous => {
            assert.deepEqual(previous, [{ n: 1 }]);
            localRaw.replace({ inner: "update" });
            return [];
          }), /array/);
          only_inner_commits(before, { inner: "update" });
          await rejects_atomically(() => localArray.update(() => assert.fail("An invalid handle invoked its updater")), /refinement/);
        }
      } finally { stopWatch(); stopCommits(); }
    }
  } finally { locus.dispose(); }
  const recovered = await hsonLiveMap.locus.resume({ state: { ...definitions.state, access: "shared" } }, { logicalMapId, persistence });
  try {
    assert.deepEqual(recovered.data.must("state").snap(), { value: [{ n: 1 }], required: 1 });
    assert.equal(recovered.rev, persistence.appendCalls.length);
  } finally { recovered.dispose(); }

  const live = { json: { value: [1] } };
  const retiredMap = hsonLiveMap.fromLibraries({ ...definitions, live });
  const retired = retiredMap.data.must("state").at(["value"]).asArray()!;
  const aggregate = internal_livemap_aggregate_authority(retiredMap);
  aggregate.restorePortableLibraries(hsonLiveMap.fromLibraries({ live }).capture());
  const before = retiredMap.capture();
  let commits = 0, notifications = 0;
  const stopCommits = retiredMap.commits.observe(() => commits++);
  const stopWatch = retiredMap.data.must("live").at([]).watch(() => notifications++);
  try {
    for (const write of [() => retired.set([]), () => retired.replace([]), () => retired.delete(), () => retired.array.push({ n: 2 })]) {
      assert.throws(write, /another map authority/i);
      assert.deepEqual(retiredMap.capture(), before);
      assert.equal(commits, 0);
      assert.equal(notifications, 0);
    }
  } finally { stopWatch(); stopCommits(); }
}

async function reentrant_collection_planning_cases() {
  const schema = Hson.schema`<type "data" root <object <value "any" numbers <array "number">>>>`;
  const item = (n: number) => ({ n });
  const one = item(1), two = item(2), three = item(3), four = item(4);
  const definition = { json: { value: [one], numbers: [1] }, schema };
  const hosted = { state: { ...definition, access: "shared" as const } };
  const persistence = new MemoryCheckpointAdapter();
  const options = { logicalMapId: "collection-capture", persistence };
  const local = hsonLiveMap.fromLibraries({ state: definition });
  const locus = await hsonLiveMap.locus.resume(hosted, options);
  type Operation = readonly [method: string, ...args: unknown[]];
  type Scenario = Readonly<{
    name: string; seed: JsonValue; collection: "array" | "object"; inner: Operation;
    outer: Operation; capture: object; final: JsonValue; changes: number;
    reject?: RegExp; path?: "numbers";
  }>;
  const scenarios: readonly Scenario[] = [
    { name: "removeAll keeps the reentrant append", seed: [one], collection: "array", inner: ["push", two],
      outer: ["removeAll"], capture: one, final: [two], changes: 2 },
    { name: "negative splice uses the new last index", seed: [one], collection: "array", inner: ["push", two],
      outer: ["splice", -1, 1], capture: three, final: [one, three], changes: 2 },
    { name: "positive splice no longer clamps at the old length", seed: [one], collection: "array", inner: ["pushMany", [two, three]],
      outer: ["splice", 2, 1], capture: four, final: [one, two, four], changes: 2 },
    { name: "insert index becomes valid after growth", seed: [one], collection: "array", inner: ["push", two],
      outer: ["insert", 2], capture: three, final: [one, two, three], changes: 2 },
    { name: "replace index becomes invalid after shrink", seed: [one, two], collection: "array", inner: ["pop"],
      outer: ["replace", 1], capture: three, final: [one], changes: 1, reject: /index/i },
    { name: "negative replace addresses the new last item", seed: [one], collection: "array", inner: ["push", two],
      outer: ["replace", -1], capture: three, final: [one, three], changes: 2 },
    { name: "removeValue matches a freshly added item", seed: [one], collection: "array", inner: ["push", two],
      outer: ["removeValue"], capture: two, final: [one], changes: 2 },
    { name: "removeAll with no matching item stays a no-op", seed: [one], collection: "array", inner: ["push", two],
      outer: ["removeAll"], capture: three, final: [one, two], changes: 1 },
    { name: "push appends after the inner append", seed: [one], collection: "array", inner: ["push", two],
      outer: ["push"], capture: three, final: [one, two, three], changes: 2 },
    { name: "deleteMany removes a key added during key-list capture", seed: { a: 1 }, collection: "object", inner: ["setKey", "b", 2],
      outer: ["deleteMany"], capture: ["b"], final: { a: 1 }, changes: 2 },
    { name: "setMany keeps the inner member and exact order", seed: { a: 1 }, collection: "object", inner: ["setKey", "middle", 2],
      outer: ["setMany"], capture: { tail: -0 }, final: { a: 1, middle: 2, tail: -0 }, changes: 2 },
    { name: "setKey rejects after an incompatible replacement", seed: { a: 1 }, collection: "object", inner: ["replace", [two]],
      outer: ["setKey", "b"], capture: three, final: [two], changes: 1, reject: /object/ },
    { name: "Schema rejects the outer array write only", seed: [1], collection: "array", inner: ["push", 2],
      outer: ["push"], capture: three, final: [1, 2], changes: 1, reject: /schema/i, path: "numbers" },
  ];
  const call = (receiver: object, [method, ...args]: Operation) => Reflect.apply(Reflect.get(receiver, method), undefined, args);
  const comparison: unknown[] = [];
  const directMap = locus_map_internal(locus);
  try {
    for (const [mode, authority, staged] of [
      ["local", local, false], ["locus", locus, false], ["batch", local, true], ["stage", locus, true],
    ] as const) {
      const governed = authority === locus;
      const state = authority.data.must("state");
      const map = governed ? directMap : local;
      const stage = (write: (writer: LiveMapStagedWriter<typeof local, void>) => void) => governed ? locus.stage(write) : local.batch(write);
      for (const [index, scenario] of scenarios.entries()) {
        const { name, seed, collection, inner, outer, capture, final, changes, reject, path = "value" } = scenario;
        await state.at([path]).replace(seed);
        const raw = state.at([path]);
        const before = { graph: map.capture(), rev: authority.rev, append: persistence.appendCalls.length };
        const operations: LiveMapCommit["operations"][] = [], watched: unknown[] = [];
        let feeds = 0, reflected = 0, pending: unknown;
        const stopCommit = authority.commits.observe(commit => operations.push(commit.operations));
        const stopWatch = raw.watch(value => watched.push(value));
        const stopFeed = map.data.must("state").at([path]).feed(() => feeds++);
        const run = (location: object) => {
          const refined = index % 2 === 0 ? call(location, [collection === "array" ? "asArray" : "asObject"]) : location;
          assert.ok(refined !== null && typeof refined === "object", name);
          const input = during_capture(capture, () => {
            reflected++;
            const subject = collection === "object" && inner[0] === "replace" ? location : Reflect.get(location, collection);
            pending = call(subject, inner);
          });
          return call(Reflect.get(refined, collection), [...outer, input]);
        };
        try {
          const write = async () => staged ? stage(w => { run(w.data.must("state").at([path])); }) : run(raw);
          if (reject === undefined) await write();
          else await assert.rejects(write, reject, name);
          await pending;
          assert.equal(reflected, 1, name);
          assert.deepEqual(raw.snap(), staged && reject !== undefined ? seed : final, name);
          const expectedTransitions = staged ? Number(reject === undefined) : changes;
          assert.equal(authority.rev, before.rev + expectedTransitions, name);
          assert.equal(operations.length, expectedTransitions, name);
          assert.equal(watched.length, expectedTransitions, name);
          assert.equal(feeds, expectedTransitions, name);
          assert.equal(persistence.appendCalls.length, before.append + Number(governed) * expectedTransitions, name);
          if (expectedTransitions === 0) assert.deepEqual(map.capture(), before.graph, name);
          else assert.deepEqual(watched.at(-1), final, name);
          const trace = { canonical: raw.hson(), operations: operations.flat() };
          if (mode === "local") comparison.push(trace);
          else if (!staged || reject === undefined) assert.deepEqual(trace, comparison[index], name);
        } finally { stopWatch(); stopFeed(); stopCommit(); }
      }
    }
  } finally { locus.dispose(); }
  const recovered = await hsonLiveMap.locus.resume(hosted, options);
  try {
    assert.deepEqual(recovered.data.must("state").snap(), { value: { a: 1 }, numbers: [1] });
    assert.equal(recovered.rev, persistence.appendCalls.length);
    assert.equal(recovered.rev, persistence.state(options.logicalMapId)?.commits.length);
  } finally { recovered.dispose(); }
}

async function delete_many_key_list_cases() {
  const initial = { keep: -0, drop: 1, tail: 2 };
  const definition = { json: { value: initial, items: [1, 2] }, schema: Hson.schema`<type "data" root <object <value "any" items <array "number">>>>` };
  const hosted = { app: { ...definition, access: "shared" as const } };
  const persistence = new MemoryCheckpointAdapter();
  const options = { logicalMapId: "delete-many-key-lists", persistence };
  const local = hsonLiveMap.fromLibraries({ app: definition });
  const locus = await hsonLiveMap.locus.resume(hosted, options);
  const directMap = locus_map_internal(locus);
  type DeleteMany = (keys: readonly string[]) => unknown;
  type Replace = (value: JsonValue) => unknown;
  try {
    for (const [authority, staged] of [[local, false], [local, true], [locus, false], [locus, true]] as const) {
      const governed = authority === locus;
      const map = governed ? directMap : local;
      const library = authority.data.must("app");
      const raw = library.at(["value"]);
      const run = async (mutation: (deleteMany: DeleteMany, replace: Replace) => unknown) => {
        if (!staged) {
          await mutation(raw.asObject()!.object.deleteMany, value => raw.replace(value));
          return;
        }
        const write = (writer: LiveMapStagedWriter<typeof local, void>) => {
          const location = writer.data.must("app").at(["value"]);
          mutation(location.asObject().object.deleteMany, location.replace);
        };
        if (governed) await locus.stage(write);
        else local.batch(write);
      };
      const commits: LiveMapCommit["operations"][] = [];
      let watches = 0, feeds = 0;
      const stops = [authority.commits.observe(commit => commits.push(commit.operations)),
        raw.watch(() => watches++), map.data.must("app").at(["value"]).feed(() => feeds++)];
      const measure = () => ({ rev: authority.rev, commits: commits.length, watches, feeds,
        appends: persistence.appendCalls.length, durable: persistence.state(options.logicalMapId)?.commits.length });
      const check = async (mutate: () => unknown, expected: JsonValue, changes: number, reject?: RegExp) => {
        await raw.replace(initial);
        const before = measure(), graph = map.capture();
        if (reject === undefined) await mutate();
        else await assert.rejects(async () => { await mutate(); }, reject);
        assert.deepEqual(raw.snap(), expected);
        const durableChanges = governed ? changes : 0;
        assert.deepEqual(measure(), {
          rev: before.rev + changes, commits: before.commits + changes, watches: before.watches + changes,
          feeds: before.feeds + changes, appends: before.appends + durableChanges, durable: before.durable! + durableChanges,
        });
        if (changes === 0) assert.deepEqual(map.capture(), graph);
      };
      const remove = (keys: readonly string[]) => run(deleteMany => deleteMany(keys));
      try {
        await check(() => remove(["drop"]), { keep: -0, tail: 2 }, 1);
        const foreign: readonly string[] = runInNewContext('["tail", "drop", "tail"]');
        await check(() => remove(foreign), { keep: -0 }, 1);
        assert.deepEqual(commits.at(-1), [
          { library: "app", operation: { kind: "delete", path: ["value", "drop"], prev: 1, next: undefined } },
          { library: "app", operation: { kind: "delete", path: ["value", "tail"], prev: 2, next: undefined } },
        ]);
        const decorated = Object.defineProperties(["drop"], {
          0: { enumerable: false },
          map: { get: () => assert.fail("Read key-list map") },
          [Symbol.iterator]: { get: () => assert.fail("Read key-list iterator") },
        });
        await check(() => remove(decorated), { keep: -0, tail: 2 }, 1);
        for (const keys of [[], ["missing", "missing"]]) await check(() => remove(keys), initial, 0);

        const sparse = new Array<string>(2);
        sparse[1] = "drop";
        await check(() => remove(sparse), initial, 0, /dense|missing index/);
        const accessor = Object.defineProperty(["drop"], "0", { get: () => assert.fail("Invoked key-list accessor") });
        await check(() => remove(accessor), initial, 0, /own data property/);
        const revoked = Proxy.revocable(["drop"], {});
        revoked.revoke();
        await check(() => remove(revoked.proxy), initial, 0, /revoked/);
        for (const invalid of ["drop", Hson.data.from(["drop"]), ["drop", 2], ["drop", undefined]]) {
          await check(() => run(deleteMany => Reflect.apply(deleteMany, undefined, [invalid])), initial, 0, /must be an array|must be a string/);
        }

        let pending: unknown, captured = 0;
        const during_index_capture = (effect: () => unknown) => new Proxy(["drop"], {
          get: () => assert.fail("Read key-list property instead of descriptor"),
          getOwnPropertyDescriptor(target, key) {
            if (key === "0") { captured++; pending = effect(); }
            return Reflect.getOwnPropertyDescriptor(target, key);
          },
        });
        await check(async () => {
          await run((deleteMany, replace) => deleteMany(during_index_capture(() => replace({ head: 3, drop: 4, keep: -0 }))));
          await pending;
        }, { head: 3, keep: -0 }, staged ? 1 : 2);
        assert.equal(captured, 1);
        await check(async () => {
          try {
            await run((deleteMany, replace) => deleteMany(during_index_capture(() => replace(["new shape"]))));
          } finally { await pending; }
        }, staged ? initial : ["new shape"], staged ? 0 : 1, /expected object/);
        assert.equal(captured, 2);

        const source = ["drop"];
        const detach = Proxy.revocable(source, { ownKeys(target) { captured++; return Reflect.ownKeys(target); } });
        await check(() => run(deleteMany => {
          const result = deleteMany(detach.proxy);
          detach.revoke();
          source[0] = "tail";
          return result;
        }), { keep: -0, tail: 2 }, 1);
        assert.equal(captured, 3);

        await check(() => {
          if (!staged) return Reflect.apply(raw.asObject()!.object.setKey, undefined, [Hson.data.from("wrapped"), 3]);
          const write = (writer: LiveMapStagedWriter<typeof local, void>) => {
            const location = writer.data.must("app").at(["value"]).asObject();
            Reflect.apply(location.object.setKey, undefined, [Hson.data.from("wrapped"), 3]);
          };
          return governed ? locus.stage(write) : local.batch(write);
        }, initial, 0, /setKey.*must be a string/);
        await check(() => {
          if (!staged) return Reflect.apply(library.at(["items"]).asArray()!.array.splice, undefined, [Hson.data.from(0), 1]);
          const write = (writer: LiveMapStagedWriter<typeof local, void>) => {
            Reflect.apply(writer.data.must("app").at(["items"]).asArray().array.splice, undefined, [Hson.data.from(0), 1]);
          };
          return governed ? locus.stage(write) : local.batch(write);
        }, initial, 0, /splice.*must be a number/);
      } finally { stops.forEach(stop => stop()); }
    }
  } finally { locus.dispose(); }
  const recovered = await hsonLiveMap.locus.resume(hosted, options);
  try {
    assert.deepEqual(recovered.data.must("app").snap(), { value: initial, items: [1, 2] });
    assert.equal(recovered.rev, persistence.appendCalls.length);
    assert.equal(recovered.rev, persistence.state(options.logicalMapId)?.commits.length);
  } finally { recovered.dispose(); }
}

export async function library_evidence_cases() {
  const earlier = Hson.schema`<type "data" root <object <earlier "number">>>`;
  const later = Hson.schema`<type "data" root <object <later "string">>>`;
  const definitions: { seed: { json: number }; maybe?: { json: { earlier: number }; schema: typeof earlier } } = { seed: { json: 1 } };
  const optionalMap = hsonLiveMap.fromLibraries(definitions);
  const receipt = optionalMap.addLibraries({ maybe: { json: { later: "present" }, schema: later } });
  assert.equal(receipt.libraries.maybe.schema.get(), later);
  assert.deepEqual(receipt.libraries.maybe.snap(), { later: "present" });
  const groups: { maybe?: { json: { earlier: number }; schema: typeof earlier } } = {};
  const optionalLocus = hsonLiveMap.locus.create(groups);
  try {
    await optionalLocus.admit({ "maybe": { json: { later: "present" }, schema: later, access: "shared" } });
    assert.equal(optionalLocus.data.must("maybe", later).schema.get(), later);
  } finally { optionalLocus.dispose(); }

  const map = hsonLiveMap.fromLibraries({ state: { json: { value: [1], parent: { value: { count: 1 } } } }, array: { json: [1] } });
  const state = map.data.must("state");
  const aggregate = internal_livemap_aggregate_authority(map);
  const before = map.capture(), issued = aggregate.identityEpoch().issued(), issuedBefore = enumerate_livemap_issued_quids(issued);
  const value = state.at(["value"]), array = value.asArray()!;
  const child = array.at([]);
  const parent = state.at(["parent"]).asObject()!;
  const object = parent.at(["value"]).asObject()!;
  const count = object.at(["count"]);
  array.snap(); array.hson(); array.array.map(x => x); object.object.keys(); count.snap();
  assert.deepEqual(map.capture(), before);
  assert.equal(aggregate.identityEpoch().issued(), issued);
  assert.deepEqual(enumerate_livemap_issued_quids(aggregate.identityEpoch().issued()), issuedBefore);
  const watched: unknown[] = [], descendants: unknown[] = [];
  const stop = array.watch(next => watched.push(next));
  const stopChild = child.watch(next => descendants.push(next));
  value.replace({ count: 2 });
  assert.equal(array.snap(), undefined);
  assert.equal(array.hson(), undefined);
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

  const staleMap = hsonLiveMap.fromLibraries({ old: { json: [1] } });
  const stale = staleMap.data.must("old").at([]).asArray()!;
  internal_livemap_aggregate_authority(staleMap).restorePortableLibraries(hsonLiveMap.fromLibraries({ next: { json: [2] } }).capture());
  assert.throws(() => stale.snap(), /another map authority/i);
  assert.throws(() => stale.array.push(3), /another map authority/i);

  const schema = Hson.schema`<type "data" root <object <value <optional "any"> parent <optional <object <value "any">>>>>>`;
  let retainedRead: ReturnType<ReadDataLocation<unknown>["asArray"]>;
  const locus = hsonLiveMap.locus.create({ "state": { json: { value: [1], parent: { value: { n: 1 } } }, schema, access: "shared" } }, { actions: { inspect(context) {
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
  await retained_data_write_cases();
  await reentrant_collection_planning_cases();
  await delete_many_key_list_cases();
}

export async function echo_refinement_cases() {
  const locus = hsonLiveMap.locus.create({ "state": { json: { value: [1] }, access: "shared" } }, { local: [{ name: "ui", initializer: { json: { value: { n: 1 } } } }], authorizeProjection: () => ({ libraries: ["state", "ui"] }) });
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
    const local = ui.at(["value"]), object = local.asObject()!;
    local.replace([1]);
    assert.equal(object.snap(), undefined);
    let commits = 0, notifications = 0;
    const stopFeed = local.feed(() => commits++);
    const stopWatch = local.watch(() => notifications++);
    try {
      const before = { rev: ui.rev, hson: ui.hson(), state: ui.snap() };
      for (const write of [() => object.set({ n: 2 }), () => object.replace({ n: 2 }), () => object.delete(),
        () => object.at(["n"]).set(2), () => object.object.setKey("n", 2),
        () => object.update(() => assert.fail("Echo invoked a stale updater"))]) {
        assert.throws(write, /object|refinement/);
        assert.deepEqual({ rev: ui.rev, hson: ui.hson(), state: ui.snap() }, before);
        assert.equal(commits, 0);
        assert.equal(notifications, 0);
      }
      local.replace({ n: 3 });
      object.set({ n: 4 });
      assert.deepEqual(local.snap(), { n: 4 });
      assert.equal(commits, 2);
      assert.equal(notifications, 2);

      local.replace([{ n: 1 }]);
      const localArray = local.asArray()!;
      let captures = 0;
      localArray.array.removeAll(during_capture({ n: 1 }, () => {
        captures++;
        localArray.array.push({ n: 2 });
      }));
      assert.equal(captures, 1);
      assert.deepEqual(local.snap(), [{ n: 2 }]);
      assert.equal(commits, 5);
      assert.equal(notifications, 5);
    } finally { stopFeed(); stopWatch(); }
  } finally { echo.dispose(); transport.dispose(); binding.dispose(); locus.dispose(); }
}

async function until(test: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (test()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail("Echo did not observe the committed transition");
}
