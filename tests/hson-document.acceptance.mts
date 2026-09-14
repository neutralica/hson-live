import assert from "node:assert/strict";

import { Hson, HsonDocument } from "../src/index.ts";
import { hson_document_root } from "../src/api/document/hson-document.ts";
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
    Hson`<main/>`,
    Hson`<main/><aside/>`,
    Hson`"ordinary text"`,
    Hson`""`,
    canonical(`"before"<main/>"after"`),
  ];
  const documents = fixtures.map((source) => HsonDocument.fromHson(source));
  assert.deepEqual(documents.map((document) => document.toNode().$_content.length), [0, 1, 2, 1, 1, 3]);
  assert.equal(documents[0]?.toHson(), "");
  assert.equal(documents[4]?.toHson(), `""`);
  assert.equal(documents[0]?.equals(documents[4] as HsonDocument), false);
  for (const document of documents) {
    assert.equal(document.toNode().$_tag, "_hson_root");
    assert.equal(HsonDocument.fromHson(document.toHson()).equals(document), true);
  }
});

check("attrs, structured style, metadata, and active QUID state retain exact closure", () => {
  const document = HsonDocument.fromHson(
    Hson`<main @000000001 class="shell" hidden style="color: red; margin-top: 2" <span @000000002 "ready"/>/>`,
  );
  const first = document.toNode().$_content[0];
  assert.ok(typeof first === "object" && first !== null);
  assert.deepEqual(first.$_attrs, {
    class: "shell",
    hidden: "hidden",
    style: { color: "red", marginTop: "2" },
  });
  assert.deepEqual(first.$_meta, { quid: "000000001" });
  assert.match(document.toHson(), /<main @000000001/);
  assert.match(document.toHson(), /<span @000000002/);
  assert.equal(HsonDocument.fromHson(document.toHson()).equals(document), true);
});

