import { test_public_exposure } from "./helpers/hosted-exposure.mts";
// @hson-live-external-test
import assert from "node:assert/strict";
import {
  Hson,
  HsonData,
  activate_interactions,
  add_interaction,
  enable_interactions,
  hsonEcho,
  hsonLiveMap,
  hsonLocus,
  hsonMirror,
  remove_interaction,
  replace_interaction,
  type HsonSchema,
  type InteractionDescriptor,
  type InteractionActionDispatcher,
  type InteractionListener,
  type InteractionLocalBehavior,
} from "../src/index.ts";
import type { LocusSocketLike } from "../src/types/locus.types.ts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";
import { validate_document_path } from "../src/api/livemap/index.ts";
import {
  set_interaction_activation_initialization_hook_for_tests,
  set_interaction_activation_initialization_materialization_hook_for_tests,
} from "../src/api/interactions/interactions.ts";
import { link_node_to_el } from "../src/api/livetree/utils/node-map-helpers.ts";
import { project_livetree } from "../src/api/livetree/creation/project-live-tree.ts";
import { create_livetree_runtime } from "../src/api/livetree/runtime/livetree-runtime.ts";
import { reflect_document_in_runtime } from "../src/api/reflect/reflect.document.ts";
import { install_fake_document } from "./helpers/fake-document.mts";
import { create_test_event_emitter } from "./test-events.mjs";
import { parse_hson_exact_runtime } from "../src/internal/exact-runtime-hson-codec.ts";
import { admit_exact_runtime_livemap_node } from "../src/internal/exact-runtime-node-admission.ts";
import { admit_exact_runtime_livemap_libraries } from "../src/internal/exact-runtime-node-admission.ts";
import { acquire_document_identity } from "./helpers/livemap-identity-internal.mts";
import { set_livemap_document_quid_candidate_source_for_tests } from "../src/api/livemap/livemap.document.registration.ts";

install_fake_document();

const PageSchema: HsonSchema = Hson.schema`<type "document" tag "main" content <sequence [<tag "button" content "empty">]>>`;
const StateSchema: HsonSchema = Hson.schema`<type "data" content <count "number">>`;
let quidSequence = 8340;
let currentQ = "000008340";
const listener: InteractionListener = Object.freeze({
  event: "click",
  target: "element",
  capture: true,
  once: false,
  passive: false,
  missingTarget: "throw",
  preventDefault: true,
  stopPropagation: true,
  stopImmediatePropagation: true,
});

class Target {
  readonly registrations: Array<Readonly<{ type: string; listener: EventListener; options: AddEventListenerOptions }>> = [];
  addEventListener(type: string, listener: EventListener, options: AddEventListenerOptions): void {
    this.registrations.push({ type, listener, options });
  }
  removeEventListener(_type: string, listener: EventListener): void {
    const index = this.registrations.findIndex((entry) => entry.listener === listener);
    if (index >= 0) this.registrations.splice(index, 1);
  }
  fire(event = new Event("click")): void {
    for (const entry of [...this.registrations]) {
      if (entry.type !== event.type) continue;
      entry.listener(event);
      if (entry.options.once) this.removeEventListener(entry.type, entry.listener);
    }
  }
}

function map_fixture() {
  quidSequence += 1;
  currentQ = quidSequence.toString().padStart(9, "0");
  const map = admit_exact_runtime_livemap_libraries({
    state: { data: { count: 0 }, schema: StateSchema },
    page: { document: parse_hson_exact_runtime(`<main <button @${currentQ}/>/>`, { allowTopLevelDocumentText: true }), schema: PageSchema },
  });
  enable_interactions(map);
  return map;
}

function socket_pair(): Readonly<{ client: LocusSocketLike; server: LocusSocketLike }> {
  const toClient = new Set<(raw: string) => void>();
  const toServer = new Set<(raw: string) => void>();
  const client = Object.freeze({
    send: (raw: string) => { for (const listener of [...toServer]) listener(raw); },
    close: () => undefined,
    onMessage: (listener: (raw: string) => void) => { toClient.add(listener); return () => toClient.delete(listener); },
    onClose: (_listener: () => void) => () => undefined,
  });
  const server = Object.freeze({
    send: (raw: string) => { for (const listener of [...toClient]) listener(raw); },
    close: () => undefined,
    onMessage: (listener: (raw: string) => void) => { toServer.add(listener); return () => toServer.delete(listener); },
    onClose: (_listener: () => void) => () => undefined,
  });
  return Object.freeze({ client, server });
}

