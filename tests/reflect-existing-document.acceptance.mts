// @hson-live-external-test
import assert from "node:assert/strict";
import { create_test_event_emitter } from "./test-events.mjs";
import { element, path, projected_element, raw_node } from "./helpers/reflect-unit6.mts";
import { create_livetree_in_runtime } from "../src/api/livetree/creation/create-livetree.ts";
import { project_livetree } from "../src/api/livetree/creation/project-live-tree.ts";
import { create_livetree_runtime } from "../src/api/livetree/runtime/livetree-runtime.ts";
import {
  reflect_document_in_runtime,
  reflect_existing_document_in_runtime,
} from "../src/api/reflect/reflect.document.ts";
import { document_binding_for_node } from "../src/api/livetree/lifecycle/document-binding-state.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import {
  DOCUMENT_REFLECT_ALREADY_BOUND_ERROR_CODE,
  DOCUMENT_REFLECT_DOM_MAPPING_MISMATCH_ERROR_CODE,
  DOCUMENT_REFLECT_NODE_KIND_MISMATCH_ERROR_CODE,
  DOCUMENT_REFLECT_QUID_MISMATCH_ERROR_CODE,
  DOCUMENT_REFLECT_REVISION_GAP_ERROR_CODE,
  DOCUMENT_REFLECT_UNSUPPORTED_OPERATION_ERROR_CODE,
  DOCUMENT_REFLECT_UPDATE_FAILED_ERROR_CODE,
  DocumentReflectError,
} from "../src/api/reflect/reflect.document.error.ts";
import type { DocumentLiveMap } from "../src/types/livemap.types.ts";
import type { LiveTree } from "../src/api/livetree/livetree.ts";
import { FakeElement } from "./helpers/fake-document.mts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "reflect.existing-document",
  title: "Existing LiveTree document Reflect binding",
  category: "Reflect",
  runtime: "node-synthetic-dom",
  tags: Object.freeze(["document", "binding", "ssr", "quid", "lifetime", "race"]),
});

