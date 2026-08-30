// @hson-live-external-test
import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import * as publicApi from "../src/index.ts";
import { hsonReflect } from "../src/api/reflect/reflect.facade.ts";
import { project_livetree } from "../src/api/livetree/creation/project-live-tree.ts";
import type { HsonNode } from "../src/core/types.ts";
import {
  InternalDocumentTraversalError,
  lower_internal_document_content_insert,
  lower_internal_document_content_remove,
  lower_internal_document_content_slot,
  lower_internal_document_content_target,
  lower_internal_document_element_target,
  resolve_internal_document_location,
  type InternalDocumentContentMutationLowering,
  type InternalDocumentLogicalEdge,
} from "../src/api/livemap/livemap.document.logical.ts";
import type {
  DocumentLiveMap,
  LiveMapDocumentContent,
} from "../src/types/livemap.types.ts";
import { validate_document_path } from "../src/api/livemap/livemap.document.path.ts";
import { FakeElement, install_fake_document } from "./helpers/fake-document.mts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

let checks = 0;
function check(name: string, run: () => void): void {
  run();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

const content = (index: number): InternalDocumentLogicalEdge => Object.freeze({ kind: "content", index });
const raw = (index: number): InternalDocumentLogicalEdge => Object.freeze({ kind: "raw-content", index });
const facet = (name: "tag" | "attrs" | "metadata" | "content"): InternalDocumentLogicalEdge =>
  Object.freeze({ kind: "facet", facet: name });

function element(source: string): DocumentLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "document") throw new Error(`Expected element map; observed ${map.mode}`);
  return map;
}

function multiNodeDocument(source: string): DocumentLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "document") throw new Error(`Expected multiNodeDocument map; observed ${map.mode}`);
  return map;
}

function emptyDocumentSequence(): DocumentLiveMap {
  const map = hson.liveMap.fromNode({ $_tag: "_hson_root", $_content: [] });
  if (map.mode !== "document") throw new Error("Expected empty multiNodeDocument map");
  return map;
}

function resolve(map: DocumentLiveMap, edges: readonly InternalDocumentLogicalEdge[]) {
  return resolve_internal_document_location(map.root(), map.mode, edges);
}

function ordinary(source: string): HsonNode {
  const root = element(source).root();
  const only = root.$_content[0];
  if (typeof only !== "object" || only === null) throw new Error("Expected one ordinary document element");
  return only;
}

function traversalCode(run: () => unknown, code: InternalDocumentTraversalError["code"]): void {
  assert.throws(run, (error: unknown) =>
    error instanceof InternalDocumentTraversalError && error.code === code);
}

function tagAt(map: DocumentLiveMap, edges: readonly InternalDocumentLogicalEdge[]): string {
  const resolved = resolve(map, edges);
  if (resolved.kind !== "node") throw new Error("Expected a logical node endpoint");
  return resolved.value.$_tag;
}

function logicalContent(map: DocumentLiveMap) {
  return resolve(map, map.mode === "document" ? [facet("content")] : []);
}

function applyLowering(map: DocumentLiveMap, lowering: InternalDocumentContentMutationLowering) {
  if (lowering.kind === "content-insert") {
    return map.document.content.insert(lowering.target, lowering.index, lowering.content);
  }
  if (lowering.kind === "content-remove") {
    return map.document.content.remove(lowering.target, lowering.index);
  }
  const replacement = hson.liveMap.fromNode(lowering.root);
  if (replacement.mode !== map.mode) {
    throw new Error(`Materialized ${replacement.mode} root cannot replace ${map.mode} owner`);
  }
  return map.install(replacement.capture());
}

function insertLogical(map: DocumentLiveMap, index: number, contentValue: LiveMapDocumentContent) {
  return applyLowering(
    map,
    lower_internal_document_content_insert(logicalContent(map), index, contentValue),
  );
}

function removeLogical(map: DocumentLiveMap, index: number) {
  return applyLowering(map, lower_internal_document_content_remove(logicalContent(map), index));
}

