// Core HSON protocol constants.

export const $_FALSE = "_false" as const;
export type FalseType = typeof $_FALSE;
export const $_ERROR = "_error" as const;

export const STR_TAG = "_hson_str" as const;
export const VAL_TAG = "_hson_val" as const;
export const ROOT_TAG = "_hson_root" as const;
export const II_TAG = "_hson_ii" as const;
export const OBJ_TAG = "_hson_obj" as const;
export const ARR_TAG = "_hson_arr" as const;
export const ELEM_TAG = "_hson_elem" as const;

export const HSON_SYS_PREFIX = "_hson_" as const;
export const HTML_KEY_PREFIX = "_-_-" as const;

export const ATTRS_KEY = "$_attrs" as const;
export const META_KEY = "$_meta" as const;
export const TAG_KEY = "$_tag" as const;
export const CONTENT_KEY = "$_content" as const;

export const VSN_TAGS: string[] = [
  II_TAG, ARR_TAG, ELEM_TAG, OBJ_TAG, STR_TAG, VAL_TAG,
] as const;

export const EVERY_VSN: string[] = [
  II_TAG, ARR_TAG, ELEM_TAG, OBJ_TAG, STR_TAG, VAL_TAG, ROOT_TAG,
] as const;

export type VSNTag = typeof VSN_TAGS[number];

export const LEAF_NODES = [STR_TAG, VAL_TAG] as string[];
export const ELEM_OBJ_ARR = [ELEM_TAG, ARR_TAG, OBJ_TAG] as string[];
export const ELEM_OBJ = [ELEM_TAG, OBJ_TAG];

export type ElemObjType = typeof ELEM_TAG | typeof OBJ_TAG;
export type ElemObjArrType = typeof ELEM_OBJ_ARR;

export const $HSON = "hson" as const;
export const $JSON = "json" as const;
export const $HTML = "html" as const;
export const $NODES = "nodes" as const;
export const $RENDER = { HSON: $HSON, HTML: $HTML, JSON: $JSON, NODES: $NODES } as const;

export const $HSON_FRAME = {
  GEN: "generate",
  STD: "standard",
  SUBSET: "subset",
} as const;

export const _META_DATA_PREFIX = "data-_";
export const _DATA_INDEX = "data-_index";
export const _DATA_QUID = "data-_quid";

export const _TRANSIT_PREFIX = "data--";
export const _TRANSIT_ATTRS = `${_TRANSIT_PREFIX}attrmap`;
