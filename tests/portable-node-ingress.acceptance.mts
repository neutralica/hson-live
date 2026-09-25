// @hson-live-external-test
import assert from "node:assert/strict";
import { Hson } from "../src/hson-authoring.ts";
import { hson } from "../src/hson.ts";
import { hsonTransform } from "../src/api/transform/transform.facade.ts";
import { UNSAFE_TRANSFORM_SOURCE } from "../src/api/transform/transform.browser.ts";
import { hsonLiveMap } from "../src/api/livemap/livemap.facade.ts";
import { hsonLiveTree } from "../src/api/livetree/livetree.facade.ts";
import { LiveTree } from "../src/api/livetree/livetree.ts";
import { default_livetree_runtime } from "../src/api/livetree/runtime/livetree-runtime.ts";
import { read_transform_error_details } from "../src/core/errors.ts";
import { read_hson_node_quid } from "../src/core/hson-node-quid.ts";
import type { HsonNode } from "../src/core/types.ts";

const schema = Hson.schema`<type "document" tag "main" content "empty">`;
const authored: HsonNode = { $_tag: "_hson_root", $_content: [{ $_tag: "main", $_content: [] }] };
const activeRoot: HsonNode = { $_tag: "main", $_content: [] };
const source = hsonTransform.fromNode(activeRoot);
const tree = new LiveTree(activeRoot);
const localQuid = tree.quid;
assert.equal(read_hson_node_quid(source.toNode()), localQuid);

function forbidden(run: () => unknown): void {
  const before = new Set(default_livetree_runtime().issuedQuids);
  let observed: unknown;
  try { run(); } catch (error) { observed = error; }
  assert.equal(read_transform_error_details(observed)?.code, "PORTABLE_RUNTIME_QUID_FORBIDDEN");
  assert.deepEqual(default_livetree_runtime().issuedQuids, before);
}

// Local inspection may carry identity. JSON reconstruction must not authorize it.
const reconstructed = JSON.parse(JSON.stringify(source.toNode())) as HsonNode;
const reconstructedBefore = structuredClone(reconstructed);
assert.equal(read_hson_node_quid(reconstructed), localQuid);
forbidden(() => hson.fromNode(reconstructed));
forbidden(() => hsonTransform.fromNode(reconstructed));
forbidden(() => UNSAFE_TRANSFORM_SOURCE.fromNode(reconstructed));
forbidden(() => hsonLiveTree.fromNode(reconstructed));
forbidden(() => new LiveTree(reconstructed));
forbidden(() => hsonLiveMap.fromLibraries({ page: { document: { $_tag: "_hson_root", $_content: [reconstructed] }, schema } }));
forbidden(() => Hson.document.fromNode({ $_tag: "_hson_root", $_content: [reconstructed] }));
forbidden(() => hsonLiveMap.fromLibraries({ page: {
  document: { $_tag: "_hson_root", $_content: [reconstructed] }, schema,
} }));
assert.deepEqual(reconstructed, reconstructedBefore);

const handAuthored: HsonNode = { $_tag: "main", $_content: [], $_meta: { quid: "000000001" } };
forbidden(() => hsonTransform.fromNode(handAuthored));
forbidden(() => hsonLiveTree.fromNode(handAuthored));
forbidden(() => hsonLiveMap.fromLibraries({ page: { document: { $_tag: "_hson_root", $_content: [handAuthored] }, schema } }));

// Other metadata remains admitted, and a fresh runtime can acquire its own QUID.
// Index evidence is valid only on an indexed structural node, so use an array
// parsed through the ordinary JSON route rather than inventing placement.
const indexed = hsonTransform.fromJson([1]).toNode();
assert.deepEqual(hsonTransform.fromNode(indexed).toNode(), indexed);
assert.equal(hsonTransform.fromNode({ $_tag: "main", $_content: [] }).toHson().serialize(), "<main/>");
const admittedTree = hsonLiveTree.fromNode({ $_tag: "main", $_content: [] }, { isolated: true });
assert.notEqual(admittedTree.quid, localQuid);
assert.equal(hsonLiveMap.fromLibraries({ page: { document: authored, schema } }).lib("page").mode, "document");

// All four portable carriers omit the active claim and do not inherit it.
const hsonWire = source.toHson().serialize();
const jsonWire = source.toJson().serialize();
const binaryWire = source.toBinary().serialize();
const htmlWire = source.toHtml().serialize();
assert.doesNotMatch(hsonWire, /@(?:[0-9a-z]{9})/);
assert.doesNotMatch(jsonWire, /"quid"/);
assert.doesNotMatch(htmlWire, /hson:quid/);
for (const decoded of [
  hsonTransform.fromHson(hsonWire).toNode(),
  hsonTransform.fromBinary(binaryWire).toNode(),
  hsonTransform.fromTrustedHtml(htmlWire).toNode(),
]) {
  assert.doesNotMatch(JSON.stringify(decoded), /"quid"/);
}
assert.equal(hsonTransform.fromHson(hsonWire).toHson().serialize(), hsonWire);
assert.equal(hsonTransform.fromBinary(binaryWire).toHson().serialize(), hsonWire);
assert.equal(hsonTransform.fromTrustedHtml(htmlWire).toHson().serialize(), hsonWire);

// JSON's ordinary application projection has its own active graph fixture.
const dataSource = hsonTransform.fromJson({ main: "" });
const dataRoot = dataSource.toNode();
const object = dataRoot.$_content[0] as HsonNode;
const member = object.$_content[0] as HsonNode;
const dataTree = new LiveTree(member);
assert.equal(read_hson_node_quid(member), dataTree.quid);
const applicationJson = dataSource.toJson().serialize();
assert.doesNotMatch(applicationJson, /"quid"/);
const receivedData = hsonTransform.fromJson(applicationJson);
assert.deepEqual(receivedData.toJson().value(), dataSource.toJson().value());
assert.doesNotMatch(JSON.stringify(receivedData.toNode()), /"quid"/);

process.stdout.write("portable node admission and active runtime round trips passed\n");
