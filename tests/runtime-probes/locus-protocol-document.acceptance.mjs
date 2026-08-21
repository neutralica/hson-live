import { emit_hson_live_test_completion } from "../launcher-completion.mjs";
import assert from "node:assert/strict";
import { decode_locus_message, decode_locus_server_message, encode_locus_message, hson } from "../../src/index.ts";
import { encode_locus_graph_content } from "../../src/api/locus/locus.graph-content-codec.ts";

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
  return decode_locus_server_message(JSON.stringify({ type: "commit", id: "commit", commit: value }));
}

function element_root(source = `<main @000000001/>`) {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "element") throw new Error(`Expected element, observed ${map.mode}`);
  return map.capture().root;
}

check("current server message encoding closes through the sole server decoder", () => {
  const message = { type: "event", event: "application.notice", payload: { exact: true, values: [0, null, ""] } };
  const decoded = decode_locus_server_message(encode_locus_message(message));
  assert.equal(decoded.ok, true);
  assert.deepEqual(decoded.ok && decoded.value, message);
});

check("hello rejects the removed hostId field", () => {
  const withoutHostId = decode_locus_message(JSON.stringify({ type: "hello", clientId: "client-a" }));
  const withHostId = decode_locus_message(JSON.stringify({ type: "hello", clientId: "client-a", hostId: "ignored-route" }));
  assert.equal(withoutHostId.ok, true);
  assert.equal(withHostId.ok, false);
  assert.equal(withoutHostId.ok && withoutHostId.value.clientId, "client-a");
});

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

