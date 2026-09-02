// @hson-live-external-test
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import { create_test_event_emitter } from "./test-events.mjs";
import assert from "node:assert/strict";
import { create_livetree } from "../src/api/livetree/creation/create-livetree.ts";
import { link_node_to_el } from "../src/api/livetree/utils/node-map-helpers.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livetree.dom-realm",
  title: "LiveTree mapped DOM realm boundaries",
  category: "LiveTree",
  runtime: "node",
  tags: Object.freeze(["dom-projection", "runtime", "realm", "externally-discoverable"]),
});

const testEvents = create_test_event_emitter("livetree.dom-realm");
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

class RealmText {
  readonly nodeType = 3;
  parentNode: RealmElement | null = null;
  public constructor(public data: string) {}
  get textContent(): string { return this.data; }
}

class RealmChildList extends Array<RealmText | RealmElement> {
  item(index: number): RealmText | RealmElement | null { return this[index] ?? null; }
}

class RealmSerializer {
  serializeToString(element: Element): string {
    return `<local:${(element as unknown as RealmElement).tagName.toLowerCase()}>`;
  }
}

class RealmParser {
  parseFromString(): never { throw new Error("local parser used"); }
}

class RealmDocument {
  public constructor(public readonly defaultView: Record<string, unknown> | null) {}
  createTextNode(value: string): RealmText { return new RealmText(value); }
}

class RealmElement {
  readonly nodeType = 1;
  readonly namespaceURI = "http://www.w3.org/1999/xhtml";
  readonly childNodes = new RealmChildList();
  readonly attributes: Array<{ name: string; value: string }> = [];
  readonly style = {
    values: new Map<string, string>(),
    setProperty: (name: string, value: string): void => { this.style.values.set(name, value); },
    removeProperty: (name: string): void => { this.style.values.delete(name); },
  };
  readonly listeners = new Map<string, Set<EventListener>>();
  parentNode: RealmElement | null = null;
  isConnected = true;
  value = "";
  checked = false;
  multiple = false;
  width = 300;
  height = 150;

  public constructor(
    public readonly tagName: string,
    public readonly ownerDocument: RealmDocument,
  ) {}

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }
  appendChild(child: RealmText | RealmElement): RealmText | RealmElement {
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }
  insertBefore(child: RealmText | RealmElement, reference: RealmText | RealmElement | null): void {
    child.parentNode = this;
    const index = reference === null ? this.childNodes.length : this.childNodes.indexOf(reference);
    this.childNodes.splice(index < 0 ? this.childNodes.length : index, 0, child);
  }
  removeChild(child: RealmText | RealmElement): void {
    const index = this.childNodes.indexOf(child);
    if (index >= 0) this.childNodes.splice(index, 1);
    child.parentNode = null;
  }
  remove(): void { this.parentNode?.removeChild(this); }
  contains(node: unknown): boolean { return node === this || this.childNodes.includes(node as never); }
  querySelector(): Element | null { return null; }
  querySelectorAll(): Element[] { return []; }
  setAttribute(): void {}
  removeAttribute(): void {}
  getAttribute(): string | null { return null; }
  getAttributeNames(): string[] { return []; }
  getBoundingClientRect(): { left: number; width: number; height: number } {
    return { left: 0, width: 80, height: 40 };
  }
  getContext(kind: string): { setTransform: (...args: number[]) => void } | null {
    return kind === "2d" ? { setTransform: () => undefined } : null;
  }
}

function mappedTree(tag: string, element: RealmElement) {
  const tree = create_livetree({ $_tag: tag, $_content: [] });
  link_node_to_el(tree.node, element as unknown as Element);
  return tree;
}

check("DOM helpers use mapped-realm facts and serializer without ambient constructors", () => {
  const priorHTMLElement = Reflect.get(globalThis, "HTMLElement");
  const priorNode = Reflect.get(globalThis, "Node");
  const priorSerializer = Reflect.get(globalThis, "XMLSerializer");
  Reflect.deleteProperty(globalThis, "HTMLElement");
  Reflect.deleteProperty(globalThis, "Node");
  Reflect.set(globalThis, "XMLSerializer", class { serializeToString(): string { return "ambient"; } });
  try {
    const document = new RealmDocument({ XMLSerializer: RealmSerializer });
    const element = new RealmElement("MAIN", document);
    const child = new RealmElement("SPAN", document);
    element.appendChild(child);
    const tree = mappedTree("main", element);
    assert.equal(tree.dom.htmlEl(), element as unknown as HTMLElement);
    assert.equal(tree.dom.contains.target(child as unknown as EventTarget), true);
    assert.equal(tree.dom.outerHtml, "<local:main>");
    tree.remove();
  } finally {
    if (priorHTMLElement !== undefined) Reflect.set(globalThis, "HTMLElement", priorHTMLElement);
    if (priorNode !== undefined) Reflect.set(globalThis, "Node", priorNode);
    if (priorSerializer === undefined) Reflect.deleteProperty(globalThis, "XMLSerializer");
    else Reflect.set(globalThis, "XMLSerializer", priorSerializer);
  }
});

