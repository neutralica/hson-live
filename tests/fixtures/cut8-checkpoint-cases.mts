import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hson, hsonLiveMap, hsonTransform } from "../../src/index.ts";
import type { HsonNode, JsonValue } from "../../src/core/types.ts";
import { is_Node } from "../../src/core/node-guards.ts";
import { validate_document_path } from "../../src/api/livemap/livemap.document.path.ts";
import { clone_node } from "../../src/core/clone-node.ts";
import { canonical_hson_graph_equal } from "../../src/core/canonical-hson-equal.ts";
import { internal_livemap_aggregate_authority, type LiveMapSemanticCheckpoint } from "../../src/api/livemap/livemap.internal.ts";
import { locus_map_internal } from "../../src/internal/governor-maps.ts";
import { CheckpointTokenDecoder, encode_checkpoint_chunks, validate_checkpoint_chunk } from "../../src/api/locus/locus.checkpoint-chunks.ts";
import { write_semantic_checkpoint } from "../../src/api/locus/locus.aggregate.persistence.ts";
import { FileCheckpointAdapter } from "../helpers/file-checkpoint-adapter.mts";
import { style_branch, style_leaf, assert_style_fidelity } from "./cut8-copy-cases.mts";

const Data = Hson.schema`<type "data">`;
const Numeric = Hson.schema`<type "data" content <negative "number" ordinary "number">>`;
const Exact = Hson.schema`<type "data" content <negative <exact -0>>>`;
const Page = Hson.schema`<type "document" tag "main" content "empty">`;
const data_fixture = (negative = -0) => ({ negative, ordinary: 0, other: 1,
  nested: { pair: [-0, 0], deeper: [{ negative: -0 }] } });
const document_fixture = (): HsonNode => ({ $_tag: "_hson_root", $_content: [style_branch()] });
function main(root: HsonNode): HsonNode {
  const node = root.$_content[0];
  assert.ok(is_Node(node));
  return node;
}
function semantic(locus: Parameters<typeof locus_map_internal>[0]): LiveMapSemanticCheckpoint {
  return internal_livemap_aggregate_authority(locus_map_internal(locus)).captureSemanticCheckpoint();
}
function library_root(checkpoint: LiveMapSemanticCheckpoint, name: string): HsonNode {
  const library = checkpoint.libraries.find(entry => entry.name === name);
  assert.ok(library);
  return library.root;
}
function decoded_root(adapter: FileCheckpointAdapter, id: string, name: string): HsonNode {
  const state = adapter.state(id);
  assert.ok(state);
  const decoder = new CheckpointTokenDecoder();
  for (const descriptor of state.checkpoint.chunks.filter(entry => entry.owner === name && entry.part === "root")) {
    decoder.feed(validate_checkpoint_chunk(adapter.chunks.get(descriptor.id), descriptor));
  }
  const value = decoder.finish();
  assert.ok(is_Node(value));
  return value;
}
function assert_checkpoint_roots(adapter: FileCheckpointAdapter, id: string, original: LiveMapSemanticCheckpoint): void {
  assert.equal(adapter.state(id)?.checkpoint.rev, original.revision);
  for (const library of original.libraries) assert.ok(canonical_hson_graph_equal(library.root, decoded_root(adapter, id, library.name)), library.name);
}
function assert_recovered(locus: Parameters<typeof locus_map_internal>[0], original: LiveMapSemanticCheckpoint): void {
  const current = semantic(locus);
  assert.equal(current.revision, original.revision);
  assert.deepEqual(current.authority, original.authority);
  assert.equal(current.registry.digest, original.registry.digest);
  assert.deepEqual(current.libraries.map(entry => entry.name), original.libraries.map(entry => entry.name));
  for (const library of original.libraries) {
    assert.ok(canonical_hson_graph_equal(library.root, library_root(current, library.name)), library.name);
    const observed = locus_map_internal(locus).lib(library.name).root();
    assert.ok(canonical_hson_graph_equal(library.root, observed));
  }
  assert_style_fidelity(main(library_root(current, "page")));
}
async function resume(adapter: FileCheckpointAdapter, id: string, data = data_fixture(), document = document_fixture()) {
  return hsonLiveMap.locus.resume({ logicalMapId: id, persistence: adapter, shared: [
    { name: "state", definition: { data, schema: Data } },
    { name: "page", definition: { document, schema: Page } },
    { name: "scalar", definition: { data: -0, schema: Data } },
    { name: "numeric", definition: { data: { negative: -0, ordinary: 0 }, schema: Numeric } },
    { name: "exact", definition: { data: { negative: -0 }, schema: Exact } },
  ] });
}

