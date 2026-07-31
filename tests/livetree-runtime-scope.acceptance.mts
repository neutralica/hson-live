import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
// @hson-live-external-test
import assert from "node:assert/strict";
import { hson } from "../src/index.ts";
import {
  _reflect_document_for_runtime_test,
  _append_livetree_branches_atomic,
  _create_livetree_for_runtime_test,
  _create_livetree_runtime_test_handle,
  _dispose_livetree_runtime_test_handle,
  _livetree_runtime_test_claim_count,
  _livetree_runtime_test_css_manager,
  _livetree_runtime_test_owns_document,
  _livetree_runtime_test_resource_counts,
  _livetree_runtime_test_same_runtime,
  _lookup_livetree_runtime_test_node,
  _own_livetree_runtime_test_disposable,
  _project_livetree_for_runtime_test,
  _register_livetree_runtime_test_document,
} from "../src/diagnostics/index.ts";
import { assign_hson_node_quid } from "../src/core/hson-node-quid.ts";
import type { HsonNode } from "../src/core/types.ts";
import type { LiveTree } from "../src/api/livetree/livetree.ts";
import type { ElementLiveMap } from "../src/types/livemap.types.ts";

let checks = 0;
function check(name: string, fn: () => void): void {
  fn();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

const SAME_QUID = "0000000000000rt1";
type RuntimeHandle = ReturnType<typeof _create_livetree_runtime_test_handle>;

function node(tag = "main", quid?: string): HsonNode {
  const value: HsonNode = { $_tag: tag, $_content: [] };
  if (quid !== undefined) assign_hson_node_quid(value, quid);
  return value;
}

function runtimeTree(runtime: RuntimeHandle, value: HsonNode): LiveTree {
  return _create_livetree_for_runtime_test(runtime, value);
}

function projectInto(
  runtime: RuntimeHandle,
  tree: LiveTree,
  document: StyleDocument,
): StyleNode {
  const projected = _project_livetree_for_runtime_test(
    runtime,
    tree,
    document as unknown as Document,
  ) as unknown as StyleNode;
  document.body.appendChild(projected);
  return projected;
}

function assertCleanProjection(root: StyleNode, authoredAttrs: readonly string[] = []): void {
  const allowed = new Set(["hson:quid", ...authoredAttrs]);
  for (const element of [root, ...root.walk()].filter((item) => !item.tagName.startsWith("#"))) {
    assert.equal(element.tagName.startsWith("hson-_runtime"), false);
    for (const name of element.getAttributeNames()) {
      assert.equal(allowed.has(name), true, `unexpected system projection attribute ${name}`);
    }
  }
}

function elementMap(source: string): ElementLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "element") throw new Error("Expected an element LiveMap.");
  return map;
}

class StyleNode {
  readonly attrs = new Map<string, string>();
  readonly children: StyleNode[] = [];
  readonly childNodes = this.children;
  readonly style = {
    cssText: "",
    values: new Map<string, string>(),
    setProperty(name: string, value: string): void { this.values.set(name, value); },
    removeProperty(name: string): void { this.values.delete(name); },
  };
  parentNode: StyleNode | undefined;
  isConnected = false;
  textContent = "";
  id = "";
  readonly namespaceURI: string;

  public constructor(
    public readonly tagName: string,
    public readonly ownerDocument: StyleDocument,
    namespace = "http://www.w3.org/1999/xhtml",
  ) {
    this.namespaceURI = namespace;
  }

