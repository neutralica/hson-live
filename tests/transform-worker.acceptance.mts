import assert from "node:assert/strict";
import { hsonTransform } from "../src/api/transform/index.ts";
import { assertCanonicalClosure } from "../src/_tests/transform-oracle.ts";
import { hsonCalc, hsonNumber } from "../src/number.ts";
import { read_transform_error_details, TransformError } from "../src/core/errors.ts";
import type { HsonNode } from "../src/core/types.ts";
import {
  ADJACENT_DUPLICATE_JSON_ERROR,
  ADJACENT_DUPLICATE_JSON_SOURCE,
  DIRECT_INTEGER_KEY_SOURCE,
  directIntegerKeyFixture,
} from "./fixtures/structural-json-order-fixtures.mts";
import { detach_hson_root_value } from "../src/api/transform/utils/node-utils/detach-hson-root-value.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";

const Q1 = "000000001";

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

check("the transform facade exposes its three leaf admissions and five synchronous constructors", () => {
  assert.deepEqual(Object.keys(hsonTransform), [
    "string",
    "number",
    "calc",
    "fromHson",
    "fromJson",
    "fromNode",
    "fromTrustedHtml",
    "fromUntrustedHtml",
  ]);
});

check("the numeric leaf entrypoint is Worker-safe and preserves negative zero", () => {
  assert.equal(Object.is(hsonNumber(-0), -0), true);
  assert.equal(Object.is(hsonCalc(() => -0), -0), true);
});

check("Worker-safe Transform produces readable, compact, and no-QUID HSON", () => {
  const node = hsonTransform
    .fromHson(`<worker @000000001 "ready"/>`)
    .toNode();
  assert.equal(
    hsonTransform.fromNode(node).toHson().serialize(),
    `<worker @000000001 "ready"/>`,
  );
  assert.equal(
    hsonTransform.fromNode(node).toHson().noBreak().serialize(),
    `<worker @000000001 "ready"/>`,
  );
  assert.equal(
    hsonTransform.fromNode(node).toHson().noQuid().serialize(),
    `<worker "ready"/>`,
  );
});

check("Worker-safe Transform oracle proves strict closure without Node support", () => {
  const result = assertCanonicalClosure({
    launcher: "transform-worker",
    caseId: "worker-strict-closure",
    ingress: "hson-source",
    source: `<worker @${Q1} "ready"/>`,
    cycles: 3,
  });
  assert.equal(result.serialized, `<worker @${Q1} "ready"/>`);
});

