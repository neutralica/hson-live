import assert from "node:assert/strict";
import { Hson, hsonLiveMap, hsonMirror } from "../../src/index.ts";
import type { LiveMapGraphReplaceContentOp } from "../../src/types/livemap.types.ts";
import { internal_livemap_aggregate_authority } from "../../src/api/livemap/livemap.internal.ts";
import { lookup_document_quad_internal } from "../../src/api/livemap/livemap.document.quad.ts";
import { assign_hson_node_quid } from "../../src/core/hson-node-quid.ts";
import { validate_document_path } from "../../src/api/livemap/livemap.document.path.ts";
import { prepare_document_graph_operation } from "../../src/api/livemap/livemap.document.mutation.ts";
import type { DocumentGraphReplaceContentOp } from "../../src/api/livemap/livemap.document.lineage.ts";
import { resolve_locus_document_action } from "../../src/api/locus/locus.document-actions.ts";
import { encode_locus_portable_graph_content } from "../../src/api/locus/locus.graph-content-codec.ts";
import type { LocusDocumentActionPayloads } from "../../src/types/locus.protocol.types.ts";
import type { HsonNode } from "../../src/core/types.ts";
import { install_fake_document } from "../helpers/fake-document.mts";
import { retained_subject } from "../helpers/retained-livetree-subject.mts";
import { raw_node, mount } from "../helpers/mirror-unit6.mts";
import { get_el_for_node } from "../../src/api/livetree/utils/node-map-helpers.ts";
// @ts-expect-error Caller-authored lineage has no public exported type.
import type { LiveMapReplacementLineage } from "../../src/api/livemap/index.ts";

const fixture = () => hsonLiveMap.fromLibraries({ page: { document: '<main <button @:keep/>/>', schema: Hson.schema`<type "document" tag "main" content <repeat <tag "button" content "empty">>>` }, state: { data: { n: 0 } } });
const target = { kind: "path" as const, path: validate_document_path([0, 0]) };
const replacement = (): HsonNode => ({ $_tag: "button", $_content: [] });
const obsolete = [{ source: [], destination: [] }];

function public_types(): void {
  const map = fixture(), page = map.doc.must("page");
  // @ts-expect-error No fourth argument, including an explicitly undefined one.
  page.document.content.replace(target, 0, replacement(), undefined);
  const op: LiveMapGraphReplaceContentOp = { domain: "graph", op: "replace-content", target, index: 0, replacement: replacement(),
    // @ts-expect-error Public graph instructions cannot author correspondence.
    lineage: obsolete };
  map.batch(draft => draft.doc.must("page").graph({ domain: "graph", op: "replace-content", target, index: 0, replacement: replacement(),
    // @ts-expect-error The batch graph entrypoint has no lineage property.
    lineage: obsolete }));
  const action: LocusDocumentActionPayloads["document.content.replace"] = { target, index: 0, replacement: replacement(),
    // @ts-expect-error Hosted actions cannot author correspondence.
    lineage: obsolete };
  void action;
  // @ts-expect-error Public commit declarations do not expose private correspondence.
  void op.lineage;
}
void public_types;

