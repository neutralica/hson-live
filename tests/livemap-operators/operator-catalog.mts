import assert from "node:assert/strict";
import { Hson, hson } from "../../src/index.ts";
import { link_livemap } from "../../src/api/livemap/livemap.link.ts";
import { make_livemap_store_api } from "../../src/api/livemap/livemap.store.ts";
import type { JsonValue, LiveMapCore } from "../../src/types/index.ts";

export type OperatorClassification = "accept" | "no-op" | "change" | "conflict" | "rejection";
export type OperatorGroup = "mutation" | "admission-schema" | "transport-propagation";

export type OperatorResult = Readonly<{
  classification: OperatorClassification;
  before: string;
  input: string;
  after: string;
  revisionDelta: number;
  publications: number;
  evidence: readonly string[];
}>;

export type DeterministicLiveMapOperator = Readonly<{
  id: string;
  reproductionId: `livemap-operator-v1/${string}`;
  group: OperatorGroup;
  name: string;
  rule: string;
  applicability: string;
  expected: OperatorClassification;
  run: () => OperatorResult;
}>;

type Map = LiveMapCore<JsonValue | undefined>;

function exact(map: Map): string {
  const capture = map.capture();
  return JSON.stringify({
    format: capture.format,
    payload: capture.payload,
  });
}

function classify(changed: boolean): OperatorClassification {
  return changed ? "change" : "no-op";
}

export function operator(
  id: string,
  group: OperatorGroup,
  name: string,
  rule: string,
  applicability: string,
  expected: OperatorClassification,
  run: () => OperatorResult,
): DeterministicLiveMapOperator {
  return Object.freeze({ id, reproductionId: `livemap-operator-v1/${id}`, group, name, rule, applicability, expected, run });
}

export function own_record(entries: readonly (readonly [string, unknown])[], prototype: object | null = Object.prototype): Record<string, JsonValue> {
  const value = Object.create(prototype) as Record<string, JsonValue>;
  for (const [key, item] of entries) {
    Object.defineProperty(value, key, { value: item, enumerable: true, writable: true, configurable: true });
  }
  return value;
}

export function mutation_operator(
  id: string,
  name: string,
  rule: string,
  applicability: string,
  expected: "change" | "no-op",
  initial: string | JsonValue,
  input: string,
  act: (map: Map) => Readonly<{ changed: boolean }>,
  verify?: (map: Map) => void,
): DeterministicLiveMapOperator {
  return operator(id, "mutation", name, rule, applicability, expected, () => {
    const map = hson.liveMap.fromJson(initial);
    let publications = 0;
    map.commits.observe(() => { publications += 1; });
    const before = exact(map);
    const rev = map.rev;
    const commit = act(map);
    verify?.(map);
    return Object.freeze({
      classification: classify(commit.changed),
      before,
      input,
      after: exact(map),
      revisionDelta: map.rev - rev,
      publications,
      evidence: Object.freeze([`commit.changed=${String(commit.changed)}`]),
    });
  });
}

export function admission_operator(
  id: string,
  name: string,
  rule: string,
  applicability: string,
  expected: "accept" | "rejection",
  input: string,
  makeValue: () => unknown,
  verify?: (map: Map) => void,
): DeterministicLiveMapOperator {
  return operator(id, "admission-schema", name, rule, applicability, expected, () => {
    try {
      const map = hson.liveMap.fromJson(makeValue() as JsonValue);
      verify?.(map);
      return Object.freeze({ classification: "accept" as const, before: "<absent>", input, after: exact(map), revisionDelta: 0, publications: 0, evidence: Object.freeze(["constructor accepted"])});
    } catch (error) {
      return Object.freeze({ classification: "rejection" as const, before: "<absent>", input, after: "<absent>", revisionDelta: 0, publications: 0, evidence: Object.freeze([error_code(error)]) });
    }
  });
}

