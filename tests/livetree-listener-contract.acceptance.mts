// @hson-live-external-test
import { create_test_event_emitter } from "./test-events.mjs";
import assert from "node:assert/strict";
import { create_livetree } from "../src/api/livetree/creation/create-livetree.ts";
import { lifecycle_resource_counts_for_owner } from "../src/api/livetree/managers/lifecycle-registry.ts";
import { link_node_to_el } from "../src/api/livetree/utils/node-map-helpers.ts";
import type { LiveTree } from "../src/api/livetree/livetree.ts";

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

class TestElement extends TestTarget {
  readonly nodeType = 1;
  readonly isConnected = true;
  public constructor(public readonly ownerDocument: TestDocument) { super(); }
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
  link_node_to_el(tree.node, element as unknown as Element);
  return { tree, element };
}

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
