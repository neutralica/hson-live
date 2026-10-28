import type { PartArgumentKind } from "./part-placeholder.js";

const label = (kind: PartArgumentKind): string => kind === "data" ? "Data" : kind === "doc" ? "Document" : "scalar";

/** Shared receiving-contract wording; names are always incoming names. */
export function part_contract_error(selected: string, parameters: ReadonlyMap<string, PartArgumentKind>,
  problem: "missing" | "unexpected" | "representation", name: string, kind: PartArgumentKind): TypeError {
  const expected = [...parameters].map(([name, kind]) => `${name}: ${label(kind)}`).join(", ") || "no inputs";
  const detail = problem === "missing" ? `is missing ${label(kind)} input ${name}`
    : problem === "unexpected" ? `received unexpected ${label(kind)} input ${name}`
    : `received ${label(kind)} input ${name} that does not match the receiving interface`;
  return new TypeError(`Part ${selected} ${detail}. Expected: ${expected}.`);
}
