import assert from "node:assert/strict";
import type { BrowserRealizationHtml } from "../../src/api/ssr/ssr.types.ts";
import type { LiveMapCommit } from "../../src/types/livemap.types.ts";

/** Tests expecting a graph operation must narrow the complete aggregate stream. */
export function document_graph_operation(commit: Pick<LiveMapCommit, "operations">) {
  const operation = commit.operations[0]?.operation;
  assert.ok(operation !== undefined && "domain" in operation && operation.domain === "graph");
  return operation;
}

export function document_html(library: Readonly<{ mode: string; render?: () => BrowserRealizationHtml }>) {
  if (library.mode !== "document" || library.render === undefined) throw new Error("Expected document Library.");
  return library.render();
}
