import type { LiveMapPathKind, LivePath } from "../../types/livemap.types.js";
import type { LiveMapAggregateWrite, LiveMapStructuralTarget } from "./livemap.library.js";
import { format_live_path } from "./livemap.path.js";

export type DataLocationCheck = () => boolean;

export function require_data_location(check: DataLocationCheck | undefined): void {
  if (check?.() === false) throw new Error("Data location refinement no longer matches.");
}

type DataLocationPredicate = Exclude<LiveMapPathKind, "missing"> | "present";
export type DataLocationRefinement = Readonly<{ path: LivePath; expected: DataLocationPredicate }>;

const retainedRefinements = new WeakMap<object, readonly DataLocationRefinement[]>();

export function register_data_location_refinements(location: object, refinements: readonly DataLocationRefinement[]): void {
  if (refinements.length > 0) retainedRefinements.set(location, refinements);
}

export function data_location_refinements(location: object): readonly DataLocationRefinement[] {
  return retainedRefinements.get(location) ?? [];
}

export function matches_data_location(actual: LiveMapPathKind, expected: DataLocationPredicate): boolean {
  return expected === "present" ? actual !== "missing" : actual === expected;
}

export function check_candidate_data_location(refinement: DataLocationRefinement, actual: LiveMapPathKind): void {
  if (!matches_data_location(actual, refinement.expected)) {
    throw new Error(`Data location refinement no longer matches: expected ${refinement.expected} at ${format_live_path(refinement.path)}.`);
  }
}

export function data_location_assertion(
  target: LiveMapStructuralTarget, expected: DataLocationPredicate,
): Extract<LiveMapAggregateWrite, { kind: "assert-data-location" }> {
  return Object.freeze({ target, kind: "assert-data-location", expected });
}
