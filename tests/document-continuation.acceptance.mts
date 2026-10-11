import { CssRuntimeManager } from "../src/api/livetree/managers/css-manager.ts";
// @hson-live-external-test
import assert from "node:assert/strict";
import {
  DocumentContinuationError,
  Hson,
  HsonData,
  add_interaction,
  continue_document,
  enable_interactions,
  hsonLiveMap,
  type HsonSchema,
  type InteractionDescriptor,
} from "../src/index.ts";
import { runtime_for_tree } from "../src/api/livetree/runtime/livetree-runtime.ts";
import { begin_livetree_materialization_profile } from "../src/api/livetree/debug/materialization-profile.ts";
import { set_document_adoption_fault_hook_for_tests } from "../src/api/continuation/continuation.adopt.ts";
import { get_node_for_el, unlinkElement } from "../src/api/livetree/utils/node-map-helpers.ts";
import { FakeElement, FakeText, install_fake_document } from "./helpers/fake-document.mts";
import { parse_hson_exact_runtime } from "../src/internal/exact-runtime-hson-codec.ts";
import { admit_exact_runtime_livemap_libraries } from "../src/internal/exact-runtime-node-admission.ts";

install_fake_document();

const EmptyPageSchema: HsonSchema = Hson.schema`<type "document" tag "main" content "empty">`;
const ButtonPageSchema: HsonSchema = Hson.schema`<type "document" tag "main" content <sequence [<tag "button" content "empty">]>>`;
const ParagraphPageSchema: HsonSchema = Hson.schema`<type "document" tag "main" content <sequence [<tag "p" content "string">]>>`;
const path = (...parts: number[]) => Object.freeze({ kind: "path" as const, path: Object.freeze([0, ...parts]) });

function documentMap(source: string) {
  return admit_exact_runtime_livemap_libraries({
    page: { document: parse_hson_exact_runtime(source, { allowTopLevelDocumentText: true }), schema: ParagraphPageSchema },
  });
}

function mainFixture(_quid?: string): Readonly<{ root: FakeElement; child: FakeElement; text: FakeText }> {
  const root = new FakeElement("main");
  const child = new FakeElement("p");
  const text = new FakeText("hello");
  child.appendChild(text);
  root.appendChild(child);
  return { root, child, text };
}

function source(quid?: string): string {
  return `<main <p${quid === undefined ? "" : ` @${quid}`} "hello"/>/>`;
}

{
  const quid = "000003001";
  const map = documentMap(source(quid));
  const fixture = mainFixture(quid);
  const before = structuredClone(map.lib("page").root());
  const profile = begin_livetree_materialization_profile();
  const continuation = continue_document({ map, root: fixture.root as unknown as Element });
  const materialization = profile.stop();
  assert.equal(continuation.map, map.lib("page"));
  assert.equal(continuation.tree.dom.el(), fixture.root as unknown as Element);
  assert.equal(continuation.tree.find.byTag("p")?.dom.el(), fixture.child as unknown as Element);
  assert.equal(fixture.child.childNodes[0], fixture.text);
  assert.deepEqual(map.lib("page").root(), before);
  assert.equal(map.rev, 0);
  assert.equal(materialization.quidEnsureCalls, 0);
  assert.equal(fixture.root.getAttribute("hson:quid"), null);
  assert.equal(fixture.child.getAttribute("hson:quid"), null);
  map.lib("page").document.attrs.set(path(0, 0), "title", "continued");
  assert.equal(fixture.child.getAttribute("title"), "continued");
  continuation.dispose();
  map.lib("page").document.attrs.set(path(0, 0), "title", "detached");
  assert.equal(fixture.child.getAttribute("title"), "continued");
  continuation.tree.find.byTag("p")?.attrs.set("title", "detached");
  const rebound = continue_document({ map, root: fixture.root as unknown as Element });
  assert.equal(rebound.tree, continuation.tree);
  rebound.dispose();
}

function cssFixture() {
  const root = new FakeElement("html"), head = new FakeElement("head"), body = new FakeElement("body"), child = new FakeElement("button");
  root.appendChild(head); root.appendChild(body); body.appendChild(child);
  return { root, child };
}