  setAttribute(name: string, value: string): void { this.attrs.set(name, value); }
  removeAttribute(name: string): void { this.attrs.delete(name); }
  getAttribute(name: string): string | null { return this.attrs.get(name) ?? null; }
  getAttributeNames(): string[] { return [...this.attrs.keys()]; }
  hasAttribute(name: string): boolean { return this.attrs.has(name); }
  appendChild(child: StyleNode): StyleNode {
    if (child.tagName === "#fragment") {
      for (const item of [...child.children]) this.appendChild(item);
      return child;
    }
    child.remove();
    child.parentNode = this;
    child.isConnected = this.isConnected;
    this.children.push(child);
    if (child.tagName === "hson-_style") this.ownerDocument.installHost(child);
    return child;
  }
  insertBefore(child: StyleNode, reference: StyleNode | null): StyleNode {
    if (child.tagName === "#fragment") {
      for (const item of [...child.children]) this.insertBefore(item, reference);
      return child;
    }
    child.remove();
    const index = reference === null ? this.children.length : this.children.indexOf(reference);
    this.children.splice(index < 0 ? this.children.length : index, 0, child);
    child.parentNode = this;
    child.isConnected = this.isConnected;
    return child;
  }
  removeChild(child: StyleNode): StyleNode {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    if (child.parentNode === this) child.parentNode = undefined;
    child.isConnected = false;
    return child;
  }
  replaceChildren(...children: StyleNode[]): void {
    for (const child of [...this.children]) this.removeChild(child);
    for (const child of children) this.appendChild(child);
  }
  remove(): void { this.parentNode?.removeChild(this); }
  get parentElement(): StyleNode | null {
    return this.parentNode?.tagName === "#fragment" ? null : this.parentNode ?? null;
  }
  querySelector<T extends StyleNode>(selector: string): T | null {
    const styleId = selector.match(/^style#(.+)$/)?.[1];
    const found = this.walk().find((child) =>
      styleId === undefined
        ? false
        : child.tagName === "style" && child.id === styleId);
    return (found as T | undefined) ?? null;
  }
  querySelectorAll(): StyleNode[] { return this.walk(); }
  walk(): StyleNode[] {
    return this.children.flatMap((child) => [child, ...child.walk()]);
  }
}

class StyleDocument {
  readonly documentElement = new StyleNode("html", this);
  readonly head = new StyleNode("head", this);
  readonly body = new StyleNode("body", this);
  private host: StyleNode | undefined;

  public constructor() {
    this.documentElement.isConnected = true;
    this.head.isConnected = true;
    this.body.isConnected = true;
  }

