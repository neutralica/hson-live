import assert from "node:assert/strict";

import * as publicApi from "../src/index.ts";
import { Hson, type HsonDocument } from "../src/index.ts";
import type { HsonCanonical } from "../src/api/transform/transform.types.ts";
import type { HsonNode } from "../src/core/types.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "hson.hson-document",
  title: "Exact HsonDocument semantic value",
  category: "Hson",
  runtime: "node",
  tags: Object.freeze(["document", "canonical", "immutability", "nominality"]),
});

const testEvents = create_test_event_emitter("hson.hson-document");
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

function canonical(source: string): HsonCanonical {
  return source as HsonCanonical;
}

function node(tag: string, content: HsonNode["$_content"] = []): HsonNode {
  return { $_tag: tag, $_content: content };
}

function root(...content: HsonNode[]): HsonNode {
  return node("_hson_root", content);
}

function str(value: string): HsonNode {
  return node("_hson_str", [value]);
}

function every_object_is_frozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (typeof value !== "object" || value === null || seen.has(value)) return true;
  seen.add(value);
  if (!Object.isFrozen(value)) return false;
  return Reflect.ownKeys(value).every((key) => {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    return descriptor === undefined || !("value" in descriptor)
      || every_object_is_frozen(descriptor.value, seen);
  });
}

check("document Hson constructs empty, one, many, text, quoted-empty, and mixed documents", () => {
  const fixtures = [
    canonical(""),
    Hson.canonical`<main/>`,
    Hson.canonical`<main/><aside/>`,
    Hson.canonical`"ordinary text"`,
    Hson.canonical`""`,
    Hson.document`"before"<main/>"after"`,
  ];
  const documents = fixtures.map((source) => Hson.document.fromHson(source));
  assert.deepEqual(documents.map((document) => Hson.document.toNode(document).$_content.length), [0, 1, 2, 1, 1, 3]);
  assert.equal(documents[0], "");
  assert.equal(documents[4], `""`);
  assert.notEqual(documents[0], documents[4]);
  for (const document of documents) {
    assert.equal(Hson.document.toNode(document).$_tag, "_hson_root");
    assert.equal(Hson.document.fromHson(document), document);
  }
});

check("attrs, structured style, metadata, and active QUID state retain exact closure", () => {
  const document = Hson.document.fromHson(
    Hson.canonical`<main @000000001 class="shell" hidden style="color: red; margin-top: 2" <span @000000002 "ready"/>/>`,
  );
  const first = Hson.document.toNode(document).$_content[0];
  assert.ok(typeof first === "object" && first !== null);
  assert.deepEqual(first.$_attrs, {
    class: "shell",
    hidden: "hidden",
    style: { color: "red", marginTop: "2" },
  });
  assert.deepEqual(first.$_meta, { quid: "000000001" });
  assert.match(document, /<main @000000001/);
  assert.match(document, /<span @000000002/);
  assert.equal(Hson.document.fromHson(document), document);
});

check("fromNode accepts only established document boundary shapes and always roots them", () => {
  const ordinary = node("main");
  const detachedText = str("text");
  const detachedCluster = node("_hson_elem", [node("header"), str("middle"), node("footer")]);
  const attachedCluster = root(node("_hson_elem", [node("main")]));
  const attachedDirect = root(node("main"), str("tail"));
  for (const input of [ordinary, detachedText, detachedCluster, attachedCluster, attachedDirect]) {
    const document = Hson.document.fromNode(input);
    assert.equal(Hson.document.toNode(document).$_tag, "_hson_root");
    assert.equal(Hson.document.fromHson(document), document);
  }
});

check("data and malformed structural graphs reject document admission", () => {
  const invalid: HsonNode[] = [
    node("_hson_obj"),
    node("_hson_arr"),
    node("_hson_ii", [str("x")]),
    node("_hson_val", [-0]),
    node("_hson_unknown"),
    node("_hson_str", []),
    node("_hson_elem", []),
    root(node("_hson_obj")),
    root(node("_hson_root")),
    { $_tag: "_hson_root", $_meta: { quid: "000000001" }, $_content: [] },
  ];
  for (const input of invalid) assert.throws(() => Hson.document.fromNode(input));
  for (const source of [Hson.canonical`<>`, Hson.canonical`[]`, Hson.canonical`true`, Hson.canonical`-0`]) {
    assert.throws(() => Hson.document.fromHson(source));
  }
  for (const source of [canonical(" "), canonical("\n"), canonical("// comment")]) {
    assert.throws(() => Hson.document.fromHson(source));
  }
});

