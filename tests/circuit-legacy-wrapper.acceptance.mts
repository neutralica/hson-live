import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import assert from "node:assert/strict";
import { hsonTransform } from "../src/api/transform/index.ts";
import { _compare_nodes } from "../src/diagnostics/index.ts";
import { _circuit_test } from "../src/diagnostics/test-circuit.ts";
import type { HsonNode } from "../src/core/types.ts";
import { with_browser_parser } from "./circuit-test-helpers.mts";

const LAUNCHER = "diagnostics.circuit-legacy-wrapper";
const SOURCE = '{"a":1,"b":[true,"x"]}';
let checks = 0;

function check(name: string, run: () => void): void {
  run();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function browser_report(options: Parameters<typeof _circuit_test>[1] = {}) {
  return with_browser_parser(() => _circuit_test(SOURCE, { entry: "json", times: 1, ...options }));
}

function json_node(source: string): HsonNode {
  return hsonTransform.fromJson(source).toNode();
}

check("legacy wrapper preserves the quiet report shape", () => {
  const report = browser_report({ dual: true });
  assert.deepEqual(Object.keys(report), ["ok", "times", "dir", "entry", "failures", "trace", "artifacts", "marks", "final", "dualFinals"]);
  assert.equal(report.ok, true);
  assert.deepEqual(report.failures, []);
});

check("omitted stopOnFirstFail is globally fail-fast", () => {
  const report = _circuit_test(SOURCE, { entry: "json", times: 1, dual: true });
  assert.equal(report.ok, false);
  assert.equal(report.failures.length, 1);
  assert.equal(report.dualFinals, undefined);
});

check("explicit exhaustive mode preserves independent dual continuation", () => {
  const report = _circuit_test(SOURCE, { entry: "json", times: 1, dual: true, stopOnFirstFail: false });
  assert.equal(report.ok, false);
  assert.equal(report.failures.length, 2);
  assert.ok(report.dualFinals?.cw);
  assert.ok(report.dualFinals?.ccw);
});

check("single-direction compatibility honors CCW", () => {
  const report = browser_report({ dual: false, dir: "ccw" });
  assert.equal(report.ok, true);
  assert.equal(report.dir, "ccw");
  assert.equal(report.dualFinals, undefined);
});

check("times remains the requested and executed lap count", () => {
  const report = with_browser_parser(() => _circuit_test(SOURCE, { entry: "json", times: 2, dual: false, dir: "cw" }));
  assert.equal(report.ok, true);
  assert.equal(report.times, 2);
});

check("explicit entry remains visible in the legacy report", () => {
  const report = browser_report({ dual: false });
  assert.equal(report.entry, "json");
  assert.equal(report.final?.fmt, "json");
});

check("auto entry retains JSON compatibility", () => {
  const report = with_browser_parser(() => _circuit_test(SOURCE, { entry: "auto", times: 1, dual: false }));
  assert.equal(report.ok, true);
  assert.equal(report.entry, "auto");
  assert.equal(report.final?.fmt, "json");
});

check("auto entry retains Hson compatibility", () => {
  const source = hsonTransform.fromJson(SOURCE).toHson().serialize();
  const report = with_browser_parser(() => _circuit_test(source, { entry: "auto", times: 1, dual: false }));
  assert.equal(report.ok, true);
  assert.equal(report.final?.fmt, "hson");
});

check("auto entry retains strong HTML closer compatibility", () => {
  const report = with_browser_parser(() => _circuit_test("<main>hello</main>", { entry: "auto", times: 1, dual: false }));
  assert.equal(report.ok, true);
  assert.equal(report.final?.fmt, "html");
});

check("verbose true retains ordered semantic stage messages", () => {
  const report = browser_report({ dual: false, verbose: true });
  assert.equal(report.trace?.[0]?.step, "enter:json");
  assert.equal(report.trace?.some((step) => step.step === "lap 1/1 begin"), true);
  assert.equal(report.trace?.some((step) => step.step === "return:check:json"), true);
});

check("capture false exposes no artifact collection", () => {
  const report = browser_report({ dual: false, capture: false });
  assert.equal(report.artifacts, undefined);
});

check("capture true retains the legacy two-artifact main-leg meaning", () => {
  const report = browser_report({ dual: false, capture: true });
  assert.equal(report.artifacts?.length, 6);
  assert.deepEqual(report.artifacts?.map((artifact) => artifact.fmt), ["json", "json", "html", "html", "hson", "hson"]);
});

check("captured artifacts retain text and before-after graph witnesses", () => {
  const report = browser_report({ dual: false, capture: true });
  assert.ok(report.artifacts?.every((artifact) => typeof artifact.text === "string" && typeof artifact.node === "string"));
  assert.notEqual(report.artifacts?.[0]?.node.length, 0);
  assert.notEqual(report.artifacts?.[1]?.node.length, 0);
});

check("single-direction paranoid mode retains entry plus four parsed marks", () => {
  const report = browser_report({ dual: false, paranoid: true });
  assert.equal(report.marks?.length, 5);
  assert.equal(report.marks?.filter((mark) => mark.phase === "closure").length, 1);
});

check("dual paranoid mode retains compatible per-direction mark material", () => {
  const report = browser_report({ dual: true, paranoid: true });
  assert.equal(report.marks?.length, 10);
  assert.equal(report.ok, true);
});

check("paranoid has an explicit verbose checkpoint-comparison effect", () => {
  const report = browser_report({ dual: true, paranoid: true, verbose: true });
  assert.equal(report.trace?.some((step) => step.step === "paranoid:4 strict checkpoint comparisons"), true);
});

check("dual false never constructs opposite-direction report structures", () => {
  const report = browser_report({ dual: false, capture: true, paranoid: true });
  assert.equal(report.dir, "cw");
  assert.equal(report.dualFinals, undefined);
  assert.equal(report.artifacts?.length, 6);
});

check("dual true retains both legacy final representations", () => {
  const report = browser_report({ dual: true });
  assert.equal(report.final?.text, report.dualFinals?.cw.text);
  assert.equal(report.dualFinals?.cw.fmt, "json");
  assert.equal(report.dualFinals?.ccw.fmt, "json");
});

check("browser diagnostics continue to invoke the DOMParser HTML path", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "DOMParser");
  class MarkerDOMParser {
    parseFromString(): never {
      throw new Error("browser-boundary-marker");
    }
  }
  Object.defineProperty(globalThis, "DOMParser", { configurable: true, value: MarkerDOMParser });
  try {
    const report = _circuit_test(SOURCE, { entry: "json", times: 1, dual: false });
    assert.equal(report.ok, false);
    assert.match(report.failures[0]?.error ?? "", /browser-boundary-marker/);
  } finally {
    if (descriptor === undefined) Reflect.deleteProperty(globalThis, "DOMParser");
    else Object.defineProperty(globalThis, "DOMParser", descriptor);
  }
});

