import { Hson, hsonTransform } from "../../src/index.ts";
import type { HsonSchemaData } from "../../src/api/transform/transform.types.ts";
import { parse_hson_exact_runtime } from "../../src/internal/exact-runtime-hson-codec.ts";
import { admit_exact_runtime_livemap_libraries } from "../../src/internal/exact-runtime-node-admission.ts";
import { internal_livemap_aggregate_authority } from "../../src/api/livemap/livemap.internal.ts";
import { validate_document_path } from "../../src/api/livemap/livemap.document.path.ts";
import { is_Node } from "../../src/core/node-guards.ts";
import type { HsonNode } from "../../src/core/types.ts";
import type {
  LiveMap,
  LiveMapDocumentLibrary,
  LiveMapDocumentCommitTarget,
  LiveMapGraphOp,
} from "../../src/types/livemap.types.ts";
import { project_livetree } from "../../src/api/livetree/creation/project-live-tree.ts";
import { FakeElement, install_fake_document } from "./fake-document.mts";

install_fake_document();

const OWNER = new WeakMap<LiveMapDocumentLibrary, LiveMap>();

export function registry_for_document_library(library: LiveMapDocumentLibrary): LiveMap {
  const registry = OWNER.get(library);
  if (registry === undefined) throw new Error("Document library is not owned by this test fixture.");
  return registry;
}

export function commit_document_operations(library: LiveMapDocumentLibrary, operations: readonly LiveMapGraphOp[]) {
  const authority = internal_livemap_aggregate_authority(registry_for_document_library(library));
  const named = authority.libraries()[0];
  if (named === undefined) throw new Error("Missing named document library.");
  return authority.commit(operations.map((operation) => ({
    target: authority.target(named, [0]), kind: "graph" as const, operation,
  })));
}

export function element(source: string): LiveMapDocumentLibrary {
  // Identity-sensitive tests use one named registry with an exact runtime root.
  const document = parse_hson_exact_runtime(source, { allowTopLevelDocumentText: true });
  return document_from_node(document);
}

export function document_from_node(document: HsonNode): LiveMapDocumentLibrary {
  const schema = Hson.schema.fromHson(hsonTransform.fromHson(schema_for_document(document)).toHson().serialize() as HsonSchemaData);
  const registry = admit_exact_runtime_livemap_libraries({ page: { document, schema } });
  const library = registry.lib("page");
  OWNER.set(library, registry);
  return library;
}

function schema_for_document(document: HsonNode): string {
  const children = semantic_children(document);
  if (children.length === 1 && is_Node(children[0]) && !children[0].$_tag.startsWith("_hson_")) {
    return `<type "document" ${element_descriptor(children[0])}>`;
  }
  return `<type "document" content ${content_descriptor(children)}>`;
}

function semantic_children(node: HsonNode): readonly (HsonNode | string | number | boolean | null)[] {
  const result: (HsonNode | string | number | boolean | null)[] = [];
  for (const child of node.$_content) {
    if (is_Node(child) && child.$_tag === "_hson_elem") result.push(...semantic_children(child));
    else result.push(child);
  }
  return result;
}

function element_descriptor(node: HsonNode): string {
  return `tag ${JSON.stringify(node.$_tag)} content ${content_descriptor(semantic_children(node))}`;
}

function content_descriptor(children: readonly (HsonNode | string | number | boolean | null)[]): string {
  if (children.length === 0) return '"empty"';
  if (children.length === 1 && is_Node(children[0]) && children[0].$_tag === "_hson_str") return '"string"';
  if (children.every((child) => is_Node(child) && !child.$_tag.startsWith("_hson_"))) {
    const elements = children.filter(is_Node);
    if (elements.every((child) => child.$_tag === elements[0]?.$_tag && content_descriptor(semantic_children(child)) === content_descriptor(semantic_children(elements[0]!)))) {
      return `<repeat <${element_descriptor(elements[0]!)}>>`;
    }
    return `<sequence [${elements.map((child) => `<${element_descriptor(child)}>`).join(", ")}]>`;
  }
  throw new Error("This legacy fixture contains mixed document content; supply an explicit registry Schema in the test.");
}

export function path(...segments: number[]): LiveMapDocumentCommitTarget {
  return Object.freeze({ kind: "path", path: validate_document_path([0, ...segments]) });
}

export function witnessed_path(
  quid: string,
  ...segments: number[]
): LiveMapDocumentCommitTarget {
  return Object.freeze({
    kind: "path",
    path: validate_document_path([0, ...segments]),
    witness: Object.freeze({ quid }),
  });
}

export function raw_node(root: HsonNode, rawPath: readonly number[]): HsonNode {
  let current = root;
  if (current.$_tag === "_hson_root") {
    const only = current.$_content[0];
    if (!is_Node(only)) throw new Error("Expected one projected document element");
    current = only;
  }
  for (const segment of rawPath) {
    const child = current.$_content[segment];
    if (!is_Node(child)) throw new Error(`Expected node at ${rawPath.join("/")}`);
    current = child;
  }
  return current;
}

export function projected_element(source: string): HsonNode {
  const projected = element(source).at([]).snap();
  if (!is_Node(projected)) throw new Error("Expected one projected document element");
  return projected;
}

export function mount(root: HsonNode): FakeElement {
  return project_livetree(root.$_tag === "_hson_root" ? raw_node(root, []) : root) as unknown as FakeElement;
}
