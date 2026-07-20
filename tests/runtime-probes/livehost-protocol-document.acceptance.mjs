import assert from "node:assert/strict";
import { decode_livehost_server_message, hson } from "../../src/index.ts";

let checks = 0;

function check(name, fn) {
  fn();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function commit(mode, ops) {
  return {
    logicalMapId: "map",
    incarnationId: "inc",
    mode,
    prevRev: 0,
    rev: 1,
    ops,
  };
}

function decode(value) {
  return decode_livehost_server_message(JSON.stringify({ type: "commit", id: "commit", commit: value }));
}

function element_root(source = `<main data-_quid="0000000000000001"/>`) {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "element") throw new Error(`Expected element, observed ${map.mode}`);
  return map.capture().root;
}

check("projected commits retain their exact data operation domain", () => {
  const valid = decode(commit("data-object", [{
    kind: "set",
    path: ["value"],
    prev: { present: true, value: 1 },
    next: { present: true, value: 2 },
  }]));
  assert.equal(valid.ok, true);

  const graphInData = decode(commit("data-object", [{
    domain: "graph",
    op: "remove-attr",
    target: { kind: "path", path: [] },
    name: "title",
  }]));
  assert.equal(graphInData.ok, false);
});

check("document commits decode graph operations without projected coercion", () => {
  const valid = decode(commit("element", [
    {
      domain: "graph",
      op: "set-attr",
      target: { kind: "quid", quid: "0000000000000001" },
      name: "style",
      value: { color: "red", _hover: { color: "blue" } },
    },
    {
      domain: "graph",
      op: "replace-content",
      target: { kind: "path", path: [] },
      index: 0,
      replacement: { $_tag: "span", $_meta: { "data-_quid": "0000000000000002" }, $_content: [] },
    },
    {
      domain: "graph",
      op: "insert-content",
      target: { kind: "path", path: [] },
      index: 1,
      content: "text",
    },
    {
      domain: "graph",
      op: "insert-content",
      target: { kind: "path", path: [] },
      index: 2,
      content: { $_tag: "aside", $_meta: { "data-_quid": "0000000000000003" }, $_content: [] },
    },
    {
      domain: "graph",
      op: "remove-content",
      target: { kind: "path", path: [] },
      index: 0,
    },
    {
      domain: "graph",
      op: "move-content",
      target: { kind: "path", path: [] },
      from: 0,
      to: 1,
    },
  ]));
  assert.equal(valid.ok, true);
  if (!valid.ok || valid.value.type !== "commit") throw new Error("Expected decoded commit");
  assert.equal(valid.value.commit.mode, "element");
  assert.equal(valid.value.commit.ops[0].domain, "graph");
});

check("replace-root requires canonical same-mode HSON and persisted identity", () => {
  const valid = decode(commit("element", [{
    domain: "graph",
    op: "replace-root",
    mode: "element",
    root: element_root(),
  }]));
  assert.equal(valid.ok, true);

  const fragment = hson.liveMap.fromHson(`"text"`);
  if (fragment.mode !== "fragment") throw new Error(`Expected fragment, observed ${fragment.mode}`);
  const mismatched = decode(commit("element", [{
    domain: "graph",
    op: "replace-root",
    mode: "element",
    root: fragment.capture().root,
  }]));
  assert.equal(mismatched.ok, false);

  const duplicateRoot = structuredClone(element_root(`<main data-_quid="0000000000000001" <p data-_quid="0000000000000002"/>/>`));
  const stack = [duplicateRoot];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node.$_tag === "p") node.$_meta["data-_quid"] = "0000000000000001";
    for (const child of node.$_content) if (typeof child === "object" && child !== null) stack.push(child);
  }
  const duplicate = decode(commit("element", [{
    domain: "graph",
    op: "replace-root",
    mode: "element",
    root: duplicateRoot,
  }]));
  assert.equal(duplicate.ok, false);
});

check("malformed graph targets, attributes, content, and mixed operations are rejected", () => {
  const invalidOps = [
    { domain: "graph", op: "remove-attr", target: { kind: "quid", quid: "short" }, name: "title" },
    { domain: "graph", op: "remove-attr", target: { kind: "path", path: [-1] }, name: "title" },
    { domain: "graph", op: "set-attr", target: { kind: "path", path: [] }, name: "data-_quid", value: "0000000000000002" },
    { domain: "graph", op: "set-attr", target: { kind: "path", path: [] }, name: "title", value: {} },
    { domain: "graph", op: "replace-content", target: { kind: "path", path: [] }, index: 0, replacement: { $_tag: "p", $_content: [], extra: true } },
    { domain: "graph", op: "insert-content", target: { kind: "path", path: [] }, index: -1, content: "x" },
    { domain: "graph", op: "insert-content", target: { kind: "path", path: [] }, index: 0, content: { $_tag: "p", $_content: [], extra: true } },
    { domain: "graph", op: "insert-content", target: { kind: "path", path: [] }, index: 0 },
    { domain: "graph", op: "remove-content", target: { kind: "path", path: [] }, index: 0, extra: true },
    { domain: "graph", op: "remove-content", target: { kind: "path", path: [] } },
    { domain: "graph", op: "move-content", target: { kind: "path", path: [] }, from: -1, to: 0 },
    { domain: "graph", op: "move-content", target: { kind: "path", path: [] }, from: 0, to: 0 },
    { domain: "graph", op: "move-content", target: { kind: "path", path: [] }, from: 0 },
    { domain: "graph", op: "move-content", target: { kind: "path", path: [] }, from: 0, to: 1, extra: true },
  ];
  for (const op of invalidOps) assert.equal(decode(commit("element", [op])).ok, false);

  const mixed = decode(commit("element", [
    { domain: "graph", op: "remove-attr", target: { kind: "path", path: [] }, name: "title" },
    { kind: "delete", path: ["value"], prev: { present: true, value: 1 }, next: { present: false } },
  ]));
  assert.equal(mixed.ok, false);
});

check("snapshot envelopes require one stable map mode", () => {
  const base = { logicalMapId: "map", incarnationId: "inc", rev: 0, hson: "<>" };
  const missing = decode_livehost_server_message(JSON.stringify({ type: "recovery-snapshot", id: "snapshot", snapshot: base }));
  assert.equal(missing.ok, false);
  for (const mode of ["data-object", "data-array", "element", "fragment"]) {
    const decoded = decode_livehost_server_message(JSON.stringify({
      type: "recovery-snapshot",
      id: "snapshot",
      snapshot: { ...base, mode },
    }));
    assert.equal(decoded.ok, true);
  }
});

process.stdout.write(`# ${checks} LiveHost document protocol checks passed\n`);
