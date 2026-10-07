import { locus_map_internal } from "../src/internal/governor-maps.js";
import { authority_groups_from_catalog_fixture, authority_groups_from_map_fixture } from "./helpers/locus-definition-fixture.mts";
import { test_application_catalog } from "./helpers/hosted-catalog.mts";
import assert from "node:assert/strict";
import { Hson, hsonMirror, hsonLiveMap, type HsonSchema } from "../src/index.ts";
import { install_libraries_snapshot, validate_document_path, type LiveMapCommit } from "../src/api/livemap/index.ts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";
import { livemap_identity_epoch_accounting } from "../src/api/livemap/livemap.identity-epoch.ts";
import { decode_hosted_root, encode_hosted_root } from "../src/api/livemap/livemap.hosted.ts";
import { create_livetree } from "../src/api/livetree/creation/create-livetree.ts";
import { is_Node } from "../src/core/node-guards.ts";
import { create_test_event_emitter } from "./test-events.mjs";
import { parse_hson_exact_runtime } from "../src/internal/exact-runtime-hson-codec.ts";
import { admit_exact_runtime_livemap_libraries } from "../src/internal/exact-runtime-node-admission.ts";

const StateSchema: HsonSchema = Hson.schema`<type "data" content <count "number" nested <content <value "number">>>>`;
const ColorsSchema: HsonSchema = Hson.schema`<type "data" content <primary "string">>`;
const PageSchema: HsonSchema = Hson.schema`<type "document" tag "main" attrs <props <title <optional "string">>> content "empty">`;
const ItemDocumentSchema: HsonSchema = Hson.schema`<type "document" tag "main" content <repeat <tag "item" content "empty">>>`;
const EmptyDocumentSchema: HsonSchema = Hson.schema`<type "document" content <repeat <tag "item" content "empty">>>`;
export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.public-libraries",
  title: "LiveMap public libraries",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["livemap", "libraries", "public-api"]),
});

const testEvents = create_test_event_emitter("livemap.public-libraries");
let checks = 0;

