import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
// @hson-live-external-test

import assert from "node:assert/strict";
import * as rootExports from "../src/index.ts";
import { hson } from "../src/hson.ts";
import * as liveMapExports from "../src/api/livemap/index.ts";
import { bind_livetree_input_value, bind_livetree_text } from "../src/api/livemap/livemap.bridge-bindings.ts";
import { disposables_count_for_owner } from "../src/api/livetree/managers/lifecycle-registry.ts";
import { acquire_projected_identity } from "./helpers/livemap-identity-internal.mts";
import type { JsonValue } from "../src/core/types.ts";
import type { ElementLiveMap } from "../src/types/livemap.types.ts";

let checks = 0;

function check(name: string, fn: () => void): void {
  fn();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function element(source: string): ElementLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "element") throw new Error(`Expected element map; observed ${map.mode}`);
  return map;
}

const nodeTag = (value: unknown): string | undefined =>
  typeof value === "object" && value !== null && "$_tag" in value ? String(value.$_tag) : undefined;

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
  let setterCalls = 0;
  const target = {
    quid: "not-an-owner",
    text: {
      get: () => text,
      set: (value: string) => { setterCalls += 1; text = value; },
      overwrite: (value: string) => { text = value; },
    },
  };

  const binding = bind_livetree_text(map.at(["value"]), target);
  assert.equal(text, "initial");
  assert.equal(disposables_count_for_owner(target.quid), 0);
  map.set(["value"], "updated");
  assert.equal(text, "updated");
  map.restore(hson.liveMap.fromJson({ value: "restored" }).capture());
  assert.equal(text, "restored");
  map.restore(map.capture());
  assert.equal(setterCalls, 4);
  binding.dispose();
  map.set(["value"], "after-dispose");
  assert.equal(text, "restored");
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

check("input bridge unwinds its source subscription when listener acquisition fails", () => {
  const map = hson.liveMap.fromJson({ value: "initial" });
  let synced = "";
  let syncCalls = 0;
  const target = {
    quid: "unpublished-input-bridge",
    form: {
      getValue: () => synced,
      setValue: (value: JsonValue) => { syncCalls += 1; synced = String(value ?? ""); },
    },
    listen: {
      onInput: (): never => { throw new Error("forced listener acquisition failure"); },
    },
  };

  assert.throws(
    () => bind_livetree_input_value(target, map.at(["value"])),
    /forced listener acquisition failure/,
  );
  assert.equal(syncCalls, 1);
  assert.equal(synced, "initial");
  map.set(["value"], "after-failure");
  assert.equal(syncCalls, 1);
  assert.equal(disposables_count_for_owner(target.quid), 0);
});

check("projected LiveTree bindings converge across ordinary commits and snapshots", () => {
  const map = hson.liveMap.fromJson({ value: "ready", sibling: 0 });
  const tree = hson.liveTree.fromHson("<span/>");
  const seen: unknown[] = [];
  const dispose = tree.bind.path(map.at(["value"]), (target, value) => {
    seen.push(value);
    if (value === "fail") throw new Error("binding mapper failure");
    target.text.set(String(value ?? "missing"));
  });

  assert.deepEqual(seen, ["ready"]);
  assert.equal(tree.text.get(), "ready");

  map.replace([], { value: "ready", sibling: 1 });
  assert.deepEqual(seen, ["ready"]);

  map.set(["value"], "changed");
  assert.equal(tree.text.get(), "changed");
  map.restore(map.capture());
  assert.deepEqual(seen, ["ready", "changed", "changed"]);

  map.restore(hson.liveMap.fromJson({ value: "restored", sibling: 2 }).capture());
  assert.equal(tree.text.get(), "restored");

  let isolatedCalls = 0;
  map.at(["value"]).watch(() => { isolatedCalls += 1; });
  assert.throws(() => map.set(["value"], "fail"), /binding mapper failure/);
  assert.equal(map.at(["value"]).snap(), "fail");
  assert.equal(isolatedCalls, 1);
  assert.equal(tree.text.get(), "restored");
  map.set(["value"], "recovered");
  assert.equal(tree.text.get(), "recovered");

  const callsBeforeRejectedRestore = seen.length;
  assert.throws(() => map.restore({ rev: 2, format: "structural-json", value: { value: "rejected" } } as never));
  assert.equal(seen.length, callsBeforeRejectedRestore);

  dispose();
  dispose();
  map.set(["value"], "after dispose");
  assert.equal(tree.text.get(), "recovered");

  const missingMap = hson.liveMap.fromJson({ present: true });
  const missingTree = hson.liveTree.fromHson("<span/>");
  const missingSeen: unknown[] = [];
  const disposeMissing = missingTree.bind.path(missingMap.at(["missing"]), (target, value) => {
    missingSeen.push(value);
    target.text.set(String(value ?? "missing"));
  });
  missingMap.restore(missingMap.capture());
  assert.deepEqual(missingSeen, [undefined, undefined]);
  disposeMissing();

  const failedInitialMap = hson.liveMap.fromJson({ value: 0 });
  let failedInitialCalls = 0;
  assert.throws(() => tree.bind.path(failedInitialMap.at(["value"]), () => {
    failedInitialCalls += 1;
    throw new Error("initial binding failure");
  }), /initial binding failure/);
  failedInitialMap.set(["value"], 1);
  assert.equal(failedInitialCalls, 1);
});

