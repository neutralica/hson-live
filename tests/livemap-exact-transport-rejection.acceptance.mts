import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
// @hson-live-external-test

import assert from "node:assert/strict";
import { make_livemap_core } from "../src/api/livemap/livemap.core.ts";
import {
  is_ordered_projected_object,
  ordered_projected_object,
  type OrderedProjectedValue,
} from "../src/core/ordered-projected-value.ts";
import {
  projected_value_from_hson_node,
  projected_value_to_hson_root,
} from "../src/core/projected-value-graph.ts";
import type { JsonValue } from "../src/core/types.ts";

let checks = 0;

function check(name: string, fn: () => void): void {
  fn();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function map(value: OrderedProjectedValue) {
  return make_livemap_core(projected_value_to_hson_root(value));
}

function graph_keys(valueMap: ReturnType<typeof make_livemap_core>): readonly string[] {
  const value = projected_value_from_hson_node(valueMap.root());
  if (!is_ordered_projected_object(value)) throw new Error("Expected object carrier.");
  return value.entries.map(([key]) => key);
}

function own_data(entries: readonly (readonly [string, JsonValue])[]): Record<string, JsonValue> {
  const value: Record<string, JsonValue> = {};
  for (const [key, child] of entries) {
    Object.defineProperty(value, key, { value: child, enumerable: true, writable: true, configurable: true });
  }
  return value;
}

function transport_failure(run: () => unknown, context: "apply" | "restore", reason: string): void {
  assert.throws(run, (error: unknown) => {
    const failure = error as { code?: unknown; context?: unknown; reason?: unknown };
    return failure.code === "INVALID_PROJECTED_TRANSPORT"
      && failure.context === context
      && failure.reason === reason;
  });
}

function replay_failure(run: () => unknown, reason: string, opIndex?: number): void {
  assert.throws(run, (error: unknown) => {
    const failure = error as { code?: unknown; reason?: unknown; opIndex?: unknown };
    return failure.code === "INVALID_REPLAY"
      && failure.reason === reason
      && failure.opIndex === opIndex;
  });
}

check("legacy restore is rejected", () => {
  const target = map(ordered_projected_object([["old", true]]));
  transport_failure(
    () => target.restore({ rev: 4, value: own_data([["10", 10], ["2", 2], ["1", 1]]) } as never),
    "restore",
    "capture is not the canonical structural representation",
  );
  assert.deepEqual(graph_keys(target), ["old"]);
  assert.equal(target.rev, 0);
});

check("legacy apply is rejected", () => {
  const target = map(ordered_projected_object([["old", true]]));
  transport_failure(
    () => target.apply({ prevRev: 0, value: own_data([["10", 10], ["2", 2], ["1", 1]]) } as never),
    "apply",
    "input is not the canonical structural representation",
  );
  assert.deepEqual(graph_keys(target), ["old"]);
});

check("materialized legacy duplicate history is not admitted", () => {
  const target = map(ordered_projected_object([["old", true]]));
  const parsed = JSON.parse('{"a":1,"a":2}') as JsonValue;
  assert.throws(() => target.restore({ rev: 1, value: parsed } as never));
  assert.deepEqual(graph_keys(target), ["old"]);
});

check("legacy replay through prevRev and ops is rejected", () => {
  const target = map(ordered_projected_object([["value", 0]]));
  replay_failure(
    () => target.replay({ prevRev: 0, ops: [{ kind: "set", path: ["value"], prev: 0, next: -0 }] } as never),
    "envelope is not the canonical structural representation",
  );
  assert.equal(Object.is(target.snap(["value"]), 0), true);
});

check("exact output never silently downgrades to the legacy shape", () => {
  const target = map(ordered_projected_object([["value", 0]]));
  const capture = target.capture();
  const commit = target.set(["value"], -0);
  assert.equal(Object.hasOwn(capture, "format"), true);
  assert.equal(Object.hasOwn(capture, "payload"), true);
  assert.equal(Object.hasOwn(commit, "format"), true);
  assert.equal(Object.hasOwn(commit, "payload"), true);
});

check("restore rejects an unsupported exact format", () => {
  const target = map(ordered_projected_object([["value", 0]]));
  transport_failure(
    () => target.restore({ rev: 0, format: "other", payload: "{}", root: target.root() } as never),
    "restore",
    "format is not supported",
  );
});

check("restore rejects a removed generation marker", () => {
  const target = map(ordered_projected_object([["value", 0]]));
  transport_failure(
    () => target.restore({ rev: 0, format: "structural-json", formatVersion: 2, payload: "{}" } as never),
    "restore",
    "capture is not the canonical structural representation",
  );
});

check("apply rejects a non-string exact payload", () => {
  const target = map(ordered_projected_object([["value", 0]]));
  transport_failure(
    () => target.apply({ prevRev: 0, format: "structural-json", payload: 1 } as never),
    "apply",
    "payload is not a string",
  );
});

check("restore rejects malformed structural JSON deterministically", () => {
  const target = map(ordered_projected_object([["value", 0]]));
  transport_failure(
    () => target.restore({ rev: 0, format: "structural-json", payload: "{", root: target.root() }),
    "restore",
    "payload is not valid structural JSON",
  );
});

check("a partial exact replay envelope never falls back to legacy ops", () => {
  const target = map(ordered_projected_object([["value", 0]]));
  replay_failure(
    () => target.replay({ prevRev: 0, format: "structural-json", ops: [] } as never),
    "payload is not a string",
  );
});

check("replay rejects a removed generation marker", () => {
  const target = map(ordered_projected_object([["value", 0]]));
  replay_failure(
    () => target.replay({ prevRev: 0, format: "structural-json", formatVersion: 2, payload: "[]" } as never),
    "envelope is not the canonical structural representation",
  );
});

check("replay rejects a non-array structural payload root", () => {
  const target = map(ordered_projected_object([["value", 0]]));
  replay_failure(
    () => target.replay({ prevRev: 0, format: "structural-json", payload: "{}" }),
    "payload root is not an operation array",
  );
});

check("replay rejects malformed exact operation structure with an index", () => {
  const target = map(ordered_projected_object([["value", 0]]));
  replay_failure(
    () => target.replay({
      prevRev: 0,
      format: "structural-json",
      payload: '[{"path":["value"],"kind":"set","prev":[0],"next":[1]}]',
    }),
    "operation fields are missing, unknown, or out of order",
    0,
  );
});

assert.equal(checks, 13);
process.stdout.write(`# ${checks} exact LiveMap transport compatibility/rejection checks passed\n`);
emit_hson_live_test_completion("livemap.exact-transport-rejection", checks, checks, 0);
