// @hson-live-external-test
import assert from "node:assert/strict";
import { Hson, activate_interactions, add_interaction, enable_interactions, hsonLiveMap, hsonMirror, type InteractionDescriptor } from "../src/index.ts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";
import { make_portable_aggregate_commit } from "../src/api/livemap/livemap.hosted.ts";
import { make_livemap_hosted_mirror_from_snapshot_internal } from "../src/api/livemap/livemap.libraries.ts";
import { resolve_document_path, validate_document_path } from "../src/api/livemap/livemap.document.path.ts";
import { project_livetree } from "../src/api/livetree/creation/project-live-tree.ts";
import { get_el_for_node } from "../src/api/livetree/utils/node-map-helpers.ts";
import { projected_value_from_hson_node } from "../src/core/projected-value-graph.ts";
import { materialize_projected_value } from "../src/core/projected-value-materialization.ts";
import { is_Node } from "../src/core/node-guards.ts";
import { install_fake_document } from "./helpers/fake-document.mts";
import { parse_hson_exact_runtime } from "../src/internal/exact-runtime-hson-codec.ts";
import { admit_exact_runtime_livemap_libraries } from "../src/internal/exact-runtime-node-admission.ts";

install_fake_document();

const ButtonSchema = Hson.schema`<type "document" tag "main" content <repeat <tag "button" content "empty">>>`;
const NestedSchema = Hson.schema`<type "document" tag "main" content <repeat <tag "section" content <repeat <tag "button" content "empty">>>>>`;
const listener = Object.freeze({
  event: "click", target: "element" as const, capture: false, once: false, passive: false,
  missingTarget: "ignore" as const, preventDefault: false, stopPropagation: false, stopImmediatePropagation: false,
});
const subject = (path: readonly number[]) => Object.freeze({ library: "page", path });
const descriptor = (id: string, path: readonly number[]): InteractionDescriptor =>
  Object.freeze({ id, subject: subject(path), listener, kind: "browser-local", key: "run", args: null });
const button = () => {
  const root = parse_hson_exact_runtime("<button/>", { allowTopLevelDocumentText: true });
  const bucket = root.$_content[0];
  const node = typeof bucket === "object" && bucket !== null && "$_content" in bucket ? bucket.$_content[0] : undefined;
  if (typeof node !== "object" || node === null) throw new Error("Expected button node.");
  return node;
};
function paths(map: ReturnType<typeof hsonLiveMap.fromLibraries>): Record<string, readonly number[]> {
  const authority = internal_livemap_aggregate_authority(map);
  const system = authority.systemState("@hson/canonical-interactions/v1");
  if (system === undefined) throw new Error("Missing interaction state.");
  const value = materialize_projected_value(projected_value_from_hson_node(authority.systemRoot(system)));
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid interaction state.");
  const descriptors = value.descriptors;
  if (!Array.isArray(descriptors)) throw new Error("Invalid descriptors.");
  return Object.fromEntries(descriptors.map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)
      || typeof entry.id !== "string"
      || typeof entry.subject !== "object" || entry.subject === null || Array.isArray(entry.subject)
      || !Array.isArray(entry.subject.path)
      || !entry.subject.path.every((part) => typeof part === "number")) throw new Error("Invalid interaction descriptor.");
    return [entry.id, entry.subject.path];
  }));
}

