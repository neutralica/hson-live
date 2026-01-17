// /diagnostics/index.ts

export { assert_invariants as _assert_invariants } from "./assert-invariants.test.js";
export { compare_nodes as _compare_nodes } from "./compare-nodes.test.js";
export { is_Node as _is_Node } from "../utils/node-utils/node-guards.js"
export { _test_full_loop } from "./loop-3.test.js";
export {
    set_node_text_content as set_node_content,
    get_node_text_content as get_node_text,
    set_form_text_value as set_node_form_value,
    get_form_text_value as get_node_form_value,
    set_input_checked as set_node_form_checked,
    set_input_selected as set_node_form_selected,
    get_input_selected as get_node_form_selected

} from "../api/livetree/managers-etc/text-values.js";