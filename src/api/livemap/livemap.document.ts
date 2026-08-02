import { ARR_TAG, ELEM_TAG, OBJ_TAG, ROOT_TAG } from "../../core/constants.js";
import { assert_invariants } from "../../core/assert-invariants.js";
import { is_Node, is_ordinary_element_node } from "../../core/node-guards.js";
import { is_persisted_quid } from "../../core/persisted-quid.js";
import { scan_hson_node_quids } from "../../core/hson-node-quid.js";
import type { HsonNode } from "../../core/types.js";
import type {
  ClassifiedLiveMap,
  DataLiveMapMode,
  DocumentLiveMap,
  DocumentLiveMapCapture,
  DocumentLiveMapInstallOptions,
  DocumentLiveMapMode,
  ElementLiveMap,
  FragmentLiveMap,
  LiveMap,
  LiveMapCore,
  LiveMapRootMode,
  LiveMapGraphCommit,
} from "../../types/livemap.types.js";
import { clone_live_root } from "./livemap.editor.js";
import {
  build_livemap_document_identity_overlay,
  register_livemap_document_identity_overlay,
  type LiveMapDocumentIdentityOverlay,
} from "./livemap.document.identity.js";
import { resolve_document_path } from "./livemap.document.path.js";
import {
  install_livemap_document_capture,
  restore_livemap_document_capture,
  type LiveMapDocumentInstallController,
} from "./livemap.document.install.js";
import {
  replay_livemap_document_commit,
  type LiveMapDocumentReplayController,
} from "./livemap.document.replay.js";
import {
  make_livemap_document_mutation_api,
  type LiveMapDocumentMutationController,
} from "./livemap.document.mutation.js";
import { make_livemap_document_attrs_read_api } from "./livemap.document.attrs.js";
import { normalize_hson_array_index_order } from "../../core/hson-array-indexes.js";

export type PreparedLiveMapRoot = Readonly<{
  root: HsonNode;
  mode: LiveMapRootMode;
  documentOverlay?: LiveMapDocumentIdentityOverlay;
}>;

/** Clone, validate, classify, and establish document identity before ownership. */
export function prepare_livemap_root(input: HsonNode): PreparedLiveMapRoot {
  const root = normalize_hson_array_index_order(
    clone_live_root(input),
    "prepare_livemap_root",
  );
  let mode: LiveMapRootMode;
  try {
    mode = classify_live_root_shape(root);
  } catch {
    // Preserve the established malformed-root cause chain while still letting
    // the document overlay own QUID validation for classifiable documents.
    mode = classify_live_root_mode(root);
  }

  if (mode === "element" || mode === "fragment") {
    const documentOverlay = build_livemap_document_identity_overlay(root, mode);
    classify_live_root_mode(root);
    return {
      root,
      mode,
      documentOverlay,
    };
  }

  // Preserve canonical QUID validation for non-document maps without
  // retaining any per-node identity structure.
  scan_hson_node_quids(root);
  classify_live_root_mode(root);
  return { root, mode };
}

/** Validate and classify one canonical LiveMap root without using JSON projection. */
export function classify_live_root_mode(root: HsonNode): LiveMapRootMode {
  try {
    assert_invariants(root, "classify_live_root_mode");
  } catch (cause) {
    throw new Error("LiveMap cannot own a malformed canonical HSON root.", { cause });
  }

  return classify_live_root_shape(root);
}

function classify_live_root_shape(root: HsonNode): LiveMapRootMode {

  if (root.$_tag === OBJ_TAG) return "data-object";
  if (root.$_tag === ARR_TAG) return "data-array";
  if (root.$_tag === ELEM_TAG) return classify_document_cluster(root);

  if (root.$_tag !== ROOT_TAG) {
    throw new Error(
      `LiveMap canonical root must be <${ROOT_TAG}>; observed <${root.$_tag}> with ${root.$_content.length} top-level content item(s).`,
    );
  }

  if (root.$_content.length === 0) return "fragment";

  const cluster = root.$_content[0];
  if (!is_Node(cluster)) {
    throw new Error(
      `LiveMap canonical root contains a primitive top-level item; observed ${root.$_content.length} top-level content item(s).`,
    );
  }

  if (cluster.$_tag === OBJ_TAG) return "data-object";
  if (cluster.$_tag === ARR_TAG) return "data-array";
  if (cluster.$_tag !== ELEM_TAG) {
    throw new Error(
      `LiveMap canonical root has unsupported top-level cluster <${cluster.$_tag}>; expected <${OBJ_TAG}>, <${ARR_TAG}>, or <${ELEM_TAG}>.`,
    );
  }

  return classify_document_cluster(cluster);
}

