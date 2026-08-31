import assert from "node:assert/strict";
import {
  Hson,
  hsonReflect,
  hsonLiveMap,
  validate_document_path,
  hsonLocus,
  type HsonSchema,
  type LiveMapMultiLibraryCommit,
} from "../src/index.ts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";
import { livemap_identity_epoch_accounting } from "../src/api/livemap/livemap.identity-epoch.ts";
import { create_livetree } from "../src/api/livetree/creation/create-livetree.ts";
import { is_Node } from "../src/core/node-guards.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

const StateSchema: HsonSchema = Hson`<type "data" content <count "number" nested <content <value "number">>>>`;
const ColorsSchema: HsonSchema = Hson`<type "data" content <primary "string">>`;
const PageSchema: HsonSchema = Hson`<type "document" tag "main" attrs <props <title <optional "string">>> content "empty">`;
const ItemDocumentSchema: HsonSchema = Hson`<type "document" tag "main" content <repeat <tag "item" content "empty">>>`;
let checks = 0;

function check(name: string, run: () => void): void {
  run();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function create_map() {
  return hsonLiveMap.fromLibraries({
    state: { data: { count: 1, nested: { value: 2 } }, schema: StateSchema },
    colors: { data: { primary: "blue" }, schema: ColorsSchema },
    page: { document: "<main/>", schema: PageSchema },
  });
}

function node(value: unknown) {
  if (!is_Node(value)) throw new Error("Expected canonical Hson node");
  return value;
}

check("fromLibraries establishes fixed named data and document Libraries", () => {
  const map = create_map();
  assert.equal(map.rev, 0);
  assert.equal(map.lib("state").mode, "data-object");
  assert.equal(map.lib("colors").snap(["primary"]), "blue");
  assert.equal(map.lib("page").mode, "document");
  assert.equal(map.lib("page").root().$_content.length, 1);
  assert.equal("document" in map.lib("page"), true);
  assert.equal(node(map.lib("page").at([]).snap()).$_tag, "main");
  assert.equal("add" in map.lib, false);
  assert.equal("create" in map.lib, false);
  assert.equal("library" in map, false);
});

check("named document Library mutations retain their selected authority and global commit envelope", () => {
  const map = create_map();
  const page = map.lib("page");
  const commit = page.at([]).attrs.set("title", "selected");
  assert.equal(commit.kind, "multi-library");
  assert.deepEqual([commit.prevRev, commit.rev], [0, 1]);
  assert.deepEqual(commit.operations.map((entry) => entry.library), ["page"]);
  assert.equal(page.at([]).attrs.get("title"), "selected");
  assert.equal(map.lib("state").snap(["count"]), 1);
});

check("named document locations keep relative content operations in their selected Library", () => {
  const map = hsonLiveMap.fromLibraries({
    page: { document: "<main <item @000009111/>/>", schema: ItemDocumentSchema },
    modal: { document: "<main <item/>/>", schema: ItemDocumentSchema },
  });
  const page = map.lib("page");
  const modal = map.lib("modal");
  const incoming = modal.at([0]).snap();
  if (!is_Node(incoming)) throw new Error("Expected selected modal item.");
  const commit = page.at([]).insert(1, incoming);
  assert.deepEqual(commit.operations.map((entry) => entry.library), ["page"]);
  assert.equal(node(page.at([]).at([1]).snap()).$_tag, "item");
  assert.equal(node(modal.at([0]).snap()).$_tag, "item");
  const capture = page.capture();
  assert.deepEqual([capture.rev, capture.root.$_tag], [1, "_hson_root"]);
});

check("Reflect binds one selected document Library and advances through unrelated global revisions", () => {
  const map = create_map();
  const page = map.lib("page");
  const binding = hsonReflect(page);
  map.lib("state").at(["count"]).set(2);
  assert.equal(binding.status, "active");
  assert.equal(binding.sourceRevision, 1);
  assert.equal(binding.diagnostics().updatesApplied, 0);
  assert.equal(binding.diagnostics().incrementalCorrespondenceUpdates, 0);
  const commit = page.at([]).attrs.set("title", "reflected");
  assert.equal(commit.rev, 2);
  assert.equal(binding.sourceRevision, 2);
  assert.equal(node(binding.tree.node.$_content[0]).$_attrs?.title, "reflected");
  assert.equal(binding.diagnostics().updatesApplied, 1);
  binding.dispose();
});

check("one aggregate page plus data commit advances Reflect once and applies only page structure", () => {
  const map = create_map();
  const page = map.lib("page");
  const binding = hsonReflect(page);
  const aggregate = internal_livemap_aggregate_authority(map);
  const [state,, pageLibrary] = aggregate.libraries();
  if (state === undefined || pageLibrary === undefined) throw new Error("Expected named library registry");
  const commit = aggregate.commit([
    { target: aggregate.target(state, ["count"]), kind: "set", value: 2 },
    {
      target: aggregate.target(pageLibrary, [0]),
      kind: "graph",
      operation: {
        domain: "graph",
        op: "set-attr",
        target: { kind: "path", path: validate_document_path([0]) },
        name: "title",
        value: "aggregate",
      },
    },
  ]);
  assert.deepEqual([commit.prevRev, commit.rev], [0, 1]);
  assert.deepEqual(commit.operations.map((operation) => operation.target.library), [state, pageLibrary]);
  assert.equal(binding.sourceRevision, 1);
  assert.equal(node(binding.tree.node.$_content[0]).$_attrs?.title, "aggregate");
  assert.equal(map.lib("state").snap(["count"]), 2);
  binding.dispose();
});

check("tree-originated selected-document mutation crosses the same Schema boundary", () => {
  const map = create_map();
  const page = map.lib("page");
  const binding = hsonReflect(page);
  const projected = binding.tree.node.$_content[0];
  if (!is_Node(projected)) throw new Error("Expected projected page root");
  const tree = create_livetree(projected).adoptRoots(binding.tree.hostRootNode());
  tree.attrs.set("title", "from-tree");
  assert.equal(page.at([]).attrs.get("title"), "from-tree");
  assert.equal(binding.sourceRevision, 1);
  const quid = tree.quid;
  assert.equal(page.document.byQuid(quid)?.$_tag, "main");
  assert.equal(binding.sourceRevision, 2);
  const beforeFailure = livemap_identity_epoch_accounting(page);
  const before = page.root();
  assert.throws(() => page.at([]).insert(0, "forbidden"), /schema/i);
  assert.deepEqual(page.root(), before);
  assert.equal(map.rev, 2);
  assert.equal(binding.sourceRevision, 2);
  assert.deepEqual(livemap_identity_epoch_accounting(page), beforeFailure);
  binding.dispose();
});

check("named document QUID lookup remains library-local while active QUIDs remain map-wide", () => {
  const Q1 = "000009001";
  const Q2 = "000009002";
  const map = hsonLiveMap.fromLibraries({
    page: { document: `<main @${Q1}/>`, schema: PageSchema },
    modal: { document: `<main @${Q2}/>`, schema: PageSchema },
  });
  const page = map.lib("page");
  const modal = map.lib("modal");
  assert.equal(page.document.byQuid(Q1)?.$_tag, "main");
  assert.equal(modal.document.byQuid(Q1), undefined);
  const commit = page.document.attrs.set({ kind: "quid", quid: Q1 }, "title", "raw-route");
  assert.deepEqual(commit.operations.map((entry) => entry.library), ["page"]);
  assert.equal(page.at([]).attrs.get("title"), "raw-route");
  assert.equal(modal.at([]).attrs.get("title"), undefined);
  assert.throws(() => hsonLiveMap.fromLibraries({
    page: { document: `<main @${Q1}/>`, schema: PageSchema },
    modal: { document: `<main @${Q1}/>`, schema: PageSchema },
  }), /collision/i);
});

check("one selected document binding is exclusive while separate named documents bind independently", () => {
  const map = hsonLiveMap.fromLibraries({
    page: { document: "<main/>", schema: PageSchema },
    modal: { document: "<main/>", schema: PageSchema },
  });
  const page = map.lib("page");
  const modal = map.lib("modal");
  const pageBinding = hsonReflect(page);
  assert.throws(() => hsonReflect(map.lib("page")), /already has an active/i);
  const modalBinding = hsonReflect(modal);
  page.at([]).attrs.set("title", "page-only");
  assert.equal(node(pageBinding.tree.node.$_content[0]).$_attrs?.title, "page-only");
  assert.equal(node(modalBinding.tree.node.$_content[0]).$_attrs?.title, undefined);
  assert.equal(modalBinding.sourceRevision, 1);
  pageBinding.dispose();
  modalBinding.dispose();
});

check("aggregate document writes reject accidental cross-library QUID transfer", () => {
  const Q1 = "000009101";
  const Q2 = "000009102";
  const Q3 = "000009103";
  const map = hsonLiveMap.fromLibraries({
    page: { document: `<main <item @${Q1}/> <item @${Q2}/>/>`, schema: ItemDocumentSchema },
    modal: { document: `<main <item @${Q3}/>/>`, schema: ItemDocumentSchema },
  });
  const aggregate = internal_livemap_aggregate_authority(map);
  const [page, modal] = aggregate.libraries();
  if (page === undefined || modal === undefined) throw new Error("Expected document libraries");
  const beforePage = map.lib("page").root();
  const beforeModal = map.lib("modal").root();
  assert.throws(() => aggregate.commit([
    {
      target: aggregate.target(page, [0, 0]),
      kind: "graph",
      operation: {
        domain: "graph",
        op: "remove-content",
        target: { kind: "path", path: validate_document_path([0, 0]) },
        index: 0,
      },
    },
    {
      target: aggregate.target(modal, [0, 0]),
      kind: "graph",
      operation: {
        domain: "graph",
        op: "insert-content",
        target: { kind: "path", path: validate_document_path([0, 0]) },
        index: 0,
        content: { $_tag: "item", $_meta: { quid: Q1 }, $_content: [] },
      },
    },
  ]), /explicit LiveMap transfer semantic/i);
  assert.deepEqual(map.lib("page").root(), beforePage);
  assert.deepEqual(map.lib("modal").root(), beforeModal);
  assert.equal(map.rev, 0);
});

check("named Handles stay library-relative and return one truthful global commit", () => {
  const map = create_map();
  const seen: LiveMapMultiLibraryCommit[] = [];
  map.commits.observe((commit) => seen.push(commit));
  const handle = map.lib("state").at(["nested"]);
  const commit = handle.at(["value"]).set(3);

  assert.equal(commit.kind, "multi-library");
  assert.deepEqual([commit.prevRev, commit.rev], [0, 1]);
  assert.deepEqual(commit.operations.map((entry) => entry.library), ["state"]);
  assert.equal("target" in commit.operations[0]!, false);
  assert.deepEqual(handle.snap(), { value: 3 });
  assert.equal(map.lib("colors").snap(["primary"]), "blue");
  assert.equal(map.rev, 1);
  assert.deepEqual(seen, [commit]);
});

check("each named Library validates its initial graph before the registry is returned", () => {
  assert.throws(() => hsonLiveMap.fromLibraries({
    state: { data: { count: 1, nested: { value: 2 } }, schema: StateSchema },
    colors: { data: { primary: 3 }, schema: ColorsSchema },
  }), /schema/i);
});

check("the public commit family preserves future cross-library operation order", () => {
  const proof: LiveMapMultiLibraryCommit<"state" | "colors"> = {
    kind: "multi-library",
    changed: true,
    prevRev: 7,
    rev: 8,
    operations: [
      { library: "state", operation: { kind: "set", path: ["count"], prev: 1, next: 2 } },
      { library: "colors", operation: { kind: "set", path: ["primary"], prev: "blue", next: "green" } },
      { library: "state", operation: { kind: "set", path: ["count"], prev: 2, next: 3 } },
    ],
  };
  assert.deepEqual(proof.operations.map((entry) => entry.library), ["state", "colors", "state"]);
});

check("current Locus rejects a public multi-library map before claiming management", () => {
  const map = create_map();
  assert.throws(
    () => hsonLocus.create({ map: map as never }),
    /multi-library LiveMap support is not yet available/i,
  );
  assert.equal(map.lib("state").at(["count"]).set(2).rev, 1);
});

if (false) {
  const map = create_map();
  const page = map.lib("page");
  const state = map.lib("state");
  page.at([]).attrs.set("title", "typed");
  // @ts-expect-error A selected document library is not a projected data library.
  page.snap();
  // @ts-expect-error A selected data library has no document authority.
  state.document;
  // @ts-expect-error The static registry rejects misspelled named libraries.
  map.lib("pages");
}

process.stdout.write(`1..${checks}\n`);
emit_hson_live_test_completion("livemap.public-libraries", checks, checks, 0);