check("fromNode rejects valid runtime graphs that are not exact notation values", () => {
  const runtimeAttrs = root({ $_tag: "main", $_attrs: { count: 2 }, $_content: [] });
  const rawStyleAttrs: NonNullable<HsonNode["$_attrs"]> = {};
  Reflect.set(rawStyleAttrs, "style", "color: red");
  const rawStyle = root({ $_tag: "main", $_attrs: rawStyleAttrs, $_content: [] });
  const typedStyle = root({
    $_tag: "main",
    $_attrs: { style: { width: { value: 2, unit: "px" } } },
    $_content: [],
  });
  const zeroStyle = root({ $_tag: "main", $_attrs: { style: { width: 0 } }, $_content: [] });
  const negativeZeroStyle = root({ $_tag: "main", $_attrs: { style: { width: -0 } }, $_content: [] });
  for (const input of [runtimeAttrs, rawStyle, typedStyle, zeroStyle, negativeZeroStyle]) {
    assert.throws(
      () => Hson.document.fromNode(input),
      /notation|attribute|style|closure/i,
    );
  }
});

check("descriptor-safe admission rejects cycles, accessors, sparse arrays, symbols, and prototypes", () => {
  const cyclic = root(node("main"));
  cyclic.$_content.push(cyclic);

  let getterRuns = 0;
  const accessor = node("main");
  Object.defineProperty(accessor, "$_attrs", {
    enumerable: true,
    get() {
      getterRuns += 1;
      return { id: "x" };
    },
  });

  const sparse = root(node("main"));
  sparse.$_content = Array(1);

  const symbol = root(node("main"));
  Object.defineProperty(symbol.$_content[0] as object, Symbol("surprise"), {
    value: true,
    enumerable: true,
  });

  class CustomNode {
    $_tag = "main";
    $_content: HsonNode["$_content"] = [];
  }

  const extra = root(node("main"));
  Reflect.set(extra.$_content[0] as object, "unexpected", true);

  for (const input of [cyclic, accessor, sparse, symbol, new CustomNode() as HsonNode, extra]) {
    assert.throws(() => Hson.document.fromNode(input));
  }
  assert.equal(getterRuns, 0);
});

check("invalid attr, metadata, and QUID structures reject", () => {
  const invalid: HsonNode[] = [
    root({ $_tag: "main", $_attrs: {}, $_content: [] }),
    root({ $_tag: "main", $_attrs: { "bad^name": "x" }, $_content: [] }),
    root({ $_tag: "main", $_meta: {}, $_content: [] }),
    root({ $_tag: "main", $_meta: { quid: "invalid" }, $_content: [] }),
    root({ $_tag: "main", $_meta: { index: "0" }, $_content: [] }),
  ];
  for (const input of invalid) assert.throws(() => Hson.document.fromNode(input));
});

check("construction owns and deeply freezes a graph without freezing caller state", () => {
  const style = { color: "red" };
  const attrs = { id: "original", style };
  const child = { $_tag: "main", $_attrs: attrs, $_content: [node("_hson_elem", [str("before")])] };
  const input = root(child);
  const document = Hson.document.fromNode(input);
  assert.equal(Object.isFrozen(input), false);
  assert.equal(Object.isFrozen(child), false);
  assert.equal(Object.isFrozen(attrs), false);
  assert.equal(Object.isFrozen(style), false);

  attrs.id = "changed";
  style.color = "blue";
  child.$_content.length = 0;
  input.$_content.length = 0;
  assert.equal(document, `<main id="original" style="color: red" "before"/>`);
  assert.equal(typeof document, "string");
  assert.equal(Object.isFrozen(document), true);
});