async function activate_echo(echo: Readonly<{
  connect: () => unknown;
  session: Readonly<{ credential: string | undefined; create: () => Promise<unknown>; reattach: () => Promise<unknown> }>;
  recovery: Readonly<{ recover: () => Promise<unknown> }>;
}>): Promise<void> {
  echo.connect();
  if (echo.session.credential === undefined) await echo.session.create();
  else await echo.session.reattach();
  await echo.recovery.recover();
}

function local(id: string, key: string, args: HsonData = Hson.data.from(null), override: Partial<InteractionListener> = {}): InteractionDescriptor {
  return Object.freeze({ id, subject: Object.freeze({ library: "page", path: [0, 0, 0] }), listener: Object.freeze({ ...listener, ...override }), kind: "browser-local", key, args });
}
function authoritative(id: string, key: string, payload: HsonData): InteractionDescriptor {
  return Object.freeze({ id, subject: Object.freeze({ library: "page", path: [0, 0, 0] }), listener, kind: "locus-authoritative", key, payload });
}

const testEvents = create_test_event_emitter("canonical-interactions");
let checks = 0;
async function check(name: string, run: () => void | Promise<void>): Promise<void> {
  testEvents.case_begin(name, name);
  try { await run(); testEvents.case_end(name, "pass"); }
  catch (error) { testEvents.case_end(name, "fail"); testEvents.terminal("fail"); throw error; }
  process.stdout.write(`ok ${++checks} - ${name}\n`);
}

await check("hidden storage is aggregate state but not public selection", () => {
  const map = map_fixture();
  const aggregate = internal_livemap_aggregate_authority(map);
  assert.equal(map.rev, 0);
  enable_interactions(map);
  assert.equal(map.rev, 0);
  assert.equal(aggregate.inspect().libraries.length, 2);
  const snapshot = aggregate.captureHosted();
  assert.equal(snapshot.registry.libraries.filter((entry) => entry.scope === "hson-internal").length, 1);
  assert.throws(() => map.lib("@hson/canonical-interactions/v1" as "state"), /Unknown/);
  let publicOperations: readonly unknown[] | undefined;
  const stop = map.commits.observe((commit) => { publicOperations = commit.operations; });
  add_interaction(map, local("a", "run"));
  assert.equal(map.rev, 1);
  assert.deepEqual(publicOperations, []);
  assert.notDeepEqual(aggregate.captureHosted(), snapshot);
  stop();
  assert.deepEqual(map.lib("state").snap(), { count: 0 });

  const late = admit_exact_runtime_livemap_libraries({
    state: { data: { count: 0 }, schema: StateSchema },
    page: { document: parse_hson_exact_runtime(`<main <button @${currentQ}/>/>`, { allowTopLevelDocumentText: true }), schema: PageSchema },
  });
  assert.equal(internal_livemap_aggregate_authority(late).captureHosted().registry.libraries.every(
    (entry) => !Object.hasOwn(entry, "scope"),
  ), true);
  late.lib("state").at(["count"]).set(1);
  assert.throws(() => enable_interactions(late), /before the first transition/);
});

await check("strict Schema and authoring semantics reject before revision movement", () => {
  const map = map_fixture();
  add_interaction(map, local("a", "run"));
  assert.throws(() => add_interaction(map, local("a", "run")), /already exists/);
  const before = map.rev;
  assert.throws(() => add_interaction(map, { ...local("bad", "run"), subject: { library: "page", path: [-1] } }), /path|index/i);
  assert.equal(map.rev, before);
  assert.throws(() => add_interaction(map, { ...local("extra", "run"), extra: true } as unknown as InteractionDescriptor), /unknown or missing/);
  assert.equal(map.rev, before);
  assert.throws(() => replace_interaction(map, local("missing", "run")), /does not exist/);
  for (const path of [[-1], [1.5], [Number.MAX_SAFE_INTEGER + 1]]) {
    assert.throws(() => add_interaction(map, { ...local(`bad-${path[0]}`, "run"), subject: { library: "page", path } }), /path|index/i);
    assert.equal(map.rev, before);
  }
  assert.throws(() => add_interaction(map, { ...local("data-target", "run"), subject: { library: "state", path: [0] } }), /document Library/);
  assert.equal(map.rev, before);
  assert.throws(() => add_interaction(map, {
    ...local("bad-target", "run"), listener: { ...listener, target: "body" },
  } as unknown as InteractionDescriptor), /Schema/);
  assert.throws(() => add_interaction(map, {
    ...local("bad-policy", "run"), listener: { ...listener, missingTarget: "later" },
  } as unknown as InteractionDescriptor), /Schema/);
  assert.throws(() => add_interaction(map, {
    ...local("hybrid", "run"), payload: Hson.data.from(null),
  } as unknown as InteractionDescriptor), /unknown or missing/);
  assert.throws(() => add_interaction(map, local("reserved", "run", { _hson_bad: 1 } as never)), /Reserved Hson prefix/);
  assert.throws(() => Hson.data.fromHson(Hson.canonical`<main/>`), /data/i);
  assert.equal(map.rev, before);
  remove_interaction(map, "a");
  assert.equal(map.rev, before + 1);
  assert.throws(() => remove_interaction(map, "a"), /does not exist/);
});

