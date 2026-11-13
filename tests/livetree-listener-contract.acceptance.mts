import { retained_subject } from "./helpers/retained-livetree-subject.mts";
// @hson-live-external-test
import { create_test_event_emitter } from "./test-events.mjs";
import assert from "node:assert/strict";
import { Hson, type HsonDataValue } from "../src/hson-authoring.ts";
import { ANY_DATA, ANY_DOCUMENT } from "../src/api/schema/hson-schema.ts";
import { create_livetree, create_staged_livetree_in_runtime } from "../src/api/livetree/creation/create-livetree.ts";
import { lifecycle_resource_counts_for_owner } from "../src/api/livetree/managers/lifecycle-registry.ts";
import { link_node_to_el } from "../src/api/livetree/utils/node-map-helpers.ts";
import { LiveTree } from "../src/api/livetree/livetree.ts";
import { hsonLiveTree } from "../src/api/livetree/livetree.facade.ts";
import { TreeSelector } from "../src/api/livetree/creation/tree-selector.ts";
import { lifecycle_resource_counts_for_subject } from "../src/api/livetree/managers/lifecycle-registry.ts";
import { create_livetree_runtime, runtime_for_tree } from "../src/api/livetree/runtime/livetree-runtime.ts";
import type { LiveTreeActionContext, LocalActionResult } from "../src/api/livetree/index.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livetree.listener-contract",
  title: "LiveTree listener registration contract",
  category: "LiveTree",
  runtime: "node-synthetic-dom",
  tags: Object.freeze(["listeners", "runtime", "public-contract", "externally-discoverable"]),
});

