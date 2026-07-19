import { ARR_TAG, ELEM_TAG, OBJ_TAG, ROOT_TAG } from "../../core/constants.js";
import { assert_invariants } from "../../core/assert-invariants.js";
import { is_Node, is_ordinary_element_node } from "../../core/node-guards.js";
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
} from "../../types/livemap.types.js";
import { clone_live_root } from "./livemap.editor.js";
import {
  index_livemap_document_elements,
  type LiveMapDocumentIdentityIndex,
} from "./livemap.document.identity.js";
import {
  install_livemap_document_capture,
  type LiveMapDocumentInstallController,
} from "./livemap.document.install.js";
import {
  make_livemap_document_mutation_api,
  type LiveMapDocumentMutationController,
} from "./livemap.document.mutation.js";

export type PreparedLiveMapRoot = Readonly<{
  root: HsonNode;
  mode: LiveMapRootMode;
  documentIdentity?: LiveMapDocumentIdentityIndex;
}>;

/** Clone, validate, classify, and establish document identity before ownership. */
export function prepare_livemap_root(input: HsonNode): PreparedLiveMapRoot {
  const root = clone_live_root(input);
  const mode = classify_live_root_mode(root);

  if (mode === "element" || mode === "fragment") {
    return {
      root,
      mode,
      documentIdentity: index_livemap_document_elements(root),
    };
  }

  return { root, mode };
}

/** Validate and classify one canonical LiveMap root without using JSON projection. */
export function classify_live_root_mode(root: HsonNode): LiveMapRootMode {
  try {
    assert_invariants(root, "classify_live_root_mode");
  } catch (cause) {
    throw new Error("LiveMap cannot own a malformed canonical HSON root.", { cause });
  }

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
  controller?: LiveMapDocumentInstallController & LiveMapDocumentMutationController,
): ClassifiedLiveMap {
  if (prepared.mode === "data-object" || prepared.mode === "data-array") {
    return core as LiveMap;
  }

  if (prepared.documentIdentity === undefined || controller === undefined) {
    throw new Error(`LiveMap document mode ${prepared.mode} was constructed without an identity index.`);
  }
  return make_document_livemap(core, prepared.mode, controller);
}

function make_document_livemap(
  core: LiveMapCore,
  mode: DocumentLiveMapMode,
  controller: LiveMapDocumentInstallController & LiveMapDocumentMutationController,
): DocumentLiveMap {
  const mutationApi = make_livemap_document_mutation_api(controller);
  const content = Object.freeze(Object.assign(
    () => detached_document_content(core.root()),
    { replace: mutationApi.replaceContent },
  ));
  const readApi = Object.freeze({
    root: () => core.root(),
    content,
    byQuid: (quid: string) => {
      const node = controller.identity().get(quid);
      return node === undefined ? undefined : clone_live_root(node);
    },
    attrs: mutationApi.attrs,
  });

  const shared = {
    root: () => core.root(),
    debug: core.debug,
    install: (capture: DocumentLiveMapCapture, options?: DocumentLiveMapInstallOptions) =>
      install_livemap_document_capture(controller, capture, options),
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
        version: 1,
        mode: "element",
        rev: core.rev,
        root: core.root(),
      }),
      element: Object.freeze({
        ...readApi,
        node: () => detached_top_level_element(core.root()),
      }),
    });
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
      version: 1,
      mode: "fragment",
      rev: core.rev,
      root: core.root(),
    }),
    fragment: readApi,
  });
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