// An unresolved document-global capability must retain its authority on disposal.
{
  const map = hsonLiveMap.fromLibraries({ page: { document: '<html <head/> <body <button/>/>/>' } });
  const fixture = cssFixture();
  const continuation = continue_document({ map, root: fixture.root as unknown as Element });
  await Promise.resolve(); // Complete adoption activation before headless snapshots.
  const tree = continuation.tree.find.must.byTag("button"), css = tree.css;
  const resolved = continuation.tree.css.global;
  resolved.sel("button").set.color("green");
  const rule = resolved.sel("button");
  const runtime = runtime_for_tree(tree), issued = [...runtime.issuedQuids];
  const activeClaims = [...runtime.quidToNode.keys()], pendingClaims = [...runtime.pendingQuidClaims.keys()];
  const graph = tree.node, documentCss = map.lib("page").css.snapshot(), rev = map.rev;
  let commits = 0;
  const stop = map.commits.observe(() => { commits++; });
  continuation.dispose();
  // HEAD permits a snapshot of runtime-only CSS after disposal, not a stale
  // document read. This must remain passive and must not resolve global writes.
  assert.equal(css.snapshot(), "");
  assert.throws(() => css.global, /disposed/);
  assert.throws(() => css.global.stylesheet("button{color:red}"), /disposed/);
  assert.throws(() => css.global.sel("button").set.color("red"), /disposed/);
  assert.throws(() => resolved.clearAll(), /disposed/);
  assert.throws(() => rule.set.color("red"), /disposed/);
  assert.equal(CssRuntimeManager.forRuntime(runtime).renderCss(), "");
  assert.equal(map.lib("page").css.snapshot(), documentCss);
  assert.equal(map.rev, rev); assert.equal(commits, 0);
  assert.deepEqual(tree.node, graph); assert.deepEqual([...runtime.issuedQuids], issued);
  assert.deepEqual([...runtime.quidToNode.keys()], activeClaims);
  assert.deepEqual([...runtime.pendingQuidClaims.keys()], pendingClaims);
  assert.equal(tree.node.$_meta?.quid, undefined);
  assert.equal(tree.dom.el(), fixture.child as unknown as Element);
  stop();
}

// Legitimate rebind before first global resolution selects the new capability.
{
  const map = documentMap(source()), fixture = mainFixture();
  const first = continue_document({ map, root: fixture.root as unknown as Element });
  const tree = first.tree, css = tree.css;
  first.dispose();
  const second = continue_document({ map, root: fixture.root as unknown as Element });
  assert.equal(second.tree, tree);
  assert.deepEqual(css.global.list(), []);
  assert.equal(tree.node.$_meta?.quid, undefined);
  second.dispose();
  assert.throws(() => css.global.clearAll(), /disposed/);
}

for (const point of ["after-first-link", "after-links", "after-runtime", "after-tree"] as const) {
  const map = documentMap(source());
  const fixture = mainFixture();
  set_document_adoption_fault_hook_for_tests((candidate) => {
    if (candidate === point) throw new Error(`fault:${point}`);
  });
  assert.throws(
    () => continue_document({ map, root: fixture.root as unknown as Element }),
    (cause) => cause instanceof DocumentContinuationError
      && cause.phase === "adopt"
      && cause.cause instanceof Error
      && cause.cause.message === `fault:${point}`,
  );
  set_document_adoption_fault_hook_for_tests(undefined);
  assert.equal(get_node_for_el(fixture.root as unknown as Element), undefined);
  assert.equal(get_node_for_el(fixture.child as unknown as Element), undefined);
  const retry = continue_document({ map, root: fixture.root as unknown as Element });
  retry.dispose();
}

{
  const map = documentMap(source());
  const fixture = mainFixture();
  set_document_adoption_fault_hook_for_tests((point) => {
    if (point === "after-tree") map.lib("page").document.attrs.set(path(0, 0), "data-race", "moved");
  });
  assert.throws(
    () => continue_document({ map, root: fixture.root as unknown as Element }),
    (cause) => cause instanceof DocumentContinuationError && cause.phase === "adopt",
  );
  set_document_adoption_fault_hook_for_tests(undefined);
  assert.equal(get_node_for_el(fixture.root as unknown as Element), undefined);
  assert.equal(fixture.child.getAttribute("data-race"), null);
  fixture.child.setAttribute("data-race", "moved");
  const retry = continue_document({ map, root: fixture.root as unknown as Element });
  retry.dispose();
}