await check("document and interaction effects accept or reject as one authority transition", async () => {
  const map = map_fixture();
  const aggregate = internal_livemap_aggregate_authority(map);
  const locus = hsonLocus.create({
    exposure: test_public_exposure(map),
    map,
    actions: {
      mixed: (context) => context.mutate((draft) => {
        draft.lib("page").graph(Object.freeze({
          domain: "graph",
          op: "set-attr",
          target: Object.freeze({ kind: "path", path: validate_document_path([0]) }),
          name: "title",
          value: "accepted",
        }));
        add_interaction(draft, local("mixed", "run"));
      }),
      invalid: (context) => context.mutate((draft) => {
        draft.lib("page").graph(Object.freeze({
          domain: "graph",
          op: "set-attr",
          target: Object.freeze({ kind: "path", path: validate_document_path([0]) }),
          name: "blocked",
          value: "rejected",
        }));
        add_interaction(draft, { ...local("invalid", "run"), subject: { library: "page", path: [-1] } });
      }),
    },
  });

  const accepted = await locus.dispatchAction({ type: "action", id: "mixed-accept", name: "mixed" });
  assert.equal(accepted.type, "ack");
  assert.equal(map.rev, 1);
  assert.equal(map.lib("page").document.attrs.get({ kind: "path", path: [0] }, "title"), "accepted");
  const acceptedCapture = aggregate.captureHosted();
  assert.match(JSON.stringify(acceptedCapture), /mixed/);

  const beforeRevision = map.rev;
  const beforeIssued = aggregate.identityEpoch().issued().size;
  const beforeCapture = JSON.stringify(acceptedCapture);
  const rejected = await locus.dispatchAction({ type: "action", id: "mixed-reject", name: "invalid" });
  assert.equal(rejected.type, "error");
  assert.equal(map.rev, beforeRevision);
  assert.equal(aggregate.identityEpoch().issued().size, beforeIssued);
  assert.equal(map.lib("page").document.attrs.get({ kind: "path", path: [0] }, "blocked"), undefined);
  assert.equal(JSON.stringify(aggregate.captureHosted()), beforeCapture);
  locus.dispose();
});

await check("Locus staging authors hidden descriptors while direct managed writes are fenced", async () => {
  const map = map_fixture();
  const descriptor = local("managed", "run", Hson.data.from(-0));
  const locus = hsonLocus.create({
    exposure: test_public_exposure(map),
    map,
    actions: {
      add: (context) => context.mutate((draft) => add_interaction(draft, descriptor)),
      replace: (context) => context.mutate((draft) => replace_interaction(draft, local("managed", "next"))),
      remove: (context) => context.mutate((draft) => remove_interaction(draft, "managed")),
    },
  });
  assert.throws(() => add_interaction(map, descriptor), /exclusive Locus authority/i);
  assert.equal((await locus.dispatchAction({ type: "action", id: "managed-add", name: "add" })).type, "ack");
  assert.equal(map.rev, 1);
  assert.equal((await locus.dispatchAction({ type: "action", id: "managed-replace", name: "replace" })).type, "ack");
  assert.equal(map.rev, 2);
  assert.equal((await locus.dispatchAction({ type: "action", id: "managed-remove", name: "remove" })).type, "ack");
  assert.equal(map.rev, 3);
  locus.dispose();
});

