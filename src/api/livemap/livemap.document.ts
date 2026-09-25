import { ARR_TAG, ELEM_TAG, OBJ_TAG, ROOT_TAG, STR_TAG, VAL_TAG } from "../../core/constants.js";
import { assert_invariants } from "../../core/assert-invariants.js";
import { is_Node, is_ordinary_element_node } from "../../core/node-guards.js";
import type { HsonNode } from "../../core/types.js";
import type { DataLiveMapMode, LiveMapRootMode } from "../../types/livemap.types.js";
import { clone_live_root } from "./livemap.editor.js";
import { build_livemap_document_identity_overlay, type LiveMapDocumentIdentityOverlay } from "./livemap.document.identity.js";
import { normalize_hson_array_index_order } from "../../core/hson-array-indexes.js";
import { build_livemap_projected_identity_overlay, type LiveMapProjectedIdentityOverlay } from "./livemap.projected.identity.js";
import { assert_document_special_tags } from "../../core/document-special-tags.js";

export type PreparedLiveMapRoot = Readonly<{
  root: HsonNode;
  mode: LiveMapRootMode;
  documentOverlay?: LiveMapDocumentIdentityOverlay;
  projectedOverlay?: LiveMapProjectedIdentityOverlay;
}>;

/** Clone, validate, classify, and establish document identity before ownership. */
export function prepare_livemap_root(input: HsonNode, family?: "data" | "document"): PreparedLiveMapRoot {
  const cloned = normalize_hson_array_index_order(
    clone_live_root(input),
    "prepare_livemap_root",
  );
  // Validate before carrier normalization so nonempty metadata on a discarded
  // structural wrapper can never disappear during LiveMap admission.
  assert_invariants(cloned, "prepare_livemap_root");
  const root = normalize_document_root(cloned);
  let mode: LiveMapRootMode;
  try {
    mode = classify_live_root_shape(root, family);
  } catch {
    // Preserve the established malformed-root cause chain while still letting
    // the document overlay own QUID validation for classifiable documents.
    mode = classify_live_root_mode(root, family);
  }

  if (mode === "document") {
    const documentOverlay = build_livemap_document_identity_overlay(root, mode);
    classify_live_root_mode(root, family);
    return {
      root,
      mode,
      documentOverlay,
    };
  }

  const projectedOverlay = build_livemap_projected_identity_overlay(root);
  classify_live_root_mode(root, family);
  return { root, mode, projectedOverlay };
}

/** Validate and classify one canonical LiveMap root without using JSON projection. */
export function classify_live_root_mode(root: HsonNode, family?: "data" | "document"): LiveMapRootMode {
  try {
    assert_invariants(root, "classify_live_root_mode");
  } catch (cause) {
    throw new Error("LiveMap cannot own a malformed canonical Hson root.", { cause });
  }

  const mode = classify_live_root_shape(root, family);
  if (family === "data" && mode === "document" || family === "document" && mode !== "document") {
    throw new Error(`LiveMap ${family} root has an incompatible semantic family.`);
  }
  if (mode === "document") assert_document_special_tags(root);
  return mode;
}

function classify_live_root_shape(root: HsonNode, family?: "data" | "document"): LiveMapRootMode {

  if (root.$_tag === OBJ_TAG) return "data-object";
  if (root.$_tag === ARR_TAG) return "data-array";
  if (family === "data" && (root.$_tag === STR_TAG || root.$_tag === VAL_TAG)) return primitive_data_mode(root);
  if (root.$_tag !== ROOT_TAG) {
    throw new Error(
      `LiveMap canonical root must be <${ROOT_TAG}>; observed <${root.$_tag}> with ${root.$_content.length} top-level content item(s).`,
    );
  }

  if (root.$_content.length === 0) return "document";

  const cluster = root.$_content[0];
  if (!is_Node(cluster)) {
    throw new Error(
      `LiveMap canonical root contains a primitive top-level item; observed ${root.$_content.length} top-level content item(s).`,
    );
  }

  if (cluster.$_tag === OBJ_TAG) return "data-object";
  if (cluster.$_tag === ARR_TAG) return "data-array";
  if (family === "data" && (cluster.$_tag === STR_TAG || cluster.$_tag === VAL_TAG)) return primitive_data_mode(cluster);
  if (cluster.$_tag === ELEM_TAG) return "document";
  if (cluster.$_tag === STR_TAG || is_ordinary_element_node(cluster)) return "document";
  throw new Error(
    "LiveMap canonical root has unsupported top-level content; expected data cluster or document content.",
  );
}

function primitive_data_mode(node: HsonNode): DataLiveMapMode {
  if (node.$_tag === STR_TAG) return "data-string";
  const value = node.$_content[0];
  if (value === null) return "data-null";
  if (typeof value === "boolean") return "data-boolean";
  if (typeof value === "number") return "data-number";
  throw new Error("LiveMap primitive data root is malformed.");
}

/** Convert parser/detached element carriers into the one retained document root shape. */
function normalize_document_root(root: HsonNode): HsonNode {
  if (root.$_tag === ELEM_TAG) {
    return { $_tag: ROOT_TAG, $_content: root.$_content.slice() };
  }
  if (root.$_tag !== ROOT_TAG || root.$_content.length !== 1) return root;
  const child = root.$_content[0];
  if (!is_Node(child) || child.$_tag !== ELEM_TAG) return root;
  return { $_tag: ROOT_TAG, $_content: child.$_content.slice() };
}

/** Assert a classified root mode for internal construction paths that require it. */
export function assert_live_root_mode(
  root: HsonNode,
  expected: LiveMapRootMode | readonly LiveMapRootMode[],
): LiveMapRootMode {
  const observed = classify_live_root_mode(root);
  const accepted = typeof expected === "string" ? [expected] : expected;
  if (!accepted.includes(observed)) {
    throw new Error(
      `LiveMap root mode mismatch: expected ${accepted.join(" or ")}; observed ${observed} with ${describe_top_level(root)}.`,
    );
  }
  return observed;
}

function describe_top_level(root: HsonNode): string {
  if (root.$_content.length === 0) return "an empty canonical root";
  const cluster = root.$_content[0];
  if (!is_Node(cluster)) return `${root.$_content.length} primitive top-level item(s)`;
  if (cluster.$_tag === ELEM_TAG) {
    const types = cluster.$_content.map((item) => is_Node(item) ? item.$_tag : typeof item);
    return `${cluster.$_content.length} document content item(s): ${types.join(", ") || "empty"}`;
  }
  return `top-level cluster <${cluster.$_tag}>`;
}

export function is_data_livemap_mode(mode: LiveMapRootMode): mode is DataLiveMapMode {
  return mode !== "document";
}