  createElement(tag: string): StyleNode { return new StyleNode(tag, this); }
  createElementNS(namespace: string, tag: string): StyleNode {
    return new StyleNode(tag, this, namespace);
  }
  createTextNode(value: string): StyleNode {
    const text = new StyleNode("#text", this);
    text.textContent = value;
    return text;
  }
  createDocumentFragment(): StyleNode { return new StyleNode("#fragment", this); }
  querySelector<T extends StyleNode>(selector: string): T | null {
    if (selector === "hson-_style#css-manager") return (this.host as T | undefined) ?? null;
    const quid = selector.match(/^\[hson\\:quid="([^"]+)"\]$/)?.[1];
    if (quid !== undefined) {
      const found = this.elements().find((element) => element.getAttribute("hson:quid") === quid);
      return (found as T | undefined) ?? null;
    }
    return null;
  }
  installHost(value: StyleNode): void { this.host = value; }
  styleTexts(): string[] {
    return this.host?.children
      .filter((child) => child.tagName === "style")
      .map((child) => child.textContent) ?? [];
  }
  elements(): StyleNode[] {
    return [this.documentElement, this.head, this.body]
      .flatMap((root) => [root, ...root.walk()])
      .filter((node) => !node.tagName.startsWith("#"));
  }
}

check("the same supplied QUID is legal in independent runtimes", () => {
  const left = _create_livetree_runtime_test_handle();
  const right = _create_livetree_runtime_test_handle();
  const leftNode = node("main", SAME_QUID);
  const rightNode = node("main", SAME_QUID);
  runtimeTree(left, leftNode);
  runtimeTree(right, rightNode);
  assert.equal(_lookup_livetree_runtime_test_node(left, SAME_QUID), leftNode);
  assert.equal(_lookup_livetree_runtime_test_node(right, SAME_QUID), rightNode);
});

check("duplicate supplied QUID admission is atomic within one runtime", () => {
  const runtime = _create_livetree_runtime_test_handle();
  runtimeTree(runtime, node("main", SAME_QUID));
  const before = _livetree_runtime_test_claim_count(runtime);
  assert.throws(() => runtimeTree(runtime, node("aside", SAME_QUID)), /Duplicate QUID/);
  assert.equal(_livetree_runtime_test_claim_count(runtime), before);
});

check("lookup never crosses runtime boundaries", () => {
  const left = _create_livetree_runtime_test_handle();
  const right = _create_livetree_runtime_test_handle();
  const tree = runtimeTree(left, node());
  assert.equal(_lookup_livetree_runtime_test_node(left, tree.quid), tree.node);
  assert.equal(_lookup_livetree_runtime_test_node(right, tree.quid), undefined);
});

check("generated QUID availability is runtime-local", () => {
  const left = _create_livetree_runtime_test_handle();
  const right = _create_livetree_runtime_test_handle();
  const generated = runtimeTree(left, node());
  const supplied = runtimeTree(right, node("aside", generated.quid));
  assert.equal(supplied.quid, generated.quid);
});

check("terminal destruction releases only the owning runtime claim", () => {
  const left = _create_livetree_runtime_test_handle();
  const right = _create_livetree_runtime_test_handle();
  const leftTree = runtimeTree(left, node("main", SAME_QUID));
  const rightTree = runtimeTree(right, node("main", SAME_QUID));
  assert.equal(leftTree.remove(), 1);
  assert.equal(_lookup_livetree_runtime_test_node(left, SAME_QUID), undefined);
  assert.equal(_lookup_livetree_runtime_test_node(right, SAME_QUID), rightTree.node);
});

check("detach retains identity and resources in its runtime", () => {
  const runtime = _create_livetree_runtime_test_handle();
  const parent = runtimeTree(runtime, node());
  const child = runtimeTree(runtime, node("section", SAME_QUID));
  parent.append(child);
  let cleaned = 0;
  _own_livetree_runtime_test_disposable(runtime, child.quid, () => { cleaned += 1; }, "other");
  assert.equal(child.detach(), 1);
  assert.equal(_lookup_livetree_runtime_test_node(runtime, child.quid), child.node);
  assert.equal(_livetree_runtime_test_resource_counts(runtime, child.quid).total, 1);
  assert.equal(cleaned, 0);
  parent.append(child);
  child.remove();
  assert.equal(cleaned, 1);
});

check("released supplied identity can be restored in the intended runtime", () => {
  const runtime = _create_livetree_runtime_test_handle();
  runtimeTree(runtime, node("main", SAME_QUID)).remove();
  assert.equal(runtimeTree(runtime, node("main", SAME_QUID)).quid, SAME_QUID);
});

check("clone is structural-only, fresh, and remains in the source runtime", () => {
  const runtime = _create_livetree_runtime_test_handle();
  const sourceNode = node();
  sourceNode.$_content.push(node("span"));
  const source = runtimeTree(runtime, sourceNode);
  const clone = source.cloneBranch();
  assert.notEqual(clone.quid, source.quid);
  assert.equal(_livetree_runtime_test_same_runtime(runtime, clone), true);
  assert.notEqual(clone.find.byTag("span")?.quid, source.find.byTag("span")?.quid);
});

check("cross-runtime append rejects without transferring either branch", () => {
  const left = _create_livetree_runtime_test_handle();
  const right = _create_livetree_runtime_test_handle();
  const target = runtimeTree(left, node());
  const branch = runtimeTree(right, node("aside"));
  assert.throws(() => target.append(branch), /another runtime scope/);
  assert.equal(target.content.count(), 0);
  assert.equal(_lookup_livetree_runtime_test_node(right, branch.quid), branch.node);
});

check("QUID-owned resource kinds are isolated across equal-valued claims", () => {
  const left = _create_livetree_runtime_test_handle();
  const right = _create_livetree_runtime_test_handle();
  const leftTree = runtimeTree(left, node("main", SAME_QUID));
  const rightTree = runtimeTree(right, node("main", SAME_QUID));
  const calls = { left: 0, right: 0 };
  for (const kind of ["listener", "binding", "tree-event", "resize-observer", "other"] as const) {
    _own_livetree_runtime_test_disposable(left, SAME_QUID, () => { calls.left += 1; }, kind);
    _own_livetree_runtime_test_disposable(right, SAME_QUID, () => { calls.right += 1; }, kind);
  }
  assert.equal(_livetree_runtime_test_resource_counts(left, SAME_QUID).total, 5);
  leftTree.remove();
  assert.deepEqual(calls, { left: 5, right: 0 });
  assert.equal(_livetree_runtime_test_resource_counts(right, SAME_QUID).total, 5);
  rightTree.remove();
  assert.deepEqual(calls, { left: 5, right: 5 });
});

check("one runtime supports many LiveTrees and ordinary QUID selectors in one Document", () => {
  const document = new StyleDocument();
  const runtime = _create_livetree_runtime_test_handle();
  const leftTree = runtimeTree(runtime, node("main", SAME_QUID));
  const rightTree = runtimeTree(runtime, node("aside", "0000000000000rt3"));
  const leftElement = projectInto(runtime, leftTree, document);
  const rightElement = projectInto(runtime, rightTree, document);
  leftTree.css.set.color("red");
  rightTree.css.set.color("blue");
  const texts = document.styleTexts();
  assert.equal(texts.length, 1);
  assert.match(texts[0] ?? "", new RegExp(`\\[hson\\\\:quid="${leftTree.quid}"\\]`));
  assert.match(texts[0] ?? "", new RegExp(`\\[hson\\\\:quid="${rightTree.quid}"\\]`));
  assertCleanProjection(leftElement);
  assertCleanProjection(rightElement);
  leftTree.remove();
  assert.equal(document.styleTexts().some((text) => text.includes("color: blue")), true);
  assert.equal(
    _livetree_runtime_test_css_manager(runtime).getForQuid(rightTree.quid, "color"),
    "blue",
  );
  rightTree.remove();
});

check("equal QUID CSS remains isolated across separate runtimes and Documents", () => {
  const leftDocument = new StyleDocument();
  const rightDocument = new StyleDocument();
  const left = _create_livetree_runtime_test_handle();
  const right = _create_livetree_runtime_test_handle();
  const leftTree = runtimeTree(left, node("main", SAME_QUID));
  const rightTree = runtimeTree(right, node("main", SAME_QUID));
  const leftElement = projectInto(left, leftTree, leftDocument);
  const rightElement = projectInto(right, rightTree, rightDocument);
  leftTree.css.set.opacity("0.4");
  rightTree.css.set.opacity("0.8");
  assert.match(leftDocument.styleTexts().join("\n"), /0\.4/);
  assert.doesNotMatch(leftDocument.styleTexts().join("\n"), /0\.8/);
  assert.match(rightDocument.styleTexts().join("\n"), /0\.8/);
  assertCleanProjection(leftElement);
  assertCleanProjection(rightElement);
  leftTree.remove();
  assert.match(rightDocument.styleTexts().join("\n"), /0\.8/);
  rightTree.remove();
});

check("keyframe ownership and cleanup are isolated across separate Documents", () => {
  const leftDocument = new StyleDocument();
  const rightDocument = new StyleDocument();
  const left = _create_livetree_runtime_test_handle();
  const right = _create_livetree_runtime_test_handle();
  const leftTree = runtimeTree(left, node("main", SAME_QUID));
  const rightTree = runtimeTree(right, node("main", SAME_QUID));
  projectInto(left, leftTree, leftDocument);
  projectInto(right, rightTree, rightDocument);
  const frames = { name: "pulse", steps: { from: { opacity: "0" }, to: { opacity: "1" } } } as const;
  const leftCss = _livetree_runtime_test_css_manager(left);
  const rightCss = _livetree_runtime_test_css_manager(right);
  leftCss.setOwnedKeyframesForQuid(SAME_QUID, frames);
  rightCss.setOwnedKeyframesForQuid(SAME_QUID, frames);
  assert.match(leftCss.renderCss(), /@keyframes pulse/);
  assert.match(rightCss.renderCss(), /@keyframes pulse/);
  leftTree.remove();
  assert.doesNotMatch(leftCss.renderCss(), /@keyframes/);
  assert.match(rightCss.renderCss(), /@keyframes/);
  rightTree.remove();
});

check("shared-Document projection rejects atomically and same-runtime registration is idempotent", () => {
  const document = new StyleDocument();
  const left = _create_livetree_runtime_test_handle();
  const right = _create_livetree_runtime_test_handle();
  const leftTree = runtimeTree(left, node("main", SAME_QUID));
  const rightTree = runtimeTree(right, node("aside", "0000000000000rt4"));
  projectInto(left, leftTree, document);
  leftTree.css.set.color("green");
  _own_livetree_runtime_test_disposable(left, leftTree.quid, () => undefined, "listener");
  _register_livetree_runtime_test_document(left, document as unknown as Document);
  _register_livetree_runtime_test_document(left, document as unknown as Document);

  const stylesBefore = document.styleTexts().join("\n");
  const elementsBefore = document.elements().length;
  const leftClaimsBefore = _livetree_runtime_test_claim_count(left);
  const leftResourcesBefore = _livetree_runtime_test_resource_counts(left, leftTree.quid);
  const rightClaimsBefore = _livetree_runtime_test_claim_count(right);

  assert.throws(
    () => _project_livetree_for_runtime_test(
      right,
      rightTree,
      document as unknown as Document,
    ),
    /already owned by another LiveTree runtime/,
  );
  assert.throws(
    () => _register_livetree_runtime_test_document(right, document as unknown as Document),
    /already owned by another LiveTree runtime/,
  );
  Reflect.set(globalThis, "document", document);
  assert.throws(
    () => rightTree.css.set.color("red"),
    /already owned by another LiveTree runtime/,
  );
  Reflect.deleteProperty(globalThis, "document");
  assert.equal(document.styleTexts().join("\n"), stylesBefore);
  assert.equal(document.elements().length, elementsBefore);
  assert.equal(_livetree_runtime_test_claim_count(left), leftClaimsBefore);
  assert.deepEqual(
    _livetree_runtime_test_resource_counts(left, leftTree.quid),
    leftResourcesBefore,
  );
  assert.equal(_livetree_runtime_test_claim_count(right), rightClaimsBefore);
  assert.equal(
    _livetree_runtime_test_css_manager(right).getForQuid(rightTree.quid, "color"),
    undefined,
  );
  assert.equal(rightTree.dom.el(), undefined);
  assert.equal(_livetree_runtime_test_owns_document(left, document as unknown as Document), true);
  assert.equal(_livetree_runtime_test_owns_document(right, document as unknown as Document), false);
  leftTree.remove();
  rightTree.remove();
});

check("disposing an inactive runtime releases its Document and style host", () => {
  const document = new StyleDocument();
  const first = _create_livetree_runtime_test_handle();
  const firstTree = runtimeTree(first, node());
  projectInto(first, firstTree, document);
  firstTree.css.set.color("purple");
  firstTree.remove();
  _dispose_livetree_runtime_test_handle(first);
  assert.equal(_livetree_runtime_test_owns_document(first, document as unknown as Document), false);
  assert.equal(document.styleTexts().length, 0);

  const second = _create_livetree_runtime_test_handle();
  const secondTree = runtimeTree(second, node());
  projectInto(second, secondTree, document);
  assert.equal(_livetree_runtime_test_owns_document(second, document as unknown as Document), true);
  secondTree.remove();
  _dispose_livetree_runtime_test_handle(second);
});

check("ambient Document changes do not clear an existing isolated runtime rule model", () => {
  const firstDocument = new StyleDocument();
  const secondDocument = new StyleDocument();
  const runtime = _create_livetree_runtime_test_handle();
  const tree = runtimeTree(runtime, node());
  projectInto(runtime, tree, firstDocument);
  Reflect.set(globalThis, "document", firstDocument);
  tree.css.set.color("purple");
  Reflect.set(globalThis, "document", secondDocument);
  tree.css.set.backgroundColor("black");
  assert.equal(tree.css.get.color(), "purple");
  assert.match(firstDocument.styleTexts().join("\n"), /purple/);
  assert.equal(secondDocument.styleTexts().length, 0);
  Reflect.deleteProperty(globalThis, "document");
  tree.remove();
});

check("a similar user-authored non-reserved scope spelling remains ordinary data content", () => {
  const document = new StyleDocument();
  const runtime = _create_livetree_runtime_test_handle();
  const value = node();
  value.$_attrs = { "data-hson-style-scope": "user-value" };
  const tree = runtimeTree(runtime, value);
  const element = projectInto(runtime, tree, document);
  assert.equal(element.getAttribute("data-hson-style-scope"), "user-value");
  assert.equal(tree.node.$_attrs?.["data-hson-style-scope"], "user-value");
  tree.remove();
  assert.equal(element.getAttribute("data-hson-style-scope"), "user-value");
});

check("creation, handles, append, batch, detach, reinsert, clone, restoration, and destruction add no runtime markup", () => {
  const document = new StyleDocument();
  const runtime = _create_livetree_runtime_test_handle();
  const rootNode = node("main");
  rootNode.$_content.push(node("span"));
  const root = runtimeTree(runtime, rootNode);
  const descendant = root.find.byTag("span");
  assert.equal(root.dom.el(), undefined);
  assert.equal(descendant?.dom.el(), undefined);

  const rootElement = projectInto(runtime, root, document);
  assertCleanProjection(rootElement);
  assert.equal(descendant?.dom.el()?.tagName.toLowerCase(), "span");

  const appended = runtimeTree(runtime, node("em"));
  root.append(appended);
  const batchA = runtimeTree(runtime, node("strong"));
  const batchB = runtimeTree(runtime, node("small"));
  _append_livetree_branches_atomic(root, [batchA, batchB]);
  appended.detach();
  root.append(appended);
  const clone = appended.cloneBranch();
  root.append(clone);
  assertCleanProjection(rootElement);
  assert.deepEqual(
    rootElement.walk().filter((item) => !item.tagName.startsWith("#")).map((item) => item.tagName),
    ["span", "strong", "small", "em", "em"],
  );

  const restoredQuid = "0000000000000rt5";
  const original = runtimeTree(runtime, node("section", restoredQuid));
  const originalElement = projectInto(runtime, original, document);
  original.remove();
  const restored = runtimeTree(runtime, node("section", restoredQuid));
  const restoredElement = projectInto(runtime, restored, document);
  assertCleanProjection(restoredElement);
  assert.equal(originalElement.getAttribute("hson:quid"), null);
  restored.remove();

  root.remove();
  assert.equal(rootElement.getAttribute("hson:quid"), null);
});

check("Reflect document and collection synchronization preserve clean projection markup", () => {
  const document = new StyleDocument();
  const runtime = _create_livetree_runtime_test_handle();
  const map = elementMap("<main <span/>/>");
  const binding = _reflect_document_for_runtime_test(runtime, map);
  const documentRoot = projectInto(runtime, binding.tree, document);
  map.document.content.insert(
    Object.freeze({ kind: "path", path: Object.freeze([0]) }),
    1,
    node("em"),
  );
  assertCleanProjection(documentRoot);
  assert.deepEqual(
    documentRoot.walk().filter((item) => !item.tagName.startsWith("#")).map((item) => item.tagName),
    ["span", "em"],
  );
  binding.dispose();
  binding.tree.remove();

  const host = runtimeTree(runtime, node("ul"));
  const hostElement = projectInto(runtime, host, document);
  const source = hson.liveMap.fromJson({
    items: [{ id: "a" }, { id: "b" }],
  });
  const projection = hson.reflect.collection<{ id: string }>({
    source: source.at(["items"]) as never,
    host,
    key: (item) => item.id,
    render: () => runtimeTree(runtime, node("li")),
  });
  assertCleanProjection(hostElement);
  assert.deepEqual(
    hostElement.walk().filter((item) => !item.tagName.startsWith("#")).map((item) => item.tagName),
    ["li", "li"],
  );
  projection.dispose();
  host.remove();
});

check("Reflect projects equal persisted QUIDs in separate runtimes", () => {
  const left = _create_livetree_runtime_test_handle();
  const right = _create_livetree_runtime_test_handle();
  const leftMap = elementMap(`<main @${SAME_QUID}/>`);
  const rightMap = elementMap(`<main @${SAME_QUID}/>`);
  const leftBinding = _reflect_document_for_runtime_test(left, leftMap);
  const rightBinding = _reflect_document_for_runtime_test(right, rightMap);
  assert.equal(leftBinding.tree.quid, SAME_QUID);
  assert.equal(rightBinding.tree.quid, SAME_QUID);
  leftBinding.dispose();
  assert.equal(leftBinding.tree.isDisposed, false);
  leftBinding.tree.remove();
  assert.equal(_lookup_livetree_runtime_test_node(right, SAME_QUID), rightBinding.tree.node);
  rightBinding.dispose();
  rightBinding.tree.remove();
});

check("Reflect same-runtime duplicate projection still rejects", () => {
  const runtime = _create_livetree_runtime_test_handle();
  const left = elementMap(`<main @${SAME_QUID}/>`);
  const right = elementMap(`<main @${SAME_QUID}/>`);
  const binding = _reflect_document_for_runtime_test(runtime, left);
  assert.throws(
    () => _reflect_document_for_runtime_test(runtime, right),
    /Initial LiveTree projection construction failed/,
  );
  binding.dispose();
  binding.tree.remove();
});

check("binding disposal and later tree destruction are separate and idempotent", () => {
  const runtime = _create_livetree_runtime_test_handle();
  const binding = _reflect_document_for_runtime_test(
    runtime,
    elementMap(`<main <span/>/>`),
  );
  binding.dispose();
  binding.dispose();
  assert.equal(binding.tree.isDisposed, false);
  assert.equal(binding.tree.remove(), 1);
  assert.equal(binding.tree.isDisposed, true);
  assert.equal(binding.tree.remove(), 0);
});

check("borrowed tree destruction stops its bridge and later binding disposal is safe", () => {
  const runtime = _create_livetree_runtime_test_handle();
  const map = elementMap(`<main @${SAME_QUID} <span/>/>`);
  const binding = _reflect_document_for_runtime_test(runtime, map);
  assert.equal(binding.tree.remove(), 1);
  assert.equal(binding.status, "disposed");
  assert.equal(map.element.node().$_tag, "main");
  binding.dispose();
  assert.equal(_lookup_livetree_runtime_test_node(runtime, SAME_QUID), undefined);
});

check("ordinary public LiveTree calls retain one compatibility runtime", () => {
  const first = hson.liveTree.fromHson(`<main @0000000000000rt2/>`);
  assert.throws(
    () => hson.liveTree.fromHson(`<aside @0000000000000rt2/>`),
    /Duplicate QUID/,
  );
  first.remove();
});

process.stdout.write(`LiveTree runtime scope acceptance: ${checks}/${checks}\n`);
emit_hson_live_test_completion("livetree.runtime-scope", checks, checks, 0);