await check("local to local to authoritative reconciliation owns one exact subject", async () => {
  const map = map_fixture();
  add_interaction(map, local("progress", "a", Hson.data.from(-0)));
  const reflection = hsonMirror(map.lib("page"));
  const subject = reflection.tree.find.must.byQuid(currentQ);
  const target = new Target();
  link_node_to_el(subject.node, target as unknown as Element);
  const aggregate = internal_livemap_aggregate_authority(map);
  const revisionBeforeActivation = map.rev;
  const issuedBeforeActivation = aggregate.identityEpoch().issued().size;
  let a = 0, b = 0, authority = 0;
  let received: HsonData | undefined;
  const dispose = activate_interactions({
    map,
    tree: reflection.tree,
    local: {
      a: (_event, exactSubject, args) => { a += 1; received = args; assert.equal(exactSubject.node, subject.node); },
      b: () => { b += 1; },
    },
    dispatch: async (_key, payload) => { authority += 1; received = payload; },
  });
  assert.equal(target.registrations.length, 1);
  assert.deepEqual(target.registrations[0]?.options, { capture: true, once: false, passive: false });
  target.fire();
  assert.equal(a, 1);
  assert.equal(Object.is(received === undefined ? undefined : Hson.data.materialize(received), -0), true);
  assert.equal(map.rev, revisionBeforeActivation);
  assert.equal(aggregate.identityEpoch().issued().size, issuedBeforeActivation);
  replace_interaction(map, local("progress", "b"));
  assert.equal(target.registrations.length, 1);
  target.fire();
  assert.deepEqual([a, b, authority], [1, 1, 0]);
  const exact = Hson.data.fromHson(Hson.canonical`<'2' 2 __proto__ -0 '1' 1>`);
  replace_interaction(map, authoritative("progress", "save", exact));
  assert.equal(target.registrations.length, 1);
  target.fire();
  await Promise.resolve();
  assert.deepEqual([a, b, authority], [1, 1, 1]);
  assert.equal(received, exact);
  dispose(); dispose();
  assert.equal(target.registrations.length, 0);
  assert.equal(map.rev, 3);
  reflection.dispose();
});

await check("once is retained per materialization and reset by replacement/reactivation", () => {
  const map = map_fixture();
  add_interaction(map, local("once", "a", Hson.data.from(null), { once: true }));
  const reflection = hsonMirror(map.lib("page"));
  const subject = reflection.tree.find.must.byQuid(currentQ);
  const target = new Target(); link_node_to_el(subject.node, target as unknown as Element);
  let calls = 0;
  let dispose = activate_interactions({ map, tree: reflection.tree, local: { a: () => { calls += 1; } } });
  target.fire(); target.fire();
  assert.equal(calls, 1);
  const afterFirstInvocation = map.rev;
  map.lib("state").at(["count"]).set(1);
  assert.equal(target.registrations.length, 0);
  assert.equal(map.rev, afterFirstInvocation + 1);
  replace_interaction(map, local("once", "a", Hson.data.from(1), { once: true }));
  assert.equal(target.registrations.length, 1);
  target.fire(); assert.equal(calls, 2);
  remove_interaction(map, "once");
  add_interaction(map, local("once", "a", Hson.data.from(2), { once: true }));
  assert.equal(target.registrations.length, 1);
  target.fire(); assert.equal(calls, 3);
  dispose();
  dispose = activate_interactions({ map, tree: reflection.tree, local: { a: () => { calls += 1; } } });
  target.fire(); assert.equal(calls, 4);
  dispose(); reflection.dispose();
});

await check("authoritative to local replacement uses no cross-capability fallback", async () => {
  const map = map_fixture();
  add_interaction(map, authoritative("reverse", "save", Hson.data.from(1)));
  const reflection = hsonMirror(map.lib("page"));
  const subject = reflection.tree.find.must.byQuid(currentQ);
  const target = new Target(); link_node_to_el(subject.node, target as unknown as Element);
  let dispatched = 0, localCalls = 0;
  const dispose = activate_interactions({
    map, tree: reflection.tree, local: { run: () => { localCalls += 1; } },
    dispatch: async () => { dispatched += 1; },
  });
  target.fire(); await Promise.resolve();
  replace_interaction(map, local("reverse", "run"));
  target.fire(); await Promise.resolve();
  assert.deepEqual([dispatched, localCalls], [1, 1]);
  dispose(); reflection.dispose();
});

await check("activation observation precedes its deterministic initialization transition", () => {
  const map = map_fixture();
  const reflection = hsonMirror(map.lib("page"));
  const subject = reflection.tree.find.must.byQuid(currentQ);
  const target = new Target(); link_node_to_el(subject.node, target as unknown as Element);
  set_interaction_activation_initialization_hook_for_tests(() => add_interaction(map, local("race", "run")));
  const dispose = activate_interactions({ map, tree: reflection.tree, local: { run: () => undefined } });
  set_interaction_activation_initialization_hook_for_tests(undefined);
  assert.equal(target.registrations.length, 1);
  dispose(); reflection.dispose();
});

