import assert from "node:assert/strict";
import { hsonTransform } from "../src/api/transform/index.ts";
import type { HsonNode } from "../src/core/types.ts";

let checks = 0;
function check(name: string, fn: () => void): void {
  fn();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function walk(node: HsonNode, visit: (current: HsonNode) => void): void {
  visit(node);
  for (const child of node.$_content) {
    if (typeof child === "object" && child !== null) walk(child, visit);
  }
}

check("the transform facade exposes all five synchronous constructors", () => {
  assert.deepEqual(Object.keys(hsonTransform), [
    "fromHson",
    "fromJson",
    "fromNode",
    "fromTrustedHtml",
    "fromUntrustedHtml",
  ]);
});

check("Worker-safe Transform produces readable, compact, and no-QUID HSON", () => {
  const node = hsonTransform
    .fromHson(`<worker @0000000000000001 "ready"/>`)
    .toNode();
  assert.equal(
    hsonTransform.fromNode(node).toHson().serialize(),
    `<worker @0000000000000001 "ready"/>`,
  );
  assert.equal(
    hsonTransform.fromNode(node).toHson().noBreak().serialize(),
    `<worker @0000000000000001 "ready"/>`,
  );
  assert.equal(
    hsonTransform.fromNode(node).toHson().noQuid().serialize(),
    `<worker "ready"/>`,
  );
});

check("trusted HTML parses without browser globals", () => {
  assert.equal("document" in globalThis, false);
  const node = hsonTransform
    .fromTrustedHtml(`<section onclick="run()"><script>alert(1)</script><b>ready</b></section>`)
    .toNode();
  let foundScript = false;
  let foundHandler = false;
  walk(node, (current) => {
    if (current.$_tag === "script") foundScript = true;
    if (current.$_attrs?.onclick === "run()") foundHandler = true;
  });
  assert.equal(foundScript, true);
  assert.equal(foundHandler, true);
});

check("untrusted HTML is sanitized without browser globals", () => {
  assert.equal("window" in globalThis, false);
  const node = hsonTransform
    .fromUntrustedHtml(
      `<section style="color:red" onclick="run()"><script>alert(1)</script><a href="javascript:bad()">ready</a></section>`,
    )
    .toNode();
  walk(node, (current) => {
    assert.notEqual(current.$_tag, "script");
    assert.equal(current.$_attrs?.style, undefined);
    assert.equal(current.$_attrs?.onclick, undefined);
    if (current.$_tag === "a") assert.equal(current.$_attrs?.href, undefined);
  });
});

check("trusted standalone SVG preserves the established direct-node shape", () => {
  const node = hsonTransform
    .fromTrustedHtml(`<svg viewBox="0 0 10 10"><path stroke-width="2"/></svg>`)
    .toNode();
  assert.equal(node.$_tag, "svg");
  assert.equal(node.$_attrs?.viewBox, "0 0 10 10");
  const path = node.$_content[0];
  assert.equal(typeof path, "object");
  assert.notEqual(path, null);
  if (typeof path !== "object" || path === null) throw new Error("missing SVG path");
  assert.equal(path.$_attrs?.["stroke-width"], "2");
});

check("fully rejected untrusted markup reports sanitization failure", () => {
  assert.throws(
    () => hsonTransform.fromUntrustedHtml(`<script>alert(1)</script>`),
    /all content removed by sanitizer/,
  );
});

process.stdout.write(`# ${checks} DOM-free transform facade checks passed\n`);
