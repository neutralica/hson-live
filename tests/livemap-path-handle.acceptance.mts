import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
// @hson-live-external-test

import assert from "node:assert/strict";
import * as rootExports from "../src/index.ts";
import { hson } from "../src/hson.ts";
import * as liveMapExports from "../src/api/livemap/index.ts";
import { bind_livetree_text } from "../src/api/livemap/livemap.bridge-bindings.ts";
import { disposables_count_for_owner } from "../src/api/livetree/managers/lifecycle-registry.ts";

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
  void Reflect.get(map.proxy(["nested"]), "value").$_;

  assert.equal(JSON.stringify(map.root()).includes("data-_quid"), false);
  assert.equal(JSON.stringify(map.root()).includes('"quid"'), false);
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

process.stdout.write(`# ${checks} LiveMap path-handle checks passed\n`);
emit_hson_live_test_completion("livemap.path-handle", checks, checks, 0);