await check("activation snapshots every caller-owned runtime option and cannot implicitly rebind", async () => {
  const map = map_fixture();
  add_interaction(map, local("fixed-local", "run"));
  add_interaction(map, local("fixed-removal", "removable", Hson.data.from(null), { event: "removal" }));
  add_interaction(map, local("fixed-absence", "added", Hson.data.from(null), { event: "addition" }));
  add_interaction(map, {
    ...authoritative("fixed-dispatch", "save", Hson.data.from(-0)),
    listener: Object.freeze({ ...listener, event: "authoritative" }),
  });

  const reflection = hsonMirror(map.lib("page"));
  const subject = reflection.tree.find.must.byQuid(currentQ);
  const firstTarget = new Target(); link_node_to_el(subject.node, firstTarget as unknown as Element);

  const alternatePage = admit_exact_runtime_livemap_node(parse_hson_exact_runtime(`<main <button @${currentQ}/>/>`, { allowTopLevelDocumentText: true }));
  if (alternatePage.mode !== "document") throw new Error("Expected alternate document LiveMap.");
  const alternateReflection = reflect_document_in_runtime(alternatePage, create_livetree_runtime());
  const alternateSubject = alternateReflection.tree.find.must.byQuid(currentQ);
  const alternateTarget = new Target(); link_node_to_el(alternateSubject.node, alternateTarget as unknown as Element);

  let localA = 0, localB = 0, removable = 0, added = 0;
  let dispatchA = 0, dispatchB = 0, failureA = 0, failureB = 0;
  const localTable: Record<string, InteractionLocalBehavior> = {
    run: () => { localA += 1; },
    removable: () => { removable += 1; },
  };
  const options = {
    map,
    tree: reflection.tree,
    local: localTable,
    dispatch: async () => { dispatchA += 1; },
    onFailure: () => { failureA += 1; },
  };
  const dispose = activate_interactions(options);
  const failuresAfterActivation = failureA;

  localTable.run = () => { localB += 1; };
  delete localTable.removable;
  localTable.added = () => { added += 1; };
  options.tree = alternateReflection.tree;
  options.local = { run: () => { localB += 1; } };
  options.dispatch = async () => { dispatchB += 1; };
  options.onFailure = () => { failureB += 1; };

  map.lib("state").at(["count"]).set(1);
  firstTarget.fire(new Event("click"));
  firstTarget.fire(new Event("removal"));
  firstTarget.fire(new Event("addition"));
  firstTarget.fire(new Event("authoritative"));
  alternateTarget.fire(new Event("click"));
  await Promise.resolve();

  assert.deepEqual([localA, localB, removable, added], [1, 0, 1, 0]);
  assert.deepEqual([dispatchA, dispatchB], [1, 0]);
  assert.equal(failureA > failuresAfterActivation, true);
  assert.equal(failureB, 0);
  assert.equal(alternateTarget.registrations.length, 0);
  dispose(); reflection.dispose(); alternateReflection.dispose();
});

await check("local capability snapshot is own-data-property-only and validates before side effects", () => {
  const map = map_fixture();
  add_interaction(map, local("prototype-only", "inherited"));
  add_interaction(map, local("prototype-to-string", "toString", Hson.data.from(null), { event: "to-string" }));
  add_interaction(map, local("prototype-constructor", "constructor", Hson.data.from(null), { event: "constructor" }));
  const reflection = hsonMirror(map.lib("page"));
  const subject = reflection.tree.find.must.byQuid(currentQ);
  const target = new Target(); link_node_to_el(subject.node, target as unknown as Element);

  let inheritedCalls = 0;
  const inheritedTable = Object.create({ inherited: () => { inheritedCalls += 1; } }) as Record<string, () => void>;
  const dispose = activate_interactions({ map, tree: reflection.tree, local: inheritedTable });
  assert.equal(target.registrations.length, 0);
  target.fire();
  assert.equal(inheritedCalls, 0);
  dispose();

  let getterCalls = 0;
  const getterTable: Record<string, unknown> = { valid: () => undefined };
  Object.defineProperty(getterTable, "getter", {
    enumerable: true,
    get: () => { getterCalls += 1; return () => undefined; },
  });
  const beforeGetter = map.rev;
  assert.throws(
    () => activate_interactions({ map, tree: reflection.tree, local: getterTable as never }),
    /data property/,
  );
  assert.equal(getterCalls, 0);
  assert.equal(target.registrations.length, 0);
  map.lib("state").at(["count"]).set(1);
  assert.equal(map.rev, beforeGetter + 1);

  assert.throws(
    () => activate_interactions({ map, tree: reflection.tree, local: { inherited: 1 } as never }),
    /must be a function/,
  );
  assert.equal(target.registrations.length, 0);
  reflection.dispose();
});

await check("an activation created without a dispatcher cannot gain one by option mutation", async () => {
  const map = map_fixture();
  add_interaction(map, authoritative("fixed-dispatch-absence", "save", Hson.data.from(-0)));
  const reflection = hsonMirror(map.lib("page"));
  const subject = reflection.tree.find.must.byQuid(currentQ);
  const target = new Target(); link_node_to_el(subject.node, target as unknown as Element);
  let dispatched = 0;
  const options: {
    map: typeof map;
    tree: typeof reflection.tree;
    local: Record<string, InteractionLocalBehavior>;
    dispatch?: InteractionActionDispatcher;
  } = { map, tree: reflection.tree, local: {} };
  const dispose = activate_interactions(options);
  options.dispatch = async () => { dispatched += 1; };
  map.lib("state").at(["count"]).set(1);
  target.fire();
  await Promise.resolve();
  assert.equal(dispatched, 0);
  assert.equal(target.registrations.length, 0);
  dispose(); reflection.dispose();
});

