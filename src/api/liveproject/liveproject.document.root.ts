import { ELEM_TAG, ROOT_TAG, _DATA_QUID } from "../../core/constants.js";
import { is_Node, is_ordinary_element_node } from "../../core/node-guards.js";
import type { HsonNode } from "../../core/types.js";
import type { DocumentLiveMapMode } from "../../types/livemap.types.js";
import { canonical_graph_equal } from "../livemap/livemap.document.install.js";
import { SVG_NS } from "../transform/utils/node-utils/node-from-svg.js";
import { get_el_for_node } from "../livetree/utils/node-map-helpers.js";
import {
  DOCUMENT_BINDING_DOM_MAPPING_MISMATCH_ERROR_CODE,
  DOCUMENT_BINDING_ROOT_KIND_MISMATCH_ERROR_CODE,
  DOCUMENT_BINDING_ROOT_MATERIAL_MISSING_ERROR_CODE,
  DOCUMENT_BINDING_ROOT_QUID_CONFLICT_ERROR_CODE,
  DOCUMENT_BINDING_ROOT_VALIDATION_FAILED_ERROR_CODE,
  DocumentLiveTreeBindingError,
} from "./liveproject.document.error.js";
import {
  plan_document_root_structural_transaction,
  type DocumentStructuralPlan,
} from "./liveproject.document.structure.js";

type PersistedQuidLookup = (node: HsonNode) => string | undefined;

export type DocumentRootMaterial = Readonly<{
  mode: DocumentLiveMapMode;
  root: HsonNode;
}>;

export type DocumentRootConvergencePlan = Readonly<{
  canonicalElement: HsonNode;
  structural: DocumentStructuralPlan;
}>;

/** Validate and plan a compatible ElementLiveMap root convergence transaction. */
export function plan_document_root_convergence(
  projectedRoot: HsonNode,
  canonicalDocumentRoot: HsonNode,
  observedMaterial: DocumentRootMaterial,
  priorCanonicalRootQuid: string | undefined,
  persistedQuidForExisting: PersistedQuidLookup,
): DocumentRootConvergencePlan {
  if (observedMaterial.mode !== "element" || !canonical_graph_equal(observedMaterial.root, canonicalDocumentRoot)) {
    throw new DocumentLiveTreeBindingError(
      DOCUMENT_BINDING_ROOT_MATERIAL_MISSING_ERROR_CODE,
      "Observed whole-root material does not match the current canonical ElementLiveMap root.",
    );
  }
  const canonicalElement = top_level_element(canonicalDocumentRoot);
  if (!is_ordinary_element_node(projectedRoot) || !is_ordinary_element_node(canonicalElement)
    || projectedRoot.$_tag !== canonicalElement.$_tag) {
    throw new DocumentLiveTreeBindingError(
      DOCUMENT_BINDING_ROOT_KIND_MISMATCH_ERROR_CODE,
      "Compatible root convergence requires the same ordinary-element tag.",
    );
  }
  const nextCanonicalRootQuid = canonicalElement.$_meta?.[_DATA_QUID];
  if (priorCanonicalRootQuid !== nextCanonicalRootQuid) {
    throw new DocumentLiveTreeBindingError(
      DOCUMENT_BINDING_ROOT_QUID_CONFLICT_ERROR_CODE,
      "Compatible root convergence cannot introduce, remove, or change the persisted root QUID.",
    );
  }
  validate_mounted_root_namespace(projectedRoot);
  try {
    const structural = plan_document_root_structural_transaction(
      projectedRoot,
      canonicalElement,
      persistedQuidForExisting,
    );
    return Object.freeze({ canonicalElement, structural });
  } catch (cause) {
    if (cause instanceof DocumentLiveTreeBindingError) throw cause;
    throw new DocumentLiveTreeBindingError(
      DOCUMENT_BINDING_ROOT_VALIDATION_FAILED_ERROR_CODE,
      "Compatible root convergence planning failed.",
      cause,
    );
  }
}

function top_level_element(root: HsonNode): HsonNode {
  const cluster = root.$_tag === ELEM_TAG
    ? root
    : root.$_tag === ROOT_TAG && is_Node(root.$_content[0]) && root.$_content[0].$_tag === ELEM_TAG
      ? root.$_content[0]
      : undefined;
  const element = cluster?.$_content.length === 1 ? cluster.$_content[0] : undefined;
  if (!is_Node(element) || !is_ordinary_element_node(element)) {
    throw new DocumentLiveTreeBindingError(
      DOCUMENT_BINDING_ROOT_MATERIAL_MISSING_ERROR_CODE,
      "Replace-root material does not contain exactly one ordinary top-level element.",
    );
  }
  return element;
}

function validate_mounted_root_namespace(root: HsonNode): void {
  const element = get_el_for_node(root);
  if (element === undefined) return;
  const expectedNamespace = root.$_tag === "svg" ? SVG_NS : "http://www.w3.org/1999/xhtml";
  if (element.namespaceURI !== expectedNamespace) {
    throw new DocumentLiveTreeBindingError(
      DOCUMENT_BINDING_DOM_MAPPING_MISMATCH_ERROR_CODE,
      "Mounted projected root namespace does not match its HSON element kind.",
    );
  }
}
