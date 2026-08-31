import { ARR_TAG, ELEM_TAG, OBJ_TAG, ROOT_TAG, STR_TAG } from "../../core/constants.js";
import { assert_invariants } from "../../core/assert-invariants.js";
import { is_Node, is_ordinary_element_node } from "../../core/node-guards.js";
import { is_persisted_quid } from "../../core/persisted-quid.js";
import type { HsonNode } from "../../core/types.js";
import type { HsonSchema } from "../transform/transform.types.js";
import type {
  ClassifiedLiveMap,
  DataLiveMapMode,
  DocumentLiveMap,
  DocumentLiveMapCapture,
  DocumentLiveMapCaptureApi,
  DocumentLiveMapCaptureOptions,
  DocumentLiveMapInstallOptions,
  DocumentLiveMapMode,
  LiveMap,
  LiveMapCore,
  LiveMapDocumentApi,
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
import {
  make_livemap_document_attrs_read_api,
  make_livemap_document_flags_read_api,
} from "./livemap.document.attrs.js";
import { normalize_hson_array_index_order } from "../../core/hson-array-indexes.js";
import { capture_livemap_document } from "./livemap.document.capture.js";
import { register_livemap_document_identity_authority } from "./livemap.document.registration.js";
import { make_livemap_document_identity_api, register_livemap_document_identity_api } from "./livemap.document.identity-handle.js";
import {
  build_livemap_projected_identity_overlay,
  type LiveMapProjectedIdentityOverlay,
} from "./livemap.projected.identity.js";
import { register_livemap_identity_epoch_owner } from "./livemap.identity-epoch.js";
import { make_livemap_document_location_factory } from "./livemap.document.location.js";
import { make_livemap_document_proxy } from "./livemap.proxy.js";
import type { LiveMapDocumentWatchRegistration } from "./livemap.watch.js";
import type { InternalDocumentSchemaController } from "./livemap.document.schema.js";

export type PreparedLiveMapRoot = Readonly<{
  root: HsonNode;
  mode: LiveMapRootMode;
  documentOverlay?: LiveMapDocumentIdentityOverlay;
  projectedOverlay?: LiveMapProjectedIdentityOverlay;
}>;

/** Clone, validate, classify, and establish document identity before ownership. */
export function prepare_livemap_root(input: HsonNode): PreparedLiveMapRoot {
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
    mode = classify_live_root_shape(root);
  } catch {
    // Preserve the established malformed-root cause chain while still letting
    // the document overlay own QUID validation for classifiable documents.
    mode = classify_live_root_mode(root);
  }

  if (mode === "document") {
    const documentOverlay = build_livemap_document_identity_overlay(root, mode);
    classify_live_root_mode(root);
    return {
      root,
      mode,
      documentOverlay,
    };
  }

  const projectedOverlay = build_livemap_projected_identity_overlay(root);
  classify_live_root_mode(root);
  return { root, mode, projectedOverlay };
}

/** Validate and classify one canonical LiveMap root without using JSON projection. */
export function classify_live_root_mode(root: HsonNode): LiveMapRootMode {
  try {
    assert_invariants(root, "classify_live_root_mode");
  } catch (cause) {
    throw new Error("LiveMap cannot own a malformed canonical Hson root.", { cause });
  }

  return classify_live_root_shape(root);
}

