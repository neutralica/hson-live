// node.types.ts


import { CssMap } from "./css.types.js";
import {  Primitive } from "./core.types.js";
import { _DATA_INDEX, _DATA_QUID } from "../consts/constants.js";

/*******
 * Core HSON structural node.
 *
 * Each node models a single unit in the IR:
 * - `_tag` identifies the node kind (HTML tag or VSN like "_obj", "_arr").
 * - `_meta` holds only *data-* metadata (e.g. QUID, array index).
 * - `_attrs` contains HTML-style attributes for element nodes.
 * - `_content` contains either child nodes or primitive leaf values.
 *
 * All transformation, LiveTree, and serialization layers operate on this shape.
 *******/
export interface HsonNode {
    _tag: string;
    _meta: HsonMeta;
    _attrs: HsonAttrs;
    _content: NodeContent;
}

/*******
 * Valid contents for an HSON node.
 *
 * A node’s `_content` array may contain:
 * - other `HsonNode` children, or
 * - primitive leaf values (`string | number | boolean | null`)
 *
 * Primitives must appear only inside `_str` or `_val` VSN wrappers;
 * validators enforce this rule for all non-leaf tags.
 *******/
export type NodeContent = (HsonNode | Primitive)[];

/*******
 * HTML-style attribute bag for `_elem` nodes.
 *
 * Keys are attribute names; values are primitive scalars.
 * Special cases:
 * - `"style"` uses a parsed `StyleObject` rather than a raw string.
 * - Boolean-present flags (attributes without values) are represented
 *   as `key: key` at parse time.
 *
 * The transform pipeline normalizes attributes; LiveTree keeps `_attrs`
 * in lockstep with the DOM.
 *******/
export type HsonAttrs = {'style'?: CssMap } & Record<string, Primitive>;


/*******
 * Metadata namespace reserved for structural bookkeeping.
 *
 * All keys must begin with `"data-_"` and encode information not meant
 * to appear as user-visible attributes:
 *
 * - `data-_index` — canonical string index for `_ii` children inside `_arr`.
 * - `data-_quid`  — stable identifier assigned by the QUID system.
 *
 * Additional `data-_…` keys may be used internally, but non-prefixed
 * metadata is rejected by invariants. `_meta` never reflects HTML attrs.
 *******/
export type HsonMeta = {
    [_DATA_INDEX]?: string;
    [_DATA_QUID]?: string;
} & Record<string, string>;
