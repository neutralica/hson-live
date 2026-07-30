import {
  EVERY_VSN,
  HSON_SYS_PREFIX,
  HSON_META_INDEX,
  HSON_META_MARKUP_PREFIX,
  HSON_META_QUID,
  II_TAG,
} from "./constants.js";
import { is_persisted_quid } from "./persisted-quid.js";
import type { HsonMeta } from "./types.js";

export type HsonMetadataKey = keyof HsonMeta;
export type HsonMetadataValueMode = "valued" | "flag";
export type HsonMetadataHsonProjection = "quid-sigil" | "array-order";
export type HsonMetadataNodeKind = "ordinary-element" | "array-item-wrapper";

export type HsonMetadataDefinition = Readonly<{
  key: HsonMetadataKey;
  markupName: `${typeof HSON_META_MARKUP_PREFIX}${HsonMetadataKey}`;
  allowedNodeKinds: readonly HsonMetadataNodeKind[];
  valueMode: HsonMetadataValueMode;
  hsonProjection: HsonMetadataHsonProjection;
  validateValue(value: unknown): value is string;
}>;

const ORDINARY_ELEMENT_NODE_KINDS: readonly HsonMetadataNodeKind[] =
  Object.freeze(["ordinary-element"]);
const ARRAY_ITEM_WRAPPER_NODE_KINDS: readonly HsonMetadataNodeKind[] =
  Object.freeze(["array-item-wrapper"]);

const DEFINITIONS = {
  [HSON_META_QUID]: Object.freeze({
    key: HSON_META_QUID,
    markupName: `${HSON_META_MARKUP_PREFIX}${HSON_META_QUID}`,
    allowedNodeKinds: ORDINARY_ELEMENT_NODE_KINDS,
    valueMode: "valued",
    hsonProjection: "quid-sigil",
    validateValue: (value: unknown): value is string =>
      is_persisted_quid(value),
  }),
  [HSON_META_INDEX]: Object.freeze({
    key: HSON_META_INDEX,
    markupName: `${HSON_META_MARKUP_PREFIX}${HSON_META_INDEX}`,
    allowedNodeKinds: ARRAY_ITEM_WRAPPER_NODE_KINDS,
    valueMode: "valued",
    hsonProjection: "array-order",
    // Sibling-dependent spelling, uniqueness, contiguity, and position checks
    // are centralized in hson-array-indexes.ts.
    validateValue: (value: unknown): value is string => typeof value === "string",
  }),
} satisfies Record<HsonMetadataKey, HsonMetadataDefinition>;

/** The sole production registry for canonical HSON structural metadata. */
export const HSON_METADATA_REGISTRY = Object.freeze(DEFINITIONS);

const MARKUP_TO_KEY = new Map<string, HsonMetadataKey>(
  Object.values(HSON_METADATA_REGISTRY).map((definition) => [
    definition.markupName,
    definition.key,
  ]),
);

export function is_hson_metadata_key(value: string): value is HsonMetadataKey {
  return Object.hasOwn(HSON_METADATA_REGISTRY, value);
}

export function hson_metadata_definition(
  key: string,
): HsonMetadataDefinition | undefined {
  return is_hson_metadata_key(key) ? HSON_METADATA_REGISTRY[key] : undefined;
}

export function hson_metadata_key_for_markup(
  markupName: string,
): HsonMetadataKey | undefined {
  return MARKUP_TO_KEY.get(markupName);
}

/** Detect syntax only. Registry lookup remains the validity decision. */
export function hson_metadata_candidate_key(
  markupName: string,
): string | undefined {
  return markupName.startsWith(HSON_META_MARKUP_PREFIX)
    ? markupName.slice(HSON_META_MARKUP_PREFIX.length)
    : undefined;
}

function node_kind_for_tag(nodeTag: string): HsonMetadataNodeKind | undefined {
  if (nodeTag === II_TAG) return "array-item-wrapper";
  if (!nodeTag.startsWith(HSON_SYS_PREFIX) && !EVERY_VSN.includes(nodeTag)) {
    return "ordinary-element";
  }
  return undefined;
}

export type HsonMetadataPolicyResult =
  | Readonly<{ valid: true; definition: HsonMetadataDefinition }>
  | Readonly<{ valid: false; reason: string }>;

export function hson_metadata_policy(
  nodeTag: string,
  key: string,
): HsonMetadataPolicyResult {
  const definition = hson_metadata_definition(key);
  if (definition === undefined) {
    return { valid: false, reason: "unknown canonical metadata key" };
  }

  const nodeKind = node_kind_for_tag(nodeTag);
  if (nodeKind === undefined || !definition.allowedNodeKinds.includes(nodeKind)) {
    return {
      valid: false,
      reason: `metadata "${key}" is not defined for node "${nodeTag}"`,
    };
  }
  return { valid: true, definition };
}

export function hson_metadata_value_is_valid(
  key: string,
  value: unknown,
): value is string {
  return hson_metadata_definition(key)?.validateValue(value) === true;
}

export type HsonMetadataAdmissionResult =
  | Readonly<{
      valid: true;
      key: HsonMetadataKey;
      definition: HsonMetadataDefinition;
      value: string;
    }>
  | Readonly<{ valid: false; reason: string }>;

/** Shared semantic admission used after either string or direct-DOM lexing. */
export function admit_hson_metadata_markup(
  nodeTag: string,
  markupName: string,
  value: unknown,
): HsonMetadataAdmissionResult {
  const candidate = hson_metadata_candidate_key(markupName);
  const key = hson_metadata_key_for_markup(markupName);
  if (candidate === undefined || key === undefined) {
    return {
      valid: false,
      reason: `unknown HSON metadata markup name "${markupName}"`,
    };
  }
  const policy = hson_metadata_policy(nodeTag, key);
  if (!policy.valid) return policy;
  if (!policy.definition.validateValue(value)) {
    return {
      valid: false,
      reason: `invalid value for HSON metadata "${markupName}"`,
    };
  }
  return {
    valid: true,
    key,
    definition: policy.definition,
    value,
  };
}