check("fromNode accepts only established document boundary shapes and always roots them", () => {
  const ordinary = node("main");
  const detachedText = str("text");
  const detachedCluster = node("_hson_elem", [node("header"), str("middle"), node("footer")]);
  const attachedCluster = root(node("_hson_elem", [node("main")]));
  const attachedDirect = root(node("main"), str("tail"));
  for (const input of [ordinary, detachedText, detachedCluster, attachedCluster, attachedDirect]) {
    const document = HsonDocument.fromNode(input);
    assert.equal(document.toNode().$_tag, "_hson_root");
    assert.equal(HsonDocument.fromHson(document.toHson()).equals(document), true);
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
  for (const input of invalid) assert.throws(() => HsonDocument.fromNode(input));
  for (const source of [Hson`<>`, Hson`[]`, Hson`true`, Hson`-0`]) {
    assert.throws(() => HsonDocument.fromHson(source));
  }
  for (const source of [canonical(" "), canonical("\n"), canonical("// comment")]) {
    assert.throws(() => HsonDocument.fromHson(source));
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
      () => HsonDocument.fromNode(input),
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
    assert.throws(() => HsonDocument.fromNode(input));
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
  for (const input of invalid) assert.throws(() => HsonDocument.fromNode(input));
});

check("construction owns and deeply freezes a graph without freezing caller state", () => {
  const style = { color: "red" };
  const attrs = { id: "original", style };
  const child = { $_tag: "main", $_attrs: attrs, $_content: [node("_hson_elem", [str("before")])] };
  const input = root(child);
  const document = HsonDocument.fromNode(input);
  assert.equal(Object.isFrozen(input), false);
  assert.equal(Object.isFrozen(child), false);
  assert.equal(Object.isFrozen(attrs), false);
  assert.equal(Object.isFrozen(style), false);

  attrs.id = "changed";
  style.color = "blue";
  child.$_content.length = 0;
  input.$_content.length = 0;
  assert.equal(document.toHson(), `<main id="original" style="color: red" "before"/>`);
  assert.equal(every_object_is_frozen(hson_document_root(document)), true);
  assert.equal(Object.isFrozen(document), true);
});

check("toNode returns independent mutable deep clones", () => {
  const document = HsonDocument.fromHson(Hson`<main style="color: red" <span "ready"/>/>`);
  const first = document.toNode();
  const second = document.toNode();
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
  assert.equal(document.toHson(), `<main style="color: red"\n  <span "ready"/>\n/>`);
  assert.equal(HsonDocument.fromHson(document.toHson()).equals(document), true);
});

check("runtime and TypeScript nominality cannot be forged structurally", () => {
  const genuine = HsonDocument.fromHson(Hson`<main/>`);
  const structural = {
    equals: genuine.equals,
    toHson: genuine.toHson,
    toNode: genuine.toNode,
  };
  assert.equal(genuine.equals(structural as HsonDocument), false);
  assert.throws(() => structural.toHson());
  assert.throws(() => Object.create(HsonDocument.prototype).toNode(), /genuine HsonDocument/);
  assert.throws(() => Reflect.construct(HsonDocument, [root(node("main"))]), /construction is controlled/);
  assert.deepEqual(Object.keys(genuine), []);
  assert.deepEqual(Object.getOwnPropertySymbols(genuine), []);
  assert.equal("root" in genuine, false);
});

check("the public runtime shape is the approved minimal class surface", () => {
  assert.deepEqual(
    Object.getOwnPropertyNames(HsonDocument).sort(),
    ["fromHson", "fromNode", "length", "name", "prototype"].sort(),
  );
  assert.deepEqual(
    Object.getOwnPropertyNames(HsonDocument.prototype).sort(),
    ["constructor", "equals", "toHson", "toNode"].sort(),
  );
});

check("equality uses exact canonical graph distinctions", () => {
  const exact = HsonDocument.fromHson(Hson`<a id="x"/><b/>`);
  assert.equal(exact.equals(HsonDocument.fromHson(exact.toHson())), true);
  assert.equal(exact.equals(HsonDocument.fromHson(Hson`<b/><a id="x"/>`)), false);
  assert.equal(exact.equals(HsonDocument.fromHson(Hson`<a id="y"/><b/>`)), false);
  assert.equal(HsonDocument.fromHson(canonical("")).equals(HsonDocument.fromHson(Hson`""`)), false);
  assert.equal(
    HsonDocument.fromNode(root(str("a"), str("b"))).equals(HsonDocument.fromNode(root(str("ab")))),
    false,
  );
  assert.equal(HsonDocument.fromHson(Hson`<box/>`).equals(HsonDocument.fromHson(Hson`<box ""/>`)), false);
  assert.equal(
    HsonDocument.fromHson(Hson`<main @000000001/>`).equals(HsonDocument.fromHson(Hson`<main/>`)),
    false,
  );
  assert.equal(
    HsonDocument.fromHson(Hson`<main @000000001/>`).equals(HsonDocument.fromHson(Hson`<main @000000002/>`)),
    false,
  );
});

check("every accepted fixture has total exact readable serialization closure", () => {
  const fixtures = [
    HsonDocument.fromHson(canonical("")),
    HsonDocument.fromHson(Hson`<main/>`),
    HsonDocument.fromHson(Hson`<main/><aside/>`),
    HsonDocument.fromHson(Hson`"text"`),
    HsonDocument.fromHson(Hson`""`),
    HsonDocument.fromHson(canonical(`"a"<b/>"c"`)),
    HsonDocument.fromHson(Hson`<main @000000001 id="x" style="color: red"/>`),
    HsonDocument.fromNode(root(str("a"), str("b"))),
  ];
  for (const document of fixtures) {
    const source = document.toHson();
    assert.equal(typeof source, "string");
    assert.equal(HsonDocument.fromHson(source).equals(document), true);
  }
  assert.equal(fixtures[2]?.toHson(), "<main/>\n<aside/>");
  assert.doesNotMatch(fixtures[2]?.toHson() ?? "", /_hson_root/);
});

check("the core value has no DOM dependency or browser-realization surface", () => {
  const document = HsonDocument.fromHson(Hson`<main/>`);
  for (const name of ["fromTrustedHtml", "fromUntrustedHtml", "toHtml", "toBrowserHtml", "toDom"]) {
    assert.equal(name in HsonDocument, false);
    assert.equal(name in document, false);
  }
});

process.stdout.write(`1..${checks}\n`);
testEvents.terminal("pass");