{
  const map = admit_exact_runtime_livemap_libraries({
    page: { document: parse_hson_exact_runtime("<main <button @000007101/> <button @000007102/>/>", { allowTopLevelDocumentText: true }), schema: ButtonSchema },
  });
  enable_interactions(map);
  add_interaction(map, descriptor("a", [0, 0, 1]));
  add_interaction(map, descriptor("b", [0, 0, 1]));
  const authority = internal_livemap_aggregate_authority(map);
  const library = authority.libraries()[0]!;
  const reflection = hsonMirror(map.lib("page"));
  project_livetree(reflection.tree.node);
  const localSubject = reflection.tree.find.must.byQuid("000007102");
  const localNode = localSubject.node;
  const localElement = get_el_for_node(localNode);
  if (localElement === undefined) throw new Error("Expected local subject element.");
  const dispose = activate_interactions({ map, tree: reflection.tree, local: { run: () => undefined } });
  assert.equal((localElement as unknown as { listeners: Map<string, Set<unknown>> }).listeners.get("click")?.size, 2);
  const revision = map.rev;
  const seen: Record<string, readonly number[]>[] = [];
  const stop = authority.observe(() => seen.push(paths(map)));
  map.lib("page").document.content.insert({ kind: "path", path: [0, 0] }, 0, button());
  assert.equal(map.rev, revision + 1);
  assert.deepEqual(paths(map), { a: [0, 0, 2], b: [0, 0, 2] });
  assert.deepEqual(seen, [{ a: [0, 0, 2], b: [0, 0, 2] }]);
  assert.deepEqual(authority.documentOverlay(library).pathForQuid("000007102"), [0, 0, 2]);
  assert.equal(reflection.tree.find.must.byQuid("000007102").node, localNode);
  assert.equal((localElement as unknown as { listeners: Map<string, Set<unknown>> }).listeners.get("click")?.size, 2);
  map.lib("page").document.content.move({ kind: "path", path: [0, 0] }, 2, 0);
  assert.deepEqual(paths(map), { a: [0, 0, 0], b: [0, 0, 0] });
  assert.deepEqual(authority.documentOverlay(library).pathForQuid("000007102"), [0, 0, 0]);
  assert.equal(reflection.tree.find.must.byQuid("000007102").node, localNode);
  const beforeFailure = JSON.stringify(paths(map));
  const beforeRev = map.rev;
  assert.throws(() => map.lib("page").document.content.insert({ kind: "path", path: [0, 0] }, 99, button()));
  assert.equal(map.rev, beforeRev);
  assert.equal(JSON.stringify(paths(map)), beforeFailure);
  map.lib("page").document.content.remove({ kind: "path", path: [0, 0] }, 0);
  assert.deepEqual(paths(map), {});
  assert.equal((localElement as unknown as { listeners: Map<string, Set<unknown>> }).listeners.has("click"), false);
  map.lib("page").document.content.insert({ kind: "path", path: [0, 0] }, 0, button());
  assert.deepEqual(paths(map), {});
  stop();
  dispose(); reflection.dispose();
}

{
  const map = admit_exact_runtime_livemap_libraries({
    page: { document: parse_hson_exact_runtime("<main <button @000007201/>/>", { allowTopLevelDocumentText: true }), schema: ButtonSchema },
  });
  enable_interactions(map);
  const authority = internal_livemap_aggregate_authority(map);
  const system = authority.systemState("@hson/canonical-interactions/v1");
  if (system === undefined) throw new Error("Missing interaction system.");
  const beforeSchemaFailure = map.rev;
  assert.throws(() => authority.commit([{
    target: authority.systemTarget(system, ["descriptors"]),
    kind: "replace",
    value: [{ id: "legacy", subjectQuid: "000007201", listener, kind: "browser-local", key: "run", args: null }],
  }]), /subject|Schema/i);
  assert.throws(() => authority.commit([{
    target: authority.systemTarget(system, ["descriptors"]),
    kind: "replace",
    value: [{
      id: "hybrid", subject: { library: "page", path: [0, 0, 0] },
      subjectQuid: "000007201", listener, kind: "browser-local", key: "run", args: null,
    }],
  }]), /Schema/i);
  assert.equal(map.rev, beforeSchemaFailure);
  add_interaction(map, descriptor("replace", [0, 0, 0]));
  const before = map.rev;
  map.lib("page").document.content.replace({ kind: "path", path: [0, 0] }, 0, button());
  assert.equal(map.rev, before + 1);
  assert.deepEqual(paths(map), {});
}

{
  const authorityMap = admit_exact_runtime_livemap_libraries({
    page: { document: parse_hson_exact_runtime("<main <button @000007401/> <button @000007402/>/>", { allowTopLevelDocumentText: true }), schema: ButtonSchema },
  });
  enable_interactions(authorityMap);
  add_interaction(authorityMap, descriptor("recovered", [0, 0, 1]));
  const authority = internal_livemap_aggregate_authority(authorityMap);
  const replica = make_livemap_hosted_mirror_from_snapshot_internal(authority.captureHosted());
  assert.deepEqual(paths(replica), { recovered: [0, 0, 1] });
  const hosted = authority.commit([{
    target: authority.target(authority.libraries()[0]!, [0, 0]),
    kind: "graph",
    operation: Object.freeze({
      domain: "graph", op: "move-content",
      target: Object.freeze({ kind: "path", path: validate_document_path([0, 0]) }),
      from: 1, to: 0,
    }),
  }]).hosted;
  if (hosted === undefined) throw new Error("Expected hosted interaction transition.");
  const portable = make_portable_aggregate_commit(hosted);
  if (portable === undefined) throw new Error("Expected portable interaction transition.");
  internal_livemap_aggregate_authority(replica).replayClientHosted(portable);
  assert.deepEqual(paths(replica), { recovered: [0, 0, 0] });
  assert.equal(replica.rev, authorityMap.rev);
}