check("multi-source bindings resnapshot complete mixed-map tuples", () => {
  const left = hson.liveMap.fromJson({ a: 1, sibling: 0 });
  const right = hson.liveMap.fromJson({ b: 2 });
  const tree = hson.liveTree.fromHson("<span/>");
  const seen: unknown[] = [];
  const dispose = tree.bind.paths(
    [left.at(["a"]), right.at(["b"])],
    (target, values) => {
      seen.push(values);
      target.text.set(`${String(values[0])}/${String(values[1])}`);
    },
  );

  assert.deepEqual(seen, [[1, 2]]);
  left.replace([], { a: 1, sibling: 1 });
  assert.equal(seen.length, 1);
  left.set(["a"], 3);
  right.set(["b"], 4);
  assert.deepEqual(seen, [[1, 2], [3, 2], [3, 4]]);

  right.restore(right.capture());
  assert.deepEqual(seen.at(-1), [3, 4]);
  left.restore(hson.liveMap.fromJson({ a: 5, sibling: 2 }).capture());
  assert.deepEqual(seen.at(-1), [5, 4]);

  dispose();
  dispose();
  left.set(["a"], 6);
  right.set(["b"], 7);
  assert.deepEqual(seen.at(-1), [5, 4]);

  const sameMap = hson.liveMap.fromJson({ x: 1, y: 2 });
  const sameMapTuples: unknown[] = [];
  const disposeSameMap = tree.bind.paths([sameMap.at(["x"]), sameMap.at(["y"])], (_target, values) => {
    sameMapTuples.push(values);
  });
  sameMap.batch((draft) => {
    draft.set(["x"], 3);
    draft.set(["y"], 4);
  });
  assert.deepEqual(sameMapTuples, [[1, 2], [3, 4], [3, 4]]);
  disposeSameMap();
});

check("document locations bind raw detached values and heterogeneous tuples", () => {
  const documentMap = element(`<main <a/> "tail"/>`);
  const projectedMap = hson.liveMap.fromJson({ theme: "dark" });
  const tree = hson.liveTree.fromHson("<span/>");
  const raw: Array<readonly [string | undefined, string | undefined]> = [];
  const tuples: unknown[] = [];

  const disposeRaw = tree.bind.path(documentMap.at([0]), (_target, value, previous) => {
    raw.push([nodeTag(value), nodeTag(previous)]);
    if (typeof value === "object" && value !== null) value.$_tag = "detached";
  });
  const disposeTuple = tree.bind.paths(
    [projectedMap.at(["theme"]), documentMap.at([1])],
    (_target, values, previous) => tuples.push([values, previous]),
  );

  assert.equal(nodeTag(documentMap.at([0]).snap()), "a");
  assert.deepEqual(raw, [["a", undefined]]);
  assert.deepEqual(tuples, [[["dark", "tail"], undefined]]);
  documentMap.at([0]).replace(element(`<b/>`).element.node());
  projectedMap.set(["theme"], "light");
  assert.deepEqual(raw, [["a", undefined], ["b", "detached"]]);
  assert.deepEqual(tuples.at(-1), [["light", "tail"], ["dark", "tail"]]);
  disposeRaw();
  disposeTuple();

  const sameDocumentMap = element(`<main <a/> <b/>/>`);
  const sameDocumentTuples: unknown[] = [];
  const disposeSameDocument = tree.bind.paths(
    [sameDocumentMap.at([0]), sameDocumentMap.at([1])],
    (_target, values) => sameDocumentTuples.push(values.map(nodeTag)),
  );
  sameDocumentMap.at([]).move(0, 1);
  assert.deepEqual(sameDocumentTuples, [["a", "b"], ["b", "a"], ["b", "a"]]);
  disposeSameDocument();
});

