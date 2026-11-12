import assert from "node:assert/strict";
import { hsonLiveMap, add_interaction, replace_interaction, remove_interaction, enable_interactions,
  activate_interactions, hsonMirror, type InteractionDescriptor } from "../../src/index.ts";
import { locus_map_internal } from "../../src/internal/governor-maps.ts";
import { internal_livemap_aggregate_authority } from "../../src/api/livemap/livemap.internal.ts";
import { node_to_json_value } from "../../src/api/livemap/livemap.editor.ts";
import { validate_document_path, resolve_document_path } from "../../src/api/livemap/livemap.document.path.ts";
import { is_Node } from "../../src/core/node-guards.ts";
import { FakeElement, install_fake_document } from "../helpers/fake-document.mts";
import { get_el_for_node } from "../../src/api/livetree/utils/node-map-helpers.ts";
import { project_livetree } from "../../src/api/livetree/creation/project-live-tree.ts";
import { retained_subject } from "../helpers/retained-livetree-subject.mts";

export async function mixed_stage_interaction_cases(): Promise<void> {
  install_fake_document();
  const parent = [0, 0, 1, 0, 0, 0];
  const path = (index: number) => [...parent, index];
  const listener = { event: "click", target: "element", capture: false, once: false, passive: false,
    missingTarget: "throw", preventDefault: false, stopPropagation: false, stopImmediatePropagation: false } as const;
  const descriptor = (id: string, index: number): InteractionDescriptor => ({ id, subject: { library: "page", path: path(index) },
    listener, kind: "browser", key: id, args: null });
  function fixture() {
    const map = hsonLiveMap.fromLibraries({ page: { document: '<main <button id="one"/> <button id="two"/>/>' } });
    enable_interactions(map);
    add_interaction(map, descriptor("existing", 0));
    add_interaction(map, descriptor("other", 1));
    return map;
  }
  function subjects(map: ReturnType<typeof fixture>) {
    const aggregate = internal_livemap_aggregate_authority(map);
    const system = aggregate.systemState("@hson/canonical-interactions");
    assert.ok(system);
    const value = node_to_json_value(aggregate.systemRoot(system));
    assert.ok(value && typeof value === "object" && !Array.isArray(value) && Array.isArray(value.descriptors));
    return Object.fromEntries(value.descriptors.map(entry => {
      assert.ok(entry && typeof entry === "object" && !Array.isArray(entry));
      const subject = entry.subject;
      assert.ok(subject && typeof subject === "object" && !Array.isArray(subject) && Array.isArray(subject.path));
      assert.ok(subject.path.every((part): part is number => typeof part === "number"));
      const node = resolve_document_path(map.doc.must("page").root(), "document", validate_document_path(subject.path));
      assert.ok(is_Node(node));
      return [String(entry.id), { path: subject.path, target: node.$_attrs?.id }];
    }));
  }
  const at = (index: number, target: string) => ({ path: path(index), target });
  for (const order of ["add-first", "move-first", "replace", "remove", "multiple", "delete"] as const) {
    const map = fixture();
    map.batch(stage => {
      const doc = stage.doc.must("page");
      if (order === "add-first") add_interaction(stage, descriptor("new", 0));
      doc.content.move({ kind: "path", path: parent }, 0, 1);
      if (order === "move-first") add_interaction(stage, descriptor("new", 0));
      if (order === "replace") replace_interaction(stage, descriptor("other", 0));
      if (order === "remove") remove_interaction(stage, "other");
      if (order === "multiple") {
        add_interaction(stage, descriptor("new", 0));
        doc.content.move({ kind: "path", path: parent }, 0, 1);
        replace_interaction(stage, descriptor("other", 1));
        remove_interaction(stage, "new");
        add_interaction(stage, descriptor("last", 0));
      }
      if (order === "delete") {
        doc.content.remove({ kind: "path", path: parent }, 1);
        add_interaction(stage, descriptor("new", 0));
      }
    });
    const expected = order === "multiple" ? { existing: at(0, "one"), other: at(1, "two"), last: at(0, "one") }
      : order === "delete" ? { other: at(0, "two"), new: at(0, "two") }
      : { existing: at(1, "one"), ...(order === "remove" ? {} : { other: at(0, "two") }),
        ...(order === "add-first" ? { new: at(1, "one") } : order === "move-first" ? { new: at(0, "two") } : {}) };
    assert.deepEqual(subjects(map), expected, order);
  }
  for (const failure of ["duplicate", "missing", "deleted-missing", "invalid-final"] as const) {
    const map = fixture();
    const aggregate = internal_livemap_aggregate_authority(map);
    const before = JSON.stringify(aggregate.captureHosted());
    const epoch = aggregate.identityEpoch();
    let commits = 0;
    const stop = map.commits.observe(() => commits++);
    assert.throws(() => map.batch(stage => {
      const doc = stage.doc.must("page");
      doc.content.move({ kind: "path", path: parent }, 0, 1);
      add_interaction(stage, descriptor("valid-group-member", 0));
      if (failure === "duplicate") add_interaction(stage, descriptor("existing", 0));
      if (failure === "missing") remove_interaction(stage, "missing");
      if (failure === "deleted-missing") {
        doc.content.remove({ kind: "path", path: parent }, 1);
        remove_interaction(stage, "existing");
      }
      if (failure === "invalid-final") add_interaction(stage, { ...descriptor("invalid", 0), subject: { library: "missing", path: path(0) } });
    }), failure === "duplicate" ? /already exists/ : failure === "invalid-final" ? /document Library/ : /does not exist/);
    assert.equal(JSON.stringify(aggregate.captureHosted()), before, failure);
    assert.equal(aggregate.identityEpoch(), epoch);
    assert.equal(commits, 0);
    assert.deepEqual(subjects(map), { existing: at(0, "one"), other: at(1, "two") });
    stop();
  }

  // Actual activation must stay on the original button after a hosted mixed stage.
  const locus = hsonLiveMap.locus.create({ page: { access: "shared", document: '<main <button id="one"/> <button id="two"/>/>' } }, {
    interactions: [descriptor("existing", 0)],
  });
  const map = locus_map_internal(locus);
  const reflection = hsonMirror(locus.doc.must("page"));
  project_livetree(retained_subject(reflection.tree));
  const one = reflection.tree.find.must.byId("one"), two = reflection.tree.find.must.byId("two");
  const oneNode = retained_subject(one), twoNode = retained_subject(two);
  const oneEl = get_el_for_node(oneNode), twoEl = get_el_for_node(twoNode);
  assert.ok(oneEl instanceof FakeElement && twoEl instanceof FakeElement);
  const calls: string[] = [];
  map.behaviors.define("existing", () => { calls.push("one"); });
  map.behaviors.define("new", () => { calls.push("two"); });
  const dispose = activate_interactions({ map, tree: reflection.tree });
  const beforeFailure = JSON.stringify(internal_livemap_aggregate_authority(map).captureHosted());
  await assert.rejects(locus.stage(stage => {
    stage.doc.must("page").content.move({ kind: "path", path: parent }, 0, 1);
    add_interaction(stage, descriptor("group-member", 0));
    add_interaction(stage, descriptor("existing", 0));
  }), /already exists/);
  assert.equal(JSON.stringify(internal_livemap_aggregate_authority(map).captureHosted()), beforeFailure);
  await locus.stage(stage => {
    stage.doc.must("page").content.move({ kind: "path", path: parent }, 0, 1);
    add_interaction(stage, descriptor("new", 0));
  });
  assert.deepEqual(subjects(map), { existing: at(1, "one"), new: at(0, "two") });
  assert.equal(retained_subject(reflection.tree.find.must.byId("one")), oneNode);
  assert.equal(retained_subject(reflection.tree.find.must.byId("two")), twoNode);
  assert.equal(oneEl.listeners.get("click")?.size, 1);
  assert.equal(twoEl.listeners.get("click")?.size, 1);
  oneEl.dispatchEvent(new Event("click"));
  assert.deepEqual(calls, ["one"]);
  twoEl.dispatchEvent(new Event("click"));
  assert.deepEqual(calls, ["one", "two"]);
  // Path maintenance alone must not rearm a consumed once listener.
  await locus.stage(stage => replace_interaction(stage, { ...descriptor("existing", 1), listener: { ...listener, once: true } }));
  calls.length = 0;
  oneEl.dispatchEvent(new Event("click"));
  assert.deepEqual(calls, ["one"]);
  await locus.stage(stage => {
    stage.doc.must("page").content.move({ kind: "path", path: parent }, 0, 1);
    add_interaction(stage, descriptor("temporary", 0));
    remove_interaction(stage, "temporary");
  });
  assert.deepEqual(subjects(map), { existing: at(0, "one"), new: at(1, "two") });
  oneEl.dispatchEvent(new Event("click"));
  assert.deepEqual(calls, ["one"]);
  assert.equal(oneEl.listeners.get("click")?.size ?? 0, 0);
  dispose(); reflection.dispose(); locus.dispose();
}
