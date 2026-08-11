// @hson-live-external-test
import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import type { HsonNode } from "../src/core/types.ts";
import {
  InternalDocumentTraversalError,
  lower_internal_document_content_slot,
  lower_internal_document_content_target,
  lower_internal_document_element_target,
  resolve_internal_document_location,
  type InternalDocumentLogicalEdge,
} from "../src/api/livemap/livemap.document.logical.ts";
import type { DocumentLiveMap, ElementLiveMap, FragmentLiveMap } from "../src/types/livemap.types.ts";
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

function element(source: string): ElementLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "element") throw new Error(`Expected element map; observed ${map.mode}`);
  return map;
}

function fragment(source: string): FragmentLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "fragment") throw new Error(`Expected fragment map; observed ${map.mode}`);
  return map;
}

function resolve(map: DocumentLiveMap, edges: readonly InternalDocumentLogicalEdge[]) {
  return resolve_internal_document_location(map.root(), map.mode, edges);
}

function ordinary(source: string): HsonNode {
  return element(source).element.node();
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

check("element logical root is the ordinary root at the direct physical empty path", () => {
  const resolved = resolve(element(`<main/>`), []);
  assert.equal(resolved.kind, "node");
  if (resolved.kind !== "node") return;
  assert.equal(resolved.value.$_tag, "main");
  assert.deepEqual(resolved.physical, { kind: "direct", path: [] });
});

check("fragment logical root is an ordered content container at the physical cluster path", () => {
  const resolved = resolve(fragment(`<a/> <b/>`), []);
  assert.deepEqual(resolved, {
    kind: "content",
    scope: "fragment",
    length: 2,
    physical: { kind: "direct", path: [] },
  });
  assert.deepEqual(lower_internal_document_content_target(resolved), { kind: "path", path: [] });
});

check("empty fragment root remains logical content without inventing a physical endpoint", () => {
  const map = hson.liveMap.fromNode({ $_tag: "_hson_root", $_content: [] });
  if (map.mode !== "fragment") throw new Error("Expected empty fragment map");
  const resolved = resolve(map, []);
  assert.deepEqual(resolved, {
    kind: "content",
    scope: "fragment",
    length: 0,
    physical: { kind: "none", reason: "empty-fragment" },
  });
  traversalCode(() => lower_internal_document_content_target(resolved), "PHYSICAL_TARGET_UNAVAILABLE");
});

check("logical child zero hides the ordinary element content carrier", () => {
  const resolved = resolve(element(`<main <a/>/>`), [content(0)]);
  assert.equal(resolved.kind === "node" ? resolved.value.$_tag : undefined, "a");
  assert.deepEqual(resolved.physical, { kind: "carrier", path: [0, 0], carrierPaths: [[0]] });
});

check("multiple logical element children retain canonical first and last order", () => {
  const map = element(`<main <a/> "middle" <b/>/>`);
  assert.equal(tagAt(map, [content(0)]), "a");
  assert.equal(tagAt(map, [content(1)]), "_hson_str");
  const last = resolve(map, [content(2)]);
  assert.equal(last.kind === "node" ? last.value.$_tag : undefined, "b");
  assert.deepEqual(last.physical.kind === "carrier" ? last.physical.path : undefined, [0, 2]);
});

check("nested logical element traversal lowers through each exact carrier", () => {
  const resolved = resolve(element(`<main <section <b/>/>/>`), [content(0), content(0)]);
  assert.equal(resolved.kind === "node" ? resolved.value.$_tag : undefined, "b");
  assert.deepEqual(resolved.physical, {
    kind: "carrier",
    path: [0, 0, 0, 0],
    carrierPaths: [[0], [0, 0, 0]],
  });
});

check("empty element content is an empty logical container with no carrier target", () => {
  const map = element(`<main/>`);
  const resolved = resolve(map, [facet("content")]);
  assert.deepEqual(resolved, {
    kind: "content",
    scope: "element",
    length: 0,
    physical: { kind: "none", reason: "empty-element-content", ownerPath: [] },
  });
  traversalCode(() => lower_internal_document_content_target(resolved), "PHYSICAL_TARGET_UNAVAILABLE");
  traversalCode(() => resolve(map, [content(0)]), "CONTENT_INDEX_OUT_OF_RANGE");
});

check("logical text content resolves the string carrier rather than its payload", () => {
  const resolved = resolve(element(`<main "text"/>`), [content(0)]);
  assert.equal(resolved.kind === "node" ? resolved.value.$_tag : undefined, "_hson_str");
  assert.deepEqual(resolved.physical.kind === "carrier" ? resolved.physical.path : undefined, [0, 0]);
});

check("explicit empty and adjacent text remain distinct ordered carriers", () => {
  const map = element(`<main "" "a" ""/>`);
  const values = [0, 1, 2].map((index) => resolve(map, [content(index), raw(0)]));
  assert.deepEqual(values.map((value) => value.kind === "primitive" ? value.value : undefined), ["", "a", ""]);
  assert.deepEqual(values.map((value) => value.physical.kind === "carrier" ? value.physical.path : undefined), [
    [0, 0, 0], [0, 1, 0], [0, 2, 0],
  ]);
});

check("raw structural traversal reaches a primitive payload with an exact path", () => {
  assert.deepEqual(resolve(element(`<main "text"/>`), [content(0), raw(0)]), {
    kind: "primitive",
    value: "text",
    physical: { kind: "carrier", path: [0, 0, 0], carrierPaths: [[0]] },
  });
});

check("descent through a primitive is rejected distinctly", () => {
  const map = element(`<main "text"/>`);
  traversalCode(() => resolve(map, [content(0), raw(0), raw(0)]), "PRIMITIVE_DESCENT");
});

check("logical out-of-range access fails without a missing-value sentinel", () => {
  traversalCode(() => resolve(element(`<main <a/>/>`), [content(1)]), "CONTENT_INDEX_OUT_OF_RANGE");
  traversalCode(() => resolve(fragment(`<a/> <b/>`), [content(2)]), "CONTENT_INDEX_OUT_OF_RANGE");
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
  traversalCode(() => resolve_internal_document_location(malformed, "element", []), "INVALID_DOCUMENT_ROOT");
  const cluster = malformed.$_content[0];
  assert.equal(typeof cluster === "object" && cluster !== null ? cluster.$_content[0]?.$_content[0] : undefined, "raw-text-without-carrier");
});

check("tag is a readonly facet owned by the element path rather than a content path", () => {
  assert.deepEqual(resolve(element(`<main/>`), [facet("tag")]), {
    kind: "facet",
    facet: "tag",
    value: "main",
    access: "readonly",
    physical: { kind: "facet", facet: "tag", ownerPath: [] },
  });
});

check("attrs resolve as one detached operation-specific facet and retain structured style", () => {
  const map = element(`<main id="root" style="color: red"/>`);
  const resolved = resolve(map, [facet("attrs")]);
  assert.equal(resolved.kind, "facet");
  if (resolved.kind !== "facet" || resolved.facet !== "attrs") return;
  assert.deepEqual(resolved.value, { id: "root", style: { color: "red" } });
  assert.equal(resolved.access, "operation-specific");
  assert.deepEqual(lower_internal_document_element_target(resolved), { kind: "path", path: [] });
});

check("metadata remains a protected facet and traversal never mints QUIDs", () => {
  const metadata = resolve(element(`<main @000000001/>`), [facet("metadata")]);
  assert.equal(metadata.kind === "facet" && metadata.facet === "metadata" ? metadata.access : undefined, "protected");
  assert.deepEqual(metadata.kind === "facet" && metadata.facet === "metadata" ? metadata.value : undefined, { quid: "000000001" });
  const unquidded = element(`<aside/>`);
  resolve(unquidded, []);
  assert.equal(unquidded.element.node().$_meta?.quid, undefined);
});

check("content facet lowers to the existing canonical content-owner target", () => {
  const map = element(`<main <a/>/>`);
  const logicalContent = resolve(map, [facet("content")]);
  assert.deepEqual(logicalContent.physical, { kind: "carrier", path: [0], carrierPaths: [[0]] });
  const target = lower_internal_document_content_target(logicalContent);
  map.document.content.insert(target, 1, ordinary(`<b/>`));
  assert.equal(tagAt(map, [content(1)]), "b");
});

check("logical child slot lowering drives the existing replace-content planner", () => {
  const map = element(`<main <a/> <b/>/>`);
  const slot = lower_internal_document_content_slot(resolve(map, [content(1)]));
  assert.deepEqual(slot, { target: { kind: "path", path: [0] }, index: 1 });
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
    physical: { kind: "facet", facet: "attrs", ownerPath: [] },
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

process.stdout.write(`# ${checks} internal logical document traversal checks passed\n`);
emit_hson_live_test_completion("livemap.document-logical-traversal", checks, checks, 0);
