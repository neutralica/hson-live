import assert from "node:assert/strict";
import { Hson, hsonLiveMap } from "../../src/index.ts";
import { encode_exact_hson_value } from "../../src/api/livemap/livemap.document.view-state-codec.ts";
import type { JsonValue } from "../../src/core/types.ts";
import type { LiveMapDataLibrary } from "../../src/types/livemap.types.ts";

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
type State = LiveMapDataLibrary<unknown>;
const Wide = Hson.schema`<type "data" content <
  value <optional "any"> a <optional "any"> b <optional "any"> c <optional "any">
  d <optional "any"> renamed <optional "any"> '10' <optional "any">
  '2' <optional "any"> '1' <optional "any"> '__proto__' <optional "any">
  constructor <optional "any"> prototype <optional "any"> items <optional "any">
  outer <optional "any"> missing <optional "any"> left <optional "any">
  right <optional "any"> source <optional "any"> destination <optional "any">
  kept <optional "any"> copy <optional "any"> other <optional "any">
>>`;
export function registry(initial: string | JsonValue) {
  return hsonLiveMap.fromLibraries({ state: { data: initial, schema: Wide } });
}
export function state(initial: string | JsonValue): State {
  return registry(initial).lib("state");
}
export function exact(map: State): string {
  return JSON.stringify({ root: encode_exact_hson_value(map.root()) });
}
function classify(changed: boolean): OperatorClassification { return changed ? "change" : "no-op"; }
export function operator(
  id: string, group: OperatorGroup, name: string, rule: string,
  applicability: string, expected: OperatorClassification, run: () => OperatorResult,
): DeterministicLiveMapOperator {
  return Object.freeze({ id, reproductionId: `livemap-operator-v1/${id}`, group, name, rule, applicability, expected, run });
}
export function own_record(entries: readonly (readonly [string, unknown])[], prototype: object | null = Object.prototype): Record<string, JsonValue> {
  const value = Object.create(prototype) as Record<string, JsonValue>;
  for (const [key, item] of entries) Object.defineProperty(value, key, { value: item, enumerable: true, writable: true, configurable: true });
  return value;
}
export function mutation_operator(
  id: string, name: string, rule: string, applicability: string,
  expected: "change" | "no-op", initial: string | JsonValue, input: string,
  act: (map: State) => Readonly<{ changed: boolean }>, verify?: (map: State) => void,
): DeterministicLiveMapOperator {
  return operator(id, "mutation", name, rule, applicability, expected, () => {
    const map = registry(initial);
    const selected = map.lib("state");
    let publications = 0;
    map.commits.observe(() => { publications += 1; });
    const before = exact(selected);
    const rev = map.rev;
    const commit = act(selected);
    verify?.(selected);
    return Object.freeze({ classification: classify(commit.changed), before, input, after: exact(selected), revisionDelta: map.rev - rev, publications, evidence: Object.freeze([`commit.changed=${String(commit.changed)}`]) });
  });
}
export function admission_operator(
  id: string, name: string, rule: string, applicability: string,
  expected: "accept" | "rejection", input: string, makeValue: () => unknown,
  verify?: (map: State) => void,
): DeterministicLiveMapOperator {
  return operator(id, "admission-schema", name, rule, applicability, expected, () => {
    try {
      const selected = state({ value: makeValue() as JsonValue });
      verify?.(selected);
      return Object.freeze({ classification: "accept" as const, before: "<absent>", input, after: exact(selected), revisionDelta: 0, publications: 0, evidence: Object.freeze(["registry accepted"]) });
    } catch (error) {
      return Object.freeze({ classification: "rejection" as const, before: "<absent>", input, after: "<absent>", revisionDelta: 0, publications: 0, evidence: Object.freeze([error_code(error)]) });
    }
  });
}
export function atomic_rejection_operator(
  id: string, name: string, rule: string, applicability: string, input: string,
  act: (map: State) => void,
): DeterministicLiveMapOperator {
  return operator(id, "admission-schema", name, rule, applicability, "rejection", () => {
    const map = registry({ value: 1 });
    const selected = map.lib("state");
    let publications = 0;
    let feeds = 0;
    map.commits.observe(() => { publications += 1; });
    selected.at([]).feed(() => { feeds += 1; });
    const before = exact(selected);
    const rev = map.rev;
    let evidence = "missing rejection";
    try { act(selected); } catch (error) { evidence = error_code(error); }
    assert.notEqual(evidence, "missing rejection");
    assert.equal(exact(selected), before);
    assert.equal(map.rev, rev);
    assert.equal(publications, 0);
    assert.equal(feeds, 0);
    return Object.freeze({ classification: "rejection" as const, before, input, after: exact(selected), revisionDelta: 0, publications, evidence: Object.freeze([evidence, "feeds=0"]) });
  });
}
export function lifecycle_operator(
  id: string, name: string, rule: string, applicability: string,
  expected: OperatorClassification, run: () => OperatorResult,
): DeterministicLiveMapOperator {
  return operator(id, "transport-propagation", name, rule, applicability, expected, run);
}
export function observe_map(
  selected: State, input: string,
  act: () => Readonly<{ classification: OperatorClassification; evidence?: readonly string[] }>,
): OperatorResult {
  let publications = 0;
  selected.at([]).feed(() => { publications += 1; });
  const before = exact(selected);
  const rev = selected.rev;
  const outcome = act();
  return Object.freeze({ classification: outcome.classification, before, input, after: exact(selected), revisionDelta: selected.rev - rev, publications, evidence: Object.freeze([...(outcome.evidence ?? [])]) });
}
export function error_code(error: unknown): string {
  if (typeof error !== "object" || error === null) return String(error);
  const value = error as { code?: unknown; reasonCode?: unknown; reason?: unknown; name?: unknown };
  const code = value.code ?? value.reasonCode ?? value.reason ?? value.name;
  return typeof code === "string" ? code : "Error";
}
export function schema_number_map(): State {
  const schema = Hson.schema`<type "data" content <value "number">>`;
  return hsonLiveMap.fromLibraries({ state: { data: { value: 1 }, schema } }).lib("state");
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
