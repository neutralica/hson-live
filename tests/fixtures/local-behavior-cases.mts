import assert from "node:assert/strict";
import { ANY_DATA, ANY_DOCUMENT, Hson, HsonDataValue, hsonLiveMap, type LocalBehaviorResult } from "../../src/index.ts";
import { install_libraries_snapshot } from "../../src/api/livemap/index.ts";

function behaviorError(result: LocalBehaviorResult) {
  assert.equal(result.ok, false);
  return result.error;
}

/** Run the same eventless registry contract in Node and in a Worker. */
export async function local_behavior_cases() {
  const map = hsonLiveMap.fromLibraries({ state: { json: { count: 0 } }, page: { document: "<main/>" } });
  const snapshot = map.capture(), cut = map.cut({ html: "page" });
  const { behaviors } = map;
  let commits = 0;
  const stop = map.commits.observe(() => { commits++; });
  try {
    const ids: string[] = [];
    const echoInput = (_ctx: unknown, data: HsonDataValue | undefined) => data;
    behaviors.define("bare", (ctx, data, message) => {
      assert.deepEqual(ctx, { map });
      assert.equal(message.name, "bare");
      ids.push(message.id);
      return data;
    });
    const first = behaviors.trigger("bare");
    assert.equal(ids.length, 1, "the handler starts in the calling turn");
    assert.deepEqual(await first, { ok: true });
    const second = await behaviors.trigger("bare", "123");
    assert.ok(second.ok && second.result?.scalar() === "123");
    assert.equal(new Set(ids).size, 2);

    const schema = Hson.schema`<type "data" content <'10' "number" '2' "number">>`;
    const exact = Hson.data.fromSource('{"10":-0,"2":2}');
    const options = { input: { schema } };
    behaviors.define("schema", echoInput, options);
    options.input.schema = ANY_DATA;
    assert.deepEqual(await behaviors.trigger("schema"), { ok: true });
    assert.equal((await behaviors.trigger("schema", null)).ok, false);
    assert.equal((await behaviors.trigger("schema", { "10": "wrong", "2": 2 })).ok, false);
    const materialize = HsonDataValue.prototype.materialize;
    try {
      HsonDataValue.prototype.materialize = () => { throw new Error("Schema must evaluate exact Data."); };
      const result = await behaviors.trigger("schema", exact);
      assert.ok(result.ok && result.result === exact);
      assert.deepEqual(result.result.entries()?.map(([name]) => name), ["10", "2"]);
      assert.ok(Object.is(result.result.entries()?.[0]?.[1].scalar(), -0));
    } finally { HsonDataValue.prototype.materialize = materialize; }

    const presence = { input: { required: true } };
    behaviors.define("presence", echoInput, presence);
    behaviors.define("required-schema", echoInput, { input: { required: true, schema } });
    presence.input.required = false;
    assert.match(behaviorError(await behaviors.trigger("presence")).message, /requires input/);
    assert.match(behaviorError(await behaviors.trigger("required-schema")).message, /requires input/);
    const explicitNull = await behaviors.trigger("presence", null);
    assert.ok(explicitNull.ok && explicitNull.result?.scalar() === null);

    for (const args of [
      ["", echoInput], [3, echoInput], ["invalid", {}],
      ["invalid", echoInput, { unexpected: true }],
      ["invalid", echoInput, { input: null }],
      ["invalid", echoInput, { input: { required: "yes" } }],
      ["invalid", echoInput, { input: { schema: {} } }],
      ["invalid", echoInput, { input: { schema: ANY_DOCUMENT } }],
    ]) assert.throws(() => Reflect.apply(behaviors.define, undefined, args), TypeError);
    assert.match(behaviorError(await behaviors.trigger("invalid")).message, /Unknown local behavior/);
    behaviors.define("invalid", echoInput);
    assert.throws(() => behaviors.define("invalid", echoInput), /already defined/);
    assert.throws(() => behaviors.define("invalid", () => "replacement"), /already defined/);
    const reentrantOptions = { get input() {
      behaviors.define("reentrant", () => "first");
      return undefined;
    } };
    assert.throws(() => behaviors.define("reentrant", () => "second", reentrantOptions), /already defined/);
    const reentrant = await behaviors.trigger("reentrant");
    assert.ok(reentrant.ok && reentrant.result?.scalar() === "first");

    let finish: (() => void) | undefined;
    behaviors.define("async", async (_ctx, data) => {
      await new Promise<void>(resolve => { finish = resolve; });
      return { input: data?.materialize() ?? null, computed: [-0, true] };
    });
    const ordinary = { count: 2 };
    const pending = behaviors.trigger("async", ordinary);
    ordinary.count = 3;
    assert.ok(finish);
    assert.deepEqual(await behaviors.trigger("bare"), { ok: true });
    finish();
    const asyncResult = await pending;
    assert.ok(asyncResult.ok);
    assert.deepEqual(asyncResult.result?.materialize(), { input: { count: 2 }, computed: [-0, true] });

    const mutable = { value: Infinity };
    behaviors.define("mutable-result", () => {
      queueMicrotask(() => { mutable.value = 1; });
      return mutable;
    });
    assert.match(behaviorError(await behaviors.trigger("mutable-result")).message, /number must be finite/);
    assert.equal(mutable.value, 1);

    const thrown = new Error("synchronous failure");
    const rejected = new Error("asynchronous failure");
    behaviors.define("throws", () => { throw thrown; });
    behaviors.define("rejects", async () => { throw rejected; });
    behaviors.define("bad-result", () => ({ value: Infinity }));
    behaviors.define("bad-async-result", async () => ({ value: Infinity }));
    assert.equal(behaviorError(await behaviors.trigger("throws")).cause, thrown);
    assert.deepEqual(behaviorError(await behaviors.trigger("rejects")), { message: rejected.message, cause: rejected });
    behaviorError(await behaviors.trigger("bad-result"));
    behaviorError(await behaviors.trigger("bad-async-result"));

    const native = Promise.resolve(null);
    Object.defineProperty(native, "then", { get() { throw new Error("Native await must not read this property."); } });
    behaviors.define("native-promise", () => native);
    const nativeResult = await behaviors.trigger("native-promise");
    assert.ok(nativeResult.ok && nativeResult.result?.scalar() === null);

    let reads = 0, calls = 0;
    const thenable = { get then() {
      reads++;
      return function (this: unknown, resolve: (value: number) => void) {
        assert.equal(this, thenable);
        calls++;
        resolve(-0);
      };
    } };
    Reflect.apply(behaviors.define, undefined, ["thenable", () => thenable]);
    const assimilated = behaviors.trigger("thenable");
    assert.equal(reads, 1);
    assert.equal(calls, 0);
    const thenableResult = await assimilated;
    assert.ok(thenableResult.ok && Object.is(thenableResult.result?.scalar(), -0));
    assert.equal(reads, 1);
    assert.equal(calls, 1);

    const getterFailure = new Error("then getter failed");
    Reflect.apply(behaviors.define, undefined, ["throwing-then", () => ({ get then() { throw getterFailure; } })]);
    assert.equal(behaviorError(await behaviors.trigger("throwing-then")).cause, getterFailure);
    behaviorError(await Reflect.apply(behaviors.trigger, undefined, ["bare", new Date()]));
    assert.equal(ids.length, 3, "invalid input never reaches the handler");

    assert.equal(map.behaviors, behaviors);
    assert.deepEqual(map.capture(), snapshot);
    assert.deepEqual(map.cut({ html: "page" }), cut);
    assert.equal(map.rev, snapshot.revision);
    assert.equal(commits, 0);
    map.restore(snapshot);
    assert.equal(map.behaviors, behaviors);
    assert.deepEqual(await behaviors.trigger("bare"), { ok: true });

    const { map: restored } = install_libraries_snapshot(snapshot);
    assert.notEqual(restored.behaviors, behaviors);
    assert.match(behaviorError(await restored.behaviors.trigger("bare")).message, /Unknown local behavior/);
    restored.behaviors.define("bare", () => true);
    const independent = await restored.behaviors.trigger("bare");
    assert.ok(independent.ok && independent.result?.scalar() === true);
    assert.deepEqual(await behaviors.trigger("bare"), { ok: true });
  } finally { stop(); }
}