check("document locations flow unchanged through every explicit mapper binding", () => {
  const documentMap = element(`<main "ready"/>`);
  const projectedMap = hson.liveMap.fromJson({ suffix: "!" });
  const location = documentMap.at([0]);
  const tree = hson.liveTree.fromHson("<span/>");
  const asText = (value: unknown): string => String(value ?? "");

  const disposers = [
    tree.bind.text(location, asText),
    tree.bind.textPaths([location, projectedMap.at(["suffix"])], (values) => `${asText(values[0])}${values[1]}`),
    tree.bind.attr(location, "data-one", asText),
    tree.bind.attrs(location, (value) => ({ "data-many": asText(value) })),
    tree.bind.attrsPaths([projectedMap.at(["suffix"]), location], (values) => ({ "data-pair": `${values[0]}${asText(values[1])}` })),
    tree.bind.css(location, (value) => ({ opacity: value === "ready" ? 1 : 0 })),
    tree.bind.cssPaths([location, projectedMap.at(["suffix"])], (values) => ({ "--pair": `${asText(values[0])}${values[1]}` })),
  ];

  assert.equal(tree.text.get(), "ready!");
  assert.equal(tree.attrs.get("data-one"), "ready");
  assert.equal(tree.attrs.get("data-many"), "ready");
  assert.equal(tree.attrs.get("data-pair"), "!ready");
  assert.equal(tree.css.get.property("opacity"), "1");
  assert.equal(tree.css.get.property("--pair"), "ready!");
  disposers.forEach((dispose) => dispose());
});

check("binding source authenticity is exact-object based and value-shape independent", () => {
  const tree = hson.liveTree.fromHson("<span/>");
  const projected = hson.liveMap.fromJson({ value: { $_tag: "looks-real", $_content: [] } });
  const projectedDispose = tree.bind.text(projected.at(["value"]));
  assert.equal(tree.text.get(), "[object Object]");

  let snaps = 0;
  const fabricated = {
    snap: () => { snaps += 1; return "fabricated"; },
    watch: () => () => undefined,
  };
  assert.throws(
    () => (tree.bind.path as (source: unknown, apply: () => void) => () => void)(fabricated, () => undefined),
    /authentic passive LiveMap or Locus location/,
  );
  assert.equal(snaps, 0);

  const documentMap = element(`<main "proxy"/>`);
  const proxyDispose = tree.bind.text(documentMap.proxy()[0].$_, (value) => String(value ?? ""));
  assert.equal(tree.text.get(), "proxy");
  projectedDispose();
  proxyDispose();
});

check("projected default text and attribute conversion remains unchanged", () => {
  const input: { value: JsonValue } = { value: { nested: true } };
  const map = hson.liveMap.fromJson(input);
  const tree = hson.liveTree.fromHson("<span/>");
  const textDispose = tree.bind.text(map.at(["value"]));
  const attrDispose = tree.bind.attr(map.at(["value"]), "data-value");

  assert.equal(tree.text.get(), "[object Object]");
  assert.equal(tree.attrs.get("data-value"), "[object Object]");
  map.set(["value"], ["a", "b"]);
  assert.equal(tree.text.get(), "a,b");
  assert.equal(tree.attrs.get("data-value"), "a,b");
  map.set(["value"], null);
  assert.equal(tree.text.get(), "");
  assert.equal(tree.attrs.has("data-value"), false);
  textDispose();
  attrDispose();
});

