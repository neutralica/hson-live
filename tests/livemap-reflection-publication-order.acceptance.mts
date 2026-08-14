// @hson-live-external-test
import assert from "node:assert/strict";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import {
  element,
  mount,
  path,
  projected_element,
  raw_node,
} from "./helpers/reflect-unit6.mts";
import {
  _create_livetree_runtime_test_handle,
  _lookup_livetree_runtime_test_node,
  _reflect_document_for_runtime_test,
} from "../src/diagnostics/index.ts";
import { hsonReflect } from "../src/api/reflect/reflect.facade.ts";
import {
  DOCUMENT_REFLECT_REVISION_GAP_ERROR_CODE,
  DOCUMENT_REFLECT_STRUCTURAL_UPDATE_FAILED_ERROR_CODE,
} from "../src/api/reflect/reflect.document.error.ts";
import { create_livetree } from "../src/api/livetree/creation/create-livetree.ts";
import { hson } from "../src/hson.ts";
import { FakeElement } from "./helpers/fake-document.mts";

let checks = 0;
function check(name: string, run: () => void): void {
  run();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

const tag = (value: unknown): string | undefined =>
  typeof value === "object" && value !== null && "$_tag" in value
    ? String(value.$_tag)
    : undefined;

check("document watch sees canonical revision n+1 before Reflection revision advances", () => {
  const map = element(`<main <a/>/>`);
  const binding = hsonReflect(map);
  let seen: unknown;
  map.at([0]).watch(() => {
    seen = {
      mapRevision: map.rev,
      canonicalTag: tag(map.at([0]).snap()),
      reflectionRevision: binding.sourceRevision,
      projectedTag: raw_node(binding.tree.node, [0, 0]).$_tag,
    };
  });
  map.document.content.replace(path(0), 0, projected_element(`<b/>`));
  assert.deepEqual(seen, {
    mapRevision: 1,
    canonicalTag: "b",
    reflectionRevision: 0,
    projectedTag: "a",
  });
  assert.equal(binding.sourceRevision, 1);
  assert.equal(raw_node(binding.tree.node, [0, 0]).$_tag, "b");
  binding.dispose();
});

check("mounted DOM remains at n inside the pre-Reflection watch and converges afterward", () => {
  const map = element(`<main <a/>/>`);
  const binding = hsonReflect(map);
  const rootDom = mount(binding.tree.node);
  let insideTag: string | undefined;
  map.at([0]).watch(() => {
    insideTag = (rootDom.childNodes[0] as FakeElement | undefined)?.tagName;
  });
  map.document.content.replace(path(0), 0, projected_element(`<b/>`));
  assert.equal(insideTag, "a");
  assert.equal((rootDom.childNodes[0] as FakeElement | undefined)?.tagName, "b");
  binding.dispose();
});

check("canonical QUID paths advance before runtime QUID correspondence", () => {
  const oldQuid = "000008101";
  const nextQuid = "000008102";
  const map = element(`<main <a @${oldQuid}/>/` + `>`);
  const runtime = _create_livetree_runtime_test_handle();
  const binding = _reflect_document_for_runtime_test(runtime, map);
  const oldProjected = raw_node(binding.tree.node, [0, 0]);
  let seam: unknown;
  map.at([0]).watch(() => {
    seam = {
      canonicalOld: map.document.byQuid(oldQuid)?.$_tag,
      canonicalNext: map.document.byQuid(nextQuid)?.$_tag,
      runtimeOld: _lookup_livetree_runtime_test_node(runtime, oldQuid) === oldProjected,
      runtimeNext: _lookup_livetree_runtime_test_node(runtime, nextQuid),
    };
  });
  map.document.content.replace(path(0), 0, projected_element(`<b @${nextQuid}/>`));
  assert.deepEqual(seam, {
    canonicalOld: undefined,
    canonicalNext: "b",
    runtimeOld: true,
    runtimeNext: undefined,
  });
  assert.equal(_lookup_livetree_runtime_test_node(runtime, oldQuid), undefined);
  assert.equal(_lookup_livetree_runtime_test_node(runtime, nextQuid), raw_node(binding.tree.node, [0, 0]));
  binding.dispose();
});

check("an ordinary observer registered before Reflection sees the same seam", () => {
  const map = element(`<main <a/>/>`);
  let binding: ReturnType<typeof hsonReflect>;
  let seen: unknown;
  map.commits.observe(() => {
    seen = {
      mapRevision: map.rev,
      canonicalTag: tag(map.at([0]).snap()),
      reflectionRevision: binding.sourceRevision,
      projectedTag: raw_node(binding.tree.node, [0, 0]).$_tag,
    };
  });
  binding = hsonReflect(map);
  map.document.content.replace(path(0), 0, projected_element(`<b/>`));
  assert.deepEqual(seen, {
    mapRevision: 1,
    canonicalTag: "b",
    reflectionRevision: 0,
    projectedTag: "a",
  });
  binding.dispose();
});

check("an ordinary observer registered after Reflection sees converged projection", () => {
  const map = element(`<main <a/>/>`);
  const binding = hsonReflect(map);
  let seen: unknown;
  map.commits.observe(() => {
    seen = {
      mapRevision: map.rev,
      reflectionRevision: binding.sourceRevision,
      projectedTag: raw_node(binding.tree.node, [0, 0]).$_tag,
    };
  });
  map.document.content.replace(path(0), 0, projected_element(`<b/>`));
  assert.deepEqual(seen, { mapRevision: 1, reflectionRevision: 1, projectedTag: "b" });
  binding.dispose();
});

check("document watches precede Reflection even when registered after the binding", () => {
  const map = element(`<main/>`);
  const binding = hsonReflect(map);
  let reflectionRevision = -1;
  map.at([]).watch(() => { reflectionRevision = binding.sourceRevision; });
  map.document.attrs.set(path(), "title", "next");
  assert.equal(reflectionRevision, 0);
  assert.equal(binding.sourceRevision, 1);
  binding.dispose();
});

check("callback ordering is watch then earlier observer then Reflection then later observer", () => {
  const map = element(`<main/>`);
  const order: string[] = [];
  let binding: ReturnType<typeof hsonReflect>;
  map.commits.observe(() => order.push(`before:${binding.sourceRevision}`));
  binding = hsonReflect(map);
  map.commits.observe(() => order.push(`after:${binding.sourceRevision}`));
  map.at([]).watch(() => order.push(`watch:${binding.sourceRevision}`));
  map.document.attrs.set(path(), "title", "next");
  assert.deepEqual(order, ["watch:0", "before:0", "after:1"]);
  binding.dispose();
});

check("a linked LiveTree read in the seam is stale-only and the exact handle later converges", () => {
  const map = element(`<main <a title="old"/>/>`);
  const binding = hsonReflect(map);
  const childNode = raw_node(binding.tree.node, [0, 0]);
  const linked = create_livetree(childNode).adoptRoots(binding.tree.hostRootNode());
  let inside: unknown;
  map.at([0]).watch(() => {
    inside = { exact: linked.node === childNode, title: linked.attrs.get("title") };
  });
  map.at([0]).attrs.set("title", "new");
  assert.deepEqual(inside, { exact: true, title: "old" });
  assert.equal(linked.node, childNode);
  assert.equal(linked.attrs.get("title"), "new");
  binding.dispose();
});

check("binding disposal from a watch prevents the pending Reflection delivery", () => {
  const map = element(`<main <a/>/>`);
  const binding = hsonReflect(map);
  const retained = binding.tree.node;
  map.at([0]).watch(() => binding.dispose());
  map.document.content.replace(path(0), 0, projected_element(`<b/>`));
  assert.equal(binding.status, "disposed");
  assert.equal(binding.sourceRevision, 0);
  assert.equal(raw_node(retained, [0, 0]).$_tag, "a");
  assert.equal(tag(map.at([0]).snap()), "b");
});

check("a watch added during watch dispatch starts with the next commit", () => {
  const map = element(`<main/>`);
  const seen: string[] = [];
  let added = false;
  map.at([]).watch(() => {
    seen.push("first");
    if (!added) {
      added = true;
      map.at([]).watch(() => seen.push("late"));
    }
  });
  map.document.attrs.set(path(), "one", true);
  assert.deepEqual(seen, ["first"]);
  map.document.attrs.set(path(), "two", true);
  assert.deepEqual(seen, ["first", "first", "late"]);
});

check("an observer added during observer dispatch starts with the next commit", () => {
  const map = element(`<main/>`);
  const seen: string[] = [];
  let added = false;
  map.commits.observe(() => {
    seen.push("first");
    if (!added) {
      added = true;
      map.commits.observe(() => seen.push("late"));
    }
  });
  map.document.attrs.set(path(), "one", true);
  assert.deepEqual(seen, ["first"]);
  map.document.attrs.set(path(), "two", true);
  assert.deepEqual(seen, ["first", "first", "late"]);
});

check("nested mutation from a pre-Reflection watch publishes depth-first and fails the binding closed", () => {
  const map = element(`<main/>`);
  const binding = hsonReflect(map);
  let nested = false;
  map.at([]).watch(() => {
    if (nested) return;
    nested = true;
    map.document.attrs.set(path(), "nested", true);
  });
  map.document.attrs.set(path(), "outer", true);
  assert.equal(map.rev, 2);
  assert.equal(map.document.attrs.get(path(), "outer"), true);
  assert.equal(map.document.attrs.get(path(), "nested"), true);
  assert.equal(binding.status, "failed");
  assert.equal(binding.failure?.code, DOCUMENT_REFLECT_REVISION_GAP_ERROR_CODE);
  assert.equal(binding.sourceRevision, 0);
  binding.dispose();
});

check("nested mutation from an observer before Reflection inverts later-observer commit order", () => {
  const map = element(`<main/>`);
  const order: string[] = [];
  let nested = false;
  map.commits.observe((observation) => {
    if (observation.kind !== "commit") return;
    order.push(`before:${observation.commit.rev}`);
    if (!nested) {
      nested = true;
      map.document.attrs.set(path(), "nested", true);
    }
  });
  const binding = hsonReflect(map);
  map.commits.observe((observation) => {
    if (observation.kind === "commit") order.push(`after:${observation.commit.rev}`);
  });
  map.document.attrs.set(path(), "outer", true);
  assert.deepEqual(order, ["before:1", "before:2", "after:2", "after:1"]);
  assert.equal(binding.status, "failed");
  assert.equal(binding.failure?.code, DOCUMENT_REFLECT_REVISION_GAP_ERROR_CODE);
  binding.dispose();
});

check("nested mutation from an observer after Reflection preserves ordered convergence", () => {
  const map = element(`<main/>`);
  const binding = hsonReflect(map);
  let nested = false;
  map.commits.observe(() => {
    if (nested) return;
    nested = true;
    map.document.attrs.set(path(), "nested", true);
  });
  map.document.attrs.set(path(), "outer", true);
  assert.equal(map.rev, 2);
  assert.equal(binding.status, "active");
  assert.equal(binding.sourceRevision, 2);
  assert.equal(binding.tree.attrs.get("outer"), true);
  assert.equal(binding.tree.attrs.get("nested"), true);
  binding.dispose();
});

check("a throwing document watch does not prevent Reflection or later observers", () => {
  const map = element(`<main/>`);
  const binding = hsonReflect(map);
  let later = 0;
  map.at([]).watch(() => { throw new Error("watch failure"); });
  map.commits.observe(() => { later += 1; });
  assert.throws(() => map.document.attrs.set(path(), "title", "next"), /watch failure/);
  assert.equal(map.rev, 1);
  assert.equal(binding.sourceRevision, 1);
  assert.equal(binding.tree.attrs.get("title"), "next");
  assert.equal(later, 1);
  binding.dispose();
});

check("an observer throwing before Reflection skips Reflection and later observers", () => {
  const map = element(`<main/>`);
  const off = map.commits.observe(() => { throw new Error("early observer failure"); });
  const binding = hsonReflect(map);
  let later = 0;
  map.commits.observe(() => { later += 1; });
  assert.throws(() => map.document.attrs.set(path(), "one", true), /early observer failure/);
  assert.equal(map.rev, 1);
  assert.equal(binding.sourceRevision, 0);
  assert.equal(binding.tree.attrs.get("one"), undefined);
  assert.equal(later, 0);
  off();
  map.document.attrs.set(path(), "two", true);
  assert.equal(binding.status, "failed");
  assert.equal(binding.failure?.code, DOCUMENT_REFLECT_REVISION_GAP_ERROR_CODE);
  binding.dispose();
});

check("an observer throwing after Reflection leaves Reflection current", () => {
  const map = element(`<main/>`);
  const binding = hsonReflect(map);
  map.commits.observe(() => { throw new Error("late observer failure"); });
  assert.throws(() => map.document.attrs.set(path(), "title", "next"), /late observer failure/);
  assert.equal(map.rev, 1);
  assert.equal(binding.status, "active");
  assert.equal(binding.sourceRevision, 1);
  assert.equal(binding.tree.attrs.get("title"), "next");
  binding.dispose();
});

check("Reflection application failure is isolated and later observers still execute", () => {
  const map = element(`<main <a/>/>`);
  const binding = hsonReflect(map);
  const rootDom = mount(binding.tree.node);
  rootDom.failReplace = true;
  let later = 0;
  map.commits.observe(() => { later += 1; });
  const commit = map.document.content.insert(path(0), 1, projected_element(`<b/>`));
  assert.equal(commit.changed, true);
  assert.equal(map.rev, 1);
  assert.equal(binding.status, "failed");
  assert.equal(binding.failure?.code, DOCUMENT_REFLECT_STRUCTURAL_UPDATE_FAILED_ERROR_CODE);
  assert.equal(binding.sourceRevision, 0);
  assert.equal(later, 1);
  binding.dispose();
});

check("a failed Reflection binding remains failed while future canonical commits continue", () => {
  const map = element(`<main <a/>/>`);
  const binding = hsonReflect(map);
  const rootDom = mount(binding.tree.node);
  rootDom.failReplace = true;
  map.document.content.insert(path(0), 1, projected_element(`<b/>`));
  rootDom.failReplace = false;
  map.document.attrs.set(path(), "later", true);
  assert.equal(map.rev, 2);
  assert.equal(binding.status, "failed");
  assert.equal(binding.sourceRevision, 0);
  assert.equal(binding.tree.attrs.get("later"), undefined);
  binding.dispose();
});

check("a fresh binding reconstructs current canonical state after failed binding disposal", () => {
  const map = element(`<main <a/>/>`);
  const failed = hsonReflect(map);
  const rootDom = mount(failed.tree.node);
  rootDom.failReplace = true;
  map.document.content.insert(path(0), 1, projected_element(`<b/>`));
  map.document.attrs.set(path(), "later", true);
  assert.throws(() => hsonReflect(map), /already has an active/);
  failed.dispose();
  const fresh = hsonReflect(map);
  assert.equal(fresh.sourceRevision, 2);
  assert.equal(fresh.tree.attrs.get("later"), true);
  assert.equal(raw_node(fresh.tree.node, [0]).$_content.length, 2);
  fresh.dispose();
});

check("multiple throwing watches all execute and the first watch error escapes", () => {
  const map = element(`<main/>`);
  const order: string[] = [];
  map.at([]).watch(() => { order.push("watch-1"); throw new Error("first watch"); });
  map.at([]).watch(() => { order.push("watch-2"); throw new Error("second watch"); });
  map.commits.observe(() => order.push("observer"));
  assert.throws(() => map.document.attrs.set(path(), "title", "next"), /first watch/);
  assert.deepEqual(order, ["watch-1", "watch-2", "observer"]);
});

check("multiple ordinary observer failures stop at the first throwing observer", () => {
  const map = element(`<main/>`);
  const order: string[] = [];
  map.commits.observe(() => { order.push("observer-1"); throw new Error("first observer"); });
  map.commits.observe(() => { order.push("observer-2"); throw new Error("second observer"); });
  assert.throws(() => map.document.attrs.set(path(), "title", "next"), /first observer/);
  assert.deepEqual(order, ["observer-1"]);
  assert.equal(map.rev, 1);
});

check("ordinary observer failure takes precedence over a prior watch failure", () => {
  const map = element(`<main/>`);
  map.at([]).watch(() => { throw new Error("watch failure"); });
  map.commits.observe(() => { throw new Error("observer failure"); });
  assert.throws(() => map.document.attrs.set(path(), "title", "next"), /observer failure/);
  assert.equal(map.rev, 1);
});

check("replay uses the same watch-before-observer-before-Reflection publication phases", () => {
  const source = element(`<main/>`);
  const commit = source.document.attrs.set(path(), "replayed", true);
  const target = element(`<main/>`);
  const order: string[] = [];
  let binding: ReturnType<typeof hsonReflect>;
  target.commits.observe(() => order.push(`before:${binding.sourceRevision}`));
  binding = hsonReflect(target);
  target.commits.observe(() => order.push(`after:${binding.sourceRevision}`));
  target.at([]).watch(() => order.push(`watch:${binding.sourceRevision}`));
  target.replay(commit);
  assert.deepEqual(order, ["watch:0", "before:0", "after:1"]);
  assert.equal(binding.tree.attrs.get("replayed"), true);
  binding.dispose();
});

check("projected maps share watch-before-observer publication without a Reflection phase", () => {
  const map = hson.liveMap.fromJson({ value: 0 });
  const order: string[] = [];
  map.at(["value"]).watch((value) => order.push(`watch:${String(value)}:${map.rev}`));
  map.commits.observe(() => order.push(`observer:${map.rev}`));
  map.set(["value"], 1);
  assert.deepEqual(order, ["watch:1:1", "observer:1"]);
});

assert.equal(checks, 25);
process.stdout.write(`1..${checks}\n`);
emit_hson_live_test_completion("reflect.livemap-publication-order", checks, checks, 0);