const testEvents = create_test_event_emitter("livetree.listener-contract");
let checks = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  testEvents.case_begin(name, name);
  try {
    await fn();
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

type ListenerRecord = {
  listener: EventListenerOrEventListenerObject;
  options: AddEventListenerOptions;
};

function normalizedOptions(options?: boolean | AddEventListenerOptions): AddEventListenerOptions {
  return typeof options === "boolean" ? { capture: options } : { ...options };
}

class TestTarget {
  readonly listeners = new Map<string, Set<ListenerRecord>>();
  readonly registrations: Array<{ type: string; options: AddEventListenerOptions }> = [];

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    if (listener === null) return;
    const normalized = normalizedOptions(options);
    const records = this.listeners.get(type) ?? new Set<ListenerRecord>();
    records.add({ listener, options: normalized });
    this.listeners.set(type, records);
    this.registrations.push({ type, options: normalized });
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void {
    if (listener === null) return;
    const capture = typeof options === "boolean" ? options : !!options?.capture;
    const records = this.listeners.get(type);
    if (!records) return;
    for (const record of records) {
      if (record.listener === listener && !!record.options.capture === capture) records.delete(record);
    }
    if (records.size === 0) this.listeners.delete(type);
  }

  dispatch(type: string, event: Event): void {
    const records = this.listeners.get(type);
    if (!records) return;
    for (const record of [...records]) {
      if (record.options.once) records.delete(record);
      if (typeof record.listener === "function") record.listener(event);
      else record.listener.handleEvent(event);
    }
    if (records.size === 0) this.listeners.delete(type);
  }
}

class TestDocument extends TestTarget {
  public constructor(public readonly defaultView: TestTarget | null) { super(); }
}

class ThrowingReleaseTarget extends TestTarget {
  removalAttempts = 0;
  public constructor(public cleanupError: Error | undefined = undefined) { super(); }
  public override removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void {
    this.removalAttempts += 1;
    super.removeEventListener(type, listener, options);
    if (this.cleanupError !== undefined) throw this.cleanupError;
  }
}

class TestElement extends TestTarget {
  readonly nodeType = 1;
  readonly isConnected = true;
  public constructor(public readonly ownerDocument: TestDocument) { super(); }
  getAttribute(_name: string): string | null { return null; }
  querySelectorAll(_selector: string): TestElement[] { return []; }
  remove(): void {}
}

class FlowEvent extends Event {
  stopCalls = 0;
  stopImmediateCalls = 0;

  public override stopPropagation(): void {
    this.stopCalls += 1;
  }

  public override stopImmediatePropagation(): void {
    this.stopImmediateCalls += 1;
  }
}

function fixture(defaultView: TestTarget | null = new TestTarget()): { tree: LiveTree; element: TestElement } {
  const tree = create_livetree({ $_tag: "button", $_content: [] });
  const element = new TestElement(new TestDocument(defaultView));
  link_node_to_el(retained_subject(tree), element as unknown as Element);
  return { tree, element };
}

function selectionFixture(documents = [new TestDocument(new TestTarget()), new TestDocument(new TestTarget())]) {
  const tree = hsonLiveTree.fromHson(`<main ${documents.map(() => '<button/>').join(' ')}/>`, { isolated: true });
  const selection = tree.findAll.byTag("button");
  const subjects = selection.array();
  const elements = subjects.map((subject, index) => {
    const element = new TestElement(documents[index]);
    link_node_to_el(retained_subject(subject), element as unknown as Element);
    return element;
  });
  const listenerCounts = () => subjects.map(subject =>
    lifecycle_resource_counts_for_subject(retained_subject(subject), runtime_for_tree(subject)).listener);
  return { tree, selection, subjects, elements, listenerCounts };
}

await check("a selection registers synchronously on both buttons and off removes only its entire group", () => {
  const { tree, selection, elements, listenerCounts } = selectionFixture();
  try {
    let calls = 0, independentCalls = 0;
    const group = selection.listen.onClick(() => { calls += 1; });
    const independent = selection.listen.onClick(() => { independentCalls += 1; });
    assert.deepEqual(listenerCounts(), [2, 2]);
    elements[0].dispatch("click", new Event("click"));
    assert.equal(calls, 1);
    elements[1].dispatch("click", new Event("click"));
    assert.equal(calls, 2);
    group.off(); group.off();
    assert.deepEqual(listenerCounts(), [1, 1]);
    for (const element of elements) element.dispatch("click", new Event("click"));
    assert.deepEqual([calls, independentCalls], [2, 4]);
    independent.off();
    assert.deepEqual(listenerCounts(), [0, 0]);
  } finally { tree.remove(); }
});

await check("selection once is per subject and retained builder reuse consumes its configuration", () => {
  const { tree, selection, elements, listenerCounts } = selectionFixture();
  try {
    const builder = selection.listen;
    let onceCalls = 0, ordinaryCalls = 0;
    const once = builder.once().onClick(() => { onceCalls += 1; });
    const ordinary = builder.onClick(() => { ordinaryCalls += 1; });
    elements[0].dispatch("click", new Event("click"));
    elements[0].dispatch("click", new Event("click"));
    assert.equal(onceCalls, 1);
    assert.deepEqual(listenerCounts(), [1, 2]);
    elements[1].dispatch("click", new Event("click"));
    elements[1].dispatch("click", new Event("click"));
    assert.deepEqual([onceCalls, ordinaryCalls], [2, 4]);
    once.off(); ordinary.off();
    assert.deepEqual(listenerCounts(), [0, 0]);
  } finally { tree.remove(); }
});

await check("selection native options and flow modifiers apply to every subject and reset after registration", () => {
  const { tree, selection, elements } = selectionFixture();
  try {
    const builder = selection.listen;
    const configured = builder.capture().preventDefault().stopProp().stopImmediateProp().on("click", () => {});
    const passive = builder.passive().stopAll().onCustom("passive", () => {});
    const cleared = builder.stopAll().clearStops().onCustomDetail<number>("cleared", () => {});
    for (const element of elements) {
      const event = new FlowEvent("click", { cancelable: true });
      element.dispatch("click", event);
      assert.deepEqual([event.defaultPrevented, event.stopCalls, event.stopImmediateCalls], [true, 1, 1]);
      const passiveEvent = new FlowEvent("passive", { cancelable: true });
      element.dispatch("passive", passiveEvent);
      assert.deepEqual([passiveEvent.defaultPrevented, passiveEvent.stopCalls, passiveEvent.stopImmediateCalls], [false, 1, 1]);
      const clearEvent = new FlowEvent("cleared", { cancelable: true });
      element.dispatch("cleared", clearEvent);
      assert.deepEqual([clearEvent.defaultPrevented, clearEvent.stopCalls, clearEvent.stopImmediateCalls], [false, 0, 0]);
      assert.deepEqual(element.registrations.map(({ options }) => options), [
        { capture: true, once: false, passive: false },
        { capture: false, once: false, passive: true },
        { capture: false, once: false, passive: false },
      ]);
    }
    configured.off(); passive.off(); cleared.off();
  } finally { tree.remove(); }
});

for (const target of ["document", "window"] as const) {
  for (const shared of [false, true]) {
    await check(`selection ${target} registrations retain per-subject ownership on ${shared ? "shared" : "distinct"} targets`, () => {
      const firstDocument = new TestDocument(new TestTarget());
      const documents = [firstDocument, shared ? firstDocument : new TestDocument(new TestTarget())];
      const { tree, selection, subjects, listenerCounts } = selectionFixture(documents);
      try {
        const targets = documents.map(document => target === "document" ? document : document.defaultView!);
        let calls = 0;
        const group = selection.listen[target].onClick(() => { calls += 1; });
        assert.deepEqual(listenerCounts(), [1, 1]);
        for (const ambient of new Set(targets)) ambient.dispatch("click", new Event("click"));
        assert.equal(calls, 2);
        subjects[0].remove();
        assert.equal(targets[0].listeners.get("click")?.size ?? 0, shared ? 1 : 0);
        for (const ambient of new Set(targets)) ambient.dispatch("click", new Event("click"));
        assert.equal(calls, 3);
        group.off(); group.off();
        assert.equal(targets[1].listeners.has("click"), false);
      } finally { tree.remove(); }
    });
  }
}

await check("selection target aliases and element reset forward configuration to both subjects", () => {
  const { tree, selection, elements } = selectionFixture();
  try {
    let calls = 0;
    const documentSub = selection.listen.toDocument().onClick(() => { calls += 1; });
    const windowSub = selection.listen.toWindow().onClick(() => { calls += 1; });
    const elementSub = selection.listen.window.document.element.onClick(() => { calls += 1; });
    for (const element of elements) {
      element.ownerDocument.dispatch("click", new Event("click"));
      element.ownerDocument.defaultView!.dispatch("click", new Event("click"));
      element.dispatch("click", new Event("click"));
    }
    assert.equal(calls, 6);
    documentSub.off(); windowSub.off(); elementSub.off();
  } finally { tree.remove(); }
});

await check("strict selection failure cleans earlier attachments and consumes configuration for all subjects", () => {
  const { tree, selection, elements, listenerCounts } = selectionFixture([
    new TestDocument(new TestTarget()), new TestDocument(null),
  ]);
  try {
    let calls = 0, independentCalls = 0;
    const ambient = elements[0].ownerDocument.defaultView!;
    const independent = selection.first()!.listen.window.onClick(() => { independentCalls += 1; });
    const builder = selection.listen;
    assert.throws(() => builder.window.once().strict("throw").onClick(() => { calls += 1; }), /no targets in selection/);
    assert.deepEqual(listenerCounts(), [1, 0]);
    ambient.dispatch("click", new Event("click"));
    assert.deepEqual([calls, independentCalls], [0, 1]);
    const next = builder.onClick(() => { calls += 1; });
    for (const element of elements) {
      element.dispatch("click", new Event("click")); element.dispatch("click", new Event("click"));
    }
    assert.equal(calls, 4);
    next.off(); independent.off();
    assert.deepEqual(listenerCounts(), [0, 0]);
  } finally { tree.remove(); }
});

await check("group off attempts every subscription before throwing the first cleanup error", () => {
  const firstError = new Error("first cleanup failed after removal");
  const targets = [new ThrowingReleaseTarget(firstError),
    new ThrowingReleaseTarget(new Error("second cleanup failed after removal")), new ThrowingReleaseTarget()];
  const { tree, selection, subjects, listenerCounts } = selectionFixture(targets.map(target => new TestDocument(target)));
  try {
    let calls = 0;
    const handler = () => { calls += 1; };
    const independent = subjects[2].listen.window.onClick(handler);
    const group = selection.listen.window.onClick(handler);
    assert.throws(() => group.off(), error => error === firstError);
    assert.deepEqual(targets.map(target => target.removalAttempts), [1, 1, 1]);
    assert.deepEqual(listenerCounts(), [1, 1, 1]);
    for (const target of targets) target.dispatch("click", new Event("click"));
    assert.equal(calls, 1, "only the independent registration remains active");
    for (const target of targets) target.cleanupError = undefined;
    group.off(); group.off();
    assert.deepEqual(targets.map(target => target.removalAttempts), [2, 2, 1]);
    assert.deepEqual(listenerCounts(), [0, 0, 1]);
    independent.off();
    assert.deepEqual(listenerCounts(), [0, 0, 0]);
  } finally {
    for (const target of targets) target.cleanupError = undefined;
    tree.remove();
  }
});

await check("strict partial failure rolls back every acquired subscription despite cleanup failure", () => {
  const targets = [new ThrowingReleaseTarget(new Error("rollback cleanup failed after removal")), new ThrowingReleaseTarget()];
  const { tree, selection, subjects, listenerCounts } = selectionFixture([
    ...targets.map(target => new TestDocument(target)), new TestDocument(null),
  ]);
  try {
    let calls = 0;
    const handler = () => { calls += 1; };
    const independent = subjects[1].listen.window.onClick(handler);
    assert.throws(() => selection.listen.window.strict("throw").onClick(handler), /no targets in selection/);
    assert.deepEqual(targets.map(target => target.removalAttempts), [1, 1]);
    assert.deepEqual(listenerCounts(), [1, 1, 0]);
    for (const target of targets) target.dispatch("click", new Event("click"));
    assert.equal(calls, 1, "failed group leaves only the independent registration active");
    independent.off();
    assert.deepEqual(listenerCounts(), [1, 0, 0]);
  } finally {
    for (const target of targets) target.cleanupError = undefined;
    tree.remove();
  }
});

await check("ignored missing selection targets leave successful attachments owned and disposable", () => {
  const { tree, selection, elements, listenerCounts } = selectionFixture([
    new TestDocument(new TestTarget()), new TestDocument(null),
  ]);
  try {
    let calls = 0;
    const group = selection.listen.window.strict("ignore").onClick(() => { calls += 1; });
    assert.deepEqual(listenerCounts(), [1, 0]);
    elements[0].ownerDocument.defaultView!.dispatch("click", new Event("click"));
    assert.equal(calls, 1);
    group.off(); assert.deepEqual(listenerCounts(), [0, 0]);
  } finally { tree.remove(); }
});

await check("duplicated queries install one listener per subject and retirement removes the exact owner's registration", () => {
  const { tree, subjects, elements } = selectionFixture();
  let calls = 0;
  const group = tree.findAll(["button", "button"]).listen.onClick(() => { calls += 1; });
  for (const element of elements) element.dispatch("click", new Event("click"));
  assert.equal(calls, 2);
  subjects[0].remove();
  for (const element of elements) element.dispatch("click", new Event("click"));
  assert.equal(calls, 3);
  tree.remove();
  for (const element of elements) element.dispatch("click", new Event("click"));
  assert.equal(calls, 3);
  group.off(); group.off();
});

await check("empty and single-subject selections support fluent registration and idempotent cleanup", () => {
  const empty = new TreeSelector([]);
  const noop = empty.listen.window.once().strict("throw").onClick(() => assert.fail("empty listener"));
  noop.off(); noop.off();
  const { tree, element } = fixture();
  try {
    let calls = 0;
    const one = new TreeSelector([tree]).listen.once().onClick(() => { calls += 1; });
    element.dispatch("click", new Event("click")); element.dispatch("click", new Event("click"));
    assert.equal(calls, 1);
    one.off(); one.off();
  } finally { tree.remove(); }
});

await check("a normal listener attaches, receives events, and has an idempotent off handle", () => {
  const { tree, element } = fixture();
  let calls = 0;
  const sub = tree.listen.onClick(() => { calls += 1; });
  assert.equal("count" in sub, false);
  assert.equal("ok" in sub, false);
  element.dispatch("click", new Event("click"));
  assert.equal(calls, 1);
  sub.off();
  sub.off();
  element.dispatch("click", new Event("click"));
  assert.equal(calls, 1);
  assert.equal(element.listeners.has("click"), false);
});

await check("off retires only the exact registration on a shared target", () => {
  const { tree, element } = fixture();
  let firstCalls = 0;
  let secondCalls = 0;
  const first = tree.listen.onClick(() => { firstCalls += 1; });
  const second = tree.listen.onClick(() => { secondCalls += 1; });

  element.dispatch("click", new Event("click"));
  first.off();
  element.dispatch("click", new Event("click"));
  assert.deepEqual([firstCalls, secondCalls], [1, 2]);
  assert.equal(element.listeners.get("click")?.size, 1);

  second.off();
  assert.equal(element.listeners.has("click"), false);
});

await check("once retires native and lifecycle bookkeeping even when the callback throws", () => {
  const { tree, element } = fixture();
  let calls = 0;
  const sub = tree.listen.once().onClick(() => {
    calls += 1;
    throw new Error("listener boom");
  });
  assert.equal(lifecycle_resource_counts_for_owner(tree.quid).listener, 1);
  assert.throws(() => element.dispatch("click", new Event("click")), /listener boom/);
  assert.equal(calls, 1);
  assert.equal(lifecycle_resource_counts_for_owner(tree.quid).listener, 0);
  element.dispatch("click", new Event("click"));
  assert.equal(calls, 1);
  sub.off();
});

await check("registration options and event-flow controls are immutable snapshots", () => {
  const { tree, element } = fixture();
  const builder = tree.listen;
  let firstCalls = 0;
  let secondCalls = 0;
  const first = builder.capture().preventDefault().stopProp().stopImmediateProp()
    .onCustom("first", () => { firstCalls += 1; });
  const second = builder.passive().clearStops().onCustom("second", () => { secondCalls += 1; });

  const firstEvent = new FlowEvent("first", { cancelable: true });
  const secondEvent = new FlowEvent("second", { cancelable: true });
  element.dispatch("first", firstEvent);
  element.dispatch("second", secondEvent);

  assert.equal(firstCalls, 1);
  assert.equal(firstEvent.defaultPrevented, true);
  assert.equal(firstEvent.stopCalls, 1);
  assert.equal(firstEvent.stopImmediateCalls, 1);
  assert.equal(secondCalls, 1);
  assert.equal(secondEvent.defaultPrevented, false);
  assert.equal(secondEvent.stopCalls, 0);
  assert.equal(secondEvent.stopImmediateCalls, 0);
  assert.deepEqual(element.registrations.map(({ options }) => options), [
    { capture: true, once: false, passive: false },
    { capture: false, once: false, passive: true },
  ]);
  first.off();
  second.off();
});

await check("one registration consumes configuration and retained-builder reuse starts from defaults", () => {
  const { tree, element } = fixture();
  const builder = tree.listen;
  let onceCalls = 0;
  let defaultCalls = 0;
  const once = builder.once().capture().onCustom("configured", () => { onceCalls += 1; });
  const ordinary = builder.onCustom("ordinary", () => { defaultCalls += 1; });

  element.dispatch("configured", new Event("configured"));
  element.dispatch("configured", new Event("configured"));
  element.dispatch("ordinary", new Event("ordinary"));
  element.dispatch("ordinary", new Event("ordinary"));

  assert.equal(onceCalls, 1);
  assert.equal(defaultCalls, 2);
  assert.deepEqual(element.registrations.map(({ options }) => options), [
    { capture: true, once: true, passive: false },
    { capture: false, once: false, passive: false },
  ]);
  once.off();
  ordinary.off();
});

await check("a strict missing-target failure is retired before retained-builder reuse", () => {
  const { tree, element } = fixture(null);
  const builder = tree.listen;
  let failedCalls = 0;
  let successfulCalls = 0;
  assert.throws(
    () => builder.window.strict("throw").onClick(() => { failedCalls += 1; }),
    /no targets in selection/,
  );
  const successful = builder.onClick(() => { successfulCalls += 1; });
  element.dispatch("click", new Event("click"));
  assert.equal(failedCalls, 0);
  assert.equal(successfulCalls, 1);
  successful.off();
});

await check("a non-strict missing-target attempt leaves no latent registration", () => {
  const { tree, element } = fixture(null);
  const builder = tree.listen;
  let ignoredCalls = 0;
  let successfulCalls = 0;
  const ignored = builder.window.strict("ignore").onClick(() => { ignoredCalls += 1; });
  const successful = builder.onClick(() => { successfulCalls += 1; });
  element.dispatch("click", new Event("click"));
  assert.equal(ignoredCalls, 0);
  assert.equal(successfulCalls, 1);
  ignored.off();
  successful.off();
});

await check("standalone action definitions follow owned roots and preserve exact direct execution", async () => {
  const tree = hsonLiveTree.fromHson("<main <button/>/>");
  const other = hsonLiveTree.fromHson("<main/>");
  const child = tree.find.must.byTag("button");
  const alias = new LiveTree(child);
  const ids: string[] = [];
  const contexts: LiveTreeActionContext[] = [];
  const fail = (result: LocalActionResult) => {
    assert.equal(result.ok, false);
    return result.error;
  };
  try {
    assert.equal(runtime_for_tree(tree), runtime_for_tree(other));
    assert.equal(Object.getOwnPropertyDescriptor(LiveTree.prototype, "actions")?.get instanceof Function, true);
    assert.equal(child.actions, tree.actions);
    assert.equal(alias.actions, tree.actions);
    assert.equal(tree.create.span().actions, tree.actions);
    assert.notEqual(other.actions, tree.actions);
    const before = tree.node;

    const echo = (context: LiveTreeActionContext, input: HsonDataValue | undefined, message: { id: string; name: string }) => {
      contexts.push(context);
      assert.equal(Object.isFrozen(context) && Object.isFrozen(message), true);
      assert.equal(message.name, "copy");
      ids.push(message.id);
      return input;
    };
    const schema = Hson.schema`<type "data" content <'10' "number" '2' "number">>`;
    const options = { input: { schema } };
    for (const args of [["", echo], ["copy", 42], ["copy", echo, { unknown: true }],
      ["copy", echo, { input: { required: "yes" } }], ["copy", echo, { input: { schema: ANY_DOCUMENT } }]]) {
      assert.throws(() => Reflect.apply(child.actions.define, undefined, args), TypeError);
    }
    assert.match(fail(await tree.actions.trigger("copy")).message, /Unknown local action "copy"/);
    alias.actions.define("copy", echo, options);
    assert.throws(() => tree.actions.define("copy", echo, options), /already defined/);
    options.input.schema = ANY_DATA;
    assert.match(fail(await other.actions.trigger("copy")).message, /Unknown local action "copy"/);

    const exact = Hson.data.fromSource('{"10":-0,"2":2}');
    const pending = child.actions.trigger("copy", exact);
    assert.equal(contexts.length, 1, "direct handlers start in the invoking turn");
    const result = await pending;
    assert.ok(result.ok && result.result === exact);
    assert.deepEqual(result.result.entries()?.map(([name]) => name), ["10", "2"]);
    assert.ok(Object.is(result.result.entries()?.[0]?.[1].scalar(), -0));
    assert.deepEqual(await tree.actions.trigger("copy"), { ok: true });
    fail(await tree.actions.trigger("copy", null));
    assert.equal(new Set(ids).size, 2);
    assert.ok(contexts.every(context => context.tree === tree && !("event" in context) && !("subject" in context)));
    assert.deepEqual(tree.node, before);
    assert.equal(lifecycle_resource_counts_for_subject(retained_subject(child)).listener, 0);

    const registry = tree.actions;
    tree.actions.define("required", async (_context, input) => input, { input: { required: true, schema: ANY_DATA } });
    assert.match(fail(await tree.actions.trigger("required")).message, /requires input/);
    const presentNull = await tree.actions.trigger("required", null);
    assert.ok(presentNull.ok && presentNull.result?.scalar() === null);
    const failure = new Error("async action failed");
    tree.actions.define("reject", async () => { throw failure; });
    tree.actions.define("invalid-return", () => Infinity);
    assert.equal(fail(await tree.actions.trigger("reject")).cause, failure);
    assert.match(fail(await tree.actions.trigger("invalid-return")).message, /number must be finite/);
    child.remove();
    assert.throws(() => child.actions, /disposed/);
    assert.equal(tree.actions, registry);
    assert.deepEqual(await tree.actions.trigger("copy"), { ok: true });
    tree.remove();
    assert.match(fail(await registry.trigger("copy")).message, /disposed/);
    assert.throws(() => registry.define("too-late", () => {}), /disposed/);
  } finally { tree.remove(); other.remove(); }
});

await check("authored click binds exact Data, native options and the receiving subject", async () => {
  const { tree, selection, subjects, elements, listenerCounts } = selectionFixture();
  const [subject, sibling] = subjects;
  const [element, otherElement] = elements;
  const calls: Array<{ context: LiveTreeActionContext; input: HsonDataValue | undefined; id: string }> = [];
  const source = `<hson:event once stopProp on:click local:record input:data={<'10' -0 '2' null>} <> >`;
  const repeat = `<hson:event on:click local:record input:data={null} <> >`;
  const record = (context: LiveTreeActionContext, input: HsonDataValue | undefined, message: { id: string }) => {
    calls.push({ context, input, id: message.id });
  };
  try {
    tree.actions.define("record", record, { input: { required: true, schema: ANY_DATA } });
    assert.deepEqual(listenerCounts(), [0, 0]);
    const pending = subject.listen.capture().passive().once();
    const once = subject.listen.event(source);
    const remaining = subject.listen.event(repeat);
    const elsewhere = sibling.listen.event(repeat);
    let callbackCalls = 0;
    const ordinary = pending.onClick(function standaloneCallback() { callbackCalls++; });
    assert.deepEqual(element.registrations.map(({ options }) => options), [
      { capture: false, once: true, passive: false },
      { capture: false, once: false, passive: false },
      { capture: true, once: true, passive: true },
    ]);
    const first = new FlowEvent("click");
    element.dispatch("click", first);
    assert.equal(first.stopCalls, 1);
    assert.deepEqual(calls[0]?.context, { tree, subject, event: first });
    assert.deepEqual(calls[0]?.input?.entries()?.map(([name, value]) => [name, value.scalar()]), [["10", -0], ["2", null]]);
    assert.equal(calls[1]?.input?.scalar(), null);
    const second = new FlowEvent("click");
    element.dispatch("click", second);
    assert.equal(second.stopCalls, 0);
    assert.equal(callbackCalls, 1);
    assert.equal(calls.length, 3);
    const callbackAction = await tree.actions.trigger("standaloneCallback");
    assert.ok(!callbackAction.ok && /Unknown local action/.test(callbackAction.error.message));

    once.off(); remaining.off(); remaining.off(); ordinary.off();
    assert.deepEqual(listenerCounts(), [0, 1]);
    subject.remove();
    otherElement.dispatch("click", new Event("click"));
    assert.equal(calls.length, 4);
    assert.equal(calls[3]?.context.subject, sibling);
    assert.deepEqual(await sibling.actions.trigger("record", null), { ok: true });
    assert.equal(new Set(calls.map(call => call.id)).size, 5);

    const group = selection.filter(item => !item.isDisposed).listen.event(repeat);
    group.off(); group.off();
    assert.deepEqual(listenerCounts(), [0, 1]);
    tree.remove();
    assert.deepEqual(listenerCounts(), [0, 0]);
    elsewhere.off();
  } finally { tree.remove(); }
});

await check("attached and detached aliases resolve through current graph ownership", async () => {
  const source = hsonLiveTree.fromHson("<main <section <button/>/>/>");
  const destination = hsonLiveTree.fromHson("<aside/>");
  const branch = source.find.must.byTag("section");
  const alias = new LiveTree(branch.find.must.byTag("button"));
  const handler = ({ tree }: LiveTreeActionContext) => tree.node.$_tag;
  try {
    source.actions.define("root", handler);
    destination.actions.define("root", handler);
    assert.equal(alias.actions, source.actions);
    branch.detach();
    assert.equal(alias.actions, branch.actions);
    assert.notEqual(branch.actions, source.actions);
    branch.actions.define("root", handler);
    destination.append(branch);
    assert.equal(alias.actions, destination.actions);
    const attached = await alias.actions.trigger("root");
    assert.ok(attached.ok && attached.result?.scalar() === "aside");
    branch.detach();
    const detached = await alias.actions.trigger("root");
    assert.ok(detached.ok && detached.result?.scalar() === "section");
  } finally { branch.remove(); source.remove(); destination.remove(); }
});

await check("invalid standalone declarations and missing actions fail before native attachment", () => {
  const { tree, element } = fixture();
  const valid = "<hson:event on:click local:run input:data={<open true>} <> >";
  const schema = Hson.schema`<type "data" content <open "boolean">>`;
  try {
    let calls = 0;
    const before = tree.node;
    assert.throws(() => tree.listen.event(valid), /Unknown local action "run".*tree\.actions/);
    tree.actions.define("run", () => { calls++; }, { input: { required: true, schema } });
    assert.deepEqual(tree.node, before);
    element.dispatch("click", new Event("click"));
    assert.equal(calls, 0);
    for (const [source, error] of [
      [valid.replace("<> ", ""), /requires an outcome object/],
      [valid.replace("<> ", "<value 1> "), /Nonempty authored event outcomes are unsupported/],
      [valid.replace("<> ", "<> <> "), /single authored event outcome object/],
      [valid.replace(" input:data={<open true>}", ""), /requires explicit input:data/],
      [valid.replace("input:data=", "input:data:name="), /Only input:data takes a value/],
      [valid.replace("local:run", "host:run"), /cannot dispatch host: actions/],
      [valid.replace("local:run", "local:run local:other"), /exactly one host: or local:/],
      [valid.replace("on:click", "on:pointerdown"), /only on:click/],
      [valid.replace("on:click", "on:click capture passive"), /Unsupported authored event header item/],
      [valid.replace("{<open true>}", "^{value}"), /cannot resolve %\{\} or \^\{\} references/],
      [valid.replace("{<open true>}", "%{value}"), /cannot resolve %\{\} or \^\{\} references/],
      [valid.replace("{<open true>}", "{<open 1>}"), /at \["open"\]/],
    ] as const) assert.throws(() => tree.listen.event(source), error, source);
    const builder = tree.listen;
    assert.throws(() => builder.capture().event(valid), /cannot combine fluent listener options/);
    assert.throws(() => builder.strict("warn").event(valid), /cannot combine fluent listener options/);
    assert.throws(() => builder.clearStops().event(valid), /cannot combine fluent listener options/);
    assert.throws(() => builder.element.event(valid), /cannot combine fluent listener options/);
    assert.equal(element.registrations.length, 0);
    const sub = builder.event(valid);
    element.dispatch("click", new Event("click"));
    assert.equal(calls, 1);
    sub.off();
  } finally { tree.remove(); }
});

await check("a selection validates every action before adding any native listeners", () => {
  const first = fixture(), second = fixture();
  const selection = new TreeSelector([first.tree, second.tree]);
  const source = "<hson:event on:click local:record input:data={null} <> >";
  let calls = 0;
  try {
    first.tree.actions.define("record", () => { calls++; });
    assert.throws(() => selection.listen.event(source), /Unknown local action "record"/);
    assert.deepEqual([first.element.registrations.length, second.element.registrations.length], [0, 0]);
    second.tree.actions.define("record", () => { calls++; });
    const pending = selection.listen.once();
    const group = selection.listen.event(source);
    assert.throws(() => pending.event(source), /cannot combine fluent listener options/);
    for (const { element } of [first, second]) {
      element.dispatch("click", new Event("click"));
      element.dispatch("click", new Event("click"));
    }
    assert.equal(calls, 4);
    group.off(); group.off();
  } finally { first.tree.remove(); second.tree.remove(); }
});

await check("partial authored selection failure releases subject and action owner registrations", () => {
  const { tree, selection, subjects, elements, listenerCounts } = selectionFixture();
  const [, second] = elements;
  const ownerCount = () => lifecycle_resource_counts_for_subject(retained_subject(tree), runtime_for_tree(tree)).listener;
  const declaration = "<hson:event on:click stopProp local:run input:data={null} <> >";
  const failure = new Error("native attachment failed after adding the listener");
  const add = second.addEventListener;
  let calls = 0;
  try {
    tree.actions.define("run", () => { calls++; });
    second.addEventListener = (...args) => { add.apply(second, args); throw failure; };
    assert.throws(() => selection.listen.event(declaration), cause => cause === failure);
    assert.deepEqual(listenerCounts(), [0, 0]);
    assert.equal(ownerCount(), 0);
    for (const element of elements) {
      assert.equal(element.listeners.has("click"), false);
      const click = new FlowEvent("click");
      element.dispatch("click", click);
      assert.equal(click.stopCalls, 0);
    }
    assert.equal(calls, 0);
    second.addEventListener = add;
    const once = subjects[0].listen.event(declaration.replace("stopProp", "once"));
    assert.equal(ownerCount(), 1);
    elements[0].dispatch("click", new Event("click"));
    once.off(); once.off();
    assert.equal(calls, 1);
    assert.equal(ownerCount(), 0);
  } finally { second.addEventListener = add; tree.remove(); }
});

await check("authored off retries native removal through the subscription or either owner", () => {
  for (const releaseThrough of ["subscription", "subject", "action owner"]) {
    const { tree, subjects: [subject], elements: [element], listenerCounts } = selectionFixture();
    const ownerCount = () => lifecycle_resource_counts_for_subject(retained_subject(tree), runtime_for_tree(tree)).listener;
    const remove = element.removeEventListener;
    const failure = new Error("native removal failed before taking effect");
    let calls = 0, attempts = 0;
    try {
      tree.actions.define("run", () => { calls++; });
      const sub = subject.listen.event("<hson:event on:click stopProp local:run input:data={null} <> >");
      element.removeEventListener = () => { attempts++; throw failure; };
      assert.throws(() => sub.off(), cause => cause === failure);
      assert.equal(ownerCount(), 1);
      assert.deepEqual(listenerCounts(), [1, 0]);
      assert.equal(element.listeners.get("click")?.size, 1);
      const click = new FlowEvent("click");
      element.dispatch("click", click);
      assert.deepEqual([calls, click.stopCalls], [0, 0]);

      element.removeEventListener = (...args) => { attempts++; remove.apply(element, args); };
      if (releaseThrough === "subscription") sub.off();
      else if (releaseThrough === "subject") subject.remove();
      else tree.remove();
      sub.off(); sub.off();
      assert.equal(attempts, 2);
      assert.equal(element.registrations.length, 1);
      assert.equal(element.listeners.has("click"), false);
      assert.equal(ownerCount(), 0);
      assert.deepEqual(listenerCounts(), [0, 0]);
    } finally { element.removeEventListener = remove; tree.remove(); }
  }
});

await check("failed authored selection rollback retains cleanup and retries before adding wrappers", () => {
  const { tree, selection, elements: [first, second], listenerCounts } = selectionFixture();
  const ownerCount = () => lifecycle_resource_counts_for_subject(retained_subject(tree), runtime_for_tree(tree)).listener;
  const declaration = "<hson:event on:click stopProp local:run input:data={null} <> >";
  const add = second.addEventListener;
  const remove = first.removeEventListener;
  const installFailure = new Error("native add failed after taking effect");
  const removeFailure = new Error("native removal failed before taking effect");
  let calls = 0;
  try {
    tree.actions.define("run", () => { calls++; });
    first.removeEventListener = second.removeEventListener = () => { throw removeFailure; };
    second.addEventListener = (...args) => { add.apply(second, args); throw installFailure; };
    assert.throws(() => selection.listen.event(declaration), cause => cause === installFailure);
    assert.deepEqual(listenerCounts(), [1, 1]);
    assert.equal(ownerCount(), 2);
    for (const target of [first, second]) {
      assert.equal(target.listeners.get("click")?.size, 1);
      const click = new FlowEvent("click");
      target.dispatch("click", click);
      assert.equal(click.stopCalls, 0);
    }
    assert.equal(calls, 0);
    assert.throws(() => selection.listen.event(declaration), cause => cause === removeFailure);
    assert.deepEqual([first.registrations.length, second.registrations.length], [1, 1]);

    first.removeEventListener = second.removeEventListener = remove;
    second.addEventListener = add;
    const sub = selection.listen.event(declaration);
    for (const target of [first, second]) {
      assert.equal(target.listeners.get("click")?.size, 1);
      target.dispatch("click", new FlowEvent("click"));
    }
    assert.equal(calls, 2);
    sub.off(); sub.off();
    assert.deepEqual(listenerCounts(), [0, 0]);
    assert.equal(ownerCount(), 0);
  } finally {
    first.removeEventListener = second.removeEventListener = remove;
    second.addEventListener = add;
    tree.remove();
  }
});

await check("reentrant native add cannot publish stale authored once ownership", () => {
  const { tree, element } = fixture();
  const ownerCount = () => lifecycle_resource_counts_for_subject(retained_subject(tree), runtime_for_tree(tree)).listener;
  const declaration = "<hson:event on:click once stopProp local:run input:data={null} <> >";
  const add = element.addEventListener;
  let calls = 0;
  try {
    tree.actions.define("run", () => { calls++; });
    element.addEventListener = (...args) => {
      add.apply(element, args);
      const early = new FlowEvent("click");
      element.dispatch("click", early);
      assert.equal(early.stopCalls, 0);
    };
    assert.throws(() => tree.listen.event(declaration), /once listener was consumed during native installation/);
    assert.equal(ownerCount(), 0);
    assert.equal(element.listeners.has("click"), false);
    assert.equal(calls, 0);

    const repeated = tree.listen.event(declaration.replace("once ", ""));
    assert.equal(ownerCount(), 1);
    assert.equal(calls, 0);
    element.dispatch("click", new FlowEvent("click"));
    assert.equal(calls, 1);
    repeated.off();
    element.addEventListener = add;
    const once = tree.listen.event(declaration);
    element.dispatch("click", new FlowEvent("click"));
    element.dispatch("click", new FlowEvent("click"));
    once.off(); once.off();
    assert.equal(calls, 2);
    assert.equal(ownerCount(), 0);
    assert.equal(element.listeners.has("click"), false);
  } finally { element.addEventListener = add; tree.remove(); }
});

await check("authored listeners use ordinary missing targets and report both failure timings", async () => {
  const runtime = create_livetree_runtime();
  const tree = create_staged_livetree_in_runtime({ $_tag: "button", $_content: [] }, runtime);
  const before = tree.node;
  const element = new TestElement(new TestDocument(new TestTarget()));
  const source = (name: string) => `<hson:event on:click local:${name} input:data={null} <> >`;
  const reports: unknown[] = [];
  const original = Object.getOwnPropertyDescriptor(globalThis, "reportError");
  Object.defineProperty(globalThis, "reportError", { configurable: true, value: (error: unknown) => reports.push(error) });
  try {
    const synchronous = new Error("sync");
    const asynchronous = new Error("async");
    tree.actions.define("sync", () => { throw synchronous; });
    tree.actions.define("async", async () => { throw asynchronous; });
    tree.actions.define("invalid", () => Infinity);
    const missing = tree.listen.event(source("sync"));
    link_node_to_el(retained_subject(tree), element as unknown as Element);
    element.dispatch("click", new Event("click"));
    assert.equal(reports.length, 0);
    missing.off();
    tree.listen.event(source("sync"));
    tree.listen.event(source("async"));
    tree.listen.event(source("invalid"));
    element.dispatch("click", new Event("click"));
    assert.equal(reports.length, 2);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(reports.length, 3);
    assert.ok(reports[0] instanceof Error && reports[0].cause === synchronous);
    assert.ok(reports[1] instanceof Error && reports[1].cause instanceof TypeError);
    assert.ok(reports[2] instanceof Error && reports[2].cause === asynchronous);
    assert.equal((await tree.actions.trigger("sync")).ok, false);
    assert.equal(reports.length, 3);
    assert.deepEqual(tree.node, before);
    assert.equal(runtime.issuedQuids.size, 0, "installing and invoking a listener does not issue identity");
  } finally {
    tree.remove();
    if (original === undefined) Reflect.deleteProperty(globalThis, "reportError");
    else Object.defineProperty(globalThis, "reportError", original);
  }
});

process.stdout.write(`# ${checks} LiveTree listener contract checks passed\n`);
testEvents.terminal("pass");