function classify_live_root_shape(root: HsonNode): LiveMapRootMode {

  if (root.$_tag === OBJ_TAG) return "data-object";
  if (root.$_tag === ARR_TAG) return "data-array";
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
  if (cluster.$_tag === ELEM_TAG) return "document";
  if (cluster.$_tag === STR_TAG || is_ordinary_element_node(cluster)) return "document";
  throw new Error(
    "LiveMap canonical root has unsupported top-level content; expected data cluster or document content.",
  );
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

/** Return the existing data surface or the narrow document façade by mode. */
export function facade_for_livemap_root(
  core: LiveMapCore,
  prepared: PreparedLiveMapRoot,
  controller?: LiveMapDocumentInstallController & LiveMapDocumentMutationController & LiveMapDocumentReplayController & InternalDocumentSchemaController,
  watchDocument?: LiveMapDocumentWatchRegistration,
): ClassifiedLiveMap {
  if (prepared.mode === "data-object" || prepared.mode === "data-array") {
    return core as LiveMap;
  }

  if (prepared.documentOverlay === undefined || controller === undefined) {
    throw new Error(`LiveMap document mode ${prepared.mode} was constructed without an identity overlay.`);
  }
  if (watchDocument === undefined) {
    throw new Error(`LiveMap document mode ${prepared.mode} was constructed without location watch authority.`);
  }
  return make_document_livemap(core, prepared.mode, controller, watchDocument);
}

function make_document_livemap(
  core: LiveMapCore,
  mode: DocumentLiveMapMode,
  controller: LiveMapDocumentInstallController & LiveMapDocumentMutationController & LiveMapDocumentReplayController & InternalDocumentSchemaController,
  watchDocument: LiveMapDocumentWatchRegistration,
): DocumentLiveMap {
  const mutationApi = make_livemap_document_mutation_api(controller);
  const attrReads = make_livemap_document_attrs_read_api(controller);
  const attrs = Object.freeze({ ...attrReads, ...mutationApi.attrs });
  const flagReads = make_livemap_document_flags_read_api(controller);
  const flags = Object.freeze({ ...flagReads, ...mutationApi.flags });
  const content = Object.freeze(Object.assign(
    () => detached_document_content(core.root()),
    {
      replace: mutationApi.replaceContent,
      insert: mutationApi.insertContent,
      remove: mutationApi.removeContent,
      move: mutationApi.moveContent,
    },
  ));
  let document: LiveMapDocumentApi;
  const identityApi = make_livemap_document_identity_api(() => document, controller);
  const at = make_livemap_document_location_factory(core, mode, {
    attrs,
    flags,
    replace: mutationApi.replaceContent,
    remove: mutationApi.removeContent,
    insert: mutationApi.insertContent,
    move: mutationApi.moveContent,
  }, watchDocument);
  const proxy = (path: readonly number[] = []) => make_livemap_document_proxy(at(path));
  document = Object.freeze({
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
    flags,
  });
  register_livemap_document_identity_api(document, identityApi);
  register_livemap_document_identity_overlay(document, controller.overlay);
  register_livemap_document_identity_authority(document, controller);
  register_livemap_identity_epoch_owner(document, controller.identityEpoch);

  const shared = {
    root: () => core.root(),
    at,
    proxy,
    install: (capture: DocumentLiveMapCapture, options?: DocumentLiveMapInstallOptions) =>
      install_livemap_document_capture(controller, capture, options),
    restore: (capture: DocumentLiveMapCapture, options?: DocumentLiveMapInstallOptions) =>
      restore_livemap_document_capture(controller, capture, options),
    replay: (commit: LiveMapGraphCommit) => replay_livemap_document_commit(controller, commit),
    commits: controller.commits,
  };

  const capture: DocumentLiveMapCaptureApi<"document"> = (
    options?: DocumentLiveMapCaptureOptions,
  ) => capture_livemap_document(
    controller.identityEpoch,
    "document",
    core.rev,
    core.root(),
    options,
  );
  let documentMap: DocumentLiveMap;
  const schema: DocumentLiveMap["schema"] = Object.freeze({
    get: controller.getDocumentSchema,
    use: ((documentSchema: HsonSchema) => {
      controller.useDocumentSchema(documentSchema);
        return documentMap;
      }) as DocumentLiveMap["schema"]["use"],
  });
  documentMap = Object.freeze({
    ...shared,
    schema,
    mode,
    get rev() {
      return core.rev;
    },
    capture,
    document,
  });
  register_livemap_document_identity_overlay(documentMap, controller.overlay);
  register_livemap_identity_epoch_owner(documentMap, controller.identityEpoch);
  return documentMap;
}

function detached_document_content(root: HsonNode): readonly (HsonNode | string | number | boolean | null)[] {
  if (root.$_tag !== ROOT_TAG) {
    throw new Error(`LiveMap document read expected <${ROOT_TAG}>; observed ${describe_top_level(root)}.`);
  }
  return root.$_content.slice();
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