function documentRootContent(map: DocumentLiveMap) {
  return {
    kind: "content",
    scope: "document",
    length: map.root().$_content.length,
    physical: { kind: "direct", path: validate_document_path([]) },
  } as const;
}

function insertDocumentRoot(map: DocumentLiveMap, index: number, contentValue: LiveMapDocumentContent) {
  return applyLowering(
    map,
    lower_internal_document_content_insert(documentRootContent(map), index, contentValue),
  );
}

function removeDocumentRoot(map: DocumentLiveMap, index: number) {
  return applyLowering(map, lower_internal_document_content_remove(documentRootContent(map), index));
}

function documentRootTagAt(map: DocumentLiveMap, index: number): string {
  const child = map.root().$_content[index];
  if (typeof child !== "object" || child === null) throw new Error("Expected a document-root content node");
  return child.$_tag;
}

check("element logical root is the ordinary root at its root-content coordinate", () => {
  const resolved = resolve(element(`<main/>`), []);
  assert.equal(resolved.kind, "node");
  if (resolved.kind !== "node") return;
  assert.equal(resolved.value.$_tag, "main");
  assert.deepEqual(resolved.physical, { kind: "direct", path: [0] });
});

check("multiNodeDocument logical root is an ordered content container at the physical cluster path", () => {
  const resolved = resolve(multiNodeDocument(`<a/> <b/>`), []);
  assert.deepEqual(resolved, {
    kind: "content",
    scope: "document",
    length: 2,
    physical: { kind: "direct", path: [] },
  });
  assert.deepEqual(lower_internal_document_content_target(resolved), { kind: "path", path: [] });
});

check("empty document root remains an addressable logical content container", () => {
  const map = hson.liveMap.fromNode({ $_tag: "_hson_root", $_content: [] });
  if (map.mode !== "document") throw new Error("Expected empty multiNodeDocument map");
  const resolved = resolve(map, []);
  assert.deepEqual(resolved, {
    kind: "content",
    scope: "document",
    length: 0,
    physical: { kind: "direct", path: [] },
  });
  assert.deepEqual(lower_internal_document_content_target(resolved), { kind: "path", path: [] });
});

check("logical child zero hides the ordinary element content carrier", () => {
  const resolved = resolve(element(`<main <a/>/>`), [content(0)]);
  assert.equal(resolved.kind === "node" ? resolved.value.$_tag : undefined, "a");
  assert.deepEqual(resolved.physical, { kind: "carrier", path: [0, 0, 0], carrierPaths: [[0, 0]] });
});

check("multiple logical element children retain canonical first and last order", () => {
  const map = element(`<main <a/> "middle" <b/>/>`);
  assert.equal(tagAt(map, [content(0)]), "a");
  assert.equal(tagAt(map, [content(1)]), "_hson_str");
  const last = resolve(map, [content(2)]);
  assert.equal(last.kind === "node" ? last.value.$_tag : undefined, "b");
  assert.deepEqual(last.physical.kind === "carrier" ? last.physical.path : undefined, [0, 0, 2]);
});

check("nested logical element traversal lowers through each exact carrier", () => {
  const resolved = resolve(element(`<main <section <b/>/>/>`), [content(0), content(0)]);
  assert.equal(resolved.kind === "node" ? resolved.value.$_tag : undefined, "b");
  assert.deepEqual(resolved.physical, {
    kind: "carrier",
    path: [0, 0, 0, 0, 0],
    carrierPaths: [[0, 0], [0, 0, 0, 0]],
  });
});

check("empty element content is an empty logical container with no carrier target", () => {
  const map = element(`<main/>`);
  const resolved = resolve(map, [facet("content")]);
  assert.deepEqual(resolved, {
    kind: "content",
    scope: "element",
    length: 0,
    physical: { kind: "none", reason: "empty-element-content", ownerPath: [0] },
  });
  traversalCode(() => lower_internal_document_content_target(resolved), "PHYSICAL_TARGET_UNAVAILABLE");
  traversalCode(() => resolve(map, [content(0)]), "CONTENT_INDEX_OUT_OF_RANGE");
});

