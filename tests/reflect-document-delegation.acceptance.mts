import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import assert from "node:assert/strict";
import { hson, LiveMapSchemaError, validate_document_path } from "../src/index.ts";
import { is_Node } from "../src/core/node-guards.ts";
import type { HsonNode } from "../src/core/types.ts";
import type { LiveInputBridgeTarget } from "../src/types/bridge.types.ts";
import type { ElementLiveMap, LiveMapCommitObservation } from "../src/types/livemap.types.ts";
import { hsonReflect } from "../src/api/reflect/reflect.facade.ts";
import {
  DOCUMENT_REFLECT_DELEGATION_UNSUPPORTED_ERROR_CODE,
  DOCUMENT_REFLECT_STRUCTURAL_UPDATE_FAILED_ERROR_CODE,
  DocumentReflectError,
} from "../src/api/reflect/reflect.document.error.ts";
import { create_livetree } from "../src/api/livetree/creation/create-livetree.ts";
import { project_livetree } from "../src/api/livetree/creation/project-live-tree.ts";
import { get_el_for_node, link_node_to_el } from "../src/api/livetree/utils/node-map-helpers.ts";
import { bind_livetree_input_value, value_to_text } from "../src/api/livemap/livemap.bridge-bindings.ts";
import { FakeElement, FakeText, install_fake_document } from "./helpers/fake-document.mts";

install_fake_document();

class FakeInputElement extends FakeElement {
  value = "";
  checked = false;
  readonly listeners = new Map<string, Set<EventListener>>();

  public constructor(tagName = "input") { super(tagName); }

  addEventListener(name: string, listener: EventListener): void {
    const listeners = this.listeners.get(name) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(name, listeners);
  }

  removeEventListener(name: string, listener: EventListener): void {
    this.listeners.get(name)?.delete(listener);
  }
}

class FakeTextAreaElement extends FakeInputElement {
  public constructor() { super("textarea"); }
}

class FakeSelectElement extends FakeInputElement {
  multiple = true;
  options: Array<{ value: string; selected: boolean }> = [];
  selectedOptions: Array<{ value: string; selected: boolean }> = [];

  public constructor() { super("select"); }
}

class FakeCanvasElement extends FakeElement {
  private bitmapWidth = 300;
  private bitmapHeight = 150;
  readonly effects: string[] = [];
  readonly context = {
    setTransform: (a: number): void => { this.effects.push(`transform:${a}`); },
  };

  public constructor() { super("canvas"); }

  get width(): number { return this.bitmapWidth; }
  set width(value: number) { this.bitmapWidth = value; this.effects.push(`width:${value}`); }
  get height(): number { return this.bitmapHeight; }
  set height(value: number) { this.bitmapHeight = value; this.effects.push(`height:${value}`); }
  getBoundingClientRect(): { width: number; height: number } { return { width: 100, height: 50 }; }
  getContext(kind: string): typeof this.context | null { return kind === "2d" ? this.context : null; }
  override setAttribute(name: string, value: string): void {
    super.setAttribute(name, value);
    this.effects.push(`attr:${name}:${value}`);
  }
}

Reflect.set(globalThis, "HTMLInputElement", FakeInputElement);
Reflect.set(globalThis, "HTMLTextAreaElement", FakeTextAreaElement);
Reflect.set(globalThis, "HTMLSelectElement", FakeSelectElement);
Reflect.set(globalThis, "HTMLCanvasElement", FakeCanvasElement);
Reflect.set(globalThis, "EventTarget", FakeElement);

let checks = 0;
function check(name: string, fn: () => void): void {
  fn();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function element(source: string): ElementLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "element") throw new Error("Expected ElementLiveMap");
  return map;
}

function path(...segments: number[]) {
  return { kind: "path" as const, path: validate_document_path(segments) };
}

function raw_node(root: HsonNode, rawPath: readonly number[]): HsonNode {
  let current = root;
  for (const segment of rawPath) {
    const child = current.$_content[segment];
    if (!is_Node(child)) throw new Error(`Expected node at ${rawPath.join("/")}`);
    current = child;
  }
  return current;
}

function projected_element(source: string): HsonNode {
  return element(source).element.node();
}

function mount(root: HsonNode): FakeElement {
  return project_livetree(root) as unknown as FakeElement;
}

function link_bound_element(node: HsonNode, element: FakeElement): void {
  const quid = node.$_meta?.quid;
  if (quid !== undefined) element.setAttribute("hson:quid", quid);
  link_node_to_el(node, element as unknown as Element);
}