check("Worker-safe structural JSON preserves order and duplicate identity", () => {
  const baseline = hsonTransform.fromHson(DIRECT_INTEGER_KEY_SOURCE).toNode();
  const wire = hsonTransform.fromNode(baseline).toJson().serialize();
  assert.equal(wire, directIntegerKeyFixture.expectedJson);
  const reparsed = detach_hson_root_value(hsonTransform.fromJson(wire).toNode());
  assert.equal(canonical_hson_graph_equal(reparsed, baseline), true);
  let duplicate: TransformError | undefined;
  assert.throws(
    () => hsonTransform.fromJson(ADJACENT_DUPLICATE_JSON_SOURCE).toNode(),
    (cause) => {
      if (!(cause instanceof TransformError)) return false;
      duplicate = cause;
      return cause.code === "HSON_JSON_DUPLICATE_PROPERTY";
    },
  );
  assert.deepEqual(read_transform_error_details(duplicate), ADJACENT_DUPLICATE_JSON_ERROR);
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

check("untrusted Worker parsing preserves valid HSON identity while removing unsafe behavior", () => {
  const node = hsonTransform
    .fromUntrustedHtml(
      `<main><span hson:quid="${Q1}" data-_quid="application" onclick="run()">ready</span></main>`,
    )
    .toNode();
  let span: HsonNode | undefined;
  walk(node, (current) => {
    if (current.$_tag === "span") span = current;
  });
  assert.equal(span?.$_meta?.quid, Q1);
  assert.equal(span?.$_attrs?.["data-_quid"], "application");
  assert.equal(span?.$_attrs?.onclick, undefined);
});

check("untrusted Worker parsing routes malformed and unknown metadata to canonical admission", () => {
  for (const [source, reason] of [
    [`<main hson:quid="bad"/>`, /invalid value for HSON metadata "hson:quid"/],
    [`<main hson:unknown="value"/>`, /unknown HSON metadata markup name "hson:unknown"/],
    [`<main hson:index="0"/>`, /metadata "index" is not defined for node "main"/],
  ] as const) {
    assert.throws(() => hsonTransform.fromUntrustedHtml(source), reason);
  }
});

check("untrusted Worker parsing admits valid wrapper metadata and rejects malformed indexes", () => {
  const node = hsonTransform
    .fromUntrustedHtml(
      `<_hson_arr><_hson_ii hson:index="0"><_hson_val>1</_hson_val></_hson_ii></_hson_arr>`,
    )
    .toNode();
  let wrapper: HsonNode | undefined;
  walk(node, (current) => {
    if (current.$_tag === "_hson_ii") wrapper = current;
  });
  assert.equal(wrapper?.$_meta?.index, "0");
  assert.throws(
    () => hsonTransform.fromUntrustedHtml(
      `<_hson_arr><_hson_ii hson:index="banana"><_hson_val>1</_hson_val></_hson_ii></_hson_arr>`,
    ),
    /not an exact canonical index/,
  );
});

check("untrusted Worker parsing rejects metadata duplicates before htmlparser2", () => {
  for (const source of [
    `<main hson:quid="${Q1}" hson:quid="000000002"/>`,
    `<main HSON:QUID="${Q1}" hson:quid="000000002"/>`,
    `<_hson_arr><_hson_ii hson:index="0" hson:index="1"/></_hson_arr>`,
  ]) {
    assert.throws(
      () => hsonTransform.fromUntrustedHtml(source),
      /duplicate HSON metadata attribute/,
    );
  }
});

check("untrusted Worker parsing rejects both authored private transit domains", () => {
  for (const source of [
    `<main _hson_meta_attr_v2_71756964="${Q1}"/>`,
    `<main _HSON_META_ATTR_V2_authored="value"/>`,
    `<main _hson_attr_transit_v1_613a62="value"/>`,
    `<main _HSON_ATTR_TRANSIT_V1_authored="value"/>`,
  ]) {
    assert.throws(
      () => hsonTransform.fromUntrustedHtml(source),
      /externally authored private (?:HSON metadata|ordinary-attribute) transit name/,
    );
  }
});

check("untrusted Worker parsing keeps data-* application-owned", () => {
  const node = hsonTransform.fromUntrustedHtml(
    `<main data-_quid="q" data-_index="i" data--attrmap="map" hson-foo="ordinary"/>`,
  ).toNode();
  let main: HsonNode | undefined;
  walk(node, (current) => {
    if (current.$_tag === "main") main = current;
  });
  assert.deepEqual(main?.$_attrs, {
    "data-_quid": "q",
    "data-_index": "i",
    "data--attrmap": "map",
  });
  assert.equal(main?.$_meta, undefined);
});

check("trusted standalone SVG preserves the established direct-node shape", () => {
  const node = hsonTransform
    .fromTrustedHtml(`<svg viewBox="0 0 10 10"><path stroke-width="2"/></svg>`)
    .toNode();
  assert.equal(node.$_tag, "svg");
  assert.equal(node.$_attrs?.viewBox, "0 0 10 10");
  const cluster = node.$_content[0];
  assert.equal(typeof cluster, "object");
  assert.notEqual(cluster, null);
  if (typeof cluster !== "object" || cluster === null) throw new Error("missing SVG element cluster");
  assert.equal(cluster.$_tag, "_hson_elem");
  const path = cluster.$_content[0];
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

check("Worker-safe authored diagnostics retain portable codes and related positions", () => {
  let observed: TransformError | undefined;
  assert.throws(
    () => hsonTransform.fromHson(`<a 1 a 2>`).toNode(),
    (cause) => {
      if (!(cause instanceof TransformError)) return false;
      observed = cause;
      return cause.code === "HSON_OBJECT_DUPLICATE_MEMBER";
    },
  );
  assert.deepEqual(read_transform_error_details(observed), {
    operation: "tokenize-hson",
    code: "HSON_OBJECT_DUPLICATE_MEMBER",
    stage: "tokenization",
    source: { index: 5, line: 1, column: 6 },
    related: [{
      role: "first-declaration",
      source: { index: 1, line: 1, column: 2 },
    }],
  });
  assert.throws(
    () => hsonTransform.fromHson(`"a\tb"`).toNode(),
    (cause) => cause instanceof TransformError
      && cause.code === "HSON_STRING_CONTROL_UNESCAPED"
      && cause.source?.index === 2,
  );
  for (const [source, expected] of [
    ["01", {
      operation: "tokenize-hson",
      code: "HSON_NUMBER_LEADING_ZERO",
      stage: "tokenization",
      source: { index: 1, line: 1, column: 2 },
    }],
    ["+1", {
      operation: "tokenize-hson",
      code: "HSON_NUMBER_LEADING_PLUS",
      stage: "tokenization",
      source: { index: 0, line: 1, column: 1 },
    }],
  ] as const) {
    let numericError: TransformError | undefined;
    assert.throws(
      () => hsonTransform.fromHson(source).toNode(),
      (cause) => {
        if (!(cause instanceof TransformError)) return false;
        numericError = cause;
        return true;
      },
    );
    assert.deepEqual(read_transform_error_details(numericError), expected);
  }
});

process.stdout.write(`# ${checks} DOM-free transform facade checks passed\n`);
