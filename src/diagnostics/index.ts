// index.ts


export { assert_invariants as _assert_invariants } from "./assert-invariants.test.js";
export { compare_nodes as _compare_nodes } from "./compare-nodes.test.js";
export { is_Node as _is_Node } from "../core/node-guards.js"
export { _circuit_test  } from "./test-circuit.js";
export { _format_test  } from "./test-format.js";
export { Artifact, LoopReport, FixtureAtom, LoopOpts } from "../types/diagnostics.types.js";


// dev exports 
export { CREATE_NODE as _CREATE_NODE } from "../core/factories.js";
export { _listeners_off_for_target, _listeners_debug_hard_reset } from "../api/livetree/managers/listener-builder.js";

export { parse_style_string as _parse_style_string } from "../api/transform/utils/attrs-utils/parse-style.js";
export { parse_selector as _parse_selector } from "../api/livetree/utils/parse-selector.js";
export { serialize_style as _serialize_style } from "../api/transform/utils/attrs-utils/serialize-style.js";
export { disposables_count_for_owner as _disposables_count_for_owner } from "../api/livetree/managers/lifecycle-registry.js";
export {
  disposable_add_for_owner as _disposable_add_for_owner,
  TERMINAL_DISPOSABLE_DRAIN_LIMIT as _TERMINAL_DISPOSABLE_DRAIN_LIMIT,
} from "../api/livetree/managers/lifecycle-registry.js";
export {
  collect_subtree_nodes as _collect_subtree_nodes,
} from "../api/livetree/utils/subtree-traversal.js";
export {
  destroy_subtree_quids as _destroy_subtree_quids,
  ensure_quid as _ensure_livetree_quid,
  get_node_by_quid as _get_livetree_node_by_quid,
  get_quid as _get_livetree_quid,
  has_quid as _has_livetree_quid,
} from "../api/livetree/quid/data-quid.js";
export {
  dispose_node_deep as _dispose_node_deep,
} from "../api/livetree/utils/dispose-node.js";
export {
  detach_node_deep as _detach_node_deep,
} from "../api/livetree/utils/detach-node.js";
export {
  assert_livetree_node_active as _assert_livetree_node_active,
  disposed_nodes_count_for_subtree as _disposed_nodes_count_for_subtree,
  is_livetree_node_disposed as _is_livetree_node_disposed,
} from "../api/livetree/livetree-state.js";
export {
  LIVETREE_DISPOSED_ERROR_CODE,
  LiveTreeDisposedError,
} from "../api/livetree/livetree.error.js";
export {
  hasElementForNode as _has_livetree_element_for_node,
} from "../api/livetree/utils/node-map-helpers.js";