check("bound text.set delegates one replacement while preserving element content", () => {
  const map = element(`<main @000000501 "old" <b @000000502/>/>`);
  const binding = hsonReflect(map);
  const rootDom = mount(binding.tree.node);
  const preserved = raw_node(binding.tree.node, [0, 1]);
  const preservedDom = get_el_for_node(preserved);
  const observations: LiveMapCommitObservation[] = [];
  map.commits.observe((event) => observations.push(event));

  for (const value of ["next", 0, false, null] as const) {
    assert.equal(binding.tree.text.set(value), binding.tree);
  }
  const revision = map.rev;
  const transactions = binding.diagnostics().updatesApplied;
  const writes = rootDom.replaceWrites;
  binding.tree.text.set("");
  assert.equal(map.rev, revision);
  assert.equal(binding.diagnostics().updatesApplied, transactions);
  assert.equal(rootDom.replaceWrites, writes);
  assert.equal(observations.length, 4);
  assert.equal(transactions, 4);
  assert.equal(raw_node(map.element.node(), [0, 0]).$_content[0], "");
  assert.equal(raw_node(binding.tree.node, [0, 1]), preserved);
  assert.equal(get_el_for_node(preserved), preservedDom);
  assert.ok(rootDom.childNodes[0] instanceof FakeText);
  assert.equal((rootDom.childNodes[0] as FakeText).data, "");
  binding.dispose();
});

check("text.set inserts one canonical text slot when the bucket has no text", () => {
  const map = element(`<main @000000503 <b/>/>`);
  const binding = hsonReflect(map);
  mount(binding.tree.node);
  binding.tree.text.set("first");
  const bucket = raw_node(map.element.node(), [0]);
  assert.equal(raw_node(map.element.node(), [0, 0]).$_content[0], "first");
  assert.equal((bucket.$_content[1] as HsonNode).$_tag, "b");
  assert.equal(binding.diagnostics().updatesApplied, 1);
  binding.dispose();
});

check("text.add and text.insert map to exact raw _hson_elem insertion slots", () => {
  const map = element(`<main @000000504 "a" <b/>/>`);
  const binding = hsonReflect(map);
  const rootDom = mount(binding.tree.node);
  const observations: LiveMapCommitObservation[] = [];
  map.commits.observe((event) => observations.push(event));
  assert.equal(binding.tree.text.add(0), binding.tree);
  assert.equal(binding.tree.text.insert(1, false), binding.tree);
  const canonicalBucket = raw_node(map.element.node(), [0]);
  assert.deepEqual(canonicalBucket.$_content.map((item) => is_Node(item)
    ? item.$_tag === "_hson_str" ? `${item.$_tag}:${String(item.$_content[0] ?? "")}` : item.$_tag
    : item), [
    "_hson_str:a", "_hson_str:false", "b", "_hson_str:0",
  ]);
  assert.deepEqual([...rootDom.childNodes].map((item) => item instanceof FakeText ? item.data : (item as FakeElement).tagName), ["a", "false", "b", "0"]);
  assert.equal(observations.length, 2);
  assert.equal(binding.diagnostics().updatesApplied, 2);
  binding.dispose();

  const empty = element(`<main @000000505/>`);
  const emptyBinding = hsonReflect(empty);
  emptyBinding.tree.text.add(null);
  assert.equal(raw_node(empty.element.node(), [0, 0]).$_content[0], "");
  assert.equal(emptyBinding.diagnostics().updatesApplied, 1);
  emptyBinding.dispose();
});

check("empty delegates only zero-or-one physical content slots", () => {
  const map = element(`<main @000000506 <section @000000507 "inside"/>/>`);
  const binding = hsonReflect(map);
  mount(binding.tree.node);
  const sectionNode = raw_node(binding.tree.node, [0, 0]);
  const sectionTree = create_livetree(sectionNode).adoptRoots(binding.tree.hostRootNode());
  const sectionDom = get_el_for_node(sectionNode) as unknown as FakeElement;
  const observations: LiveMapCommitObservation[] = [];
  map.commits.observe((event) => observations.push(event));
  assert.equal(sectionTree.empty(), sectionTree);
  assert.equal(raw_node(map.element.node(), [0, 0]).$_content.length, 0);
  assert.equal(sectionDom.childNodes.length, 0);
  const revision = map.rev;
  const transactions = binding.diagnostics().updatesApplied;
  const writes = sectionDom.replaceWrites;
  sectionTree.empty();
  assert.equal(map.rev, revision);
  assert.equal(binding.diagnostics().updatesApplied, transactions);
  assert.equal(sectionDom.replaceWrites, writes);
  assert.equal(observations.length, 1);
  assert.equal(binding.tree.empty(), binding.tree);
  assert.equal(map.element.node().$_content.length, 0);
  assert.equal((get_el_for_node(binding.tree.node) as unknown as FakeElement).childNodes.length, 0);
  assert.equal(observations.length, 2);
  assert.equal(binding.diagnostics().updatesApplied, 2);
  binding.dispose();
});