check("logical text content resolves the string carrier rather than its payload", () => {
  const resolved = resolve(element(`<main "text"/>`), [content(0)]);
  assert.equal(resolved.kind === "node" ? resolved.value.$_tag : undefined, "_hson_str");
  assert.deepEqual(resolved.physical.kind === "carrier" ? resolved.physical.path : undefined, [0, 0, 0]);
});

check("explicit empty and adjacent text remain distinct ordered carriers", () => {
  const map = element(`<main "" "a" ""/>`);
  const values = [0, 1, 2].map((index) => resolve(map, [content(index), raw(0)]));
  assert.deepEqual(values.map((value) => value.kind === "primitive" ? value.value : undefined), ["", "a", ""]);
  assert.deepEqual(values.map((value) => value.physical.kind === "carrier" ? value.physical.path : undefined), [
    [0, 0, 0, 0], [0, 0, 1, 0], [0, 0, 2, 0],
  ]);
});

check("raw structural traversal reaches a primitive payload with an exact path", () => {
  assert.deepEqual(resolve(element(`<main "text"/>`), [content(0), raw(0)]), {
    kind: "primitive",
    value: "text",
    physical: { kind: "carrier", path: [0, 0, 0, 0], carrierPaths: [[0, 0]] },
  });
});

check("descent through a primitive is rejected distinctly", () => {
  const map = element(`<main "text"/>`);
  traversalCode(() => resolve(map, [content(0), raw(0), raw(0)]), "PRIMITIVE_DESCENT");
});

check("logical out-of-range access fails without a missing-value sentinel", () => {
  traversalCode(() => resolve(element(`<main <a/>/>`), [content(1)]), "CONTENT_INDEX_OUT_OF_RANGE");
  traversalCode(() => resolve(multiNodeDocument(`<a/> <b/>`), [content(2)]), "CONTENT_INDEX_OUT_OF_RANGE");
});

check("logical and raw indexes require non-negative safe integers", () => {
  const map = element(`<main <a/>/>`);
  for (const edge of [content(-1), content(0.5), raw(Number.MAX_SAFE_INTEGER + 1)]) {
    traversalCode(() => resolve(map, [edge]), "INVALID_EDGE_INDEX");
  }
});
check("malformed element graphs fail exact canonical admission instead of being repaired", () => {
  const malformed: HsonNode = {
    $_tag: "_hson_root",
    $_content: [{
      $_tag: "_hson_elem",
      $_content: [{ $_tag: "main", $_content: ["raw-text-without-carrier"] }],
    }],
  };

  traversalCode(
    () => resolve_internal_document_location(malformed, "document", []),
    "INVALID_DOCUMENT_ROOT",
  );

  const cluster = malformed.$_content[0];
  assert.ok(typeof cluster === "object" && cluster !== null);

  // CHANGED: narrow the nested content item before accessing node-only $_content.
  const main = cluster.$_content[0];
  assert.ok(typeof main === "object" && main !== null);

  assert.equal(main.$_content[0], "raw-text-without-carrier");
});
check("tag is a readonly facet owned by the element path rather than a content path", () => {
  assert.deepEqual(resolve(element(`<main/>`), [facet("tag")]), {
    kind: "facet",
    facet: "tag",
    value: "main",
    access: "readonly",
    physical: { kind: "facet", facet: "tag", ownerPath: [0] },
  });
});

check("attrs resolve as one detached operation-specific facet and retain structured style", () => {
  const map = element(`<main id="root" style="color: red"/>`);
  const resolved = resolve(map, [facet("attrs")]);
  assert.equal(resolved.kind, "facet");
  if (resolved.kind !== "facet" || resolved.facet !== "attrs") return;
  assert.deepEqual(resolved.value, { id: "root", style: { color: "red" } });
  assert.equal(resolved.access, "operation-specific");
  assert.deepEqual(lower_internal_document_element_target(resolved), { kind: "path", path: [0] });
});