check("document commits decode only current canonical path targets", () => {
  const valid = decode(commit("element", [
    {
      domain: "graph",
      op: "set-attr",
      target: { kind: "path", path: [], witness: { quid: "000000001" } },
      name: "style",
      value: { color: "red", _hover: { color: "blue" } },
    },
    {
      domain: "graph",
      op: "replace-attrs",
      target: { kind: "path", path: [] },
      attrs: { count: 0, hidden: false, nullable: null, style: { color: "red" }, title: "next" },
    },
    {
      domain: "graph",
      op: "replace-content",
      target: { kind: "path", path: [] },
      index: 0,
      replacement: encode_locus_graph_content({ $_tag: "span", $_meta: { quid: "000000002" }, $_content: [] }),
    },
    {
      domain: "graph",
      op: "insert-content",
      target: { kind: "path", path: [] },
      index: 1,
      content: encode_locus_graph_content("text"),
    },
    {
      domain: "graph",
      op: "insert-content",
      target: { kind: "path", path: [] },
      index: 2,
      content: encode_locus_graph_content({ $_tag: "aside", $_meta: { quid: "000000003" }, $_content: [] }),
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

check("QUID-only canonical recovery input rejects", () => {
  const legacy = commit("fragment", [{
    domain: "graph",
    op: "replace-attrs",
    target: { kind: "quid", quid: "000000001" },
    attrs: { hidden: false, style: { color: "red" }, title: "recovered" },
  }]);
  const decoded = decode_locus_server_message(JSON.stringify({
    type: "recovery-commit",
    id: "replace-attrs-recovery",
    phase: "body",
    commit: legacy,
  }));
  assert.equal(decoded.ok, false);
});

check("replace-root requires canonical same-mode HSON and persisted identity", () => {
  const valid = decode(commit("element", [{
    domain: "graph",
    op: "replace-root",
    mode: "element",
    root: encode_locus_graph_content(element_root()),
  }]));
  assert.equal(valid.ok, true);

  const fragment = hson.liveMap.fromHson(`"text"`);
  if (fragment.mode !== "fragment") throw new Error(`Expected fragment, observed ${fragment.mode}`);
  const mismatched = decode(commit("element", [{
    domain: "graph",
    op: "replace-root",
    mode: "element",
    root: encode_locus_graph_content(fragment.capture().root),
  }]));
  assert.equal(mismatched.ok, false);

  const duplicateRoot = structuredClone(element_root(`<main @000000001 <p @000000002/>/>`));
  const stack = [duplicateRoot];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node.$_tag === "p") node.$_meta["quid"] = "000000001";
    for (const child of node.$_content) if (typeof child === "object" && child !== null) stack.push(child);
  }
  const duplicatePayload = encode_locus_graph_content(
    element_root(`<main @000000001 <p @000000002/>/>`),
  );
  const duplicate = decode(commit("element", [{
    domain: "graph",
    op: "replace-root",
    mode: "element",
    root: {
      ...duplicatePayload,
      payload: duplicatePayload.payload.replace("000000002", "000000001"),
    },
  }]));
  assert.equal(duplicate.ok, false);
});

check("malformed graph targets, attributes, content, and mixed operations are rejected", () => {
  const invalidOps = [
    { domain: "graph", op: "remove-attr", target: { kind: "quid", quid: "short" }, name: "title" },
    { domain: "graph", op: "remove-attr", target: { kind: "path", path: [-1] }, name: "title" },
    { domain: "graph", op: "set-attr", target: { kind: "path", path: [] }, name: "hson:quid", value: "000000002" },
    { domain: "graph", op: "set-attr", target: { kind: "path", path: [] }, name: "title", value: {} },
    { domain: "graph", op: "replace-attrs", target: { kind: "path", path: [] } },
    { domain: "graph", op: "replace-attrs", target: { kind: "path", path: [] }, attrs: [] },
    { domain: "graph", op: "replace-attrs", target: { kind: "path", path: [] }, attrs: { "hson:quid": "000000002" } },
    { domain: "graph", op: "replace-attrs", target: { kind: "path", path: [] }, attrs: { "hson:index": "0" } },
    { domain: "graph", op: "replace-attrs", target: { kind: "path", path: [] }, attrs: { "hson:unknown": "x" } },
    { domain: "graph", op: "replace-attrs", target: { kind: "path", path: [] }, attrs: { "": "x" } },
    { domain: "graph", op: "replace-attrs", target: { kind: "path", path: [] }, attrs: { "bad name": "x" } },
    { domain: "graph", op: "replace-attrs", target: { kind: "path", path: [] }, attrs: { title: {} } },
    { domain: "graph", op: "replace-attrs", target: { kind: "path", path: [] }, attrs: { style: { color: [] } } },
    { domain: "graph", op: "replace-attrs", target: { kind: "path", path: [] }, attrs: {}, extra: true },
    { domain: "graph", op: "replace-content", target: { kind: "path", path: [] }, index: 0, replacement: { format: "hson-graph", formatVersion: 1, payload: "<broken" } },
    { domain: "graph", op: "insert-content", target: { kind: "path", path: [] }, index: -1, content: "x" },
    { domain: "graph", op: "insert-content", target: { kind: "path", path: [] }, index: 0, content: { format: "hson-graph", formatVersion: 2, payload: "" } },
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
  const missing = decode_locus_server_message(JSON.stringify({ type: "recovery-snapshot", id: "snapshot", snapshot: base }));
  assert.equal(missing.ok, false);
  for (const mode of ["data-object", "data-array", "element", "fragment"]) {
    const decoded = decode_locus_server_message(JSON.stringify({
      type: "recovery-snapshot",
      id: "snapshot",
      snapshot: { ...base, mode },
    }));
    assert.equal(decoded.ok, true);
  }
  const viewState = decode_locus_server_message(JSON.stringify({
    type: "recovery-snapshot",
    id: "view-state-snapshot",
    snapshot: {
      logicalMapId: "map",
      incarnationId: "inc",
      rev: 0,
      mode: "element",
      format: "view-state",
      payload: "payload",
    },
  }));
  assert.equal(viewState.ok, true);
});

check("recovery capability advertisements are strict and generation-free", () => {
  const valid = decode_locus_message(JSON.stringify({
    type: "recover",
    id: "recover-capabilities",
    logicalMapId: "map",
    snapshotCapabilities: { hson: true, viewState: true },
  }));
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.ok && valid.value.snapshotCapabilities, {
    hson: true,
    viewState: true,
  });

  const malformed = [
    false,
    { hson: false },
    { hson: true, viewState: false },
    { hson: true, viewStateVersions: [2] },
    { hson: true, extra: true },
  ];
  for (const snapshotCapabilities of malformed) {
    const decoded = decode_locus_message(JSON.stringify({
      type: "recover",
      id: "recover-capabilities-invalid",
      logicalMapId: "map",
      snapshotCapabilities,
    }));
    assert.equal(decoded.ok, false);
    assert.equal(decoded.ok ? undefined : decoded.error.code, "LOCUS_SNAPSHOT_CAPABILITIES_INVALID");
  }
});

check("recovery plans carry generation-free snapshot encoding acknowledgments", () => {
  const common = {
    type: "recovery-plan",
    id: "plan",
    sessionId: "session",
    logicalMapId: "map",
    incarnationId: "inc",
    headRev: 0,
    outcome: "current",
  };
  for (const snapshotEncoding of [
    { format: "hson" },
    { format: "view-state" },
  ]) {
    const decoded = decode_locus_server_message(JSON.stringify({ ...common, snapshotEncoding }));
    assert.equal(decoded.ok, true);
  }
  for (const snapshotEncoding of [
    { format: "unknown" },
    { format: "view-state", formatVersion: 2 },
    { format: "hson", formatVersion: 1 },
  ]) {
    const decoded = decode_locus_server_message(JSON.stringify({ ...common, snapshotEncoding }));
    assert.equal(decoded.ok, false);
    assert.equal(decoded.ok ? undefined : decoded.error.code, "LOCUS_SNAPSHOT_NEGOTIATION_INVALID");
  }
});

process.stdout.write(`# ${checks} Locus document protocol checks passed\n`);
emit_hson_live_test_completion("locus.protocol-document", checks, checks, 0);
