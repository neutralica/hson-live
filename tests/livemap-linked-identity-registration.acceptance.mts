// @hson-live-external-test
import assert from "node:assert/strict";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import { element, mount, path, raw_node } from "./helpers/reflect-unit6.mts";
import {
  _create_livetree_runtime_test_handle,
  _dispose_livetree_runtime_test_handle,
  _livetree_runtime_test_claim_count,
  _lookup_livetree_runtime_test_node,
  _reflect_document_for_runtime_test,
} from "../src/diagnostics/index.ts";
import { is_persisted_quid } from "../src/core/hson-node-quid.ts";
import { canonical_graph_equal } from "../src/api/livemap/livemap.document.install.ts";
import { FakeElement } from "./helpers/fake-document.mts";

const syntheticHead = new FakeElement("head");
syntheticHead.isConnected = true;
Reflect.set(globalThis.document, "head", syntheticHead);
Reflect.set(globalThis.document, "documentElement", syntheticHead);
Reflect.set(globalThis.document, "querySelector", () => undefined);
Reflect.set(FakeElement.prototype, "querySelector", () => undefined);

let checks = 0;
function check(name: string, run: () => void): void {
  run();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

const runtime = _create_livetree_runtime_test_handle();
function reflected(source: string) {
  const map = element(source);
  const binding = _reflect_document_for_runtime_test(runtime, map);
  return { map, binding };
}
function close(binding: ReturnType<typeof reflected>["binding"]): void {
  binding.dispose();
  binding.tree.remove();
}

check("linked root QUID demand returns a valid canonical QUID", () => {
  const { binding } = reflected(`<main/>`);
  assert.equal(is_persisted_quid(binding.tree.quid), true);
  close(binding);
});

check("linked descendant QUID demand is supported", () => {
  const { binding } = reflected(`<main <span/>/>`);
  assert.equal(is_persisted_quid(binding.tree.find.byTag("span")?.quid), true);
  close(binding);
});

check("registration mutates canonical metadata", () => {
  const { map, binding } = reflected(`<main/>`);
  const quid = binding.tree.quid;
  assert.equal(map.element.node().$_meta?.quid, quid);
  close(binding);
});

check("registration mutates projected metadata with the same bytes", () => {
  const { binding } = reflected(`<main/>`);
  const quid = binding.tree.quid;
  assert.equal(binding.tree.node.$_meta?.quid, quid);
  close(binding);
});

check("new registration advances the ordinary revision once", () => {
  const { map, binding } = reflected(`<main/>`);
  void binding.tree.quid;
  assert.equal(map.rev, 1);
  close(binding);
});

check("registration publishes one semantic ensure-quid operation", () => {
  const { map, binding } = reflected(`<main/>`);
  const observations: unknown[] = [];
  map.commits.observe((observation) => observations.push(observation));
  void binding.tree.quid;
  const observation = observations[0];
  assert.equal(typeof observation, "object");
  const commit = Reflect.get(observation!, "commit");
  assert.equal(Reflect.get(Reflect.get(commit, "ops")[0], "op"), "ensure-quid");
  close(binding);
});

check("registration target is a frozen canonical path", () => {
  const { map, binding } = reflected(`<main/>`);
  let target: unknown;
  map.commits.observe((observation) => {
      if (observation.kind === "commit") {
        const operation = observation.commit.ops[0];
        if (operation !== undefined && "domain" in operation && operation.op !== "replace-root") {
          target = operation.target;
        }
      }
  });
  void binding.tree.quid;
  assert.deepEqual(target, { kind: "path", path: [] });
  assert.equal(typeof target, "object");
  assert.equal(Object.isFrozen(Reflect.get(target!, "path")), true);
  close(binding);
});

check("sparse overlay resolves the registered node", () => {
  const { map, binding } = reflected(`<main/>`);
  const quid = binding.tree.quid;
  assert.equal(map.document.byQuid(quid)?.$_tag, "main");
  close(binding);
});

check("runtime registry resolves the exact projected node", () => {
  const { binding } = reflected(`<main/>`);
  const quid = binding.tree.quid;
  assert.equal(_lookup_livetree_runtime_test_node(runtime, quid), binding.tree.node);
  close(binding);
});

check("mounted registration retains the exact DOM element", () => {
  const { binding } = reflected(`<main/>`);
  const before = mount(binding.tree.node);
  void binding.tree.quid;
  assert.equal(mount(binding.tree.node), before);
  close(binding);
});

check("mounted DOM receives the canonical hson:quid", () => {
  const { binding } = reflected(`<main/>`);
  const elementNode = mount(binding.tree.node);
  const quid = binding.tree.quid;
  assert.equal(elementNode.getAttribute("hson:quid"), quid);
  close(binding);
});

check("second QUID access is an exact no-op", () => {
  const { map, binding } = reflected(`<main/>`);
  const first = binding.tree.quid;
  const second = binding.tree.quid;
  assert.equal(second, first);
  assert.equal(map.rev, 1);
  close(binding);
});

check("existing canonical QUID access publishes nothing", () => {
  const q = "0000000000002101";
  const { map, binding } = reflected(`<main @${q}/>`);
  let observations = 0;
  map.commits.observe(() => observations += 1);
  assert.equal(binding.tree.quid, q);
  assert.equal(map.rev, 0);
  assert.equal(observations, 0);
  close(binding);
});

check("registration is visible to strict canonical equality", () => {
  const { map, binding } = reflected(`<main/>`);
  const before = map.element.node();
  void binding.tree.quid;
  assert.equal(canonical_graph_equal(before, map.element.node()), false);
  close(binding);
});

check("durable capture preserves registered metadata", () => {
  const { map, binding } = reflected(`<main/>`);
  const quid = binding.tree.quid;
  const restored = element(`<main/>`);
  restored.restore(map.capture());
  assert.equal(restored.element.node().$_meta?.quid, quid);
  close(binding);
});

check("recorded registration replays without allocation", () => {
  const { map, binding } = reflected(`<main/>`);
  let commit: unknown;
  map.commits.observe((observation) => {
    if (observation.kind === "commit") commit = observation.commit;
  });
  const quid = binding.tree.quid;
  const mirror = element(`<main/>`);
  Reflect.apply(mirror.replay, mirror, [commit]);
  assert.equal(mirror.element.node().$_meta?.quid, quid);
  close(binding);
});

check("registered descendant survives detached capture and replay", () => {
  const { map, binding } = reflected(`<main <span/>/>`);
  const child = binding.tree.find.byTag("span")!;
  const quid = child.quid;
  const restored = element(`<main/>`);
  restored.restore(map.capture());
  assert.equal(restored.document.byQuid(quid)?.$_tag, "span");
  close(binding);
});

check("ordinary reflection still starts with zero claims", () => {
  const { binding } = reflected(`<main <a/> <b/>/>`);
  assert.equal(_livetree_runtime_test_claim_count(runtime), 0);
  close(binding);
});

check("byQuid returns detached public material", () => {
  const { map, binding } = reflected(`<main/>`);
  const quid = binding.tree.quid;
  const detached = map.document.byQuid(quid)!;
  detached.$_tag = "aside";
  assert.equal(map.element.node().$_tag, "main");
  close(binding);
});

check("no public raw-QUID assignment or identity acquisition method is added", () => {
  const { map, binding } = reflected(`<main/>`);
  assert.equal(Reflect.get(map.document, "ensureIdentity"), undefined);
  assert.equal(Reflect.get(map.document, "retain"), undefined);
  assert.equal(Reflect.get(map.document, "setQuid"), undefined);
  close(binding);
});

_dispose_livetree_runtime_test_handle(runtime);
process.stdout.write(`LiveMap linked identity registration acceptance: ${checks}/${checks}\n`);
emit_hson_live_test_completion("livemap.linked-identity-registration", checks, checks, 0);
