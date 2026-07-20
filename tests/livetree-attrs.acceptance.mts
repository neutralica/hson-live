import assert from "node:assert/strict";
import {
  hson,
  LIVETREE_ATTRIBUTE_NOT_FOUND_ERROR_CODE,
  LIVETREE_INVALID_ATTRIBUTE_NAME_ERROR_CODE,
  LIVETREE_INVALID_ATTRIBUTE_VALUE_ERROR_CODE,
  LIVETREE_PROTECTED_ATTRIBUTE_ERROR_CODE,
  LiveTreeAttributeError,
} from "../src/index.ts";
import type { LiveTree } from "../src/api/livetree/livetree.ts";
import { link_node_to_el } from "../src/api/livetree/utils/node-map-helpers.ts";

let checks = 0;
function check(name: string, fn: () => void): void {
  fn();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

class AttributeProjection {
  readonly values = new Map<string, string>();

  setAttribute(name: string, value: string): void {
    this.values.set(name, value);
  }

  removeAttribute(name: string): void {
    this.values.delete(name);
  }

  getAttribute(name: string): string | null {
    return this.values.get(name) ?? null;
  }

  getAttributeNames(): string[] {
    return [...this.values.keys()];
  }
}

function tree(source = `<main/>`): LiveTree {
  return hson.liveTree.fromHson(source);
}

function mount(treeValue: LiveTree): AttributeProjection {
  const element = new AttributeProjection();
  element.setAttribute("data-_quid", treeValue.quid);
  link_node_to_el(treeValue.node, element as unknown as Element);
  return element;
}

function errorCode(fn: () => unknown, code: string, operation?: string): void {
  assert.throws(fn, (cause) => cause instanceof LiveTreeAttributeError
    && cause.code === code
    && (operation === undefined || cause.operation === operation));
}

function snapshot(treeValue: LiveTree, element: AttributeProjection): unknown {
  return {
    node: structuredClone(treeValue.node),
    dom: [...element.values.entries()].sort(([left], [right]) => left.localeCompare(right)),
  };
}

check("canonical reads preserve primitives and detach structured style", () => {
  const value = tree();
  value.attrs.replace({
    empty: "",
    enabled: true,
    disabled: false,
    positive: 9,
    zero: 0,
    nullable: null,
    style: { color: "red", width: { value: 2, unit: "px" } },
  });
  assert.equal(value.attrs.get("empty"), "");
  assert.equal(value.attrs.get("enabled"), true);
  assert.equal(value.attrs.get("disabled"), false);
  assert.equal(value.attrs.get("positive"), 9);
  assert.equal(value.attrs.get("zero"), 0);
  assert.equal(value.attrs.get("nullable"), null);
  assert.equal(value.attrs.get("missing"), undefined);
  for (const name of ["empty", "disabled", "zero", "nullable"]) {
    assert.equal(value.attrs.has(name), true);
  }
  assert.equal(value.attrs.has("missing"), false);

  const style = value.attrs.get("style");
  const styleAgain = value.attrs.get("style");
  assert.deepEqual(style, { color: "red", width: { value: 2, unit: "px" } });
  assert.notEqual(style, styleAgain);
  assert.equal(Object.isFrozen(style), true);
  assert.equal(typeof style === "object" && style !== null && Object.isFrozen(style.width), true);
  assert.equal(Reflect.set(style as object, "color", "purple"), false);
  assert.deepEqual(value.attrs.get("style"), { color: "red", width: { value: 2, unit: "px" } });
});

check("keys is lexical, fresh, frozen, and excludes flags and metadata", () => {
  const value = tree(`<button disabled data-_quid="0000000000000201"/>`);
  value.attrs.setMany({ zeta: 1, alpha: 2, style: { color: "red" } });
  const first = value.attrs.keys();
  const second = value.attrs.keys();
  assert.deepEqual(first, ["alpha", "style", "zeta"]);
  assert.notEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(first.includes("disabled"), false);
  assert.equal(first.includes("data-_quid"), false);
  assert.equal(Reflect.set(first as string[], 0, "changed"), false);
  assert.deepEqual(value.attrs.keys(), ["alpha", "style", "zeta"]);
});

check("must.get has stable frozen identity and one structured absence error", () => {
  const value = tree(`<main id="present"/>`);
  assert.equal(value.attrs.must, value.attrs.must);
  assert.equal(Object.isFrozen(value.attrs.must), true);
  assert.equal(value.attrs.must.get("id"), "present");
  assert.throws(
    () => value.attrs.must.get("missing"),
    (cause) => cause instanceof LiveTreeAttributeError
      && cause.code === LIVETREE_ATTRIBUTE_NOT_FOUND_ERROR_CODE
      && cause.operation === "must.get"
      && cause.attributeName === "missing"
      && cause.quid === value.quid,
  );
  errorCode(() => value.attrs.must.get("bad name"), LIVETREE_INVALID_ATTRIBUTE_NAME_ERROR_CODE, "must.get");
  errorCode(() => value.attrs.must.get("data-_quid"), LIVETREE_PROTECTED_ATTRIBUTE_ERROR_CODE, "must.get");
});

check("set stores false, null, zero, and empty string while undefined is rejected", () => {
  const value = tree(`<main title="before"/>`);
  const element = mount(value);
  assert.equal(value.attrs.set("title", false), value);
  assert.equal(value.attrs.get("title"), false);
  assert.equal(value.attrs.has("title"), true);
  assert.equal(element.getAttribute("title"), "false");
  value.attrs.set("nullable", null);
  value.attrs.set("zero", 0);
  value.attrs.set("empty", "");
  value.attrs.set("enabled", true);
  assert.equal(value.attrs.get("nullable"), null);
  assert.equal(value.attrs.get("zero"), 0);
  assert.equal(value.attrs.get("empty"), "");
  assert.equal(element.getAttribute("nullable"), "null");
  assert.equal(element.getAttribute("zero"), "0");
  assert.equal(element.getAttribute("empty"), "");
  assert.equal(element.getAttribute("enabled"), "true");

  const unchangedIdentity = value.node.$_attrs;
  value.attrs.set("zero", 0);
  assert.equal(value.node.$_attrs, unchangedIdentity);

  const before = snapshot(value, element);
  errorCode(
    () => Reflect.apply(value.attrs.set, value.attrs, ["bad", undefined]),
    LIVETREE_INVALID_ATTRIBUTE_VALUE_ERROR_CODE,
    "set",
  );
  assert.deepEqual(snapshot(value, element), before);
});

check("set validates names, style, and protected metadata before graph or DOM mutation", () => {
  const value = tree(`<main id="before"/>`);
  const element = mount(value);
  element.setAttribute("id", "before");
  for (const [name, attrValue, code] of [
    ["bad name", "x", LIVETREE_INVALID_ATTRIBUTE_NAME_ERROR_CODE],
    ["data-_quid", "x", LIVETREE_PROTECTED_ATTRIBUTE_ERROR_CODE],
    ["style", { _hover: { color: "blue" } }, LIVETREE_INVALID_ATTRIBUTE_VALUE_ERROR_CODE],
    ["count", Number.NaN, LIVETREE_INVALID_ATTRIBUTE_VALUE_ERROR_CODE],
  ] as const) {
    const before = snapshot(value, element);
    errorCode(() => Reflect.apply(value.attrs.set, value.attrs, [name, attrValue]), code);
    assert.deepEqual(snapshot(value, element), before);
  }
});

check("inline style accepts typed leaves and rejects stylesheet maps atomically", () => {
  const value = tree(`<main id="before"/>`);
  const element = mount(value);
  value.attrs.set("style", { width: { value: 2, unit: "px" }, opacity: 0.5 });
  assert.deepEqual(value.attrs.get("style"), { opacity: 0.5, width: { value: 2, unit: "px" } });
  assert.equal(element.getAttribute("style"), "opacity: 0.5; width: 2px");

  for (const style of [
    { _hover: { color: "blue" } },
    { __before: { content: '"x"' } },
    { "& .child": { color: "blue" } },
  ]) {
    const before = snapshot(value, element);
    errorCode(
      () => Reflect.apply(value.attrs.setMany, value.attrs, [{ title: "must-not-apply", style }]),
      LIVETREE_INVALID_ATTRIBUTE_VALUE_ERROR_CODE,
      "setMany",
    );
    assert.deepEqual(snapshot(value, element), before);
  }
});

check("inline style manager shares typed leaf rendering and rejects nested rules before writes", () => {
  const priorElement = Reflect.get(globalThis, "Element");
  Reflect.set(globalThis, "Element", class {});
  try {
    const value = tree();
    value.style.setProp("width", { value: 2, unit: "px" });
    assert.deepEqual(value.attrs.get("style"), { width: "2px" });
    const before = JSON.stringify(value.node);
    for (const map of [
      { color: "must-not-apply", _hover: { color: "blue" } },
      { color: "must-not-apply", __before: { content: '"x"' } },
      { color: "must-not-apply", "& .child": { color: "blue" } },
    ]) {
      assert.throws(
        () => Reflect.apply(value.style.setMany, value.style, [map]),
        /Inline style does not support (pseudo|selector) declarations/,
      );
      assert.equal(JSON.stringify(value.node), before);
    }
  } finally {
    if (priorElement === undefined) Reflect.deleteProperty(globalThis, "Element");
    else Reflect.set(globalThis, "Element", priorElement);
  }
});

check("setMany overlays atomically and canonical equality is order-insensitive", () => {
  const value = tree(`<main id="before" title="kept"/>`);
  const element = mount(value);
  value.attrs.setMany({ id: "after", hidden: false, count: 0, style: { color: "red" } });
  assert.deepEqual(value.attrs.keys(), ["count", "hidden", "id", "style", "title"]);
  assert.equal(value.attrs.get("title"), "kept");
  assert.equal(value.attrs.get("hidden"), false);
  assert.equal(element.getAttribute("hidden"), "false");
  assert.equal(element.getAttribute("style"), "color: red");

  const attrsIdentity = value.node.$_attrs;
  value.attrs.setMany({ style: { color: "red" }, count: 0, id: "after", hidden: false });
  assert.equal(value.node.$_attrs, attrsIdentity);

  const before = snapshot(value, element);
  errorCode(
    () => Reflect.apply(value.attrs.setMany, value.attrs, [{ good: "x", "bad name": "x" }]),
    LIVETREE_INVALID_ATTRIBUTE_NAME_ERROR_CODE,
    "setMany",
  );
  assert.deepEqual(snapshot(value, element), before);
});

check("drop and dropMany remove only explicit ordinary names atomically", () => {
  const value = tree(`<main id="one" title="two" class="three" data-_quid="0000000000000202"/>`);
  const element = mount(value);
  for (const [name, attrValue] of Object.entries(value.node.$_attrs ?? {})) {
    element.setAttribute(name, String(attrValue));
  }
  value.attrs.drop("id");
  const afterDrop = value.node.$_attrs;
  value.attrs.drop("absent");
  assert.equal(value.node.$_attrs, afterDrop);
  value.attrs.dropMany(["title", "absent", "title"]);
  assert.deepEqual(value.attrs.keys(), ["class"]);
  assert.equal(element.getAttribute("id"), null);
  assert.equal(element.getAttribute("title"), null);
  assert.equal(element.getAttribute("data-_quid"), value.quid);

  const before = snapshot(value, element);
  errorCode(
    () => Reflect.apply(value.attrs.dropMany, value.attrs, [["class", "data-_quid"]]),
    LIVETREE_PROTECTED_ATTRIBUTE_ERROR_CODE,
    "dropMany",
  );
  assert.deepEqual(snapshot(value, element), before);
  errorCode(() => value.attrs.drop("bad name"), LIVETREE_INVALID_ATTRIBUTE_NAME_ERROR_CODE, "drop");
  errorCode(() => value.attrs.drop("data-_index"), LIVETREE_PROTECTED_ATTRIBUTE_ERROR_CODE, "drop");
});

check("clear preserves flags, identity, metadata, tag, and content", () => {
  const value = tree(`<button disabled id="ordinary" data-_quid="0000000000000203" "content"/>`);
  const element = mount(value);
  element.setAttribute("disabled", "disabled");
  element.setAttribute("id", "ordinary");
  const beforeTag = value.node.$_tag;
  const beforeContent = structuredClone(value.node.$_content);
  const beforeMeta = structuredClone(value.node.$_meta);
  value.attrs.clear();
  assert.deepEqual(value.attrs.keys(), []);
  assert.equal(value.flags.has("disabled"), true);
  assert.equal(value.node.$_attrs?.disabled, "disabled");
  assert.equal(element.getAttribute("disabled"), "disabled");
  assert.equal(element.getAttribute("id"), null);
  assert.equal(element.getAttribute("data-_quid"), value.quid);
  assert.equal(value.node.$_tag, beforeTag);
  assert.deepEqual(value.node.$_content, beforeContent);
  assert.deepEqual(value.node.$_meta, beforeMeta);

  const empty = tree();
  assert.equal(empty.attrs.clear(), empty);
  assert.equal(empty.node.$_attrs, undefined);
});

check("replace applies one exact ordinary bag while retaining flags and canonical distinctions", () => {
  const value = tree(`<button disabled id="old" title="remove"/>`);
  const element = mount(value);
  element.setAttribute("disabled", "disabled");
  element.setAttribute("id", "old");
  element.setAttribute("title", "remove");
  const input = {
    nullable: null,
    zero: 0,
    empty: "",
    hidden: false,
    style: { color: "blue" },
    added: "yes",
  };
  value.attrs.replace(input);
  input.style.color = "mutated";
  assert.deepEqual(value.attrs.keys(), ["added", "empty", "hidden", "nullable", "style", "zero"]);
  assert.equal(value.attrs.get("nullable"), null);
  assert.equal(value.attrs.get("hidden"), false);
  assert.deepEqual(value.attrs.get("style"), { color: "blue" });
  assert.equal(value.flags.has("disabled"), true);
  assert.equal(element.getAttribute("id"), null);
  assert.equal(element.getAttribute("title"), null);
  assert.equal(element.getAttribute("disabled"), "disabled");
  assert.equal(element.getAttribute("style"), "color: blue");

  const attrsIdentity = value.node.$_attrs;
  value.attrs.replace({ added: "yes", style: { color: "blue" }, hidden: false, empty: "", zero: 0, nullable: null });
  assert.equal(value.node.$_attrs, attrsIdentity);

  const beforeInvalid = snapshot(value, element);
  errorCode(
    () => Reflect.apply(value.attrs.replace, value.attrs, [{ kept: "x", style: { color: [] } }]),
    LIVETREE_INVALID_ATTRIBUTE_VALUE_ERROR_CODE,
    "replace",
  );
  assert.deepEqual(snapshot(value, element), beforeInvalid);

  value.attrs.replace({});
  assert.deepEqual(value.attrs.keys(), []);
  assert.equal(value.node.$_attrs?.disabled, "disabled");
});

check("attrs and flags remain separate when one name changes ownership", () => {
  const value = tree();
  value.flags.set("hidden");
  assert.equal(value.flags.has("hidden"), true);
  assert.equal(value.attrs.has("hidden"), false);
  value.attrs.set("hidden", false);
  assert.equal(value.attrs.has("hidden"), true);
  assert.equal(value.attrs.get("hidden"), false);
  const element = mount(value);
  value.attrs.set("disabled", true);
  assert.equal(value.attrs.get("disabled"), true);
  assert.equal(value.flags.has("disabled"), false);
  assert.equal(element.getAttribute("disabled"), "true");
  value.flags.clear("hidden");
  assert.equal(value.attrs.has("hidden"), true);
  assert.equal(value.attrs.get("hidden"), false);
});

process.stdout.write(`# ${checks} LiveTree canonical attrs checks passed\n`);