check("metadata remains a protected facet and traversal never mints QUIDs", () => {
  const metadata = resolve(element(`<main @000000001/>`), [facet("metadata")]);
  assert.equal(metadata.kind === "facet" && metadata.facet === "metadata" ? metadata.access : undefined, "protected");
  assert.deepEqual(metadata.kind === "facet" && metadata.facet === "metadata" ? metadata.value : undefined, { quid: "000000001" });
  const unquidded = element(`<aside/>`);
  resolve(unquidded, []);
  assert.equal(unquidded.root().$_meta?.quid, undefined);
});

check("content facet lowers to the existing canonical content-owner target", () => {
  const map = element(`<main <a/>/>`);
  const logicalContent = resolve(map, [facet("content")]);
  assert.deepEqual(logicalContent.physical, { kind: "carrier", path: [0, 0], carrierPaths: [[0, 0]] });
  const target = lower_internal_document_content_target(logicalContent);
  map.document.content.insert(target, 1, ordinary(`<b/>`));
  assert.equal(tagAt(map, [content(1)]), "b");
});

check("logical child slot lowering drives the existing replace-content planner", () => {
  const map = element(`<main <a/> <b/>/>`);
  const slot = lower_internal_document_content_slot(resolve(map, [content(1)]));
  assert.deepEqual(slot, { target: { kind: "path", path: [0, 0] }, index: 1 });
  map.document.content.replace(slot.target, slot.index, ordinary(`<em/>`));
  assert.equal(tagAt(map, [content(1)]), "em");
});

check("attrs facet lowering reuses existing set drop and replacement planners", () => {
  const map = element(`<main id="before"/>`);
  const target = lower_internal_document_element_target(resolve(map, [facet("attrs")]));
  map.document.attrs.set(target, "title", "set");
  map.document.attrs.drop(target, "id");
  map.document.attrs.replace(target, { role: "main" });
  assert.deepEqual(resolve(map, [facet("attrs")]), {
    kind: "facet",
    facet: "attrs",
    value: { role: "main" },
    access: "operation-specific",
    physical: { kind: "facet", facet: "attrs", ownerPath: [0] },
  });
});

check("fixed logical location denotes the new occupant after insertion before it", () => {
  const map = element(`<main <a/> <b/>/>`);
  const edges = Object.freeze([content(1)]);
  assert.equal(tagAt(map, edges), "b");
  const target = lower_internal_document_content_target(resolve(map, [facet("content")]));
  map.document.content.insert(target, 0, ordinary(`<x/>`));
  assert.equal(tagAt(map, edges), "a");
});

check("fixed logical location does not follow a moved subject", () => {
  const map = element(`<main <a/> <b/> <c/>/>`);
  const target = lower_internal_document_content_target(resolve(map, [facet("content")]));
  map.document.content.move(target, 0, 2);
  assert.equal(tagAt(map, [content(0)]), "b");
  assert.equal(tagAt(map, [content(2)]), "a");
});

check("fixed logical location denotes the shifted occupant after removal", () => {
  const map = element(`<main <a/> <b/>/>`);
  const target = lower_internal_document_content_target(resolve(map, [facet("content")]));
  map.document.content.remove(target, 0);
  assert.equal(tagAt(map, [content(0)]), "b");
});

check("fixed logical locations denote replacements after direct and ancestor replacement", () => {
  const map = element(`<main <a/> <b/>/>`);
  const slot = lower_internal_document_content_slot(resolve(map, [content(1)]));
  map.document.content.replace(slot.target, slot.index, ordinary(`<x/>`));
  assert.equal(tagAt(map, [content(1)]), "x");

  const nested = element(`<main <section <a/>/>/>`);
  const ancestor = lower_internal_document_content_slot(resolve(nested, [content(0)]));
  nested.document.content.replace(ancestor.target, ancestor.index, ordinary(`<article <y/>/>`));
  assert.equal(tagAt(nested, [content(0), content(0)]), "y");
});