check("nested remove and removeSelf delegate one raw parent-slot removal", () => {
  const map = element(`<main @000000508 <a @000000509/> <b/> <c/>/>`);
  const binding = hsonReflect(map);
  mount(binding.tree.node);
  const aNode = raw_node(binding.tree.node, [0, 0]);
  const bNode = raw_node(binding.tree.node, [0, 1]);
  const cNode = raw_node(binding.tree.node, [0, 2]);
  const aTree = create_livetree(aNode).adoptRoots(binding.tree.hostRootNode());
  const bTree = create_livetree(bNode).adoptRoots(binding.tree.hostRootNode());
  const observations: LiveMapCommitObservation[] = [];
  map.commits.observe((event) => observations.push(event));
  assert.equal(bTree.remove(), 1);
  assert.equal(raw_node(binding.tree.node, [0, 1]), cNode);
  create_livetree(cNode).adoptRoots(binding.tree.hostRootNode()).attrs.set("shifted", "yes");
  assert.equal(map.document.attrs.get(path(0, 1), "shifted"), "yes");
  assert.equal(aTree.removeSelf(), 1);
  assert.equal(raw_node(map.element.node(), [0, 0]).$_tag, "c");
  assert.equal(observations.length, 3);
  assert.equal(binding.diagnostics().updatesApplied, 3);
  assert.equal(binding.tree.remove(), 1);
  assert.equal(binding.status, "disposed");
  assert.equal(map.element.node().$_tag, "main");
  binding.dispose();
});

check("replayed path changes are used by later text delegation", () => {
  const map = element(`<main @000000510 <a "left"/> <b "right"/>/>`);
  const binding = hsonReflect(map);
  const bNode = raw_node(binding.tree.node, [0, 1]);
  const bTree = create_livetree(bNode).adoptRoots(binding.tree.hostRootNode());
  map.replay({
    changed: true,
    prevRev: 0,
    rev: 1,
    ops: [{ domain: "graph", op: "move-content", target: path(0), from: 1, to: 0 }],
  });
  bTree.text.set("moved");
  assert.equal(raw_node(map.element.node(), [0, 0, 0, 0]).$_content[0], "moved");
  assert.equal(binding.sourceRevision, 2);
  assert.equal(binding.diagnostics().updatesApplied, 2);
  binding.dispose();
});

check("bound flags delegate canonically, validate schema, and do not mint QUIDs", () => {
  const Schema = hson.liveMap.schema.define((s) => s.main(s.attrs.exact({
    selected: s.flag.optional,
    required: s.flag,
    text: s.string.optional,
  })));
  const map = element(`<main required/>`).schema.use(Schema);
  const binding = hsonReflect(map);
  const rootDom = mount(binding.tree.node);
  assert.equal(binding.tree.node.$_meta, undefined);
  assert.equal(binding.tree.flags.has("selected"), false);

  const before = map.rev;
  assert.equal(binding.tree.flags.set("selected"), binding.tree);
  assert.equal(map.rev, before + 1);
  assert.equal(map.at([]).flags.has("selected"), true);
  assert.equal(binding.tree.attrs.get("selected"), "selected");
  assert.equal(rootDom.getAttribute("selected"), "selected");
  assert.equal(binding.tree.node.$_meta, undefined);

  assert.throws(() => binding.tree.flags.clear("required"), LiveMapSchemaError);
  assert.equal(map.at([]).flags.has("required"), true);
  assert.equal(rootDom.getAttribute("required"), "required");
  assert.equal(binding.tree.node.$_meta, undefined);

  binding.tree.attrs.set("text", "value");
  binding.tree.flags.clear("text");
  assert.equal(map.at([]).attrs.get("text"), "value");
  binding.tree.flags.clear("selected");
  assert.equal(map.at([]).flags.has("selected"), false);
  assert.equal(rootDom.getAttribute("selected"), null);
  binding.dispose();
});