export function atomic_rejection_operator(
  id: string,
  name: string,
  rule: string,
  applicability: string,
  input: string,
  act: (map: Map) => void,
): DeterministicLiveMapOperator {
  return operator(id, "admission-schema", name, rule, applicability, "rejection", () => {
    const map = hson.liveMap.fromJson({ value: 1 });
    let publications = 0;
    let feeds = 0;
    map.commits.observe(() => { publications += 1; });
    map.feed([], () => { feeds += 1; });
    const before = exact(map);
    const rev = map.rev;
    let evidence = "missing rejection";
    try { act(map); } catch (error) { evidence = error_code(error); }
    assert.notEqual(evidence, "missing rejection");
    assert.equal(exact(map), before);
    assert.equal(map.rev, rev);
    assert.equal(publications, 0);
    assert.equal(feeds, 0);
    return Object.freeze({ classification: "rejection" as const, before, input, after: exact(map), revisionDelta: 0, publications, evidence: Object.freeze([evidence, "feeds=0"])});
  });
}

export function lifecycle_operator(
  id: string,
  name: string,
  rule: string,
  applicability: string,
  expected: OperatorClassification,
  run: () => OperatorResult,
): DeterministicLiveMapOperator {
  return operator(id, "transport-propagation", name, rule, applicability, expected, run);
}

export function observe_map(
  map: Map,
  input: string,
  act: () => Readonly<{ classification: OperatorClassification; evidence?: readonly string[] }>,
): OperatorResult {
  let publications = 0;
  map.commits.observe(() => { publications += 1; });
  const before = exact(map);
  const rev = map.rev;
  const outcome = act();
  return Object.freeze({ classification: outcome.classification, before, input, after: exact(map), revisionDelta: map.rev - rev, publications, evidence: Object.freeze([...(outcome.evidence ?? [])]) });
}

export function error_code(error: unknown): string {
  if (typeof error !== "object" || error === null) return String(error);
  const value = error as { code?: unknown; reasonCode?: unknown; reason?: unknown; name?: unknown };
  const code = value.code ?? value.reasonCode ?? value.reason ?? value.name;
  return typeof code === "string" ? code : "Error";
}

export function schema_number_map(): Map {
  const map = hson.liveMap.fromJson({ value: 1 });
  map.schema.use(Hson`<type "data" content <value "number">>`);
  return map;
}

export function linked_maps(source: string | JsonValue, target: string | JsonValue, path: readonly (string | number)[] = ["value"]): readonly [Map, Map] {
  const sourceMap = hson.liveMap.fromJson(source);
  const targetMap = hson.liveMap.fromJson(target);
  link_livemap(sourceMap, targetMap, { path });
  return [sourceMap, targetMap];
}

export function store_for(map: Map) {
  return make_livemap_store_api(map);
}

export function assert_operator(operator: DeterministicLiveMapOperator): OperatorResult {
  const first = operator.run();
  const second = operator.run();
  assert.equal(first.classification, operator.expected);
  assert.deepEqual(second, first);
  assert.equal(operator.reproductionId, `livemap-operator-v1/${operator.id}`);
  assert.notEqual(operator.applicability.length, 0);
  return first;
}

export function render_operator_artifact(operators: readonly DeterministicLiveMapOperator[]): string {
  const lines = [
    "# Deterministic LiveMap operator catalog",
    "",
    "Generated from executable, deterministic operators. Exact before/after witnesses embed the structural-json payload, preserving semantic entry order and `-0`.",
    "",
    `Operators: ${operators.length}`,
    "",
  ];
  for (const group of ["mutation", "admission-schema", "transport-propagation"] as const) {
    lines.push(`## ${group}`, "");
    for (const item of operators.filter((candidate) => candidate.group === group)) {
      const result = assert_operator(item);
      lines.push(
        `### ${item.reproductionId} — ${item.name}`,
        "",
        `- Expected classification: \`${item.expected}\``,
        `- Applicability: ${item.applicability}`,
        `- Rule: ${item.rule}`,
        `- Representative input: \`${result.input.replaceAll("`", "\\`")}\``,
        "- Materialized witness:",
        "",
        "```json",
        JSON.stringify({ before: materialized_witness(result.before), after: materialized_witness(result.after), revisionDelta: result.revisionDelta, publications: result.publications, evidence: result.evidence }, null, 2),
        "```",
        "",
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

function materialized_witness(value: string): unknown {
  if (value === "<absent>") return value;
  try { return JSON.parse(value) as unknown; } catch { return value; }
}