check("replay preserves logical location semantics in a DOM-free runtime", () => {
  assert.equal(Reflect.has(globalThis, "document"), false);
  const source = element(`<main <a/> <b/>/>`);
  const target = element(`<main <a/> <b/>/>`);
  const contentTarget = lower_internal_document_content_target(resolve(source, [facet("content")]));
  target.replay(source.document.content.move(contentTarget, 0, 1));
  assert.equal(tagAt(target, [content(0)]), "b");
  assert.equal(tagAt(target, [content(1)]), "a");
});

check("empty element content resolution is passive and preserves exact state", () => {
  const map = element(`<main/>`);
  const beforeRoot = map.root();
  const beforeCapture = map.capture();
  const observations: unknown[] = [];
  map.commits.observe((observation) => observations.push(observation));
  assert.deepEqual(logicalContent(map), {
    kind: "content",
    scope: "element",
    length: 0,
    physical: { kind: "none", reason: "empty-element-content", ownerPath: [0] },
  });
  assert.deepEqual(map.root(), beforeRoot);
  assert.deepEqual(map.capture(), beforeCapture);
  assert.equal(map.rev, 0);
  assert.equal(observations.length, 0);
});

check("empty element insertion lowers to its real owner with one transient carrier", () => {
  const map = element(`<main/>`);
  const lowering = lower_internal_document_content_insert(logicalContent(map), 0, "first");
  assert.equal(lowering.kind, "content-insert");
  if (lowering.kind !== "content-insert") return;
  assert.deepEqual(lowering.target, { kind: "path", path: [0] });
  assert.equal(lowering.index, 0);
  assert.equal(typeof lowering.content === "object" && lowering.content !== null
    ? lowering.content.$_tag
    : undefined, "_hson_elem");
  assert.deepEqual(map.root(), { $_tag: "_hson_root", $_content: [ordinary(`<main/>`)] });
});

check("first empty-element string insertion uses existing string-carrier normalization once", () => {
  const map = element(`<main/>`);
  const commit = insertLogical(map, 0, "first");
  assert.equal(commit.changed, true);
  assert.deepEqual([commit.prevRev, commit.rev, map.rev], [0, 1, 1]);
  assert.equal(commit.ops[0]?.op, "insert-content");
  const documentRoot = map.root();
  const main = documentRoot.$_content[0];
  const carrier = typeof main === "object" && main !== null ? main.$_content[0] : undefined;
  assert.equal(typeof carrier === "object" && carrier !== null ? carrier.$_tag : undefined, "_hson_elem");
  assert.equal(typeof carrier === "object" && carrier !== null
    && typeof carrier.$_content[0] === "object" && carrier.$_content[0] !== null
    ? carrier.$_content[0].$_tag
    : undefined, "_hson_str");
  assert.equal(JSON.stringify(map.root()).includes("quid"), false);
});

check("first empty-element ordinary-node insertion materializes canonical element content", () => {
  const map = element(`<main/>`);
  insertLogical(map, 0, ordinary(`<span/>`));
  assert.equal(tagAt(map, [content(0)]), "span");
  assert.deepEqual(map.document.content().map((item) =>
    typeof item === "object" && item !== null ? item.$_tag : item), ["main"]);
});

check("invalid insertion indexes reject before empty-element materialization", () => {
  const map = element(`<main/>`);
  traversalCode(
    () => lower_internal_document_content_insert(logicalContent(map), 1, "x"),
    "CONTENT_INDEX_OUT_OF_RANGE",
  );
  traversalCode(
    () => lower_internal_document_content_insert(logicalContent(map), -1, "x"),
    "INVALID_EDGE_INDEX",
  );
  assert.deepEqual(map.root(), { $_tag: "_hson_root", $_content: [ordinary(`<main/>`)] });
  assert.equal(map.rev, 0);
});

check("after first insertion element content uses the ordinary carrier path", () => {
  const map = element(`<main/>`);
  insertLogical(map, 0, ordinary(`<a/>`));
  assert.deepEqual(logicalContent(map), {
    kind: "content",
    scope: "element",
    length: 1,
    physical: { kind: "carrier", path: [0, 0], carrierPaths: [[0, 0]] },
  });
  assert.deepEqual(resolve(map, [content(0)]).physical, {
    kind: "carrier",
    path: [0, 0, 0],
    carrierPaths: [[0, 0]],
  });
});