check("standalone form state remains local while bound form state delegates before DOM realization", () => {
  const standaloneNode = projected_element(`<input/>`);
  const standalone = create_livetree(standaloneNode);
  const standaloneDom = new FakeInputElement();
  link_node_to_el(standaloneNode, standaloneDom as unknown as Element);
  standalone.form.setValue("local").form.setChecked(true);
  assert.deepEqual(standaloneNode.$_attrs, { checked: true, value: "local" });
  assert.equal(standaloneDom.value, "local");
  assert.equal(standaloneDom.checked, true);

  const standaloneSelectNode = projected_element(`<select/>`);
  const standaloneSelect = create_livetree(standaloneSelectNode);
  const standaloneSelectDom = new FakeSelectElement();
  standaloneSelectDom.options = [
    { value: "left", selected: false },
    { value: "right", selected: false },
  ];
  link_node_to_el(standaloneSelectNode, standaloneSelectDom as unknown as Element);
  standaloneSelect.form.setSelected(["right"]);
  assert.deepEqual(standaloneSelectNode.$_attrs, { value: "right", values: ["right"] });
  assert.deepEqual(standaloneSelectDom.options.map((option) => option.selected), [false, true]);

  const map = element(`<input @000000518/>`);
  const binding = hsonReflect(map);
  const dom = new FakeInputElement();
  link_bound_element(binding.tree.node, dom);
  const before = map.rev;
  binding.tree.form.setValue("canonical").form.setChecked(true);
  assert.equal(map.rev, before + 2);
  assert.equal(map.document.attrs.get(path(), "value"), "canonical");
  assert.equal(map.document.attrs.get(path(), "checked"), true);
  assert.equal(dom.value, "canonical");
  assert.equal(dom.checked, true);
  binding.dispose();
});

check("bound form rejection preserves graph and DOM, including unsupported selected arrays", () => {
  const ValueSchema = hson.liveMap.schema.define((s) => s.input(s.attrs.exact({
    value: s.string.constrain("fixed", (value) => value === "before"),
  })));
  const map = element(`<input @000000519 value="before"/>`).schema.use(ValueSchema);
  const binding = hsonReflect(map);
  const dom = new FakeInputElement();
  dom.value = "before";
  link_bound_element(binding.tree.node, dom);
  assert.throws(() => binding.tree.form.setValue("after"), LiveMapSchemaError);
  assert.equal(map.document.attrs.get(path(), "value"), "before");
  assert.equal(binding.tree.node.$_attrs?.value, "before");
  assert.equal(dom.value, "before");
  binding.dispose();

  const selectedMap = element(`<select @000000520 value="before"/>`);
  const selectedBinding = hsonReflect(selectedMap);
  const selectedDom = new FakeSelectElement();
  selectedDom.value = "before";
  selectedDom.options = [{ value: "before", selected: true }, { value: "after", selected: false }];
  link_bound_element(selectedBinding.tree.node, selectedDom);
  const selectedBefore = structuredClone(selectedBinding.tree.node);
  assert.throws(() => selectedBinding.tree.form.setSelected(["after"]), DocumentReflectError);
  assert.deepEqual(selectedBinding.tree.node, selectedBefore);
  assert.equal(selectedMap.document.attrs.get(path(), "value"), "before");
  assert.deepEqual(selectedDom.options.map((option) => option.selected), [true, false]);
  selectedBinding.dispose();
});

check("form bridge destinations inherit bound document authority", () => {
  const map = element(`<input @000000521/>`);
  const binding = hsonReflect(map);
  const dom = new FakeInputElement();
  link_bound_element(binding.tree.node, dom);
  const source = hson.liveMap.fromJson({ value: "bridged" });
  const target: LiveInputBridgeTarget = {
    form: {
      getValue: () => binding.tree.form.getValue(),
      setValue: (value, options) => binding.tree.form.setValue(value_to_text(value), options),
    },
    listen: binding.tree.listen,
  };
  const bridge = bind_livetree_input_value(target, source.at(["value"]));
  assert.equal(map.document.attrs.get(path(), "value"), "bridged");
  assert.equal(binding.tree.node.$_attrs?.value, "bridged");
  assert.equal(dom.value, "bridged");
  bridge.dispose();
  binding.dispose();
});

