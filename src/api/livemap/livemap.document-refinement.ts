/** Retained logical predicates are local capability evidence, never portable state. @internal */
export type DocumentLocationRefinement = Readonly<{
  path: readonly number[];
  expected: "present" | "element" | "root" | "text";
}>;
const refinements = new WeakMap<object, readonly DocumentLocationRefinement[]>();
export function register_document_location_refinements(location: object, checks: readonly DocumentLocationRefinement[]): void {
  refinements.set(location, checks);
}
export function document_location_refinements(location: object): readonly DocumentLocationRefinement[] {
  return refinements.get(location) ?? [];
}