await check("failed initialization rolls back installed listeners and every observer", () => {
  const map = map_fixture();
  add_interaction(map, local("rollback-a", "run"));
  add_interaction(map, local("rollback-b", "run"));
  const reflection = hsonMirror(map.lib("page"));
  const subject = reflection.tree.find.must.byQuid(currentQ);
  const target = new Target(); link_node_to_el(subject.node, target as unknown as Element);
  let imperative = 0;
  const imperativeSub = subject.listen.onCustom("click", () => { imperative += 1; });

  let materializations = 0;
  set_interaction_activation_initialization_materialization_hook_for_tests(() => {
    materializations += 1;
    throw new Error("forced post-materialization initialization failure");
  });
  try {
    assert.throws(
      () => activate_interactions({ map, tree: reflection.tree, local: { run: () => undefined } }),
      /forced post-materialization/,
    );
  } finally {
    set_interaction_activation_initialization_materialization_hook_for_tests(undefined);
  }
  assert.equal(materializations, 1);
  assert.equal(target.registrations.length, 1);
  target.fire();
  assert.equal(imperative, 1);

  const beforeCommit = map.rev;
  assert.doesNotThrow(() => map.lib("state").at(["count"]).set(1));
  assert.equal(map.rev, beforeCommit + 1);
  assert.equal(target.registrations.length, 1);

  set_interaction_activation_initialization_hook_for_tests(() => { throw new Error("forced initialization barrier failure"); });
  try {
    assert.throws(
      () => activate_interactions({ map, tree: reflection.tree, local: { run: () => undefined } }),
      /forced initialization barrier/,
    );
  } finally {
    set_interaction_activation_initialization_hook_for_tests(undefined);
  }
  assert.equal(target.registrations.length, 1);
  assert.doesNotThrow(() => map.lib("state").at(["count"]).set(2));
  assert.equal(target.registrations.length, 1);
  imperativeSub.off(); reflection.dispose();
});

await check("concurrent activations own independent capabilities failures listeners and disposal", async () => {
  const map = map_fixture();
  add_interaction(map, local("concurrent", "run"));
  const reflection = hsonMirror(map.lib("page"));
  const subject = reflection.tree.find.must.byQuid(currentQ);
  const target = new Target(); link_node_to_el(subject.node, target as unknown as Element);
  let imperative = 0, a = 0, aReplacement = 0, b = 0, failureA = 0, failureB = 0;
  const imperativeSub = subject.listen.onCustom("click", () => { imperative += 1; });
  const tableA: Record<string, InteractionLocalBehavior> = {
    run: () => { a += 1; throw new Error("activation A failure"); },
  };
  const disposeA = activate_interactions({
    map, tree: reflection.tree, local: tableA,
    onFailure: () => { failureA += 1; },
  });
  const disposeB = activate_interactions({
    map, tree: reflection.tree, local: { run: () => { b += 1; } },
    onFailure: () => { failureB += 1; },
  });
  tableA.run = () => { aReplacement += 1; };

  target.fire(); await Promise.resolve(); await Promise.resolve();
  assert.deepEqual([imperative, a, aReplacement, b, failureA, failureB], [1, 1, 0, 1, 1, 0]);
  disposeA();
  target.fire(); await Promise.resolve();
  assert.deepEqual([imperative, a, aReplacement, b], [2, 1, 0, 2]);
  disposeB();
  target.fire();
  assert.deepEqual([imperative, a, aReplacement, b], [3, 1, 0, 2]);
  assert.equal(target.registrations.length, 1);
  imperativeSub.off(); reflection.dispose();
});

await check("concurrent authoritative activations retain independent dispatchers", async () => {
  const map = map_fixture();
  add_interaction(map, authoritative("concurrent-authority", "save", Hson.data.from(-0)));
  const reflection = hsonMirror(map.lib("page"));
  const subject = reflection.tree.find.must.byQuid(currentQ);
  const target = new Target(); link_node_to_el(subject.node, target as unknown as Element);
  let a = 0, b = 0;
  const disposeA = activate_interactions({ map, tree: reflection.tree, local: {}, dispatch: async () => { a += 1; } });
  const disposeB = activate_interactions({ map, tree: reflection.tree, local: {}, dispatch: async () => { b += 1; } });
  target.fire(); await Promise.resolve();
  assert.deepEqual([a, b], [1, 1]);
  disposeA(); target.fire(); await Promise.resolve();
  assert.deepEqual([a, b], [1, 2]);
  disposeB(); assert.equal(target.registrations.length, 0);
  reflection.dispose();
});

