import { hson } from "../../src/hson.ts";
import { validate_document_path } from "../../src/api/livemap/livemap.document.path.ts";
import { is_Node } from "../../src/core/node-guards.ts";
import type { HsonNode } from "../../src/core/types.ts";
import type {
  ElementLiveMap,
  LiveMapDocumentCommitTarget,
} from "../../src/types/livemap.types.ts";
import { project_livetree } from "../../src/api/livetree/creation/project-live-tree.ts";
import { FakeElement, install_fake_document } from "./fake-document.mts";

install_fake_document();

export function element(source: string): ElementLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "element") throw new Error("Expected ElementLiveMap");
  return map;
}

export function path(...segments: number[]): LiveMapDocumentCommitTarget {
  return Object.freeze({ kind: "path", path: validate_document_path(segments) });
}

export function witnessed_path(
  quid: string,
  ...segments: number[]
): LiveMapDocumentCommitTarget {
  return Object.freeze({
    kind: "path",
    path: validate_document_path(segments),
    witness: Object.freeze({ quid }),
  });
}

export function raw_node(root: HsonNode, rawPath: readonly number[]): HsonNode {
  let current = root;
  for (const segment of rawPath) {
    const child = current.$_content[segment];
    if (!is_Node(child)) throw new Error(`Expected node at ${rawPath.join("/")}`);
    current = child;
  }
  return current;
}

export function projected_element(source: string): HsonNode {
  return element(source).element.node();
}

export function mount(root: HsonNode): FakeElement {
  return project_livetree(root) as unknown as FakeElement;
}