{
  const map = documentMap(source());
  const existing = (await import("../src/api/mirror/mirror.document.ts")).reflect_document(map.lib("page"));
  const fixture = mainFixture();
  assert.throws(
    () => continue_document({ map, root: fixture.root as unknown as Element }),
    (cause) => cause instanceof DocumentContinuationError && cause.phase === "mirror" && cause.cause !== undefined,
  );
  assert.equal(get_node_for_el(fixture.root as unknown as Element), undefined);
  existing.dispose();
  const retry = continue_document({ map, root: fixture.root as unknown as Element });
  retry.dispose();
}

{
  const map = documentMap(source());
  const fixture = mainFixture();
  assert.throws(
    () => continue_document({
      map,
      root: fixture.root as unknown as Element,
      interactions: { local: {} },
    }),
    (cause) => cause instanceof DocumentContinuationError && cause.phase === "interactions" && cause.cause !== undefined,
  );
  assert.equal(get_node_for_el(fixture.root as unknown as Element), undefined);
  const retry = continue_document({ map, root: fixture.root as unknown as Element });
  retry.dispose();
}

{
  const first = hsonLiveMap.fromLibraries({
    page: { document: `<main/>`, schema: EmptyPageSchema },
  });
  enable_interactions(first);
  const root = new FakeElement("main");
  const inferred = continue_document({ map: first, root: root as unknown as Element });
  assert.equal(inferred.map, first.lib("page"));
  inferred.dispose();

  const many = hsonLiveMap.fromLibraries({
    page: { document: `<main/>`, schema: EmptyPageSchema },
    modal: { document: `<main/>`, schema: EmptyPageSchema },
  });
  assert.throws(
    () => continue_document({ map: many, root: new FakeElement("main") as unknown as Element }),
    /multiple public document libraries/i,
  );
  const modalRoot = new FakeElement("main");
  const selected = continue_document({ map: many, document: many.lib("modal"), root: modalRoot as unknown as Element });
  assert.equal(selected.map, many.lib("modal"));
  selected.dispose();
}

{
  const quid = "000003100";
  const map = admit_exact_runtime_livemap_libraries({ page: { document: parse_hson_exact_runtime(`<main <button @${quid}/>/>`, { allowTopLevelDocumentText: true }), schema: ButtonPageSchema } });
  enable_interactions(map);
  const descriptor: InteractionDescriptor = Object.freeze({
    id: "local-click",
    subject: Object.freeze({ library: "page", path: [0, 0, 0] }),
    kind: "browser",
    key: "click",
    args: Hson.data.from({ exact: true }),
    listener: Object.freeze({
      event: "click", target: "element", capture: false, once: false, passive: false,
      missingTarget: "throw", preventDefault: false, stopPropagation: false, stopImmediatePropagation: false,
    }),
  });
  add_interaction(map, descriptor);
  const root = new FakeElement("main");
  const button = new FakeElement("button");
  root.appendChild(button);
  let calls = 0;
  const continuation = continue_document({
    map,
    root: root as unknown as Element,
    interactions: { local: { click: () => { calls += 1; } } },
  });
  button.dispatchEvent(new Event("click"));
  assert.equal(calls, 1);
  continuation.dispose();
  button.dispatchEvent(new Event("click"));
  assert.equal(calls, 1);
}

{
  const firstMap = documentMap(source());
  const fixture = mainFixture();
  const first = continue_document({ map: firstMap, root: fixture.root as unknown as Element });
  first.dispose();
  const activeReuse = continue_document({ map: firstMap, root: fixture.root as unknown as Element });
  assert.equal(activeReuse.tree, first.tree);
  activeReuse.dispose();
  first.tree.remove();
  assert.equal(first.tree.isDisposed, true);
  const replacementChild = new FakeElement("p");
  replacementChild.appendChild(new FakeText("hello"));
  fixture.root.appendChild(replacementChild);
  const freshMap = documentMap(source());
  const profile = begin_livetree_materialization_profile();
  const fresh = continue_document({ map: freshMap, root: fixture.root as unknown as Element });
  assert.notEqual(fresh.tree, first.tree);
  assert.equal(profile.stop().quidEnsureCalls, 0);
  fresh.dispose();
}

{
  const map = documentMap(source());
  const fixture = mainFixture();
  const continuation = continue_document({ map, root: fixture.root as unknown as Element });
  continuation.dispose();
  unlinkElement(fixture.root as unknown as Element);
  assert.throws(
    () => continue_document({ map, root: fixture.root as unknown as Element }),
    (cause) => cause instanceof DocumentContinuationError && cause.phase === "adopt",
  );
  continuation.tree.remove();
}

process.stdout.write("Document continuation acceptance passed.\n");