check("toNode returns independent mutable deep clones", () => {
  const document = Hson.document.fromHson(Hson.canonical`<main style="color: red" <span "ready"/>/>`);
  const first = Hson.document.toNode(document);
  const second = Hson.document.toNode(document);
  assert.notEqual(first, second);
  assert.notEqual(first.$_content, second.$_content);
  assert.notEqual(first.$_content[0], second.$_content[0]);
  assert.equal(Object.isFrozen(first), false);
  const firstMain = first.$_content[0];
  const secondMainBefore = second.$_content[0];
  assert.ok(typeof firstMain === "object" && firstMain !== null);
  assert.ok(typeof secondMainBefore === "object" && secondMainBefore !== null);
  assert.notEqual(firstMain.$_attrs, secondMainBefore.$_attrs);
  assert.notEqual(firstMain.$_attrs?.style, secondMainBefore.$_attrs?.style);
  if (firstMain.$_attrs?.style) Reflect.set(firstMain.$_attrs.style, "color", "blue");
  assert.equal(secondMainBefore.$_attrs?.style?.color, "red");
  first.$_content.length = 0;
  const secondMain = second.$_content[0];
  assert.ok(typeof secondMain === "object" && secondMain !== null);
  secondMain.$_tag = "changed";
  assert.equal(document, `<main style="color: red"\n  <span "ready"/>\n/>`);
  assert.equal(Hson.document.fromHson(document), document);
});

check("public document values are primitive strings with validated helper boundaries", () => {
  const genuine = Hson.document.fromHson(Hson.canonical`<main/>`);
  assert.equal(typeof genuine, "string");
  assert.equal(Object.hasOwn(publicApi, "HsonDocument"), false);
  assert.throws(() => Hson.document.toNode({ value: genuine } as unknown as HsonDocument));
  const forged = "<main  />" as HsonDocument;
  assert.throws(() => Hson.document.fromHson(forged), /canonical/);
  assert.throws(() => Hson.document.toNode(forged), /canonical/);
});

check("equality uses exact canonical graph distinctions", () => {
  const exact = Hson.document.fromHson(Hson.canonical`<a id="x"/><b/>`);
  assert.equal(exact, Hson.document.fromHson(exact));
  assert.notEqual(exact, Hson.document`<b/><a id="x"/>`);
  assert.notEqual(exact, Hson.document`<a id="y"/><b/>`);
  assert.notEqual(Hson.document.fromHson(canonical("")), Hson.document`""`);
  assert.notEqual(Hson.document.fromNode(root(str("a"), str("b"))), Hson.document.fromNode(root(str("ab"))));
  assert.notEqual(Hson.document`<box/>`, Hson.document`<box ""/>`);
  assert.notEqual(Hson.document`<main @000000001/>`, Hson.document`<main/>`);
  assert.notEqual(Hson.document`<main @000000001/>`, Hson.document`<main @000000002/>`);
});

check("every accepted fixture has total exact readable serialization closure", () => {
  const fixtures = [
    Hson.document.fromHson(canonical("")),
    Hson.document.fromHson(Hson.canonical`<main/>`),
    Hson.document.fromHson(Hson.canonical`<main/><aside/>`),
    Hson.document.fromHson(Hson.canonical`"text"`),
    Hson.document.fromHson(Hson.canonical`""`),
    Hson.document`"a"<b/>"c"`,
    Hson.document.fromHson(Hson.canonical`<main @000000001 id="x" style="color: red"/>`),
    Hson.document.fromNode(root(str("a"), str("b"))),
  ];
  for (const document of fixtures) {
    const source = document;
    assert.equal(typeof source, "string");
    assert.equal(Hson.document.fromHson(source), document);
  }
  assert.equal(fixtures[2], "<main/>\n<aside/>");
  assert.doesNotMatch(fixtures[2] ?? "", /_hson_root/);
});

check("the core value has no DOM dependency or browser-realization surface", () => {
  const document = Hson.document.fromHson(Hson.canonical`<main/>`);
  for (const name of ["fromTrustedHtml", "fromUntrustedHtml", "toHtml", "toBrowserHtml", "toDom"]) {
    assert.equal(name in Hson.document, false);
    assert.equal(name in Object(document), false);
  }
});

process.stdout.write(`1..${checks}\n`);
testEvents.terminal("pass");
