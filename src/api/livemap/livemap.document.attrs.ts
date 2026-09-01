import { HSON_META_MARKUP_PREFIX } from "../../core/constants.js";
import {
  canonical_attr_is_flag,
} from "../../core/public-attr-transitions.js";
import {
  decode_public_attrs,
  decode_public_attr_value,
  is_public_attr_name,
} from "../../core/public-attrs.js";
import type {
  DocumentLiveMapAttrsReadApi,
  DocumentLiveMapFlagsReadApi,
  DocumentLiveMapMode,
  LiveMapDocumentAttributeValue,
  LiveMapDocumentAttrs,
  LiveMapDocumentRequestTarget,
} from "../../types/livemap.types.js";
import type { HsonNode } from "../../core/types.js";
import type { LiveMapDocumentIdentityOverlay } from "./livemap.document.identity.js";
import {
  LiveMapDocumentAttributeNotFoundError,
  LiveMapDocumentMutationError,
} from "./livemap.error.js";
import {
  normalize_document_target,
  require_document_attr_element,
  resolve_document_target,
  type LiveMapDocumentOperation,
} from "./livemap.document.target.js";

export const is_public_document_attr_name = is_public_attr_name;

export function decode_document_attr_value(
  name: string,
  value: unknown,
): LiveMapDocumentAttributeValue | undefined {
  return decode_public_attr_value(name, value);
}

/** Validate, detach, freeze, and deterministically order a complete attrs bag. */
export function decode_document_attrs(value: unknown): LiveMapDocumentAttrs | undefined {
  return decode_public_attrs(value);
}

export type LiveMapDocumentAttrsReadController = Readonly<{
  mode: DocumentLiveMapMode;
  root: () => HsonNode;
  overlay: () => LiveMapDocumentIdentityOverlay;
}>;

/** Build canonical graph-facing reads without entering the mutation planner. */
export function make_livemap_document_attrs_read_api(
  controller: LiveMapDocumentAttrsReadController,
): DocumentLiveMapAttrsReadApi {
  const get = (
    targetInput: LiveMapDocumentRequestTarget,
    nameInput: string,
  ): LiveMapDocumentAttributeValue | undefined => {
    const operation = "get-attr";
    const { element } = resolve_attr_query(controller, targetInput, operation);
    const name = normalize_read_attr_name(nameInput, operation);
    return read_detached_attr(element, name, operation);
  };
  const must = Object.freeze({
    get: (
      targetInput: LiveMapDocumentRequestTarget,
      nameInput: string,
    ): LiveMapDocumentAttributeValue => {
      const operation = "must-get-attr";
      const { target, element } = resolve_attr_query(controller, targetInput, operation);
      const name = normalize_read_attr_name(nameInput, operation);
      const value = read_detached_attr(element, name, operation);
      if (value === undefined) throw new LiveMapDocumentAttributeNotFoundError(target, name);
      return value;
    },
  });
  return Object.freeze({
    get,
    has: (targetInput, nameInput) => {
      const operation = "has-attr";
      const { element } = resolve_attr_query(controller, targetInput, operation);
      const name = normalize_read_attr_name(nameInput, operation);
      return element.$_attrs !== undefined
        && Object.prototype.hasOwnProperty.call(element.$_attrs, name);
    },
    keys: (targetInput) => {
      const operation = "list-attrs";
      const { element } = resolve_attr_query(controller, targetInput, operation);
      return Object.freeze(
        Object.keys(element.$_attrs ?? {})
          .filter(is_public_document_attr_name)
          .sort(),
      );
    },
    must,
  });
}

/** Build semantic flag reads over the same canonical attribute bag. */
export function make_livemap_document_flags_read_api(
  controller: LiveMapDocumentAttrsReadController,
): DocumentLiveMapFlagsReadApi {
  return Object.freeze({
    has: (targetInput, nameInput) => {
      const operation = "has-attr";
      const { element } = resolve_attr_query(controller, targetInput, operation);
      const name = normalize_read_attr_name(nameInput, operation);
      const attrs = decode_document_attrs(element.$_attrs ?? {});
      if (attrs === undefined) {
        throw new LiveMapDocumentMutationError(
          "INVALID_DOCUMENT_ATTRIBUTE_VALUE",
          operation,
          "stored attributes are not canonical",
        );
      }
      return canonical_attr_is_flag(attrs, name);
    },
  });
}

function resolve_attr_query(
  controller: LiveMapDocumentAttrsReadController,
  targetInput: unknown,
  operation: LiveMapDocumentOperation,
): Readonly<{ target: LiveMapDocumentRequestTarget; element: HsonNode }> {
  const target = normalize_document_target(targetInput, operation);
  const endpoint = resolve_document_target(
    controller.root(),
    controller.mode,
    controller.overlay(),
    target,
    operation,
  );
  return Object.freeze({
    target,
    element: require_document_attr_element(endpoint, operation),
  });
}

function normalize_read_attr_name(input: unknown, operation: LiveMapDocumentOperation): string {
  if (typeof input === "string" && input.startsWith(HSON_META_MARKUP_PREFIX)) {
    throw new LiveMapDocumentMutationError(
      "PROTECTED_DOCUMENT_METADATA",
      operation,
      "system metadata cannot be read through ordinary attrs",
    );
  }
  if (!is_public_document_attr_name(input)) {
    throw new LiveMapDocumentMutationError(
      "INVALID_DOCUMENT_ATTRIBUTE_NAME",
      operation,
      "attribute name is not a canonical bare Hson name",
    );
  }
  return input;
}

function read_detached_attr(
  element: HsonNode,
  name: string,
  operation: LiveMapDocumentOperation,
): LiveMapDocumentAttributeValue | undefined {
  const attrs = element.$_attrs;
  if (attrs === undefined || !Object.prototype.hasOwnProperty.call(attrs, name)) return undefined;
  const value = decode_document_attr_value(name, attrs[name]);
  if (value !== undefined) return value;
  throw new LiveMapDocumentMutationError(
    "INVALID_DOCUMENT_ATTRIBUTE_VALUE",
    operation,
    `stored ordinary attribute ${JSON.stringify(name)} is not canonical`,
  );
}