{
  const map = admit_exact_runtime_livemap_libraries({
    page: { document: parse_hson_exact_runtime("<main <button @000007501/>/>", { allowTopLevelDocumentText: true }), schema: ButtonSchema },
  });
  enable_interactions(map);
  add_interaction(map, descriptor("unresolved", [0, 0, 1]));
  assert.deepEqual(paths(map), { unresolved: [0, 0, 1] });
  map.lib("page").document.content.insert({ kind: "path", path: [0, 0] }, 1, button());
  assert.deepEqual(paths(map), { unresolved: [0, 0, 1] });
  const reflection = hsonMirror(map.lib("page"));
  project_livetree(reflection.tree.node);
  let calls = 0;
  const dispose = activate_interactions({ map, tree: reflection.tree, local: { run: () => { calls += 1; } } });
  const node = resolve_document_path(reflection.tree.node, "document", validate_document_path([0, 0, 1]));
  assert.equal(is_Node(node), true);
  if (!is_Node(node)) throw new Error("Expected realized subject.");
  get_el_for_node(node)?.dispatchEvent(new Event("click"));
  assert.equal(calls, 1);
  map.lib("page").document.content.move({ kind: "path", path: [0, 0] }, 1, 0);
  assert.deepEqual(paths(map), { unresolved: [0, 0, 0] });
  get_el_for_node(node)?.dispatchEvent(new Event("click"));
  assert.equal(calls, 2);
  map.lib("page").document.content.remove({ kind: "path", path: [0, 0] }, 0);
  assert.deepEqual(paths(map), {});
  dispose(); reflection.dispose();
}

{
  const map = admit_exact_runtime_livemap_libraries({
    page: { document: parse_hson_exact_runtime("<main <section <button @000007301/>/> <section <button @000007302/>/>/>", { allowTopLevelDocumentText: true }), schema: NestedSchema },
  });
  enable_interactions(map);
  add_interaction(map, descriptor("descendant", [0, 0, 1, 0, 0]));
  const authority = internal_livemap_aggregate_authority(map);
  const before = map.rev;
  map.lib("page").document.content.move({ kind: "path", path: [0, 0] }, 1, 0);
  assert.equal(map.rev, before + 1);
  assert.deepEqual(paths(map), { descendant: [0, 0, 0, 0, 0] });
  assert.deepEqual(authority.documentOverlay(authority.libraries()[0]!).pathForQuid("000007302"), [0, 0, 0, 0, 0]);
}

{
  const map = admit_exact_runtime_livemap_libraries({
    page: { document: parse_hson_exact_runtime("<main <section <button/> <button/>/>/>", { allowTopLevelDocumentText: true }), schema: NestedSchema },
  });
  enable_interactions(map);
  add_interaction(map, descriptor("survivor", [0, 0, 0, 0, 0]));
  add_interaction(map, descriptor("terminated", [0, 0, 0, 0, 1]));
  const replacementRoot = parse_hson_exact_runtime("<section <button/> <button/> <button/>/>", { allowTopLevelDocumentText: true });
  const replacementBucket = replacementRoot.$_content[0];
  const replacement = typeof replacementBucket === "object" && replacementBucket !== null && "$_content" in replacementBucket ? replacementBucket.$_content[0] : undefined;
  if (!is_Node(replacement)) throw new Error("Expected replacement section.");
  const authority = internal_livemap_aggregate_authority(map);
  authority.commit([{
    target: authority.target(authority.libraries()[0]!, [0, 0]),
    kind: "graph",
    operation: Object.freeze({
      domain: "graph", op: "replace-content",
      target: Object.freeze({ kind: "path", path: validate_document_path([0, 0]) }),
      index: 0, replacement,
      lineage: Object.freeze([{ source: validate_document_path([0, 0]), destination: validate_document_path([0, 2]) }]),
    }),
  }]);
  assert.deepEqual(paths(map), { survivor: [0, 0, 0, 0, 2] });
}

process.stdout.write("interaction subject path lifecycle passed\n");
