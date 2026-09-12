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
  type DocumentLiveMap,
  type HsonSchema,
  type InteractionDescriptor,
} from "../src/index.ts";
import { begin_livetree_materialization_profile } from "../src/api/livetree/debug/materialization-profile.ts";
import { set_document_adoption_fault_hook_for_tests } from "../src/api/continuation/continuation.adopt.ts";
import { get_node_for_el } from "../src/api/livetree/utils/node-map-helpers.ts";
import { FakeElement, FakeText, install_fake_document } from "./helpers/fake-document.mts";

install_fake_document();

const EmptyPageSchema: HsonSchema = Hson`<type "document" tag "main" content "empty">`;
const ButtonPageSchema: HsonSchema = Hson`<type "document" tag "main" content <sequence [<tag "button" content "empty">]>>`;
const path = (...parts: number[]) => Object.freeze({ kind: "path" as const, path: Object.freeze([0, ...parts]) });

function documentMap(source: string): DocumentLiveMap {
  const map = hsonLiveMap.fromHson(source);
  if (map.mode !== "document") throw new Error("Expected document map.");
  return map;
}

function mainFixture(quid?: string): Readonly<{ root: FakeElement; child: FakeElement; text: FakeText }> {
  const root = new FakeElement("main");
  const child = new FakeElement("p");
  if (quid !== undefined) child.setAttribute("hson:quid", quid);
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
  const before = structuredClone(map.root());
  const profile = begin_livetree_materialization_profile();
  const continuation = continue_document({ map, root: fixture.root as unknown as Element });
  const materialization = profile.stop();
  assert.equal(continuation.map, map);
  assert.equal(continuation.tree.dom.el(), fixture.root as unknown as Element);
  assert.equal(continuation.tree.find.byTag("p")?.dom.el(), fixture.child as unknown as Element);
  assert.equal(fixture.child.childNodes[0], fixture.text);
  assert.deepEqual(map.root(), before);
  assert.equal(map.rev, 0);
  assert.equal(materialization.quidEnsureCalls, 0);
  assert.equal(fixture.root.getAttribute("hson:quid"), null);
  assert.equal(fixture.child.getAttribute("hson:quid"), quid);
  map.document.attrs.set(path(0, 0), "title", "continued");
  assert.equal(fixture.child.getAttribute("title"), "continued");
  continuation.dispose();
  map.document.attrs.set(path(0, 0), "title", "detached");
  assert.equal(fixture.child.getAttribute("title"), "continued");
  continuation.tree.find.byTag("p")?.attrs.set("title", "detached");
  const rebound = continue_document({ map, root: fixture.root as unknown as Element });
  assert.equal(rebound.tree, continuation.tree);
  rebound.dispose();
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
    if (point === "after-tree") map.document.attrs.set(path(0, 0), "data-race", "moved");
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
  const existing = (await import("../src/api/reflect/reflect.document.ts")).reflect_document(map);
  const fixture = mainFixture();
  assert.throws(
    () => continue_document({ map, root: fixture.root as unknown as Element }),
    (cause) => cause instanceof DocumentContinuationError && cause.phase === "reflect" && cause.cause !== undefined,
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
  const map = hsonLiveMap.fromLibraries({ page: { document: `<main <button @${quid}/>/>`, schema: ButtonPageSchema } });
  enable_interactions(map);
  const descriptor: InteractionDescriptor = Object.freeze({
    id: "local-click",
    subjectQuid: quid,
    kind: "browser-local",
    key: "click",
    args: HsonData.from({ exact: true }),
    listener: Object.freeze({
      event: "click", target: "element", capture: false, once: false, passive: false,
      missingTarget: "throw", preventDefault: false, stopPropagation: false, stopImmediatePropagation: false,
    }),
  });
  add_interaction(map, descriptor);
  const root = new FakeElement("main");
  const button = new FakeElement("button");
  button.setAttribute("hson:quid", quid);
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

process.stdout.write("Document continuation acceptance passed.\n");