await check("an ignored missing listener target remains eligible for later realization", () => {
  const map = map_fixture();
  add_interaction(map, local("late-target", "run", Hson.data.from(null), { missingTarget: "ignore" }));
  const reflection = hsonMirror(map.lib("page"));
  let calls = 0;
  const dispose = activate_interactions({ map, tree: reflection.tree, local: { run: () => { calls += 1; } } });
  const subject = reflection.tree.find.must.byQuid(currentQ);
  assert.equal(subject.dom.el(), undefined);
  project_livetree(reflection.tree.node);
  const element = subject.dom.must.el();
  element.dispatchEvent(new Event("click"));
  assert.equal(calls, 1);
  dispose(); reflection.dispose();
});

await check("exact subject replacement disposes A and materializes once on B", () => {
  const map = map_fixture();
  add_interaction(map, local("replace-subject", "run"));
  const localQ = "000009001";
  assert.notEqual(currentQ, localQ);
  const page = admit_exact_runtime_livemap_node(parse_hson_exact_runtime(`<main <button @${localQ}/>/>`, { allowTopLevelDocumentText: true }));
  if (page.mode !== "document") throw new Error("Expected document LiveMap.");
  const reflection = hsonMirror(page);
  project_livetree(reflection.tree.node);
  const first = reflection.tree.find.must.byQuid(localQ);
  const firstNode = first.node;
  const firstElement = first.dom.el() as unknown as import("./helpers/fake-document.mts").FakeElement;
  let calls = 0;
  const dispose = activate_interactions({ map, tree: reflection.tree, local: { run: () => { calls += 1; } } });
  assert.equal(firstElement.listeners.get("click")?.size, 1);
  const replacementMap = admit_exact_runtime_livemap_node(parse_hson_exact_runtime("<i/>", { allowTopLevelDocumentText: true }));
  if (replacementMap.mode !== "document") throw new Error("Expected replacement document LiveMap.");
  const replacement = replacementMap.at([]).snap();
  if (typeof replacement !== "object" || replacement === null || !("$_tag" in replacement)) throw new Error("Expected replacement node.");
  page.at([0]).replace(replacement);
  assert.equal(reflection.tree.find.byQuid(localQ), undefined);
  project_livetree(reflection.tree.node);
  const second = reflection.tree.find.must.byTag("i");
  const secondQuid = second.quid;
  assert.notEqual(secondQuid, localQ);
  project_livetree(second.node);
  const secondElement = second.dom.el() as unknown as import("./helpers/fake-document.mts").FakeElement;
  assert.notEqual(firstNode, second.node);
  assert.equal(firstElement.listeners.has("click"), false);
  assert.equal(secondElement.listeners.get("click")?.size, 1);
  firstElement.dispatchEvent(new Event("click"));
  secondElement.dispatchEvent(new Event("click"));
  assert.equal(calls, 1);
  dispose(); reflection.dispose();
});

await check("snapshot restore makes current hidden descriptors reconciliation truth", () => {
  const map = map_fixture();
  add_interaction(map, local("recover", "a"));
  const aggregate = internal_livemap_aggregate_authority(map);
  const snapshot = aggregate.captureHosted();
  replace_interaction(map, local("recover", "b"));
  const reflection = hsonMirror(map.lib("page"));
  const subject = reflection.tree.find.must.byQuid(currentQ);
  const target = new Target(); link_node_to_el(subject.node, target as unknown as Element);
  let a = 0, b = 0;
  const dispose = activate_interactions({ map, tree: reflection.tree, local: { a: () => { a += 1; }, b: () => { b += 1; } } });
  target.fire();
  aggregate.restoreHosted(snapshot);
  assert.equal(target.registrations.length, 1);
  target.fire();
  assert.deepEqual([a, b], [1, 1]);
  dispose(); reflection.dispose();
});

await check("runtime failures are isolated and canonical descriptors remain", async () => {
  const map = map_fixture();
  add_interaction(map, local("unknown", "missing"));
  add_interaction(map, { ...local("missing-subject", "ok"), subject: { library: "page", path: [99] } });
  add_interaction(map, authoritative("no-dispatch", "save", Hson.data.from(1)));
  add_interaction(map, local("missing-target", "ok", Hson.data.from(null), { target: "window" }));
  add_interaction(map, local("working", "ok"));
  const reflection = hsonMirror(map.lib("page"));
  const subject = reflection.tree.find.must.byQuid(currentQ);
  const target = new Target(); link_node_to_el(subject.node, target as unknown as Element);
  const phases: string[] = [];
  let calls = 0;
  const dispose = activate_interactions({
    map, tree: reflection.tree, local: { ok: () => { calls += 1; } },
    onFailure: (failure) => { phases.push(failure.phase); },
  });
  target.fire(); await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(phases.includes("local-capability-resolution"), true);
  assert.equal(phases.includes("subject-resolution"), true);
  assert.equal(phases.includes("authoritative-capability-resolution"), true);
  assert.equal(phases.includes("listener-installation"), true);
  assert.equal(map.rev, 5);
  dispose(); reflection.dispose();
});

