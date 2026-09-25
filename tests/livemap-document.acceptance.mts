import { create_test_event_emitter } from "./test-events.mjs";
import { parse_hson_exact_runtime } from "../src/internal/exact-runtime-hson-codec.ts";
import { admit_exact_runtime_livemap_libraries } from "../src/internal/exact-runtime-node-admission.ts";
import assert from "node:assert/strict";
import { hson, hsonLiveMap, hsonTransform } from "../src/hson.ts";
import { Hson } from "../src/index.ts";
import type { HsonNode, NodeContent, Primitive } from "../src/core/types.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.document",
  title: "Document LiveMap",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["document", "construction", "identity"]),
});

const testEvents = create_test_event_emitter("livemap.document");
let checks = 0;

function check(name: string, fn: () => void): void {

  testEvents.case_begin(name, name);
  try {
    fn();
    testEvents.case_end(name, "pass");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Check failed.";
    testEvents.diagnostic(name, "assertion", message.slice(0, 1_000));
    testEvents.case_end(name, "fail");
    testEvents.terminal("fail");
    throw error;
  }
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function is_node(value: HsonNode | Primitive): value is HsonNode {
  return typeof value === "object" && value !== null && "$_tag" in value;
}

function find_nodes(root: HsonNode, tag: string): HsonNode[] {
  const found: HsonNode[] = [];
  const visit = (node: HsonNode): void => {
    if (node.$_tag === tag) found.push(node);
    for (const child of node.$_content) if (is_node(child)) visit(child);
  };
  visit(root);
  return found;
}

function assert_fully_detached(left: HsonNode, right: HsonNode): void {
  assert.notEqual(left, right);
  assert.notEqual(left.$_content, right.$_content);
  assert.deepEqual(left, right);
  if (left.$_attrs !== undefined && right.$_attrs !== undefined) {
    assert.notEqual(left.$_attrs, right.$_attrs);
    if (typeof left.$_attrs.style === "object" && left.$_attrs.style !== null
      && typeof right.$_attrs.style === "object" && right.$_attrs.style !== null) {
      assert.notEqual(left.$_attrs.style, right.$_attrs.style);
    }
  }
  if (left.$_meta !== undefined && right.$_meta !== undefined) {
    assert.notEqual(left.$_meta, right.$_meta);
  }
  for (let index = 0; index < left.$_content.length; index += 1) {
    const leftChild = left.$_content[index];
    const rightChild = right.$_content[index];
    if (leftChild !== undefined && rightChild !== undefined && is_node(leftChild) && is_node(rightChild)) {
      assert_fully_detached(leftChild, rightChild);
    }
  }
}

function mutate_graph(root: HsonNode): void {
  root.$_tag = "mutated-root";
  root.$_meta = { quid: "000000010" };
  const nodes = find_nodes(root, "main");
  const main = nodes[0];
  if (main !== undefined) {
    main.$_tag = "changed-main";
    main.$_attrs = { id: "changed", style: { color: "purple", ":hover": { color: "orange" } } };
    main.$_meta = { quid: "000000011" };
    main.$_content.push({ $_tag: "added", $_content: [] });
  }
  root.$_content.push({ $_tag: "detached", $_content: [] });
}

function mutate_content(content: readonly NodeContent[number][]): void {
  const mutable = content as NodeContent;
  const firstNode = mutable.find(is_node);
  if (firstNode !== undefined) {
    firstNode.$_tag = "changed";
    firstNode.$_content.push({ $_tag: "nested-change", $_content: [] });
    firstNode.$_attrs = { id: "changed" };
    firstNode.$_meta = { quid: "000000011" };
  }
  mutable.push({ $_tag: "changed-content", $_content: [] });
}

const MainText = Hson.schema`<type "document" tag "main" content "string">`;
const MainP = Hson.schema`<type "document" tag "main" content <sequence [<tag "p" content "string">]>>`;
const MainTwoP = Hson.schema`<type "document" tag "main" content <repeat <tag "p" content "string"> count 2>>`;
const EmptyDocument = Hson.schema`<type "document" content <sequence []>>`;
const TextDocument = Hson.schema`<type "document" content "string">`;
const NumberData = Hson.schema`<type "data" content <value "number">>`;
const NumberArray = Hson.schema`<type "data" defs <Root <array "number">> content <ref "Root">>`;

check("registry construction stays canonical and DOM-free", () => {
  for (const removed of ["fromNode", "fromHson", "fromJson", "fromData", "fromDocument", "fromTrustedHtml", "fromUntrustedHtml"]) {
    assert.equal(removed in hson.liveMap, false);
  }
  const trusted = hsonLiveMap.fromLibraries({ page: { document: hsonTransform.fromTrustedHtml("<main>ready</main>").toNode(), schema: MainText } });
  const untrusted = hsonLiveMap.fromLibraries({ page: { document: hsonTransform.fromUntrustedHtml("<main onclick='unsafe()'>ready</main>").toNode(), schema: MainText } });
  assert.equal(trusted.lib("page").mode, "document");
  assert.equal(untrusted.lib("page").mode, "document");
  assert.equal(find_nodes(untrusted.lib("page").root(), "main")[0]?.$_attrs?.onclick, undefined);
});

check("one-library registries classify data and document roots", () => {
  const object = hsonLiveMap.fromLibraries({ state: { data: { value: 1 }, schema: NumberData } });
  const array = hsonLiveMap.fromLibraries({ state: { data: [1, 2], schema: NumberArray } });
  const document = hsonLiveMap.fromLibraries({ page: { document: '<main "text"/>', schema: MainText } });
  const empty = hsonLiveMap.fromLibraries({ page: { document: "", schema: EmptyDocument } });
  assert.deepEqual([object.lib("state").mode, array.lib("state").mode, document.lib("page").mode, empty.lib("page").mode], ["data-object", "data-array", "document", "document"]);
  assert.deepEqual(empty.lib("page").root(), { $_tag: "_hson_root", $_content: [] });
});

check("empty document and quoted empty text remain distinct", () => {
  const empty = hsonLiveMap.fromLibraries({ page: { document: "", schema: EmptyDocument } }).lib("page");
  const quoted = hsonLiveMap.fromLibraries({ page: { document: '""', schema: TextDocument } }).lib("page");
  assert.equal(quoted.root().$_content.length, 1);
  assert.notDeepEqual(quoted.root(), empty.root());
});

check("malformed canonical roots and generated QUID claims reject at admission", () => {
  assert.throws(() => admit_exact_runtime_livemap_libraries({ page: { document: { $_tag: "_hson_root", $_content: [1] }, schema: EmptyDocument } }));
  assert.throws(() => hsonLiveMap.fromLibraries({ page: { document: { $_tag: "main", $_content: [], $_meta: { quid: "000000001" } }, schema: MainText } }));
  assert.throws(() => hsonLiveMap.fromLibraries({ page: { document: '<aside/>', schema: MainText } }));
});

check("document input and detached reads do not share graph ownership", () => {
  const source = parse_hson_exact_runtime('<main id="original" <p "x"/>/>', { allowTopLevelDocumentText: true });
  const map = admit_exact_runtime_livemap_libraries({ page: { document: source, schema: MainP } });
  const page = map.lib("page");
  const baseline = page.root();
  assert.notEqual(source, baseline);
  const capture = page.capture();
  assert.equal(capture.kind, "hson-document");
  assert_fully_detached(page.root(), page.root());
  assert_fully_detached(capture.root, page.capture().root);
  mutate_graph(source);
  mutate_graph(capture.root);
  const content = page.document.content();
  mutate_content(content);
  assert.deepEqual(page.root(), baseline);
  assert.equal(map.rev, 0);
});

check("ordinary data input is detached and selected library reads remain exact", () => {
  const input = { value: 1 };
  const map = hsonLiveMap.fromLibraries({ state: { data: input, schema: NumberData } });
  input.value = 2;
  assert.deepEqual(map.lib("state").snap(), { value: 1 });
  assert.equal(map.lib("state").at(["value"]).snap(), 1);
  assert.equal(map.rev, 0);
});

check("local QUID identity is sparse and portable capture omits it", () => {
  const source = parse_hson_exact_runtime('<main @000000001 <p "one"/> <p @000000005 "two"/>/>', { allowTopLevelDocumentText: true });
  const map = admit_exact_runtime_livemap_libraries({ page: { document: source, schema: MainTwoP } });
  const page = map.lib("page");
  const root = page.root();
  assert.equal(find_nodes(root, "main")[0]?.$_meta?.quid, "000000001");
  assert.equal(find_nodes(root, "p")[0]?.$_meta?.quid, undefined);
  assert.equal(find_nodes(root, "p")[1]?.$_meta?.quid, "000000005");
  assert.equal(page.document.byQuid("000000005")?.$_tag, "p");
  assert.equal(page.document.byQuid("unknown"), undefined);
  assert.equal(JSON.stringify(page.capture()).includes('"quid"'), false);
  assert.equal(JSON.stringify(map.capture()).includes('"quid"'), false);
});

check("duplicate and malformed document QUIDs reject before registry construction", () => {
  assert.throws(() => admit_exact_runtime_livemap_libraries({ page: { document: parse_hson_exact_runtime('<main <p @000000006 "a"/> <p @000000006 "b"/>/>', { allowTopLevelDocumentText: true }), schema: MainTwoP } }), /duplicate quid/);
  assert.throws(() => hsonLiveMap.fromLibraries({ page: { document: '<main @/>', schema: MainText } }));
});

check("selected document library has document operations and no data writes", () => {
  const map = hsonLiveMap.fromLibraries({ page: { document: '<main "Save"/>', schema: MainText } });
  const page = map.lib("page");
  assert.equal(page.schema.get(), MainText);
  assert.equal("set" in page, false);
  assert.equal("replay" in page, false);
  assert.equal(typeof page.document.attrs.set, "function");
  assert.equal(typeof page.document.content, "function");
  assert.equal(typeof map.render, "function");
  assert.equal(typeof map.restore, "function");
});

check("first data and document writes advance one map revision", () => {
  const data = hsonLiveMap.fromLibraries({ state: { data: { value: 1 }, schema: NumberData } });
  const dataCommit = data.lib("state").at(["value"]).set(2);
  assert.deepEqual([dataCommit.prevRev, dataCommit.rev, data.rev], [0, 1, 1]);
  const document = hsonLiveMap.fromLibraries({ page: { document: '<main "new"/>', schema: MainText } });
  const documentCommit = document.lib("page").document.attrs.set({ kind: "path", path: [0] }, "id", "main");
  assert.deepEqual([documentCommit.prevRev, documentCommit.rev, document.rev], [0, 1, 1]);
});

process.stdout.write(`# ${checks} registry document checks passed\n`);
testEvents.terminal("pass");