function classify_document_cluster(cluster: HsonNode): DocumentLiveMapMode {
  return cluster.$_content.length === 1 && is_ordinary_element_node(cluster.$_content[0])
    ? "element"
    : "fragment";
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

/** Return the existing data surface or the narrow document façade by mode. */
export function facade_for_livemap_root(
  core: LiveMapCore,
  prepared: PreparedLiveMapRoot,
  controller?: LiveMapDocumentInstallController & LiveMapDocumentMutationController & LiveMapDocumentReplayController,
): ClassifiedLiveMap {
  if (prepared.mode === "data-object" || prepared.mode === "data-array") {
    return core as LiveMap;
  }

  if (prepared.documentOverlay === undefined || controller === undefined) {
    throw new Error(`LiveMap document mode ${prepared.mode} was constructed without an identity overlay.`);
  }
  return make_document_livemap(core, prepared.mode, controller);
}

function make_document_livemap(
  core: LiveMapCore,
  mode: DocumentLiveMapMode,
  controller: LiveMapDocumentInstallController & LiveMapDocumentMutationController & LiveMapDocumentReplayController,
): DocumentLiveMap {
  const mutationApi = make_livemap_document_mutation_api(controller);
  const attrReads = make_livemap_document_attrs_read_api(controller);
  const attrs = Object.freeze({ ...attrReads, ...mutationApi.attrs });
  const content = Object.freeze(Object.assign(
    () => detached_document_content(core.root()),
    {
      replace: mutationApi.replaceContent,
      insert: mutationApi.insertContent,
      remove: mutationApi.removeContent,
      move: mutationApi.moveContent,
    },
  ));
  const document = Object.freeze({
    root: () => core.root(),
    content,
    byQuid: (quid: string) => {
      if (!is_persisted_quid(quid)) return undefined;
      const path = controller.overlay().pathForQuid(quid);
      if (path === undefined) return undefined;
      const node = resolve_document_path(controller.root(), mode, path);
      return is_Node(node) ? clone_live_root(node) : undefined;
    },
    attrs,
  });
  register_livemap_document_identity_overlay(document, controller.overlay);

  const shared = {
    root: () => core.root(),
    debug: core.debug,
    install: (capture: DocumentLiveMapCapture, options?: DocumentLiveMapInstallOptions) =>
      install_livemap_document_capture(controller, capture, options),
    restore: (capture: DocumentLiveMapCapture, options?: DocumentLiveMapInstallOptions) =>
      restore_livemap_document_capture(controller, capture, options),
    replay: (commit: LiveMapGraphCommit) => replay_livemap_document_commit(controller, commit),
    commits: controller.commits,
  };

  if (mode === "element") {
    const elementMap: ElementLiveMap = Object.freeze({
      ...shared,
      mode,
      get rev() {
        return core.rev;
      },
      capture: (): DocumentLiveMapCapture<"element"> => Object.freeze({
        kind: "hson-document",
        version: 2,
        mode: "element",
        rev: core.rev,
        root: core.root(),
      }),
      document,
      element: Object.freeze({
        node: () => detached_top_level_element(core.root()),
      }),
    });
    register_livemap_document_identity_overlay(elementMap, controller.overlay);
    return elementMap;
  }

  const fragmentMap: FragmentLiveMap = Object.freeze({
    ...shared,
    mode,
    get rev() {
      return core.rev;
    },
    capture: (): DocumentLiveMapCapture<"fragment"> => Object.freeze({
      kind: "hson-document",
      version: 2,
      mode: "fragment",
      rev: core.rev,
      root: core.root(),
    }),
    document,
  });
  register_livemap_document_identity_overlay(fragmentMap, controller.overlay);
  return fragmentMap;
}

function detached_document_content(root: HsonNode): readonly (HsonNode | string | number | boolean | null)[] {
  if (root.$_tag === ROOT_TAG && root.$_content.length === 0) return [];
  const cluster = document_cluster(root);
  if (cluster === undefined) {
    throw new Error(`LiveMap document read expected <${ELEM_TAG}> content; observed ${describe_top_level(root)}.`);
  }
  return cluster.$_content.slice();
}

function detached_top_level_element(root: HsonNode): HsonNode {
  const cluster = document_cluster(root);
  if (cluster === undefined || cluster.$_content.length !== 1) {
    throw new Error(`LiveMap element read expected exactly one ordinary top-level element; observed ${describe_top_level(root)}.`);
  }
  const element = cluster.$_content[0];
  if (!is_ordinary_element_node(element)) {
    throw new Error(`LiveMap element read expected exactly one ordinary top-level element; observed ${describe_top_level(root)}.`);
  }
  return element;
}

function document_cluster(root: HsonNode): HsonNode | undefined {
  if (root.$_tag === ELEM_TAG) return root;
  const cluster = root.$_content[0];
  return is_Node(cluster) && cluster.$_tag === ELEM_TAG ? cluster : undefined;
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
  return mode === "data-object" || mode === "data-array";
}