check("canvas display matching accepts canonical sizing before property and context realization", () => {
  const standaloneNode = projected_element(`<canvas/>`);
  const standalone = create_livetree(standaloneNode);
  const standaloneDom = new FakeCanvasElement();
  link_node_to_el(standaloneNode, standaloneDom as unknown as Element);
  standalone.canvas.display.match({ dpr: 2 });
  assert.deepEqual(standaloneNode.$_attrs, { height: "100", width: "200" });
  assert.equal(standaloneDom.width, 200);
  assert.equal(standaloneDom.height, 100);
  assert.deepEqual(standaloneDom.effects, [
    "attr:width:200", "attr:height:100", "attr:width:200",
    "width:200", "height:100", "transform:2",
  ]);

  const map = element(`<canvas @000000522/>`);
  const binding = hsonReflect(map);
  const dom = new FakeCanvasElement();
  link_bound_element(binding.tree.node, dom);
  dom.effects.length = 0;
  binding.tree.canvas.display.match({ dpr: 2 });
  assert.equal(map.document.attrs.get(path(), "width"), "200");
  assert.equal(map.document.attrs.get(path(), "height"), "100");
  assert.deepEqual(dom.effects, [
    "attr:width:200", "attr:height:100", "attr:width:200",
    "width:200", "height:100", "transform:2",
  ]);
  binding.dispose();
});

check("rejected bound canvas sizing leaves canonical graph and canvas properties unchanged", () => {
  const CanvasSchema = hson.liveMap.schema.define((s) => s.canvas(s.attrs.exact({
    width: s.string.constrain("fixed width", (value) => value === "10"),
    height: s.string,
  })));
  const map = element(`<canvas @000000523 width="10" height="10"/>`).schema.use(CanvasSchema);
  const binding = hsonReflect(map);
  const dom = new FakeCanvasElement();
  link_bound_element(binding.tree.node, dom);
  dom.effects.length = 0;
  const before = structuredClone(binding.tree.node);
  assert.throws(() => binding.tree.canvas.display.match({ dpr: 2 }), LiveMapSchemaError);
  assert.deepEqual(binding.tree.node, before);
  assert.equal(map.document.attrs.get(path(), "width"), "10");
  assert.equal(map.document.attrs.get(path(), "height"), "10");
  assert.equal(dom.width, 300);
  assert.equal(dom.height, 150);
  assert.deepEqual(dom.effects, []);
  binding.dispose();
});

check("ambiguous and lifecycle-incompatible APIs remain rejected", () => {
  const map = element(`<main @000000511 "one" "two"/>`);
  map.document.content.insert(path(0), 1, projected_element(`<aside/>`));
  const binding = hsonReflect(map);
  const branch = create_livetree(projected_element(`<aside/>`));
  const before = structuredClone(binding.tree.node);
  for (const [name, mutation] of [
    ["text.set", () => binding.tree.text.set("collapsed")],
    ["text.overwrite", () => binding.tree.text.overwrite("all")],
    ["append", () => binding.tree.append(branch)],
    ["create", () => binding.tree.create.div()],
    ["detach", () => binding.tree.detach()],
    ["detachContents", () => binding.tree.detachContents()],
    ["removeChildren", () => binding.tree.removeChildren()],
  ] as const) {
    assert.throws(mutation, (cause) => cause instanceof DocumentReflectError
      && (cause.code === DOCUMENT_REFLECT_DELEGATION_UNSUPPORTED_ERROR_CODE
        || cause.code === "DOCUMENT_REFLECT_UNSUPPORTED_OPERATION"), name);
  }
  assert.deepEqual(binding.tree.node, before);
  assert.equal(map.rev, 1);
  assert.equal(binding.status, "active");
  binding.dispose();
});

check("projection failure after delegated canonical success fails without escaping", () => {
  const map = element(`<main @000000512/>`);
  const binding = hsonReflect(map);
  const rootDom = mount(binding.tree.node);
  rootDom.failReplace = true;
  assert.equal(binding.tree.text.add("canonical"), binding.tree);
  assert.equal(map.rev, 1);
  assert.equal(binding.status, "failed");
  assert.equal(binding.failure?.code, DOCUMENT_REFLECT_STRUCTURAL_UPDATE_FAILED_ERROR_CODE);
  assert.equal(binding.sourceRevision, 0);
  assert.throws(() => binding.tree.text.set("blocked"), DocumentReflectError);
  binding.dispose();
  binding.tree.text.overwrite("unbound");
  assert.equal(binding.tree.text.get(), "unbound");
});

process.stdout.write(`# ${checks} bound document mutation delegation checks passed\n`);
emit_hson_live_test_completion("reflect.document-delegation", checks, checks, 0);
