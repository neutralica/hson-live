import { hson } from "../../src/hson.ts";
import { validate_document_path } from "../../src/api/livemap/livemap.document.path.ts";
import { is_Node } from "../../src/core/node-guards.ts";
import type { HsonNode } from "../../src/core/types.ts";
import type {
  DocumentLiveMap,
  LiveMapDocumentCommitTarget,
} from "../../src/types/livemap.types.ts";
import { project_livetree } from "../../src/api/livetree/creation/project-live-tree.ts";
import { FakeElement, install_fake_document } from "./fake-document.mts";

install_fake_document();

export function element(source: string): DocumentLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "document") throw new Error("Expected DocumentLiveMap");
  return map;
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