check("unmapped document primitive defaults preserve text and attribute policy", () => {
  const cases = [
    ["ready", "ready", "ready"],
    [undefined, "", undefined],
  ] as const;

  cases.forEach(([value, expectedText, expectedAttr]) => {
    const documentMap = value === undefined ? element(`<main/>`) : element(`<main "ready"/>`);
    const tree = hson.liveTree.fromHson("<span/>");
    const textDispose = (tree.bind.text as (source: unknown) => () => void)(documentMap.at([0]));
    const attrDispose = (tree.bind.attr as (source: unknown, name: string) => () => void)(documentMap.at([0]), "data-state");
    assert.equal(tree.text.get(), expectedText);
    assert.equal(tree.attrs.get("data-state"), expectedAttr);
    textDispose();
    attrDispose();
  });
});

check("unmapped structured document values reject before initial mutation or subscription", () => {
  const documentMap = element(`<main <strong/>/>`);
  const tree = hson.liveTree.fromHson(`<span title="stable" "stable"/>`);
  const beforeResources = disposables_count_for_owner(tree.quid);

  assert.throws(
    () => (tree.bind.text as (source: unknown) => () => void)(documentMap.at([0])),
    /document Hson values require an explicit mapper/,
  );
  assert.equal(tree.text.get(), "stable");
  assert.equal(disposables_count_for_owner(tree.quid), beforeResources);
  documentMap.at([0]).replace("later");
  assert.equal(tree.text.get(), "stable");

  documentMap.at([0]).replace(element(`<em/>`).element.node());
  assert.throws(
    () => (tree.bind.attr as (source: unknown, name: string) => () => void)(documentMap.at([0]), "title"),
    /document Hson values require an explicit mapper/,
  );
  assert.equal(tree.attrs.get("title"), "stable");
  assert.equal(disposables_count_for_owner(tree.quid), beforeResources);
});

check("unmapped document primitive bindings survive structured failures and recover", () => {
  const documentMap = element(`<main "ready"/>`);
  const tree = hson.liveTree.fromHson("<span/>");
  let isolatedCalls = 0;
  documentMap.at([0]).watch(() => { isolatedCalls += 1; });
  const dispose = (tree.bind.text as (source: unknown) => () => void)(documentMap.at([0]));
  assert.equal(tree.text.get(), "ready");

  assert.throws(
    () => documentMap.at([0]).replace(element(`<strong/>`).element.node()),
    /document Hson values require an explicit mapper/,
  );
  assert.equal(tree.text.get(), "ready");
  assert.equal(isolatedCalls, 1);
  documentMap.at([0]).replace("recovered");
  assert.equal(tree.text.get(), "recovered");
  assert.equal(isolatedCalls, 2);
  dispose();
});

check("document bindings inherit fixed coordinates, attrs observation, and restore convergence", () => {
  const documentMap = element(`<main <a id="subject"/> <b/>/>`);
  const tree = hson.liveTree.fromHson("<span/>");
  const seen: string[] = [];
  const location = documentMap.at([0]);
  const discovered = documentMap.at([]).id("subject");
  assert.equal(discovered, location);
  const initial = documentMap.capture();
  const dispose = tree.bind.path(location, (_target, value) => seen.push(nodeTag(value) ?? String(value)));

  documentMap.at([]).insert(0, element(`<x/>`).element.node());
  assert.equal(nodeTag(discovered.snap()), "x");
  assert.deepEqual(documentMap.at([]).id("subject")?.path(), [1]);
  documentMap.at([]).move(0, 2);
  documentMap.at([0]).attrs.set("title", "changed");
  documentMap.restore(initial);
  documentMap.restore(documentMap.capture());
  const beforeRejectedRestore = seen.length;
  const incompatible = hson.liveMap.fromHson(`<a/> <b/>`);
  if (incompatible.mode !== "fragment") throw new Error("Expected fragment map");
  assert.throws(() => documentMap.restore(incompatible.capture()));
  assert.equal(seen.length, beforeRejectedRestore);

  assert.deepEqual(seen, ["a", "x", "a", "a", "a", "a"]);
  assert.equal(discovered, location);
  assert.equal(documentMap.at([]).id("subject"), location);
  dispose();

  const missingMap = element(`<main/>`);
  const missingSeen: unknown[] = [];
  const missingDispose = tree.bind.path(missingMap.at([9]), (_target, value) => missingSeen.push(value));
  missingMap.restore(missingMap.capture());
  assert.deepEqual(missingSeen, [undefined, undefined]);
  missingDispose();
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

check("watch uses exact data equality", () => {
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