check("subsequent logical insertion reuses the materialized content owner", () => {
  const map = element(`<main/>`);
  insertLogical(map, 0, ordinary(`<a/>`));
  const commit = insertLogical(map, 1, ordinary(`<b/>`));
  assert.equal(commit.ops[0]?.op, "insert-content");
  assert.deepEqual([tagAt(map, [content(0)]), tagAt(map, [content(1)])], ["a", "b"]);
  assert.equal(map.rev, 2);
});

check("subsequent replacement uses the existing physical slot planner", () => {
  const map = element(`<main/>`);
  insertLogical(map, 0, ordinary(`<a/>`));
  const slot = lower_internal_document_content_slot(resolve(map, [content(0)]));
  map.document.content.replace(slot.target, slot.index, ordinary(`<b/>`));
  assert.equal(tagAt(map, [content(0)]), "b");
});

check("subsequent movement uses the existing materialized content planner", () => {
  const map = element(`<main/>`);
  insertLogical(map, 0, ordinary(`<a/>`));
  insertLogical(map, 1, ordinary(`<b/>`));
  const target = lower_internal_document_content_target(logicalContent(map));
  map.document.content.move(target, 0, 1);
  assert.deepEqual([tagAt(map, [content(0)]), tagAt(map, [content(1)])], ["b", "a"]);
});

check("removing the final logical element item removes its carrier canonically", () => {
  const map = element(`<main/>`);
  insertLogical(map, 0, ordinary(`<a/>`));
  const commit = removeLogical(map, 0);
  assert.equal(commit.ops[0]?.op, "remove-content");
  assert.deepEqual(map.root(), { $_tag: "_hson_root", $_content: [ordinary(`<main/>`)] });
  assert.deepEqual(logicalContent(map).physical, {
    kind: "none",
    reason: "empty-element-content",
    ownerPath: [0],
  });
});

check("reinsertion after returning an element to empty rematerializes normally", () => {
  const map = element(`<main/>`);
  insertLogical(map, 0, ordinary(`<a/>`));
  removeLogical(map, 0);
  insertLogical(map, 0, ordinary(`<b/>`));
  assert.equal(tagAt(map, [content(0)]), "b");
  assert.equal(map.rev, 3);
});

check("empty document resolution is passive and uses the internal root authority", () => {
  const map = emptyDocumentSequence();
  const before = map.capture();
  assert.deepEqual(documentRootContent(map), {
    kind: "content",
    scope: "document",
    length: 0,
    physical: { kind: "direct", path: [] },
  });
  assert.deepEqual(map.capture(), before);
  assert.equal(map.rev, 0);
});

check("first empty-document insertion lowers through ordinary root content mutation", () => {
  const map = emptyDocumentSequence();
  const lowering = lower_internal_document_content_insert(documentRootContent(map), 0, "first");
  assert.equal(lowering.kind, "content-insert");
  const commit = applyLowering(map, lowering);
  assert.equal(commit.ops[0]?.op, "insert-content");
  assert.equal(map.mode, "document");
  assert.equal(documentRootTagAt(map, 0), "_hson_str");
  assert.deepEqual([commit.prevRev, commit.rev, map.rev], [0, 1, 1]);
  assert.equal(JSON.stringify(map.root()).includes("quid"), false);
});

check("empty-document invalid insertion indexes reject without mutation", () => {
  const map = emptyDocumentSequence();
  traversalCode(
    () => lower_internal_document_content_insert(documentRootContent(map), 1, "x"),
    "CONTENT_INDEX_OUT_OF_RANGE",
  );
  assert.deepEqual(map.root(), { $_tag: "_hson_root", $_content: [] });
  assert.equal(map.rev, 0);

  const elementLowering = lower_internal_document_content_insert(
    documentRootContent(map),
    0,
    ordinary(`<aside/>`),
  );
  assert.equal(elementLowering.kind, "content-insert");
  applyLowering(map, elementLowering);
  assert.equal(documentRootTagAt(map, 0), "aside");
  assert.equal(map.rev, 1);
});