// Integrity-valid corrupt roots exercise contextual qualification independently
// of byte/checksum validation. Only the test adapter is modified.
function replace_stored_root(adapter: FileCheckpointAdapter, id: string, name: string, root: HsonNode): void {
  const state = adapter.state(id);
  assert.ok(state);
  const encoded = [...encode_checkpoint_chunks(state.checkpoint.checkpointId, state.checkpoint.rev, name, "root", root)];
  for (const { chunk } of encoded) adapter.chunks.set(chunk.id, chunk);
  let replaced = false;
  const chunks = state.checkpoint.chunks.flatMap(descriptor => {
    if (descriptor.owner !== name || descriptor.part !== "root") return [descriptor];
    if (replaced) return [];
    replaced = true;
    return encoded.map(entry => entry.descriptor);
  });
  assert.ok(replaced);
  adapter.seed(id, { checkpoint: { ...state.checkpoint, chunks }, commits: state.commits });
  adapter.flush();
}

export async function cut8_checkpoint_cases(check: (name: string, run: () => Promise<void>) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "hson-cut8-checkpoints-"));
  const fresh = (name: string) => new FileCheckpointAdapter(join(directory, `${name}.json`));
  await check("Cut 8 token bytes preserve root VAL, nested OBJ/ARR, signs and field presence", async () => {
    const values: JsonValue[] = [-0, [0, -0, 1, -1, Number.MIN_VALUE, Number.MAX_VALUE,
      Number.EPSILON, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER], { negative: -0 }, data_fixture()];
    const roots: HsonNode[] = [{ $_tag: "_hson_val", $_content: [-0] }, ...values.map(value => hsonTransform.fromJson(value).toNode())];
    for (const root of roots) {
      const encoded = [...encode_checkpoint_chunks("tokens", 0, "state", "root", root)];
      const bytes = encoded.map(entry => entry.chunk.payload).join("");
      assert.match(bytes, /\["-0"\]/);
      const decoder = new CheckpointTokenDecoder();
      for (const entry of encoded) decoder.feed(validate_checkpoint_chunk(JSON.parse(JSON.stringify(entry.chunk)), entry.descriptor));
      const result = decoder.finish();
      assert.ok(is_Node(result) && canonical_hson_graph_equal(root, result));
    }
  });
  await check("Cut 8 token bytes retain own-present undefined independently of absence/null/string", async () => {
    const document = document_fixture(), decoder = new CheckpointTokenDecoder();
    const chunks = [...encode_checkpoint_chunks("style", 0, "page", "root", document)];
    const bytes = chunks.map(entry => entry.chunk.payload).join("");
    assert.match(bytes, /\["u"\]/);
    for (const entry of chunks) decoder.feed(validate_checkpoint_chunk(JSON.parse(JSON.stringify(entry.chunk)), entry.descriptor));
    const result = decoder.finish();
    assert.ok(is_Node(result) && canonical_hson_graph_equal(result, document));
    assert_style_fidelity(main(result));
  });
  await check("Cut 8 malformed token placement and unsupported primitives reject", async () => {
    for (const payload of ['["u"]\n', '["a"]\n["u"]\n["e"]\n', '["o"]\n["u"]\n["e"]\n',
      '["u",null]\n', '["-0",0]\n', '["n",-0]\n', '["n",1e309]\n', '["n","-0"]\n']) {
      assert.throws(() => { const decoder = new CheckpointTokenDecoder(); decoder.feed(payload); decoder.finish(); });
    }
    for (const value of [undefined, [undefined], Infinity, NaN]) assert.throws(() => [...encode_checkpoint_chunks("invalid", 0, "state", "root", value)]);
    assert.throws(() => hsonTransform.fromNode({ $_tag: "_hson_val", $_content: [undefined] } as never));
    const invalid = style_branch(); style_leaf(invalid, "width").unit = null;
    assert.throws(() => hsonLiveMap.fromLibraries({ page: { document: { $_tag: "_hson_root", $_content: [invalid] } } }));
  });
  await check("Cut 8 initial disk checkpoint has no tail and resumes five exact Schema-governed libraries", async () => {
    const id = "cut8-initial", adapter = fresh(id), locus = await resume(adapter, id);
    const original = semantic(locus);
    assert_checkpoint_roots(adapter, id, original);
    assert.equal(adapter.state(id)?.commits.length, 0);
    assert_style_fidelity(main(library_root(original, "page")));
    assert.ok(Object.is(locus.lib("scalar").snap(), -0));
    locus.dispose();
    const reopened = await resume(fresh(id), id);
    try { assert_recovered(reopened, original); assert.ok(Object.is(reopened.lib("scalar").snap(), -0)); }
    finally { reopened.dispose(); }
  });
  await check("Cut 8 ordered signed-zero replay is exact before and after checkpoint coverage", async () => {
    const id = "cut8-ordered", adapter = fresh(id), locus = await resume(adapter, id, data_fixture(0));
    const initial = semantic(locus);
    await hsonLiveMap.locus.checkpoint(locus);
    assert_checkpoint_roots(adapter, id, initial);
    await locus.stage(draft => { draft.lib("state").at(["negative"]).set(-0); });
    await locus.stage(draft => { draft.lib("state").at(["other"]).set(2); });
    assert.deepEqual(adapter.state(id)?.commits.map(record => [record.commit.prevRev, record.commit.rev]), [[0, 1], [1, 2]]);
    const operation = adapter.state(id)!.commits[0]!.commit.operations[0]!;
    assert.ok(operation.domain !== "document");
    assert.match(operation.payload, /-0/);
    assert_checkpoint_roots(adapter, id, initial);
    const expected = semantic(locus); locus.dispose();
    const reopenedAdapter = fresh(id), reopened = await resume(reopenedAdapter, id, data_fixture(0));
    try {
      assert_recovered(reopened, expected);
      assert.ok(Object.is(reopened.lib("state").snap(["negative"]), -0));
      await hsonLiveMap.locus.checkpoint(reopened);
      assert_checkpoint_roots(reopenedAdapter, id, expected);
      assert.equal(reopenedAdapter.state(id)?.commits.length, 0);
    } finally { reopened.dispose(); }
    const compacted = await resume(fresh(id), id, data_fixture(0));
    try { assert_recovered(compacted, expected); } finally { compacted.dispose(); }
  });
  await check("Cut 8 unrelated replay cannot mask checkpoint sign or style-unit loss", async () => {
    const id = "cut8-unrelated", adapter = fresh(id), locus = await resume(adapter, id);
    const initial = semantic(locus);
    await locus.stage(draft => { draft.lib("state").at(["other"]).set(2); });
    assert_checkpoint_roots(adapter, id, initial);
    const expected = semantic(locus); locus.dispose();
    const reopened = await resume(fresh(id), id);
    try { assert_recovered(reopened, expected); assert.equal(reopened.rev, 1); } finally { reopened.dispose(); }
  });
  await check("Cut 8 graph replacement replay is checked independently of its checkpoint baseline", async () => {
    const id = "cut8-replacement", adapter = fresh(id), locus = await resume(adapter, id);
    const initial = semantic(locus), replacement = style_branch();
    replacement.$_attrs!.title = "replacement";
    await locus.stage(draft => { draft.lib("page").content.replace({ kind: "path", path: validate_document_path([]) }, 0, replacement); });
    assert_checkpoint_roots(adapter, id, initial);
    const expected = semantic(locus); locus.dispose();
    const reopened = await resume(fresh(id), id);
    try { assert_recovered(reopened, expected); assert.equal(reopened.rev, 1); }
    finally { reopened.dispose(); }
  });
  await check("Cut 8 repeated disk recovery/checkpoint cycles retain signs, presence, authority and no-op revision", async () => {
    const id = "cut8-cycles";
    let adapter = fresh(id), locus = await resume(adapter, id);
    const original = semantic(locus);
    for (let cycle = 0; cycle < 3; cycle++) {
      await hsonLiveMap.locus.checkpoint(locus);
      assert_checkpoint_roots(adapter, id, original);
      assert.equal(adapter.state(id)?.commits.length, 0);
      assert.doesNotMatch([...adapter.chunks.values()].map(chunk => chunk.payload).join(""), /issuedQuids|identityEpoch|\["k","quid"/);
      locus.dispose(); adapter = fresh(id); locus = await resume(adapter, id);
      assert_recovered(locus, original);
      await locus.stage(draft => { draft.lib("state").at(["negative"]).set(-0); });
      assert.equal(locus.rev, 0);
    }
    locus.dispose();
  });
  await check("Cut 8 exact prefixes reject both sign/presence directions and nested/order mismatches before activation", async () => {
    const id = "cut8-prefix", adapter = fresh(id), locus = await resume(adapter, id);
    const original = semantic(locus);
    const mismatch = async (name: string, edit: (copy: LiveMapSemanticCheckpoint) => void) => {
      const proposed = clone_node(original); edit(proposed);
      const active = adapter.state(id)!.checkpoint.checkpointId, staged = adapter.chunks.size, writes = adapter.checkpointCalls.length;
      await assert.rejects(() => write_semantic_checkpoint(proposed, adapter), /invalid/i, name);
      assert.equal(adapter.state(id)!.checkpoint.checkpointId, active);
      assert.equal(adapter.chunks.size, staged, "rejection precedes chunk staging");
      assert.equal(adapter.checkpointCalls.length, writes, "rejection precedes manifest/activation");
    };
    await mismatch("persisted -0 versus proposed +0", copy => { style_leaf(main(library_root(copy, "page")), "width").value = 0; });
    await mismatch("persisted +0 versus proposed -0", copy => { style_leaf(main(library_root(copy, "page")), "height").value = -0; });
    await mismatch("persisted present undefined versus absent", copy => { delete style_leaf(main(library_root(copy, "page")), "width").unit; });
    await mismatch("persisted absent versus present undefined", copy => { style_leaf(main(library_root(copy, "page")), "height").unit = undefined; });
    await mismatch("nested data signed zero", copy => {
      const altered = hsonLiveMap.fromLibraries({ state: { data: { ...data_fixture(), nested: { pair: [0, 0], deeper: [{ negative: -0 }] } }, schema: Data } });
      library_root(copy, "state").$_content = altered.lib("state").root().$_content;
    });
    await mismatch("ordered object members", copy => {
      const object = main(library_root(copy, "state")); object.$_content.reverse();
    });
    await mismatch("library order", copy => {
      const roots = [...copy.libraries].reverse();
      Object.defineProperty(copy, "libraries", { value: roots });
    });
    await assert.doesNotReject(() => write_semantic_checkpoint(semantic(locus), adapter));
    assert_checkpoint_roots(adapter, id, original);
    locus.dispose();
  });
  await check("Cut 8 initially ordinary-zero/absent-unit prefix rejects uncommitted sign and presence changes", async () => {
    const map = hsonLiveMap.fromLibraries({ page: { document: { $_tag: "_hson_root", $_content: [{ $_tag: "main",
      $_attrs: { style: { width: { value: 0 } } }, $_content: [] }] }, schema: Page } });
    const original = internal_livemap_aggregate_authority(map).captureSemanticCheckpoint();
    const adapter = fresh("cut8-minimal-prefix");
    await write_semantic_checkpoint(original, adapter);
    for (const change of ["sign", "presence"] as const) {
      const proposed = clone_node(original), width = style_leaf(main(library_root(proposed, "page")), "width");
      if (change === "sign") width.value = -0; else width.unit = undefined;
      const prior = adapter.state(original.authority.logicalMapId)!, chunks = adapter.chunks.size, manifests = adapter.checkpointCalls.length;
      await assert.rejects(() => write_semantic_checkpoint(proposed, adapter), /invalid/i);
      assert.deepEqual(adapter.state(original.authority.logicalMapId), prior);
      assert.equal(adapter.chunks.size, chunks);
      assert.equal(adapter.checkpointCalls.length, manifests);
    }
    await assert.doesNotReject(() => write_semantic_checkpoint(clone_node(original), adapter));
  });
  await check("Cut 8 integrity-valid illegal style units and negative-zero Schema mismatch fail before recovered authority", async () => {
    for (const target of ["page", "exact", "attribute"] as const) {
      const id = `cut8-invalid-${target}`, adapter = fresh(id), locus = await resume(adapter, id);
      const original = semantic(locus), saved = adapter.state(id)!, chunks = new Map(adapter.chunks);
      const name = target === "attribute" ? "page" : target;
      const invalid = clone_node(library_root(original, name));
      if (target === "page") style_leaf(main(invalid), "width").unit = null;
      else if (target === "attribute") main(invalid).$_attrs!.count = undefined;
      else invalid.$_content = hsonLiveMap.fromLibraries({ wrong: { data: { negative: 0 } } }).lib("wrong").root().$_content;
      replace_stored_root(adapter, id, name, invalid);
      const corrupt = adapter.state(id);
      const reopening = fresh(id);
      await assert.rejects(() => resume(reopening, id), /invalid/i);
      assert.equal(reopening.checkpointCalls.length, 0);
      assert.equal(reopening.appendCalls.length, 0);
      assert.deepEqual(reopening.state(id), corrupt);
      assert_recovered(locus, original);
      locus.dispose();
      adapter.chunks.clear(); for (const [key, value] of chunks) adapter.chunks.set(key, value);
      adapter.seed(id, saved); adapter.flush();
      const valid = await resume(fresh(id), id);
      try { assert_recovered(valid, original); } finally { valid.dispose(); }
    }
  });
  await check("Cut 8 covered tail after pruning failure resumes once and maintains next revision", async () => {
    const id = "cut8-prune", adapter = fresh(id), locus = await resume(adapter, id, data_fixture(0));
    await locus.stage(draft => { draft.lib("state").at(["negative"]).set(-0); });
    const expected = semantic(locus);
    adapter.failPrune = new Error("simulated crash after activation");
    await assert.rejects(hsonLiveMap.locus.checkpoint(locus));
    assert.equal(adapter.state(id)?.checkpoint.rev, 1);
    assert.deepEqual(adapter.state(id)?.commits.map(record => record.commit.rev), [1]);
    assert_checkpoint_roots(adapter, id, expected); locus.dispose();
    const reopenedAdapter = fresh(id), reopened = await resume(reopenedAdapter, id, data_fixture(0));
    try {
      assert_recovered(reopened, expected);
      let notifications = 0;
      const stop = locus_map_internal(reopened).commits.observe(() => notifications++);
      await reopened.stage(draft => { draft.lib("state").at(["other"]).set(2); });
      stop();
      assert.equal(notifications, 1);
      assert.equal(reopened.rev, 2);
      assert.deepEqual(reopenedAdapter.state(id)?.commits.map(record => record.commit.rev), [1, 2]);
      await hsonLiveMap.locus.checkpoint(reopened);
      assert.equal(reopenedAdapter.state(id)?.commits.length, 0);
      assert_checkpoint_roots(reopenedAdapter, id, semantic(reopened));
    } finally { reopened.dispose(); }
  });
}