await check("invocation rejection is isolated and disposal leaves imperative listeners intact", async () => {
  const map = map_fixture();
  add_interaction(map, authoritative("reject", "save", Hson.data.from(1)));
  const reflection = hsonMirror(map.lib("page"));
  const subject = reflection.tree.find.must.byQuid(currentQ);
  const target = new Target(); link_node_to_el(subject.node, target as unknown as Element);
  let imperative = 0;
  const imperativeSub = subject.listen.onCustom("click", () => { imperative += 1; });
  const phases: string[] = [];
  const dispose = activate_interactions({
    map, tree: reflection.tree, local: {}, dispatch: async () => { throw new Error("rejected"); },
    onFailure: (failure) => { phases.push(failure.phase); },
  });
  target.fire(); await Promise.resolve(); await Promise.resolve();
  assert.equal(phases.includes("authoritative-invocation"), true);
  assert.equal(imperative, 1);
  const beforeDispose = map.rev;
  dispose(); dispose();
  replace_interaction(map, local("reject", "missing"));
  assert.equal(map.rev, beforeDispose + 1);
  assert.equal(target.registrations.length, 1);
  target.fire();
  assert.equal(imperative, 2);
  imperativeSub.off(); reflection.dispose();
});

await check("public Echo dispatcher preserves exact payload through configured Locus authority", async () => {
  const exact = Hson.data.fromHson(Hson.canonical`<'10' -0 '2' <__proto__ <constructor 1 prototype 2>> __proto__ <polluted true>>`);
  const authorityMap = map_fixture();
  add_interaction(authorityMap, authoritative("echo", "save", exact));
  let handled: HsonData | undefined;
  const locus = hsonLocus.create({
    exposure: test_public_exposure(authorityMap),
    map: authorityMap,
    actions: { save: (_context, payload) => { handled = payload; } },
  });
  const echoMap = admit_exact_runtime_livemap_libraries({
    state: { data: { count: 0 }, schema: StateSchema },
    page: { document: parse_hson_exact_runtime(`<main <button @${currentQ}/>/>`, { allowTopLevelDocumentText: true }), schema: PageSchema },
  });
  enable_interactions(echoMap);
  const pair = socket_pair();
  locus.connect(pair.server);
  const echo = hsonEcho.create({ socket: pair.client, map: echoMap, recovery: { logicalMapId: locus.logicalMapId } });
  await activate_echo(echo);
  assert.throws(() => add_interaction(echoMap, local("replica-write", "save")), /exclusive Locus authority/i);
  const reflection = hsonMirror(echoMap.lib("page"));
  const page = echoMap.lib("page");
  if (!("document" in page)) throw new Error("Expected document library.");
  const localQ = "000009999";
  set_livemap_document_quid_candidate_source_for_tests(page.document, () => localQ);
  acquire_document_identity(page.document, { kind: "path", path: validate_document_path([0, 0, 0]) });
  assert.equal(page.document.byQuid(currentQ), undefined);
  const subject = reflection.tree.find.must.byQuid(localQ);
  const target = new Target(); link_node_to_el(subject.node, target as unknown as Element);
  let localCalls = 0;
  const dispose = activate_interactions({
    map: echoMap,
    tree: reflection.tree,
    local: { save: () => { localCalls += 1; } },
    dispatch: async (key, payload) => {
      const result = await echo.action(key, payload);
      if (result.type !== "ack") throw result.error;
    },
  });
  target.fire();
  for (let attempt = 0; attempt < 20 && handled === undefined; attempt += 1) await Promise.resolve();
  assert.equal(localCalls, 0);
  assert.equal(handled, exact);
  assert.deepEqual(handled === undefined ? undefined : Hson.data.entries(handled)?.map(([name]) => name), ["10", "2", "__proto__"]);
  assert.equal(Object.is(handled === undefined ? undefined : Hson.data.materialize(Hson.data.entries(handled)?.[0]?.[1]!), -0), true);
  dispose(); reflection.dispose(); echo.dispose(); locus.dispose();
});

testEvents.terminal("pass");
process.stdout.write(`1..${checks}\n`);