export function document_replacement_boundary_cases(check: (name: string, run: () => void) => void): void {
  install_fake_document();
  for (const staged of [false, true]) check(`${staged ? "staged" : "direct"} equal replacement retires the displaced identity and QUAD`, () => {
    const map = fixture(), page = map.doc.must("page"), old = page.q("keep")!;
    const quid = lookup_document_quad_internal(page, "keep")!.quid, before = page.root();
    if (staged) map.batch(draft => draft.doc.must("page").graph({ domain: "graph", op: "replace-content", target, index: 0, replacement: replacement() }));
    else page.document.content.replace(target, 0, replacement());
    assert.deepEqual(page.root(), before); assert.equal(old.active, false);
    assert.equal(page.q("keep"), undefined); assert.equal(page.document.byQuid(quid), undefined);
    assert.ok(internal_livemap_aggregate_authority(map).identityEpoch().issued().has(quid));
    assert.equal(map.rev, 1);
  });
  check("obsolete positional arguments reject before mutation, including undefined and empty lineage", () => {
    const map = fixture(), page = map.doc.must("page"), before = map.capture();
    let commits = 0; map.commits.observe(() => commits++);
    for (const value of [undefined, [], obsolete]) {
      assert.throws(() => Reflect.apply(page.document.content.replace, undefined, [target, 0, replacement(), value]), /lineage.*unsupported/);
      assert.deepEqual(map.capture(), before); assert.equal(page.q("keep")!.active, true);
      assert.throws(() => map.batch(draft => {
        draft.data.must("state").at(["n"]).set(1);
        Reflect.apply(draft.doc.must("page").content.replace, undefined, [target, 0, replacement(), value]);
      }), /lineage.*unsupported/);
      assert.deepEqual(map.capture(), before);
    }
    assert.equal(commits, 0);
  });
  check("obsolete graph fields reject atomically after earlier staged writes", () => {
    const map = fixture(), before = map.capture();
    for (const lineage of [undefined, [], obsolete]) {
      const operation = { domain: "graph" as const, op: "replace-content" as const, target, index: 0, replacement: replacement(), lineage };
      assert.throws(() => map.batch(draft => { draft.data.must("state").at(["n"]).set(1); draft.doc.must("page").graph(operation); }), /field|storage/i);
      assert.deepEqual(map.capture(), before);
    }
    const hidden = Object.defineProperty({ domain: "graph" as const, op: "replace-content" as const, target, index: 0, replacement: replacement() }, "lineage", { value: obsolete });
    assert.throws(() => map.batch(draft => draft.doc.must("page").graph(hidden)));
    assert.deepEqual(map.capture(), before);
  });
  check("Locus replacement actions reject client-authored correspondence", () => {
    const map = fixture(), page = map.doc.must("page"), before = map.capture();
    const payload = { target: { kind: "path", path: [...target.path] }, index: 0, replacement: encode_locus_portable_graph_content(replacement()) };
    for (const lineage of [[], obsolete]) {
      assert.equal(resolve_locus_document_action(page, "document.content.replace", { ...payload, lineage }).kind, "invalid");
      assert.deepEqual(map.capture(), before);
    }
    assert.equal(resolve_locus_document_action(page, "document.content.replace", payload).kind, "ready");
  });
  check("internal exact evidence automatically preserves sparse identity, projected node, DOM and listeners", () => {
    const map = fixture(), page = map.doc.must("page"), old = page.q("keep")!;
    const authority = internal_livemap_aggregate_authority(map), id = authority.libraries()[0]!;
    const quid = lookup_document_quad_internal(page, "keep")!.quid;
    const binding = hsonMirror(page), node = raw_node(retained_subject(binding.tree), [0, 0]);
    mount(retained_subject(binding.tree)); const native = get_el_for_node(node);
    const tree = binding.tree.find.byQuid(quid)!; let calls = 0;
    tree.events.on("probe", () => calls++);
    const next = replacement(); next.$_attrs = { title: "exact" }; assign_hson_node_quid(next, quid);
    const accepted = authority.commit([{ target: authority.target(id, target.path), kind: "graph", operation: {
      domain: "graph", op: "replace-content", target, index: 0, replacement: next,
    } }]);
    const operation = accepted.operations[0]?.operation;
    assert.ok(operation && "op" in operation && operation.op === "replace-content");
    const internal: DocumentGraphReplaceContentOp = operation;
    assert.deepEqual(internal.lineage, [{ source: [], destination: [] }]);
    assert.equal(old.active, true); assert.equal(old.attrs.get("title"), "exact");
    assert.equal(raw_node(retained_subject(binding.tree), [0, 0]), node); assert.equal(get_el_for_node(node), native);
    tree.events.emit("probe"); assert.equal(calls, 1); assert.equal(binding.status, "active");
    page.document.content.replace(target, 0, replacement());
    assert.equal(old.active, false); assert.throws(() => tree.events.emit("probe"), /disposed|active|retired/i);
    binding.dispose();
  });
  check("invalid internal correspondence fails without changing graph or overlay", () => {
    const map = fixture(), page = map.doc.must("page"), authority = internal_livemap_aggregate_authority(map), id = authority.libraries()[0]!;
    const before = map.capture(), root = authority.root(id), overlay = authority.documentOverlay(id);
    assert.throws(() => prepare_document_graph_operation(root, "document", { domain: "graph", op: "replace-content", target, index: 0,
      replacement: replacement(), lineage: [{ source: [99], destination: [] }] }, overlay));
    assert.deepEqual(map.capture(), before); assert.equal(authority.documentOverlay(id), overlay); assert.equal(page.q("keep")!.active, true);
  });
}
