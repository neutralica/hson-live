import { retained_subject } from "./helpers/retained-livetree-subject.mts";
// @hson-live-external-test
import { create_test_event_emitter } from "./test-events.mjs";
import assert from "node:assert/strict";
import { create_livetree } from "../src/api/livetree/creation/create-livetree.ts";
import { lifecycle_resource_counts_for_owner } from "../src/api/livetree/managers/lifecycle-registry.ts";
import { link_node_to_el } from "../src/api/livetree/utils/node-map-helpers.ts";
import type { LiveTree } from "../src/api/livetree/livetree.ts";
import { hsonLiveTree } from "../src/api/livetree/livetree.facade.ts";
import { TreeSelector } from "../src/api/livetree/creation/tree-selector.ts";
import { lifecycle_resource_counts_for_subject } from "../src/api/livetree/managers/lifecycle-registry.ts";
import { runtime_for_tree } from "../src/api/livetree/runtime/livetree-runtime.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livetree.listener-contract",
  title: "LiveTree listener registration contract",
  category: "LiveTree",
  runtime: "node-synthetic-dom",
  tags: Object.freeze(["listeners", "runtime", "public-contract", "externally-discoverable"]),
});

const testEvents = create_test_event_emitter("livetree.listener-contract");
let checks = 0;
function check(name: string, fn: () => void): void {
  testEvents.case_begin(name, name);
  try {
    fn();
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

check("a selection registers synchronously on both buttons and off removes only its entire group", () => {
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

check("selection once is per subject and retained builder reuse consumes its configuration", () => {
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

check("selection native options and flow modifiers apply to every subject and reset after registration", () => {
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
    check(`selection ${target} registrations retain per-subject ownership on ${shared ? "shared" : "distinct"} targets`, () => {
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

check("selection target aliases and element reset forward configuration to both subjects", () => {
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

check("strict selection failure cleans earlier attachments and consumes configuration for all subjects", () => {
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

check("group off attempts every subscription before throwing the first cleanup error", () => {
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
    assert.deepEqual(listenerCounts(), [0, 0, 1]);
    for (const target of targets) target.dispatch("click", new Event("click"));
    assert.equal(calls, 1, "only the independent registration remains active");
    group.off(); group.off();
    assert.deepEqual(targets.map(target => target.removalAttempts), [1, 1, 1]);
    independent.off();
    assert.deepEqual(listenerCounts(), [0, 0, 0]);
  } finally {
    for (const target of targets) target.cleanupError = undefined;
    tree.remove();
  }
});

check("strict partial failure rolls back every acquired subscription despite cleanup failure", () => {
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
    assert.deepEqual(listenerCounts(), [0, 1, 0]);
    for (const target of targets) target.dispatch("click", new Event("click"));
    assert.equal(calls, 1, "failed group leaves only the independent registration active");
    independent.off();
    assert.deepEqual(listenerCounts(), [0, 0, 0]);
  } finally {
    for (const target of targets) target.cleanupError = undefined;
    tree.remove();
  }
});

check("ignored missing selection targets leave successful attachments owned and disposable", () => {
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

check("duplicated queries install one listener per subject and retirement removes the exact owner's registration", () => {
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

check("empty and single-subject selections support fluent registration and idempotent cleanup", () => {
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

check("a normal listener attaches, receives events, and has an idempotent off handle", () => {
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

check("off retires only the exact registration on a shared target", () => {
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

check("once retires native and lifecycle bookkeeping even when the callback throws", () => {
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

check("registration options and event-flow controls are immutable snapshots", () => {
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

check("one registration consumes configuration and retained-builder reuse starts from defaults", () => {
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

check("a strict missing-target failure is retired before retained-builder reuse", () => {
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

check("a non-strict missing-target attempt leaves no latent registration", () => {
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

process.stdout.write(`# ${checks} LiveTree listener contract checks passed\n`);
testEvents.terminal("pass");
