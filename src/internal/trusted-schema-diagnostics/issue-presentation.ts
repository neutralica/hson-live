/** Private semantic evidence: no English-message parsing or public taxonomy. */
export type SchemaIssuePresentation = Readonly<{ subject?: "tag" | "flag"; constraintLabel?: string }>;
const EVIDENCE = new WeakMap<object, SchemaIssuePresentation>();
export function annotate_schema_issue<T extends object>(issue: T, evidence: SchemaIssuePresentation): T {
  EVIDENCE.set(issue, Object.freeze(evidence));
  return issue;
}
export function read_schema_issue_presentation(issue: object): SchemaIssuePresentation | undefined { return EVIDENCE.get(issue); }
