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
import { continuation_runtime_for_document, runtime_for_tree, subject_for_tree } from "../src/api/livetree/runtime/livetree-runtime.ts";
import { make_livemap_from_authored_libraries_internal } from "../src/api/livemap/livemap.libraries.ts";
import { install_libraries_snapshot, validate_document_path } from "../src/api/livemap/index.ts";
import { lookup_document_quad_internal } from "../src/api/livemap/livemap.document.quad.ts";
import type { DocumentQuadSubject } from "../src/api/livemap/livemap.document.quad.ts";
import type { LiveTree } from "../src/api/livetree/livetree.ts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";
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

// Authored addresses issue identities into the Library overlay, not its portable root.
// The same cases run in an actual Worker through livetree-css-lazy.worker.mts.
for (const restored of [false, true]) {
  const server = make_livemap_from_authored_libraries_internal({ page: { document: restored
    ? '<main @:root <button @:confirm/> <aside @:other/> <span/>/>'
    : '<main <button @:confirm/> <aside/> <span/>/>' } });
  const map = restored ? install_libraries_snapshot(server.capture()).map : server;
  const page = map.lib("page");
  if (page.mode !== "document") throw new Error("Expected document Library.");
  const before = map.capture(), aggregate = internal_livemap_aggregate_authority(map);
  const ledger = aggregate.identityEpoch().issued();
  const names = restored ? ["root", "confirm", "other"] : ["confirm"];
  const root = new FakeElement("main"), button = new FakeElement("button"), aside = new FakeElement("aside"), span = new FakeElement("span");
  root.appendChild(button); root.appendChild(aside); root.appendChild(span);
  const html = page.render();
  assert.doesNotMatch(html, /hson:quid/);
  const continuation = continue_document({ map, document: page, root: root as unknown as Element });
  const runtime = runtime_for_tree(continuation.tree);
  assert.equal(continuation.tree.dom.el(), root as unknown as Element);
  for (const name of names) {
    const address: DocumentQuadSubject = lookup_document_quad_internal(page, name)!;
    const tree: LiveTree = continuation.tree.find.byQuid(address.quid)!;
    const element = name === "root" ? root : name === "confirm" ? button : aside;
    assert.equal(tree.dom.el(), element as unknown as Element);
    assert.equal(tree.quid, address.quid);
    assert.equal(tree.node.$_meta?.quid, address.quid);
    assert.equal(runtime.quidToNode.get(address.quid), subject_for_tree(tree));
    assert.equal(runtime.nodeToQuid.get(subject_for_tree(tree)), address.quid);
    assert.equal(element.getAttribute("hson:quid"), null);
    if (restored) assert.notEqual(address.quid, lookup_document_quad_internal(server.lib("page"), name)!.quid);
  }
  assert.equal(continuation.tree.find.must.byTag("span").node.$_meta?.quid, undefined);
  assert.equal(aggregate.identityEpoch().issued(), ledger);
  assert.deepEqual(map.capture(), before);
  const quid = lookup_document_quad_internal(page, "confirm")!.quid;
  page.at([]).asElement()!.move(0, 1);
  assert.equal(continuation.mirror.status, "active", continuation.mirror.failure?.message);
  assert.equal(root.childNodes[1], button);
  assert.deepEqual(lookup_document_quad_internal(page, "confirm")!.path, [0, 0, 1]);
  page.document.content.replace(path(0), 1, { $_tag: "button", $_content: [] },
    [{ source: validate_document_path([]), destination: validate_document_path([]) }]);
  assert.equal(lookup_document_quad_internal(page, "confirm")!.quid, quid);
  assert.equal(continuation.tree.find.byQuid(quid)!.dom.el(), button as unknown as Element);
  continuation.dispose();
  const rebound = continue_document({ map, document: page, root: root as unknown as Element });
  assert.equal(rebound.tree, continuation.tree);
  assert.equal(rebound.tree.find.byQuid(quid)!.dom.el(), button as unknown as Element);
  rebound.dispose();
}

// Failed adoption must leave the existing Library claims intact and allow a retry.
for (const failure of ["foreign-quid", "matching-quid", "malformed-quid", "wrong-attribute", "after-runtime", "after-tree", "after-tree-dom"] as const) {
  const map = make_livemap_from_authored_libraries_internal({ page: { document: '<main <button @:confirm/>/>' } });
  const page = map.lib("page"), root = new FakeElement("main"), button = new FakeElement("button");
  if (page.mode !== "document") throw new Error("Expected document Library.");
  root.appendChild(button);
  const aggregate = internal_livemap_aggregate_authority(map), before = map.capture(), ledger = aggregate.identityEpoch().issued();
  const runtime = continuation_runtime_for_document(root.ownerDocument as unknown as Document);
  const issued = [...runtime.issuedQuids], claims = [...runtime.quidToNode];
  if (failure === "foreign-quid") button.setAttribute("hson:quid", "000000001");
  if (failure === "matching-quid") button.setAttribute("hson:quid", lookup_document_quad_internal(page, "confirm")!.quid);
  if (failure === "malformed-quid") button.setAttribute("hson:quid", "malformed");
  if (failure === "wrong-attribute") button.setAttribute("title", "unexpected");
  set_document_adoption_fault_hook_for_tests((point) => {
    if (point === failure) throw new Error("QUAD adoption fault");
    if (point === "after-tree" && failure === "after-tree-dom") button.setAttribute("title", "changed after matching");
  });
  try {
    assert.throws(() => continue_document({ map, document: page, root: root as unknown as Element }),
      (error) => error instanceof DocumentContinuationError && error.phase === (failure === "after-tree-dom" ? "mirror" : "adopt"));
  } finally { set_document_adoption_fault_hook_for_tests(undefined); }
  assert.equal(get_node_for_el(root as unknown as Element), undefined);
  assert.equal(get_node_for_el(button as unknown as Element), undefined);
  assert.equal(aggregate.identityEpoch().issued(), ledger);
  assert.deepEqual([...runtime.issuedQuids], issued);
  assert.deepEqual([...runtime.quidToNode], claims);
  assert.deepEqual(map.capture(), before);
  button.removeAttribute("hson:quid"); button.removeAttribute("title");
  const retry = continue_document({ map, document: page, root: root as unknown as Element });
  assert.equal(retry.tree.find.byQuid(lookup_document_quad_internal(page, "confirm")!.quid)!.dom.el(), button as unknown as Element);
  retry.dispose();
}

process.stdout.write("Document continuation acceptance passed.\n");