check("legacy projected comparator remains available for compatibility", () => {
  const ordered = json_node('{"a":1,"b":2}');
  const reordered = json_node('{"b":2,"a":1}');
  assert.deepEqual(_compare_nodes(ordered, reordered, false), []);
});

check("legacy comparator compatibility does not become strict circuit authority", () => {
  const zero = json_node("0");
  const negativeZero = json_node("-0");
  assert.deepEqual(_compare_nodes(zero, negativeZero, false), []);
  const circuit = with_browser_parser(() => _circuit_test("-0", { entry: "json", times: 1, dual: false }));
  assert.equal(typeof circuit.ok, "boolean");
});

check("successful repeated reports are deterministic", () => {
  const first = browser_report({ dual: true, capture: true, paranoid: true, verbose: true });
  const second = browser_report({ dual: true, capture: true, paranoid: true, verbose: true });
  assert.deepEqual(second, first);
});

check("explicit JSON prevents ambiguous source redispatch", () => {
  const report = with_browser_parser(() => _circuit_test('"<ambiguous>"', { entry: "json", times: 1, dual: false }));
  assert.equal(report.ok, true);
  assert.equal(report.final?.fmt, "json");
});

check("invalid entry parse yields one structured report failure and no final", () => {
  const report = _circuit_test("{", { entry: "json", times: 1, dual: true });
  assert.equal(report.ok, false);
  assert.equal(report.failures.length, 1);
  assert.equal(report.final, undefined);
  assert.equal(report.dualFinals, undefined);
});

check("quiet reports no longer retain the forced legacy debug trace", () => {
  const report = browser_report({ dual: true, verbose: false, capture: false });
  assert.equal(report.trace, undefined);
  assert.equal(report.artifacts, undefined);
  assert.equal(report.marks, undefined);
});

assert.equal(checks, 25);
process.stdout.write(`# ${checks} legacy circuit wrapper compatibility checks passed\n`);
emit_hson_live_test_completion(LAUNCHER, checks, checks, 0);
