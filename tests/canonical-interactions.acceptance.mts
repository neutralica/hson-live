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
  hsonReflect,
  remove_interaction,
  replace_interaction,
  type HsonSchema,
  type InteractionDescriptor,
  type InteractionListener,
} from "../src/index.ts";
import type { LocusSocketLike } from "../src/types/locus.types.ts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";
import { set_interaction_activation_initialization_hook_for_tests } from "../src/api/interactions/interactions.ts";
import { link_node_to_el } from "../src/api/livetree/utils/node-map-helpers.ts";
import { project_livetree } from "../src/api/livetree/creation/project-live-tree.ts";
import { install_fake_document } from "./helpers/fake-document.mts";
import { create_test_event_emitter } from "./test-events.mjs";

install_fake_document();

const PageSchema: HsonSchema = Hson`<type "document" tag "main" content <sequence [<tag "button" content "empty">]>>`;
const StateSchema: HsonSchema = Hson`<type "data" content <count "number">>`;
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
      entry.listener(event);
      if (entry.options.once) this.removeEventListener(entry.type, entry.listener);
    }
  }
}

function map_fixture() {
  quidSequence += 1;
  currentQ = quidSequence.toString().padStart(9, "0");
  const map = hsonLiveMap.fromLibraries({
    state: { data: { count: 0 }, schema: StateSchema },
    page: { document: `<main <button @${currentQ}/>/>`, schema: PageSchema },
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

function local(id: string, key: string, args: HsonData = HsonData.from(null), override: Partial<InteractionListener> = {}): InteractionDescriptor {
  return Object.freeze({ id, subjectQuid: currentQ, listener: Object.freeze({ ...listener, ...override }), kind: "browser-local", key, args });
}
function authoritative(id: string, key: string, payload: HsonData): InteractionDescriptor {
  return Object.freeze({ id, subjectQuid: currentQ, listener, kind: "locus-authoritative", key, payload });
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
  assert.equal(aggregate.inspect().libraries.length, 3);
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

  const late = hsonLiveMap.fromLibraries({
    state: { data: { count: 0 }, schema: StateSchema },
    page: { document: `<main <button @${currentQ}/>/>`, schema: PageSchema },
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
  assert.throws(() => add_interaction(map, { ...local("bad", "run"), subjectQuid: "iiiiiiiii" }), /Schema/);
  assert.equal(map.rev, before);
  assert.throws(() => add_interaction(map, { ...local("extra", "run"), extra: true } as unknown as InteractionDescriptor), /unknown or missing/);
  assert.equal(map.rev, before);
  assert.throws(() => replace_interaction(map, local("missing", "run")), /does not exist/);
  for (const subjectQuid of ["00000000", "00000000i", "00000000l", "00000000o", "00000000u", "00000000A", "00000000-"]) {
    assert.throws(() => add_interaction(map, { ...local(`bad-${subjectQuid}`, "run"), subjectQuid }), /Schema/);
    assert.equal(map.rev, before);
  }
  assert.throws(() => add_interaction(map, {
    ...local("bad-target", "run"), listener: { ...listener, target: "body" },
  } as unknown as InteractionDescriptor), /Schema/);
  assert.throws(() => add_interaction(map, {
    ...local("bad-policy", "run"), listener: { ...listener, missingTarget: "later" },
  } as unknown as InteractionDescriptor), /Schema/);
  assert.throws(() => add_interaction(map, {
    ...local("hybrid", "run"), payload: HsonData.from(null),
  } as unknown as InteractionDescriptor), /unknown or missing/);
  assert.throws(() => add_interaction(map, local("reserved", "run", { _hson_bad: 1 } as never)), /Reserved Hson prefix/);
  assert.throws(() => HsonData.fromHson(Hson`<main/>`), /data/i);
  assert.equal(map.rev, before);
  remove_interaction(map, "a");
  assert.equal(map.rev, before + 1);
  assert.throws(() => remove_interaction(map, "a"), /does not exist/);
});

await check("Locus staging authors hidden descriptors while direct managed writes are fenced", async () => {
  const map = map_fixture();
  const descriptor = local("managed", "run", HsonData.from(-0));
  const locus = hsonLocus.create({
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
  add_interaction(map, local("progress", "a", HsonData.from(-0)));
  const reflection = hsonReflect(map.lib("page"));
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
  assert.equal(Object.is(received?.scalar(), -0), true);
  assert.equal(map.rev, revisionBeforeActivation);
  assert.equal(aggregate.identityEpoch().issued().size, issuedBeforeActivation);
  replace_interaction(map, local("progress", "b"));
  assert.equal(target.registrations.length, 1);
  target.fire();
  assert.deepEqual([a, b, authority], [1, 1, 0]);
  const exact = HsonData.fromHson(Hson`<'2' 2 __proto__ -0 '1' 1>`);
  replace_interaction(map, authoritative("progress", "save", exact));
  assert.equal(target.registrations.length, 1);
  target.fire();
  await Promise.resolve();
  assert.deepEqual([a, b, authority], [1, 1, 1]);
  assert.equal(received?.equals(exact), true);
  dispose(); dispose();
  assert.equal(target.registrations.length, 0);
  assert.equal(map.rev, 3);
  reflection.dispose();
});

await check("once is retained per materialization and reset by replacement/reactivation", () => {
  const map = map_fixture();
  add_interaction(map, local("once", "a", HsonData.from(null), { once: true }));
  const reflection = hsonReflect(map.lib("page"));
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
  replace_interaction(map, local("once", "a", HsonData.from(1), { once: true }));
  assert.equal(target.registrations.length, 1);
  target.fire(); assert.equal(calls, 2);
  remove_interaction(map, "once");
  add_interaction(map, local("once", "a", HsonData.from(2), { once: true }));
  assert.equal(target.registrations.length, 1);
  target.fire(); assert.equal(calls, 3);
  dispose();
  dispose = activate_interactions({ map, tree: reflection.tree, local: { a: () => { calls += 1; } } });
  target.fire(); assert.equal(calls, 4);
  dispose(); reflection.dispose();
});

await check("authoritative to local replacement uses no cross-capability fallback", async () => {
  const map = map_fixture();
  add_interaction(map, authoritative("reverse", "save", HsonData.from(1)));
  const reflection = hsonReflect(map.lib("page"));
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
  const reflection = hsonReflect(map.lib("page"));
  const subject = reflection.tree.find.must.byQuid(currentQ);
  const target = new Target(); link_node_to_el(subject.node, target as unknown as Element);
  set_interaction_activation_initialization_hook_for_tests(() => add_interaction(map, local("race", "run")));
  const dispose = activate_interactions({ map, tree: reflection.tree, local: { run: () => undefined } });
  set_interaction_activation_initialization_hook_for_tests(undefined);
  assert.equal(target.registrations.length, 1);
  dispose(); reflection.dispose();
});

await check("an ignored missing listener target remains eligible for later realization", () => {
  const map = map_fixture();
  add_interaction(map, local("late-target", "run", HsonData.from(null), { missingTarget: "ignore" }));
  const reflection = hsonReflect(map.lib("page"));
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
  const page = hsonLiveMap.fromHson(`<main <button @${currentQ}/>/>`);
  if (page.mode !== "document") throw new Error("Expected document LiveMap.");
  const reflection = hsonReflect(page);
  project_livetree(reflection.tree.node);
  const first = reflection.tree.find.must.byQuid(currentQ);
  const firstNode = first.node;
  const firstElement = first.dom.el() as unknown as import("./helpers/fake-document.mts").FakeElement;
  let calls = 0;
  const dispose = activate_interactions({ map, tree: reflection.tree, local: { run: () => { calls += 1; } } });
  assert.equal(firstElement.listeners.get("click")?.size, 1);
  const replacementMap = hsonLiveMap.fromHson(`<i @${currentQ}/>`);
  if (replacementMap.mode !== "document") throw new Error("Expected replacement document LiveMap.");
  const replacement = replacementMap.at([]).snap();
  if (typeof replacement !== "object" || replacement === null || !("$_tag" in replacement)) throw new Error("Expected replacement node.");
  page.at([0]).replace(replacement);
  const second = reflection.tree.find.must.byQuid(currentQ);
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
  const reflection = hsonReflect(map.lib("page"));
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
  add_interaction(map, { ...local("missing-subject", "ok"), subjectQuid: "000009999" });
  add_interaction(map, authoritative("no-dispatch", "save", HsonData.from(1)));
  add_interaction(map, local("missing-target", "ok", HsonData.from(null), { target: "window" }));
  add_interaction(map, local("working", "ok"));
  const reflection = hsonReflect(map.lib("page"));
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
  add_interaction(map, authoritative("reject", "save", HsonData.from(1)));
  const reflection = hsonReflect(map.lib("page"));
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
  const exact = HsonData.fromHson(Hson`<'10' -0 '2' <__proto__ <constructor 1 prototype 2>> __proto__ <polluted true>>`);
  const authorityMap = map_fixture();
  add_interaction(authorityMap, authoritative("echo", "save", exact));
  let handled: HsonData | undefined;
  const locus = hsonLocus.create({
    map: authorityMap,
    actions: { save: (_context, payload) => { handled = payload; } },
  });
  const echoMap = hsonLiveMap.fromLibraries({
    state: { data: { count: 0 }, schema: StateSchema },
    page: { document: `<main <button @${currentQ}/>/>`, schema: PageSchema },
  });
  enable_interactions(echoMap);
  const pair = socket_pair();
  locus.connect(pair.server);
  const echo = hsonEcho.create({ socket: pair.client, map: echoMap, recovery: { logicalMapId: locus.logicalMapId } });
  await activate_echo(echo);
  assert.throws(() => add_interaction(echoMap, local("replica-write", "save")), /exclusive Locus authority/i);
  const reflection = hsonReflect(echoMap.lib("page"));
  const subject = reflection.tree.find.must.byQuid(currentQ);
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
  assert.equal(handled?.equals(exact), true);
  assert.deepEqual(handled?.entries()?.map(([name]) => name), ["10", "2", "__proto__"]);
  assert.equal(Object.is(handled?.entries()?.[0]?.[1].scalar(), -0), true);
  dispose(); reflection.dispose(); echo.dispose(); locus.dispose();
});

testEvents.terminal("pass");
process.stdout.write(`1..${checks}\n`);