const testEvents = create_test_event_emitter("reflect.existing-document");
let checks = 0;
function check(name: string, run: () => void): void {
  testEvents.case_begin(name, name);
  try {
    run();
    testEvents.case_end(name, "pass");
  } catch (error) {
    testEvents.diagnostic(name, "assertion", error instanceof Error ? error.message : "Check failed.");
    testEvents.case_end(name, "fail");
    testEvents.terminal("fail");
    throw error;
  }
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

const runtime = create_livetree_runtime();
let nextQuid = 720;

function source(rootAttrs = "", sectionAttrs = "", text = "hello"): string {
  const rootQuid = String(nextQuid++).padStart(9, "0");
  const sectionQuid = String(nextQuid++).padStart(9, "0");
  return `<main @${rootQuid} ${rootAttrs} <section @${sectionQuid} ${sectionAttrs} "${text}"/>/>`;
}

function admitted(sourceText: string): { map: DocumentLiveMap; tree: LiveTree; root: FakeElement; section: FakeElement } {
  const map = element(sourceText);
  const tree = create_livetree_in_runtime(projected_element(sourceText), runtime);
  const root = project_livetree(tree.node, "html", runtime, globalThis.document) as unknown as FakeElement;
  const section = root.childNodes[0] as FakeElement;
  return { map, tree, root, section };
}

function expect_code(code: string, run: () => unknown): void {
  assert.throws(run, (error: unknown) => error instanceof DocumentReflectError && error.code === code);
}

check("exact carrier and QUID state binds without initial DOM or graph writes", () => {
  const fixture = admitted(source('class="ready"', 'data-state="initial"'));
  const rootChildren = [...fixture.root.childNodes];
  const sectionChildren = [...fixture.section.childNodes];
  const rootAttrs = new Map(fixture.root.attrs);
  const sectionAttrs = new Map(fixture.section.attrs);
  const graphBefore = structuredClone(fixture.tree.node);
  const binding = reflect_existing_document_in_runtime(fixture.map, fixture.tree, runtime);

  assert.equal(binding.tree, fixture.tree);
  assert.equal(binding.status, "active");
  assert.equal(binding.sourceRevision, fixture.map.rev);
  assert.deepEqual(fixture.tree.node, graphBefore);
  assert.deepEqual([...fixture.root.childNodes], rootChildren);
  assert.deepEqual([...fixture.section.childNodes], sectionChildren);
  assert.deepEqual(fixture.root.attrs, rootAttrs);
  assert.deepEqual(fixture.section.attrs, sectionAttrs);
  assert.equal(fixture.tree.dom.el(), fixture.root as unknown as Element);
  assert.equal(fixture.root.replaceWrites, 0);
  assert.equal(fixture.section.replaceWrites, 0);

  binding.dispose();
  assert.equal(fixture.tree.isDisposed, false);
  assert.equal(fixture.tree.dom.el(), fixture.root as unknown as Element);
  const rebound = reflect_existing_document_in_runtime(fixture.map, fixture.tree, runtime);
  assert.equal(rebound.status, "active");
  rebound.dispose();
  fixture.tree.remove();
});

check("ordinary later commit uses existing Reflect projection and retains Element identity", () => {
  const fixture = admitted(source("", 'data-state="before"'));
  const binding = reflect_existing_document_in_runtime(fixture.map, fixture.tree, runtime);
  const beforeRevision = fixture.map.rev;
  const sectionNode = raw_node(fixture.tree.node, [0, 0]);

  const commit = fixture.map.document.attrs.set(path(0, 0), "data-state", "after");
  assert.equal(commit.rev, beforeRevision + 1);
  assert.equal(binding.sourceRevision, commit.rev);
  assert.equal(binding.diagnostics().updatesApplied, 1);
  assert.equal(fixture.root.childNodes[0], fixture.section);
  assert.equal(fixture.section.getAttribute("data-state"), "after");
  assert.equal(raw_node(fixture.map.root(), [0, 0]).$_attrs?.["data-state"], "after");
  assert.equal(sectionNode.$_attrs?.["data-state"], "after");
  assert.equal(canonical_hson_graph_equal(
    { $_tag: "_hson_root", $_content: [fixture.tree.node] },
    fixture.map.root(),
  ), true);

  binding.dispose();
  fixture.map.document.attrs.set(path(0, 0), "data-state", "unobserved");
  assert.equal(fixture.section.getAttribute("data-state"), "after");
  assert.equal(fixture.tree.isDisposed, false);
  assert.equal(document_binding_for_node(sectionNode), undefined);
  fixture.tree.attrs.set("data-standalone", "yes");
  assert.equal(fixture.root.getAttribute("data-standalone"), "yes");
  fixture.tree.remove();
});

check("stale DOM provenance rejects without repair or borrowed disposal", () => {
  const fixture = admitted(source());
  fixture.section.setAttribute("data-rogue", "browser-only");
  expect_code(DOCUMENT_REFLECT_DOM_MAPPING_MISMATCH_ERROR_CODE, () =>
    reflect_existing_document_in_runtime(fixture.map, fixture.tree, runtime));
  assert.equal(fixture.section.getAttribute("data-rogue"), "browser-only");
  assert.equal(fixture.tree.isDisposed, false);
  assert.equal(fixture.tree.dom.el(), fixture.root as unknown as Element);
  fixture.section.removeAttribute("data-rogue");
  fixture.tree.remove();
});

check("canonical content mismatch rejects without disposing the borrowed tree", () => {
  const sourceText = source("", "", "tree");
  const fixture = admitted(sourceText);
  const conflicting = element(sourceText.replace("tree", "map"));
  expect_code(DOCUMENT_REFLECT_UPDATE_FAILED_ERROR_CODE, () =>
    reflect_existing_document_in_runtime(conflicting, fixture.tree, runtime));
  assert.equal(fixture.tree.isDisposed, false);
  assert.equal(fixture.tree.dom.el(), fixture.root as unknown as Element);
  assert.equal(document_binding_for_node(fixture.tree.node), undefined);
  fixture.tree.remove();
});

check("conflicting and absent canonical QUID identity reject strictly", () => {
  const treeSource = source();
  const fixture = admitted(treeSource);
  const treeRootQuid = fixture.tree.node.$_meta?.quid;
  if (treeRootQuid === undefined) throw new Error("Expected supplied root QUID");
  const conflicting = element(treeSource.replace(treeRootQuid, "000009999"));
  expect_code(DOCUMENT_REFLECT_QUID_MISMATCH_ERROR_CODE, () =>
    reflect_existing_document_in_runtime(conflicting, fixture.tree, runtime));
  const absent = element(treeSource.replace(`@${treeRootQuid}`, ""));
  expect_code(DOCUMENT_REFLECT_QUID_MISMATCH_ERROR_CODE, () =>
    reflect_existing_document_in_runtime(absent, fixture.tree, runtime));
  assert.equal(fixture.tree.isDisposed, false);
  fixture.tree.remove();
});

check("incompatible document root shape rejects and releases map exclusivity", () => {
  const sourceText = source();
  const fixture = admitted(sourceText);
  const incompatible = element(`<main @000008730/><aside @000008731/>`);
  expect_code(DOCUMENT_REFLECT_NODE_KIND_MISMATCH_ERROR_CODE, () =>
    reflect_existing_document_in_runtime(incompatible, fixture.tree, runtime));
  const fresh = reflect_document_in_runtime(incompatible, runtime);
  assert.equal(fresh.status, "active");
  fresh.dispose();
  fresh.tree.remove();
  fixture.tree.remove();
});

check("one-active-map and one-active-tree rules reject overlapping controllers", () => {
  const sourceText = source();
  const fixture = admitted(sourceText);
  const binding = reflect_existing_document_in_runtime(fixture.map, fixture.tree, runtime);
  expect_code(DOCUMENT_REFLECT_ALREADY_BOUND_ERROR_CODE, () =>
    reflect_existing_document_in_runtime(fixture.map, fixture.tree, runtime));
  expect_code(DOCUMENT_REFLECT_ALREADY_BOUND_ERROR_CODE, () =>
    reflect_existing_document_in_runtime(element(sourceText), fixture.tree, runtime));
  assert.equal(binding.status, "active");
  binding.dispose();
  fixture.tree.remove();
});

check("revision change during observe activation rolls back without touching borrowed state", () => {
  const fixture = admitted(source("", 'data-race="before"'));
  const rootBefore = structuredClone(fixture.tree.node);
  const attrsBefore = new Map(fixture.section.attrs);
  let injectRevision = true;
  const racing: DocumentLiveMap = {
    ...fixture.map,
    get rev() { return fixture.map.rev; },
    commits: Object.freeze({
      observe(observer: Parameters<DocumentLiveMap["commits"]["observe"]>[0]) {
        const off = fixture.map.commits.observe(observer);
        if (injectRevision) {
          injectRevision = false;
          fixture.map.document.attrs.set(path(0, 0), "data-race", "after-capture");
        }
        return off;
      },
    }),
  };
  expect_code(DOCUMENT_REFLECT_REVISION_GAP_ERROR_CODE, () =>
    reflect_existing_document_in_runtime(racing, fixture.tree, runtime));
  assert.deepEqual(fixture.tree.node, rootBefore);
  assert.deepEqual(fixture.section.attrs, attrsBefore);
  assert.equal(fixture.tree.isDisposed, false);
  assert.equal(document_binding_for_node(fixture.tree.node), undefined);
  fixture.map.document.attrs.set(path(0, 0), "data-race", "before");
  const retry = reflect_existing_document_in_runtime(racing, fixture.tree, runtime);
  assert.equal(retry.sourceRevision, racing.rev);
  retry.dispose();
  fixture.tree.remove();
});

check("borrowed root identity epoch replacement fails closed", () => {
  const fixture = admitted(source());
  const binding = reflect_existing_document_in_runtime(fixture.map, fixture.tree, runtime);
  const rootBefore = fixture.tree.node;
  const elementBefore = fixture.root;
  fixture.map.restore(element(source()).capture());
  assert.equal(binding.status, "failed");
  assert.equal(binding.failure?.code, DOCUMENT_REFLECT_UNSUPPORTED_OPERATION_ERROR_CODE);
  assert.equal(binding.tree.node, rootBefore);
  assert.equal(binding.tree.isDisposed, false);
  assert.equal(binding.tree.dom.el(), elementBefore as unknown as Element);
  binding.dispose();
  fixture.tree.remove();
});

testEvents.terminal("pass");
process.stdout.write(`# ${checks} existing LiveTree document binding checks passed\n`);
