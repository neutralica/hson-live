import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
// @hson-live-external-test

import assert from "node:assert/strict";
import * as rootExports from "../src/index.ts";
import { hson } from "../src/hson.ts";
import * as liveMapExports from "../src/api/livemap/index.ts";
import { bind_livetree_text } from "../src/api/livemap/livemap.bridge-bindings.ts";
import { disposables_count_for_owner } from "../src/api/livetree/managers/lifecycle-registry.ts";
import { acquire_projected_identity } from "./helpers/livemap-identity-internal.mts";

let checks = 0;

function check(name: string, fn: () => void): void {
  fn();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

check("path handles expose no pseudo-QUID surface or public helpers", () => {
  const map = hson.liveMap.fromJson({ value: 1 });
  const handle = map.at(["value"]);

  assert.equal("quid" in handle, false);
  assert.equal(Reflect.ownKeys(handle).includes("quid"), false);
  for (const name of [
    "debug_livemap_quids",
    "drop_livemap_quid",
    "ensure_livemap_quid",
    "get_livemap_owner",
    "get_livemap_quid",
    "reindex_livemap_quid",
    "remint_livemap_quid",
  ]) {
    assert.equal(name in rootExports, false);
    assert.equal(name in liveMapExports, false);
  }
  assert.equal(JSON.stringify({ handle: Reflect.ownKeys(handle), root: map.root() }).includes("lmq-"), false);
});

check("one map interns one handle per canonical path", () => {
  const map = hson.liveMap.fromJson({ user: { name: "Ada" } });
  const mutablePath: Array<string | number> = ["user", "name"];
  const first = map.at(mutablePath);
  mutablePath.push("ignored");

  assert.equal(first, map.at(["user", "name"]));
  assert.equal(first.at([]), first);
  assert.deepEqual(first.path(), ["user", "name"]);
});

check("different paths do not alias", () => {
  const map = hson.liveMap.fromJson({ left: 1, right: 2 });
  assert.notEqual(map.at(["left"]), map.at(["right"]));
  assert.deepEqual(map.at(["left"]).path(), ["left"]);
  assert.deepEqual(map.at(["right"]).path(), ["right"]);
});

check("different maps never share path handles", () => {
  const left = hson.liveMap.fromJson({ value: 1 });
  const right = hson.liveMap.fromJson({ value: 1 });
  assert.notEqual(left.at(["value"]), right.at(["value"]));
});

check("canonical path parts retain their existing string and index distinction", () => {
  const map = hson.liveMap.fromJson({ "0": "object key", items: ["array item"] });
  assert.equal(map.at(["0"]), map.at(["0"]));
  assert.notEqual(map.at(["0"]), map.at([0]));
  assert.equal(map.at(["items", 0]).snap(), "array item");
});

check("cached handles remain positional across ordinary mutations", () => {
  const map = hson.liveMap.fromJson({ items: ["first", "second"] });
  const first = map.at(["items", 0]);

  map.set(["items", 0], "changed");
  assert.equal(first.snap(), "changed");
  map.replace(["items"], ["replacement"]);
  assert.equal(first.snap(), "replacement");
  assert.equal(first, map.at(["items", 0]));
});

check("proxy exits reuse the owning map path-handle cache", () => {
  const map = hson.liveMap.fromJson({ user: { name: "Ada" } });
  const proxy = map.proxy(["user"]);
  const nameProxy = Reflect.get(proxy, "name");

  assert.equal(nameProxy.$_, map.at(["user", "name"]));
  assert.equal(nameProxy.$_, Reflect.get(proxy, "name").$_);
  nameProxy.$_.set("Grace");
  assert.equal(map.snap(["user", "name"]), "Grace");
});

check("path-handle creation never mints canonical node identity", () => {
  const map = hson.liveMap.fromJson({ nested: { value: 1 } });
  void map.at([]);
  void map.at(["nested"]);
  const proxyLocation = Reflect.get(map.proxy(["nested"]), "value").$_;
  const dispose = proxyLocation.watch(() => undefined);

  assert.equal(JSON.stringify(map.root()).includes("data-_quid"), false);
  assert.equal(JSON.stringify(map.root()).includes('"quid"'), false);
  assert.equal(map.rev, 0);
  assert.equal(proxyLocation, map.at(["nested", "value"]));
  dispose();
});

check("arbitrary string quid targets receive explicit bridge disposal only", () => {
  const map = hson.liveMap.fromJson({ value: "initial" });
  let text = "";
  const target = {
    quid: "not-an-owner",
    text: {
      get: () => text,
      set: (value: string) => { text = value; },
      overwrite: (value: string) => { text = value; },
    },
  };

  const binding = bind_livetree_text(map.at(["value"]), target);
  assert.equal(text, "initial");
  assert.equal(disposables_count_for_owner(target.quid), 0);
  map.set(["value"], "updated");
  assert.equal(text, "updated");
  binding.dispose();
  map.set(["value"], "after-dispose");
  assert.equal(text, "updated");
});

check("actual LiveTree bridge targets retain canonical lifecycle ownership", () => {
  const map = hson.liveMap.fromJson({ value: "initial" });
  const tree = hson.liveTree.fromHson("<span/>");
  const before = disposables_count_for_owner(tree.quid);

  const binding = bind_livetree_text(map.at(["value"]), tree);
  assert.equal(tree.text.get(), "initial");
  assert.equal(disposables_count_for_owner(tree.quid), before + 1);
  map.set(["value"], "updated");
  assert.equal(tree.text.get(), "updated");
  binding.dispose();
  assert.equal(disposables_count_for_owner(tree.quid), before);
  map.set(["value"], "after-dispose");
  assert.equal(tree.text.get(), "updated");
});

check("watch is future-only, value-filtered, detached, and disposable", () => {
  const map = hson.liveMap.fromJson({ value: { label: "initial" }, sibling: 0 });
  const location = map.at(["value"]);
  const seen: unknown[] = [];
  const isolatedSeen: unknown[] = [];
  const dispose = location.watch((next) => {
    seen.push(structuredClone(next));
    if (typeof next === "object" && next !== null && !Array.isArray(next)) next.label = "listener mutation";
  });
  const disposeIsolated = location.watch((next) => isolatedSeen.push(structuredClone(next)));

  assert.deepEqual(seen, []);
  map.set(["sibling"], 1);
  map.replace(["value"], { label: "initial" });
  assert.deepEqual(seen, []);
  map.set(["value", "label"], "changed");
  assert.deepEqual(seen, [{ label: "changed" }]);
  assert.deepEqual(isolatedSeen, [{ label: "changed" }]);
  assert.deepEqual(location.snap(), { label: "changed" });

  map.replace([], { value: { label: "ancestor replacement" }, sibling: 1 });
  assert.deepEqual(seen, [{ label: "changed" }, { label: "ancestor replacement" }]);
  assert.deepEqual(isolatedSeen, [{ label: "changed" }, { label: "ancestor replacement" }]);

  dispose();
  dispose();
  map.set(["value", "label"], "after dispose");
  assert.equal(seen.length, 2);
  assert.deepEqual(isolatedSeen.at(-1), { label: "after dispose" });
  disposeIsolated();
});

check("watch keeps a fixed array coordinate through missing transitions", () => {
  const map = hson.liveMap.fromJson({ items: ["a", "b"] });
  const seen: unknown[] = [];
  const stillMissing: unknown[] = [];
  const dispose = map.at(["items", 1]).watch((next) => seen.push(next));
  map.at(["items", 5]).watch((next) => stillMissing.push(next));

  map.splice(["items"], 0, 1);
  map.splice(["items"], 0, 1);
  map.splice(["items"], 0, 0, "first", "restored");
  assert.deepEqual(seen, [undefined, "restored"]);
  assert.deepEqual(stillMissing, []);
  dispose();
});

check("watch uses exact projected equality", () => {
  const numberMap = hson.liveMap.fromJson({ value: 0 });
  const numbers: number[] = [];
  numberMap.at(["value"]).watch((next) => {
    if (typeof next !== "number") throw new Error("Expected watched number");
    numbers.push(next);
  });
  numberMap.set(["value"], -0);
  assert.equal(numbers.length, 1);
  assert.equal(Object.is(numbers[0], -0), true);

  const orderMap = hson.liveMap.fromJson('{"value":{"a":1,"b":2}}');
  const orders: string[][] = [];
  orderMap.at(["value"]).watch((next) => {
    if (typeof next !== "object" || next === null || Array.isArray(next)) {
      throw new Error("Expected watched object");
    }
    orders.push(Object.keys(next));
  });
  orderMap.replace(["value"], { b: 2, a: 1 });
  assert.deepEqual(orders, [["b", "a"]]);
});

check("watch always delivers explicit snapshot replacement", () => {
  const map = hson.liveMap.fromJson({ value: "same" });
  const missing = map.at(["missing"]);
  const values: unknown[] = [];
  const missingValues: unknown[] = [];
  map.at(["value"]).watch((next) => values.push(next));
  missing.watch((next) => missingValues.push(next));

  map.restore(map.capture());
  assert.deepEqual(values, ["same"]);
  assert.deepEqual(missingValues, [undefined]);

  assert.throws(() => map.restore({ rev: 2, format: "structural-json", value: { value: "rejected" } } as never));
  assert.deepEqual(values, ["same"]);
  assert.deepEqual(missingValues, [undefined]);
});

check("watch reentrancy never regresses a listener baseline", () => {
  const map = hson.liveMap.fromJson({ value: 0 });
  const first: number[] = [];
  const second: number[] = [];
  map.at(["value"]).watch((next) => {
    if (typeof next !== "number") throw new Error("Expected watched number");
    first.push(next);
    if (next === 1) map.set(["value"], 2);
  });
  map.at(["value"]).watch((next) => {
    if (typeof next !== "number") throw new Error("Expected watched number");
    second.push(next);
  });

  map.set(["value"], 1);
  assert.deepEqual(first, [1, 2]);
  assert.deepEqual(second, [2]);
  assert.deepEqual([map.rev, map.snap(["value"])], [2, 2]);

  map.set(["value"], 3);
  assert.deepEqual(first, [1, 2, 3]);
  assert.deepEqual(second, [2, 3]);
});

check("watch coalesces batches, observes replay, and suppresses identity-only commits", () => {
  const batched = hson.liveMap.fromJson({ value: { a: 1, b: 2 } });
  const batchValues: unknown[] = [];
  batched.at(["value"]).watch((next) => batchValues.push(structuredClone(next)));
  batched.batch((tx) => {
    tx.set(["value", "a"], 3);
    tx.set(["value", "b"], 4);
  });
  assert.deepEqual(batchValues, [{ a: 3, b: 4 }]);

  const source = hson.liveMap.fromJson({ items: ["a", "b"] });
  const receiver = hson.liveMap.fromJson({ items: ["a", "b"] });
  const replayValues: unknown[] = [];
  receiver.at(["items", 0]).watch((next) => replayValues.push(next));
  receiver.replay(source.at(["items"]).array.move(0, 1));
  assert.deepEqual(replayValues, ["b"]);

  const identified = hson.liveMap.fromJson({ value: {} });
  let identityNotifications = 0;
  identified.at(["value"]).watch(() => { identityNotifications += 1; });
  acquire_projected_identity(identified, ["value"]);
  assert.equal(identityNotifications, 0);
});

check("watch delivery is isolated from public channels and among watchers", () => {
  const map = hson.liveMap.fromJson({ value: 0 });
  const order: string[] = [];
  map.at(["value"]).watch(() => {
    order.push("watch-a");
    throw new Error("watch failure");
  });
  map.at(["value"]).watch(() => { order.push("watch-b"); });
  map.feed(["value"], () => { order.push("feed"); });
  map.commits.observe(() => { order.push("observer"); });

  assert.throws(() => map.set(["value"], 1), /watch failure/);
  assert.deepEqual(order, ["watch-a", "watch-b", "feed", "observer"]);
  assert.equal(map.snap(["value"]), 1);

  order.length = 0;
  map.replace([], { value: 1, sibling: true });
  assert.deepEqual(order, ["feed", "observer"]);

  order.length = 0;
  assert.throws(() => map.set(["value"], 2), /watch failure/);
  assert.deepEqual(order, ["watch-a", "watch-b", "feed", "observer"]);
});

check("existing publication failure takes precedence without blocking watch", () => {
  const map = hson.liveMap.fromJson({ value: 0 });
  const order: string[] = [];
  map.feed(["value"], () => {
    order.push("feed");
    throw new Error("feed failure");
  });
  map.commits.observe(() => { order.push("observer"); });
  map.at(["value"]).watch(() => {
    order.push("watch-a");
    throw new Error("watch failure");
  });
  map.at(["value"]).watch(() => { order.push("watch-b"); });

  assert.throws(() => map.set(["value"], 1), /feed failure/);
  assert.deepEqual(order, ["watch-a", "watch-b", "feed"]);
  assert.equal(map.snap(["value"]), 1);
});

check("throwing public snapshot observers cannot block watch reset delivery", () => {
  const map = hson.liveMap.fromJson({ value: 0 });
  const order: string[] = [];
  map.commits.observe(() => {
    order.push("observer");
    throw new Error("observer failure");
  });
  map.at(["value"]).watch(() => { order.push("watch"); });

  assert.throws(() => map.restore(hson.liveMap.fromJson({ value: 2 }).capture()), /observer failure/);
  assert.deepEqual(order, ["watch", "observer"]);
  assert.equal(map.snap(["value"]), 2);
});

process.stdout.write(`# ${checks} LiveMap path-handle checks passed\n`);
emit_hson_live_test_completion("livemap.path-handle", checks, checks, 0);