check("empty document content uses direct path lowering for successive inserts", () => {
  const map = emptyDocumentSequence();
  insertDocumentRoot(map, 0, "first");
  assert.deepEqual(documentRootContent(map).physical, { kind: "direct", path: [] });
  insertDocumentRoot(map, 1, ordinary(`<aside/>`));
  assert.deepEqual([documentRootTagAt(map, 0), documentRootTagAt(map, 1)], ["_hson_str", "aside"]);
});

check("last document-content removal retains the canonical empty root", () => {
  const map = emptyDocumentSequence();
  insertDocumentRoot(map, 0, "first");
  const removed = removeDocumentRoot(map, 0);
  assert.equal(removed.ops[0]?.op, "remove-content");
  assert.deepEqual(map.root(), { $_tag: "_hson_root", $_content: [] });
  insertDocumentRoot(map, 0, "again");
  const first = map.root().$_content[0];
  assert.equal(typeof first === "object" && first !== null ? first.$_content[0] : undefined, "again");
  assert.equal(map.rev, 3);
});

check("replay reproduces first empty-element materialization as ordinary insert history", () => {
  const source = element(`<main/>`);
  const target = element(`<main/>`);
  const commit = insertLogical(source, 0, ordinary(`<span/>`));
  target.replay(commit);
  assert.deepEqual(target.root(), source.root());
  assert.equal(tagAt(target, [content(0)]), "span");
});

check("replay reproduces first empty-document insertion as ordinary content history", () => {
  const source = emptyDocumentSequence();
  const target = emptyDocumentSequence();
  const commit = insertDocumentRoot(source, 0, "first");
  target.replay(commit);
  assert.deepEqual(target.root(), source.root());
  assert.equal(documentRootTagAt(target, 0), "_hson_str");
});

check("public entrypoints expose no internal insertion-boundary representation", () => {
  assert.equal(Reflect.has(publicApi, "lower_internal_document_content_insert"), false);
  assert.equal(Reflect.has(publicApi, "lower_internal_document_content_remove"), false);
  assert.equal(Reflect.has(publicApi, "make_internal_document_content_carrier"), false);
});

check("Reflection consumes first carrier materialization through existing commit handling", () => {
  install_fake_document();
  const map = element(`<main/>`);
  const binding = hsonReflect(map);
  const rootDom = project_livetree(binding.tree.node) as unknown as FakeElement;
  const beforeProjection = structuredClone(binding.tree.node);

  logicalContent(map);
  assert.deepEqual(binding.tree.node, beforeProjection);
  assert.equal(binding.sourceRevision, 0);
  assert.equal(rootDom.childNodes.length, 1);

  const commit = insertLogical(map, 0, ordinary(`<span/>`));
  assert.equal(commit.ops[0]?.op, "insert-content");
  assert.equal(binding.status, "active", binding.failure?.message);
  assert.equal(binding.sourceRevision, 1);

  // CHANGED: narrow the first content item before reading node-only $_tag.
  const projectedMain = binding.tree.node.$_content[0];
  assert.ok(typeof projectedMain === "object" && projectedMain !== null);
  const carrier = projectedMain.$_content[0];
  assert.ok(typeof carrier === "object" && carrier !== null);
  assert.equal(carrier.$_tag, "_hson_elem");

  assert.equal(
    rootDom.childNodes[0] instanceof FakeElement
      && rootDom.childNodes[0].childNodes[0] instanceof FakeElement
      ? rootDom.childNodes[0].childNodes[0].tagName
      : undefined,
    "span",
  );

  binding.dispose();
});

process.stdout.write(`# ${checks} internal logical document traversal checks passed\n`);
emit_hson_live_test_completion("livemap.document-logical-traversal", checks, checks, 0);
