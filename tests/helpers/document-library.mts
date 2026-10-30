import assert from "node:assert/strict";
import type { BrowserRealizationHtml } from "../../src/api/ssr/ssr.types.ts";
import type { LiveMapCommit } from "../../src/types/livemap.types.ts";
import { hsonTransform } from "../../src/index.ts";
import { is_ordinary_element_node } from "../../src/core/node-guards.ts";
import { resolve_document_path, validate_document_path } from "../../src/api/livemap/livemap.document.path.ts";

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

/** Inspect the ordinary authored root after complete-Document admission. */
export function body_root(root: import("../../src/core/types.ts").HsonNode) {
  const node = resolve_document_path(root, "document", validate_document_path([0, 0, 1, 0, 0]));
  if (!is_ordinary_element_node(node)) throw new Error("Expected authored body element.");
  return node;
}

/** Explicit full-page expectation for fixtures authored as one body element. */
export function complete_hson(body: string) {
  return hsonTransform.fromHson(`<html <head/> <body ${body}/>/>`).toHson().serialize();
}
export function complete_html(body: string) {
  return `<!doctype html><html><head></head><body>${body}</body></html>`;
}