check("form and text operations narrow locally without ambient constructors or Node constants", () => {
  const priorInput = Reflect.get(globalThis, "HTMLInputElement");
  const priorTextarea = Reflect.get(globalThis, "HTMLTextAreaElement");
  const priorSelect = Reflect.get(globalThis, "HTMLSelectElement");
  const priorNode = Reflect.get(globalThis, "Node");
  for (const name of ["HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "Node"]) {
    Reflect.deleteProperty(globalThis, name);
  }
  try {
    const document = new RealmDocument({});
    const input = new RealmElement("INPUT", document);
    const inputTree = mappedTree("input", input);
    inputTree.form.setValue("local");
    inputTree.form.setChecked(true);
    assert.equal(input.value, "local");
    assert.equal(input.checked, true);
    assert.equal(inputTree.form.getValue(), "local");

    const host = new RealmElement("MAIN", document);
    host.appendChild(new RealmText("old"));
    const textTree = mappedTree("main", host);
    textTree.text.set("next");
    assert.equal((host.childNodes[0] as RealmText).data, "next");
    inputTree.remove();
    textTree.remove();
  } finally {
    if (priorInput !== undefined) Reflect.set(globalThis, "HTMLInputElement", priorInput);
    if (priorTextarea !== undefined) Reflect.set(globalThis, "HTMLTextAreaElement", priorTextarea);
    if (priorSelect !== undefined) Reflect.set(globalThis, "HTMLSelectElement", priorSelect);
    if (priorNode !== undefined) Reflect.set(globalThis, "Node", priorNode);
  }
});

check("listeners accept foreign targets and never borrow ambient window for a mapped null-view Document", () => {
  const priorEventTarget = Reflect.get(globalThis, "EventTarget");
  const priorWindow = Reflect.get(globalThis, "window");
  let ambientAdds = 0;
  Reflect.set(globalThis, "EventTarget", class {});
  Reflect.set(globalThis, "window", {
    addEventListener: () => { ambientAdds += 1; },
    removeEventListener: () => undefined,
  });
  try {
    const foreignDocument = new RealmDocument({});
    const foreignElement = new RealmElement("BUTTON", foreignDocument);
    const foreignTree = mappedTree("button", foreignElement);
    const listener = foreignTree.listen.onClick(() => undefined);
    assert.equal(foreignElement.listeners.get("click")?.size, 1);
    listener.off();
    assert.equal(foreignElement.listeners.get("click")?.size, 0);
    foreignTree.remove();

    const nullViewElement = new RealmElement("BUTTON", new RealmDocument(null));
    const nullViewTree = mappedTree("button", nullViewElement);
    assert.throws(
      () => nullViewTree.listen.window.strict("throw").onClick(() => undefined),
      /no targets in selection/,
    );
    assert.equal(ambientAdds, 0);
    nullViewTree.remove();
  } finally {
    if (priorEventTarget === undefined) Reflect.deleteProperty(globalThis, "EventTarget");
    else Reflect.set(globalThis, "EventTarget", priorEventTarget);
    if (priorWindow === undefined) Reflect.deleteProperty(globalThis, "window");
    else Reflect.set(globalThis, "window", priorWindow);
  }
});

check("canvas narrowing and DPR come from the mapped canvas realm", () => {
  const priorCanvas = Reflect.get(globalThis, "HTMLCanvasElement");
  const priorWindow = Reflect.get(globalThis, "window");
  Reflect.set(globalThis, "HTMLCanvasElement", class {});
  Reflect.set(globalThis, "window", { devicePixelRatio: 9 });
  try {
    const canvas = new RealmElement("CANVAS", new RealmDocument({ devicePixelRatio: 2 }));
    const tree = mappedTree("canvas", canvas);
    assert.equal(tree.canvas.el(), canvas as unknown as HTMLCanvasElement);
    const display = tree.canvas.display.size();
    assert.equal(display?.width, 80);
    assert.equal(display?.height, 40);
    assert.equal(display?.dpr, 2);
    assert.equal(display?.bitmapWidth, 160);
    assert.equal(display?.bitmapHeight, 80);
    tree.remove();
  } finally {
    if (priorCanvas === undefined) Reflect.deleteProperty(globalThis, "HTMLCanvasElement");
    else Reflect.set(globalThis, "HTMLCanvasElement", priorCanvas);
    if (priorWindow === undefined) Reflect.deleteProperty(globalThis, "window");
    else Reflect.set(globalThis, "window", priorWindow);
  }
});

check("mounted SVG creation resolves DOMParser from the mapped realm", () => {
  const priorParser = Reflect.get(globalThis, "DOMParser");
  Reflect.set(globalThis, "DOMParser", class { parseFromString(): never { throw new Error("ambient parser used"); } });
  try {
    const document = new RealmDocument({ DOMParser: RealmParser });
    const tree = mappedTree("main", new RealmElement("MAIN", document));
    assert.throws(() => tree.create.svg("<svg/>") , /local parser used/);
    tree.remove();
  } finally {
    if (priorParser === undefined) Reflect.deleteProperty(globalThis, "DOMParser");
    else Reflect.set(globalThis, "DOMParser", priorParser);
  }
});

process.stdout.write(`# ${checks} LiveTree DOM realm checks passed\n`);
testEvents.terminal("pass");
emit_hson_live_test_completion("livetree.dom-realm", checks, checks, 0);
