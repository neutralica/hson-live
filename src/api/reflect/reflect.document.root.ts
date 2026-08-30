import { HSON_META_QUID, ROOT_TAG } from "../../core/constants.js";
import { is_ordinary_element_node } from "../../core/node-guards.js";
import type { HsonNode } from "../../core/types.js";
import type { DocumentLiveMapMode } from "../../types/livemap.types.js";
import { canonical_graph_equal } from "../livemap/livemap.document.install.js";
import { SVG_NS } from "../transform/utils/node-utils/node-from-svg.js";
import { get_el_for_node } from "../livetree/utils/node-map-helpers.js";
import {
  DOCUMENT_REFLECT_DOM_MAPPING_MISMATCH_ERROR_CODE,
  DOCUMENT_REFLECT_ROOT_KIND_MISMATCH_ERROR_CODE,
  DOCUMENT_REFLECT_ROOT_MATERIAL_MISSING_ERROR_CODE,
  DOCUMENT_REFLECT_ROOT_QUID_CONFLICT_ERROR_CODE,
  DOCUMENT_REFLECT_ROOT_VALIDATION_FAILED_ERROR_CODE,
  DocumentReflectError,
} from "./reflect.document.error.js";
import {
  plan_document_root_structural_transaction,
  type DocumentStructuralPlan,
} from "./reflect.document.structure.js";

type PersistedQuidLookup = (node: HsonNode) => string | undefined;

export type DocumentRootMaterial = Readonly<{
  mode: DocumentLiveMapMode;
  root: HsonNode;
}>;

export type DocumentRootConvergencePlan = Readonly<{
  canonicalRoot: HsonNode;
  structural: DocumentStructuralPlan;
}>;

/** Validate and plan a compatible rooted-document convergence transaction. */
export function plan_document_root_convergence(
  projectedRoot: HsonNode,
  canonicalDocumentRoot: HsonNode,
  observedMaterial: DocumentRootMaterial,
  priorCanonicalRootQuid: string | undefined,
  persistedQuidForExisting: PersistedQuidLookup,
): DocumentRootConvergencePlan {
  if (observedMaterial.mode !== "document" || !canonical_graph_equal(observedMaterial.root, canonicalDocumentRoot)) {
    throw new DocumentReflectError(
      DOCUMENT_REFLECT_ROOT_MATERIAL_MISSING_ERROR_CODE,
      "Observed whole-root material does not match the current canonical document root.",
    );
  }
  const canonicalRoot = canonicalDocumentRoot;
  const rootsAreContainers = projectedRoot.$_tag === ROOT_TAG && canonicalRoot.$_tag === ROOT_TAG;
  const rootsAreCompatibleElements = is_ordinary_element_node(projectedRoot)
    && is_ordinary_element_node(canonicalRoot)
    && projectedRoot.$_tag === canonicalRoot.$_tag;
  if (!rootsAreContainers && !rootsAreCompatibleElements) {
    throw new DocumentReflectError(
      DOCUMENT_REFLECT_ROOT_KIND_MISMATCH_ERROR_CODE,
      "Compatible root convergence requires matching document-facing roots.",
    );
  }
  const nextCanonicalRootQuid = canonicalRoot.$_meta?.[HSON_META_QUID];
  if (priorCanonicalRootQuid !== nextCanonicalRootQuid) {
    throw new DocumentReflectError(
      DOCUMENT_REFLECT_ROOT_QUID_CONFLICT_ERROR_CODE,
      "Compatible root convergence cannot introduce, remove, or change root subject identity.",
    );
  }
  validate_mounted_root_namespace(projectedRoot);
  try {
    const structural = plan_document_root_structural_transaction(
      projectedRoot,
      canonicalRoot,
      persistedQuidForExisting,
    );
    return Object.freeze({ canonicalRoot, structural });
  } catch (cause) {
    if (cause instanceof DocumentReflectError) throw cause;
    throw new DocumentReflectError(
      DOCUMENT_REFLECT_ROOT_VALIDATION_FAILED_ERROR_CODE,
      "Compatible root convergence planning failed.",
      cause,
    );
  }
}

/** Require the internal rooted-document carrier used by Reflection. @internal */
export function document_root_from_root(root: HsonNode): HsonNode {
  if (root.$_tag !== ROOT_TAG) {
    throw new DocumentReflectError(
      DOCUMENT_REFLECT_ROOT_MATERIAL_MISSING_ERROR_CODE,
      "Replace-root material does not contain an internal document root.",
    );
  }
  return root;
}

function validate_mounted_root_namespace(root: HsonNode): void {
  if (!is_ordinary_element_node(root)) return;
  const element = get_el_for_node(root);
  if (element === undefined) return;
  const expectedNamespace = root.$_tag === "svg" ? SVG_NS : "http://www.w3.org/1999/xhtml";
  if (element.namespaceURI !== expectedNamespace) {
    throw new DocumentReflectError(
      DOCUMENT_REFLECT_DOM_MAPPING_MISMATCH_ERROR_CODE,
      "Mounted projected root namespace does not match its Hson element kind.",
    );
  }
}