function check(name: string, run: () => void): void {

  testEvents.case_begin(name, name);
  try {
    run();
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

check("batch groups ordered cross-library writes into one public commit", () => {
  const map = create_map();
  const observed: LiveMapCommit[] = [];
  map.commits.observe(commit => { observed.push(commit); });
  const commit = map.batch(batch => {
    batch.lib("state").at(["count"]).set(2);
    batch.lib("colors").at(["primary"]).set("red");
    batch.lib("state").at(["count"]).set(3);
    batch.lib("page").graph({ domain: "graph", op: "set-attr",
      target: { kind: "path", path: validate_document_path([0]) }, name: "title", value: "batched" });
    assert.equal(map.rev, 0);
    assert.equal(map.lib("state").at(["count"]).snap(), 1);
  });
  assert.equal(commit.changed, true);
  assert.equal(commit.rev, 1);
  assert.deepEqual(commit.operations.map(entry => entry.library), ["state", "colors", "state", "page"]);
  assert.equal(map.rev, 1);
  assert.equal(observed.length, 1);
  assert.equal(map.lib("state").at(["count"]).snap(), 3);
});

check("batch validates the final Schema candidate and installs nothing on failure", () => {
  const map = create_map();
  const repaired = map.batch(batch => {
    batch.lib("state").at(["count"]).set("temporarily invalid" as never);
    batch.lib("state").at(["count"]).set(4);
  });
  assert.equal(repaired.rev, 1);
  assert.throws(() => map.batch(batch => {
    batch.lib("colors").at(["primary"]).set("green");
    batch.lib("state").at(["count"]).set("invalid" as never);
  }));
  assert.equal(map.rev, 1);
  assert.equal(map.lib("colors").at(["primary"]).snap(), "blue");
  assert.equal(map.batch(() => {}).changed, false);
  assert.equal(map.batch(batch => { batch.lib("state").at(["count"]).set(4); }).changed, false);
  assert.equal(map.rev, 1);
});

check("batch rejects async, nested, direct, and escaped writes", () => {
  const map = create_map();
  let escaped: { set(value: number): void } | undefined;
  assert.throws(() => map.batch(batch => {
    escaped = batch.lib("state").at(["count"]);
    map.lib("state").at(["count"]).set(2);
  }), /batch/i);
  assert.equal(map.rev, 0);
  assert.throws(() => escaped?.set(2), /expired/i);
  assert.throws(() => map.batch(() => { map.batch(() => {}); }), /nested/i);
  assert.throws(() => map.batch(batch => {
    batch.lib("state").at(["count"]).set(3);
    throw new Error("callback failed");
  }), /callback failed/);
  assert.throws(() => map.batch((async () => {}) as never), /synchronous/i);
  let asyncHandle: { set(value: number): void } | undefined;
  assert.throws(() => map.batch(((batch: Parameters<Parameters<typeof map.batch>[0]>[0]) => {
    asyncHandle = batch.lib("state").at(["count"]);
    return Promise.resolve();
  }) as never), /synchronous/i);
  assert.throws(() => asyncHandle?.set(2), /expired/i);
  assert.equal(map.rev, 0);
});

check("batch captures public graph commands and rejects direct identity claims", () => {
  const map = create_map();
  const target = { kind: "path", path: validate_document_path([0]) } as const;
  const command: Record<string, unknown> = { domain: "graph", op: "set-attr", target,
    name: "title", value: "captured" };
  map.batch(batch => {
    batch.lib("page").graph(command as never);
    delete command.name;
    delete command.value;
    command.op = "ensure-quid";
    command.quid = "012345678";
  });
  assert.equal(map.lib("page").document.attrs.get(target, "title"), "captured");
  assert.equal(JSON.stringify(map.lib("page").root()).includes("012345678"), false);
  const rev = map.rev;
  assert.throws(() => map.batch(batch => {
    batch.lib("page").graph({ domain: "graph", op: "ensure-quid", target, quid: "012345678" } as never);
  }), /generated identity/i);
  assert.equal(map.rev, rev);

  const aggregate = internal_livemap_aggregate_authority(map);
  const pageLibrary = aggregate.libraries()[2];
  if (pageLibrary === undefined) throw new Error("Expected page library");
  assert.throws(() => aggregate.commit([{
    target: aggregate.target(pageLibrary, [0]), kind: "graph", publicStaged: true,
    operation: { domain: "graph", op: "ensure-quid", target, quid: "012345678" },
  } as never]), /generated identity/i);
  assert.equal(map.rev, rev);
});

check("batch detaches nested graph targets and CSS definitions", () => {
  const map = create_map();
  const path = [0];
  const graph = { domain: "graph", op: "set-attr", target: { kind: "path", path },
    name: "title", value: "original target" };
  const css = { domain: "css", kind: "property", name: "--original",
    definition: { name: "--original", syn: "<number>", inh: false, init: "0" } };
  map.batch(batch => {
    batch.lib("page").graph(graph as never);
    batch.lib("page").css(css as never);
    path[0] = 1;
    css.name = "--changed";
    css.definition.name = "--changed";
  });
  assert.equal(map.lib("page").document.attrs.get({ kind: "path", path: validate_document_path([0]) }, "title"), "original target");
  assert.match(map.lib("page").css.snapshot(), /@property --original/);
  assert.equal(map.lib("page").css.snapshot().includes("--changed"), false);
});

check("fromLibraries establishes fixed named data and document Libraries", () => {
  const map = create_map();
  assert.equal(map.rev, 0);
  assert.equal(map.lib("state").mode, "data-object");
  assert.equal(map.lib("colors").snap(["primary"]), "blue");
  assert.equal(map.lib("page").mode, "document");
  assert.equal(map.lib("page").root().$_content.length, 1);
  assert.equal("document" in map.lib("page"), true);
  assert.equal(node(map.lib("page").at([]).snap()).$_tag, "main");
  assert.equal(typeof map.addLibraries, "function");
  assert.equal("add" in map.lib, false);
  assert.equal("create" in map.lib, false);
  assert.equal("library" in map, false);
});

check("addLibraries admits runtime libraries while lib remains a selector", () => {
  const map = create_map();
  const page = map.lib("page");
  const commit = map.addLibraries({ extra: { data: { primary: "green" }, schema: ColorsSchema } });
  assert.deepEqual([commit.changed, commit.prevRev, commit.rev, map.rev], [true, 0, 1, 1]);
  assert.equal(commit.operations.length, 1);
  assert.equal(Reflect.get(commit.operations[0]!.operation, "kind"), "library-add");
  const extra = map.lib("extra");
  if (extra.mode === "document") throw new Error("Expected admitted data Library");
  assert.equal(extra.snap(["primary"]), "green");
  assert.equal(map.lib("page"), page);
  assert.equal(map.lib("state").snap(["count"]), 1);
  assert.equal("add" in map.lib, false);
});

check("public aggregate snapshot transfers state and revision without generated identity", () => {
  const source = create_map();
  const sourceAuthority = internal_livemap_aggregate_authority(source);
  const page = sourceAuthority.libraries()[2];
  if (page === undefined) throw new Error("Expected page Library");
  const quid = "00004c001";
  sourceAuthority.acquireLocalDocumentIdentity(page, validate_document_path([0]), quid);
  source.lib("state").at(["count"]).set(3);
  assert.equal(livemap_identity_epoch_accounting(source.lib("page")).issued, 1);
  const snapshot = source.capture();
  assert.equal("identity" in snapshot, false);
  assert.equal(JSON.stringify(snapshot).includes(quid), false);
  const received = install_libraries_snapshot(snapshot).map;
  assert.equal(received.rev, source.rev);
  const receivedState = received.lib("state");
  const receivedPage = received.lib("page");
  if (!("snap" in receivedState) || !("document" in receivedPage)) throw new Error("Installed registry modes changed");
  assert.deepEqual(receivedState.snap(), source.lib("state").snap());
  assert.equal(receivedPage.document.byQuid(quid), undefined);
  assert.equal(livemap_identity_epoch_accounting(receivedPage).issued, 0);
  assert.notEqual(internal_livemap_aggregate_authority(received).identityEpoch().owner, sourceAuthority.identityEpoch().owner);

  assert.throws(() => install_libraries_snapshot({ ...snapshot, identity: { epoch: 0, issuedQuids: [quid] } } as never));
  const pageEntry = snapshot.libraries[2];
  if (pageEntry === undefined) throw new Error("Expected captured page");
  const root = decode_hosted_root(pageEntry.root);
  const main = root.$_content[0];
  if (!is_Node(main)) throw new Error("Expected page element");
  main.$_meta = { quid };
  const tampered = { ...snapshot, libraries: snapshot.libraries.map((entry, index) =>
    index === 2 ? { ...entry, root: encode_hosted_root(root) } : entry) };
  assert.throws(() => install_libraries_snapshot(tampered), /runtime QUID metadata is invalid/);
});

check("named registry construction preserves selection and atomic commits in either declaration order", () => {
  for (const order of [["left", "right"], ["right", "left"]] as const) {
    const inputs = Object.fromEntries(order.map((name) => [name, {
      data: { count: name === "left" ? 1 : 2, nested: { value: 0 } },
      schema: StateSchema,
    }]));
    const map = hsonLiveMap.fromLibraries(inputs);
    const authority = internal_livemap_aggregate_authority(map);
    const identities = authority.libraries();
    assert.equal("root" in map, false);
    assert.equal(map.lib("left"), map.lib("left"));
    assert.equal(map.lib("right"), map.lib("right"));
    assert.equal(identities.length, 2);
    assert.notEqual(identities[0], identities[1]);
    const identityByName = new Map(order.map((name, index) => [name, identities[index]!]));
    const left = identityByName.get("left")!;
    const right = identityByName.get("right")!;
    const commit = authority.commit([
      { target: authority.target(right, ["count"]), kind: "set", value: 20 },
      { target: authority.target(left, ["count"]), kind: "set", value: 10 },
    ]);
    assert.deepEqual([commit.prevRev, commit.rev], [0, 1]);
    assert.deepEqual(commit.operations.map((entry) => entry.target.library), [right, left]);
    const leftSelected = map.lib("left");
    const rightSelected = map.lib("right");
    assert.equal(leftSelected.mode !== "document" && leftSelected.snap(["count"]), 10);
    assert.equal(rightSelected.mode !== "document" && rightSelected.snap(["count"]), 20);
    assert.equal(map.rev, 1);
  }
});

check("one named library seeds the ordinary registry authority", () => {
  const data = hsonLiveMap.fromLibraries({ state: { data: { count: 1, nested: { value: 2 } }, schema: StateSchema } });
  const document = hsonLiveMap.fromLibraries({ page: { document: "<main/>", schema: PageSchema } });
  for (const [map, mode] of [[data, "data-object"], [document, "document"]] as const) {
    const authority = internal_livemap_aggregate_authority(map);
    assert.equal(authority.libraries().length, 1);
    assert.equal(authority.inspect().libraries[0]?.mode, mode);
    assert.equal(authority.inspect().revision, map.rev);
  }
});

check("document Libraries admit empty graph owners and reject empty source", () => {
  const map = hsonLiveMap.fromLibraries({
    empty: { document: { $_tag: "_hson_root", $_content: [] }, schema: EmptyDocumentSchema },
  });
  assert.throws(() => hsonLiveMap.fromLibraries({ empty: { document: "", schema: EmptyDocumentSchema } }), /has no semantic value/);
  assert.equal(map.lib("empty").mode, "document");
  assert.deepEqual(map.lib("empty").root(), { $_tag: "_hson_root", $_content: [] });
  const received = install_libraries_snapshot(map.capture()).map;
  assert.deepEqual(received.lib("empty").root(), map.lib("empty").root());
  assert.deepEqual(received.capture(), map.capture());
  const cutReceived = install_libraries_snapshot(map.cut().libs).map;
  assert.deepEqual(cutReceived.lib("empty").root(), map.lib("empty").root());
  const source = hsonLiveMap.create();
  const commit = source.addLibraries({ empty: { document: { $_tag: "_hson_root", $_content: [] }, schema: EmptyDocumentSchema } });
  const replica = hsonLiveMap.create();
  replica.replay(commit);
  assert.deepEqual(replica.lib("empty").root(), map.lib("empty").root());
});

check("named document Library mutations retain their selected authority and global commit envelope", () => {
  const map = create_map();
  const page = map.lib("page");
  const commit = page.at([]).asElement()!.attrs.set("title", "selected");
  assert.equal(commit.kind, "map");
  assert.deepEqual([commit.prevRev, commit.rev], [0, 1]);
  assert.deepEqual(commit.operations.map((entry) => entry.library), ["page"]);
  assert.equal(page.at([]).asElement()!.attrs.get("title"), "selected");
  assert.equal(map.lib("state").snap(["count"]), 1);
});

check("named document locations keep relative content operations in their selected Library", () => {
  const map = admit_exact_runtime_livemap_libraries({
    page: { document: parse_hson_exact_runtime("<main <item @000009111/>/>", { allowTopLevelDocumentText: true }), schema: ItemDocumentSchema },
    modal: { document: "<main <item/>/>", schema: ItemDocumentSchema },
  });
  const page = map.lib("page");
  const modal = map.lib("modal");
  const incoming = modal.at([0]).snap();
  if (!is_Node(incoming)) throw new Error("Expected selected modal item.");
  const commit = page.at([]).asElement()!.insert(1, incoming);
  assert.deepEqual(commit.operations.map((entry) => entry.library), ["page"]);
  assert.equal(node(page.at([]).at([1]).snap()).$_tag, "item");
  assert.equal(node(modal.at([0]).snap()).$_tag, "item");
  assert.deepEqual([page.rev, page.root().$_tag], [1, "_hson_root"]);
});

check("Mirror binds one selected document Library and advances through unrelated global revisions", () => {
  const map = create_map();
  const page = map.lib("page");
  const binding = hsonMirror(page);
  map.lib("state").at(["count"]).set(2);
  assert.equal(binding.status, "active");
  assert.equal(binding.sourceRevision, 1);
  assert.equal(binding.diagnostics().updatesApplied, 0);
  assert.equal(binding.diagnostics().incrementalCorrespondenceUpdates, 0);
  const commit = page.at([]).asElement()!.attrs.set("title", "reflected");
  assert.equal(commit.rev, 2);
  assert.equal(binding.sourceRevision, 2);
  assert.equal(node(binding.tree.node.$_content[0]).$_attrs?.title, "reflected");
  assert.equal(binding.diagnostics().updatesApplied, 1);
  binding.dispose();
});

check("one aggregate page plus data commit advances Mirror once and applies only page structure", () => {
  const map = create_map();
  const page = map.lib("page");
  const binding = hsonMirror(page);
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
  const binding = hsonMirror(page);
  const projected = binding.tree.node.$_content[0];
  if (!is_Node(projected)) throw new Error("Expected projected page root");
  const tree = create_livetree(projected).adoptRoots(binding.tree.hostRootNode());
  tree.attrs.set("title", "from-tree");
  assert.equal(page.at([]).asElement()!.attrs.get("title"), "from-tree");
  assert.equal(binding.sourceRevision, 1);
  const quid = tree.quid;
  assert.equal(page.document.byQuid(quid)?.$_tag, "main");
  assert.equal(binding.sourceRevision, 1);
  const beforeFailure = livemap_identity_epoch_accounting(page);
  const before = page.root();
  assert.throws(() => page.at([]).asElement()!.insert(0, "forbidden"), /schema/i);
  assert.deepEqual(page.root(), before);
  assert.equal(map.rev, 1);
  assert.equal(binding.sourceRevision, 1);
  assert.deepEqual(livemap_identity_epoch_accounting(page), beforeFailure);
  binding.dispose();
});

check("named document QUID lookup remains library-local while active QUIDs remain map-wide", () => {
  const Q1 = "000009001";
  const Q2 = "000009002";
  const map = admit_exact_runtime_livemap_libraries({
    page: { document: parse_hson_exact_runtime(`<main @${Q1}/>`, { allowTopLevelDocumentText: true }), schema: PageSchema },
    modal: { document: parse_hson_exact_runtime(`<main @${Q2}/>`, { allowTopLevelDocumentText: true }), schema: PageSchema },
  });
  const page = map.lib("page");
  const modal = map.lib("modal");
  assert.equal(page.document.byQuid(Q1)?.$_tag, "main");
  assert.equal(modal.document.byQuid(Q1), undefined);
  const commit = page.document.attrs.set({ kind: "path", path: [0] }, "title", "path-route");
  assert.deepEqual(commit.operations.map((entry) => entry.library), ["page"]);
  assert.equal(page.at([]).asElement()!.attrs.get("title"), "path-route");
  assert.equal(modal.at([]).asElement()!.attrs.get("title"), undefined);
  assert.throws(() => admit_exact_runtime_livemap_libraries({
    page: { document: parse_hson_exact_runtime(`<main @${Q1}/>`, { allowTopLevelDocumentText: true }), schema: PageSchema },
    modal: { document: parse_hson_exact_runtime(`<main @${Q1}/>`, { allowTopLevelDocumentText: true }), schema: PageSchema },
  }), /collision/i);
});

check("one selected document binding is exclusive while separate named documents bind independently", () => {
  const map = hsonLiveMap.fromLibraries({
    page: { document: "<main/>", schema: PageSchema },
    modal: { document: "<main/>", schema: PageSchema },
  });
  const page = map.lib("page");
  const modal = map.lib("modal");
  const pageBinding = hsonMirror(page);
  assert.throws(() => hsonMirror(map.lib("page")), /already has an active/i);
  const modalBinding = hsonMirror(modal);
  page.at([]).asElement()!.attrs.set("title", "page-only");
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
  const map = admit_exact_runtime_livemap_libraries({
    page: { document: parse_hson_exact_runtime(`<main <item @${Q1}/> <item @${Q2}/>/>`, { allowTopLevelDocumentText: true }), schema: ItemDocumentSchema },
    modal: { document: parse_hson_exact_runtime(`<main <item @${Q3}/>/>`, { allowTopLevelDocumentText: true }), schema: ItemDocumentSchema },
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
  const seen: LiveMapCommit[] = [];
  map.commits.observe((commit) => seen.push(commit));
  const handle = map.lib("state").at(["nested"]);
  const commit = handle.at(["value"]).set(3);

  assert.equal(commit.kind, "map");
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
  const proof: LiveMapCommit<"state" | "colors"> = {
    kind: "map",
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

check("ordinary Locus constructs and exclusively manages its authority map", async () => {
  const map = create_map();
  const locus = hsonLiveMap.locus.create({ ...authority_groups_from_map_fixture(map, test_application_catalog(map)) });
  assert.notEqual(locus_map_internal(locus), map);
  await locus.lib("state").at(["count"]).set(2);
  assert.equal(map.lib("state").at(["count"]).set(2).rev, 1);
  locus.dispose();
  await assert.rejects(locus.lib("state").at(["count"]).set(2), /unavailable|disposed|closed/i);
});

if (false) {
  const map = create_map();
  const page = map.lib("page");
  const state = map.lib("state");
  page.at([]).asElement()!.attrs.set("title", "typed");
  // @ts-expect-error A selected document library is not a projected data library.
  page.snap();
  // @ts-expect-error A selected data library has no document authority.
  state.document;
  // Dynamic names are accepted by the type surface and checked at runtime.
  const dynamicName: string = "pages";
  map.lib(dynamicName);
}

process.stdout.write(`1..${checks}\n`);
testEvents.terminal("pass");
