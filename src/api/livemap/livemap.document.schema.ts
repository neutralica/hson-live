import { ELEM_TAG, ROOT_TAG, STR_TAG } from "../../core/constants.js";
import { is_Node, is_ordinary_element_node } from "../../core/node-guards.js";
import type { HsonNode } from "../../core/types.js";
import type {
  DocumentLiveMapMode,
  LiveMapSchemaIssueCode,
} from "../../types/livemap.types.js";
import type {
  LiveMapSchemaIssue,
  LiveMapSchemaValidation,
} from "./livemap.schema.js";

declare const DOCUMENT_ITEM_EVIDENCE: unique symbol;
declare const DOCUMENT_CONTENT_EVIDENCE: unique symbol;
declare const DOCUMENT_ROOT_EVIDENCE: unique symbol;
declare const DOCUMENT_ROOT_MODE: unique symbol;

export type DocumentTextEvidence = Readonly<{ kind: "text" }>;
export type DocumentUnknownEvidence = Readonly<{ kind: "unknown" }>;
export type DocumentElementEvidence<
  TTag extends string | undefined,
  TContent,
> = Readonly<{
  kind: "element";
  tag: TTag;
  content: TContent;
}>;
export type DocumentSequenceEvidence<TItems extends readonly unknown[]> = Readonly<{
  kind: "sequence";
  items: TItems;
}>;
export type DocumentRepeatEvidence<TItem> = Readonly<{
  kind: "repeat";
  item: TItem;
}>;
export type DocumentCountedRepeatEvidence<TCount extends number, TItem> = Readonly<{
  kind: "counted-repeat";
  count: TCount;
  item: TItem;
}>;
export type DocumentPickEvidence<TChoices extends readonly unknown[]> = Readonly<{
  kind: "pick";
  choices: TChoices;
}>;
export type DocumentFragmentEvidence<TContent> = Readonly<{
  kind: "fragment";
  content: TContent;
}>;

export type InternalDocumentItemSchema<TEvidence = unknown> = Readonly<{
  readonly [DOCUMENT_ITEM_EVIDENCE]: TEvidence;
}>;

export type InternalDocumentContentSchema<TEvidence = unknown> = Readonly<{
  readonly [DOCUMENT_CONTENT_EVIDENCE]: TEvidence;
}>;

export type InternalDocumentElementSchema<TEvidence = unknown> =
  InternalDocumentItemSchema<TEvidence> & Readonly<{
    readonly [DOCUMENT_ROOT_EVIDENCE]: TEvidence;
    readonly [DOCUMENT_ROOT_MODE]: "element";
  }>;

export type InternalDocumentFragmentSchema<TEvidence = unknown> = Readonly<{
  readonly [DOCUMENT_ROOT_EVIDENCE]: TEvidence;
  readonly [DOCUMENT_ROOT_MODE]: "fragment";
}> & (TEvidence extends DocumentFragmentEvidence<infer TContent>
  ? InternalDocumentContentSchema<TContent>
  : unknown);

export type InternalDocumentRootSchema =
  | InternalDocumentElementSchema
  | InternalDocumentFragmentSchema;

export type InternalDocumentRootSchemaForMode<TMode extends DocumentLiveMapMode> =
  TMode extends "element"
    ? InternalDocumentElementSchema
    : InternalDocumentFragmentSchema;

export type InternalDocumentSchemaController = Readonly<{
  getDocumentSchema: () => InternalDocumentRootSchema | undefined;
  useDocumentSchema: (schema: InternalDocumentRootSchema) => void;
}>;

export type InternalDocumentSchemaEvidence<TSchema> =
  TSchema extends Readonly<{ readonly [DOCUMENT_ROOT_EVIDENCE]: infer TEvidence }>
    ? TEvidence
    : TSchema extends Readonly<{ readonly [DOCUMENT_ITEM_EVIDENCE]: infer TEvidence }>
      ? TEvidence
      : TSchema extends Readonly<{ readonly [DOCUMENT_CONTENT_EVIDENCE]: infer TEvidence }>
        ? TEvidence
        : never;

type ItemEvidence<TSchema> = InternalDocumentSchemaEvidence<TSchema>;
type ContentEvidence<TSchema> = InternalDocumentSchemaEvidence<TSchema>;

type DocumentItemNode =
  | Readonly<{ kind: "text"; category: "item" }>
  | Readonly<{ kind: "unknown"; category: "item" }>
  | DocumentElementNode
  | Readonly<{
    kind: "pick";
    category: "item";
    choices: readonly DocumentItemNode[];
  }>;

type DocumentElementNode = Readonly<{
  kind: "element";
  category: "item";
  tag?: string;
  content?: DocumentContentNode;
}>;

type DocumentContentNode =
  | Readonly<{
    kind: "sequence";
    category: "content";
    items: readonly DocumentItemNode[];
  }>
  | Readonly<{
    kind: "repeat";
    category: "content";
    item: DocumentItemNode;
    count?: number;
  }>
  | Readonly<{
    kind: "pick";
    category: "content";
    choices: readonly DocumentContentNode[];
  }>;

type DocumentFragmentNode = Readonly<{
  kind: "fragment";
  category: "root";
  content: DocumentContentNode;
}>;

type DocumentRootNode = DocumentElementNode | DocumentFragmentNode;
type DocumentSchemaNode = DocumentItemNode | DocumentContentNode | DocumentFragmentNode;

const DOCUMENT_ITEM_NODES = new WeakMap<object, DocumentItemNode>();
const DOCUMENT_CONTENT_NODES = new WeakMap<object, DocumentContentNode>();
const DOCUMENT_ROOT_NODES = new WeakMap<object, DocumentRootNode>();

function document_token<TSchema extends object>(
  register: (value: object) => void,
): TSchema {
  const value = {};
  register(value);
  return Object.freeze(value) as TSchema;
}

function frozen_item_pick(choices: readonly DocumentItemNode[]): DocumentItemNode {
  return Object.freeze({
    kind: "pick",
    category: "item",
    choices: Object.freeze([...choices]),
  });
}

function frozen_content_pick(choices: readonly DocumentContentNode[]): DocumentContentNode {
  return Object.freeze({
    kind: "pick",
    category: "content",
    choices: Object.freeze([...choices]),
  });
}

function register_item(value: object, node: DocumentItemNode): void {
  DOCUMENT_ITEM_NODES.set(value, node);
  if (node.kind === "element") DOCUMENT_ROOT_NODES.set(value, node);
}

function register_content(value: object, node: DocumentContentNode): void {
  DOCUMENT_CONTENT_NODES.set(value, node);
}

export function add_document_text_capability<TValue extends object>(value: TValue): TValue & InternalDocumentItemSchema<DocumentTextEvidence> {
  register_item(value, Object.freeze({ kind: "text", category: "item" }));
  return value as TValue & InternalDocumentItemSchema<DocumentTextEvidence>;
}

export function add_document_unknown_capability<TValue extends object>(value: TValue): TValue & InternalDocumentItemSchema<DocumentUnknownEvidence> {
  register_item(value, Object.freeze({ kind: "unknown", category: "item" }));
  return value as TValue & InternalDocumentItemSchema<DocumentUnknownEvidence>;
}

export function make_document_element_schema<
  const TTag extends string | undefined,
  const TContent,
>(
  tag: TTag,
  children: readonly object[],
): InternalDocumentElementSchema<DocumentElementEvidence<TTag, TContent>> {
  if (tag !== undefined && (typeof tag !== "string" || tag.length === 0 || tag.startsWith("_hson_"))) {
    throw new TypeError("Document element schema tag must be a non-empty ordinary element tag.");
  }
  const content = document_content_from_children(children);
  const node: DocumentElementNode = Object.freeze({
    kind: "element",
    category: "item",
    ...(tag === undefined ? {} : { tag }),
    ...(content === undefined ? {} : { content }),
  });
  return document_token((value) => register_item(value, node));
}

function fragment_node(content: DocumentContentNode): DocumentFragmentNode {
  return Object.freeze({
    kind: "fragment",
    category: "root",
    content,
  });
}

export function make_document_tuple_schema<const TItems extends readonly InternalDocumentItemSchema[]>(
  ...items: TItems
): InternalDocumentContentSchema<DocumentSequenceEvidence<{
  readonly [TIndex in keyof TItems]: ItemEvidence<TItems[TIndex]>;
}>> {
  const itemNodes = items.map((item) => require_item_node(item));
  const node: DocumentContentNode = Object.freeze({
    kind: "sequence",
    category: "content",
    items: Object.freeze(itemNodes),
  });
  return document_token((value) => register_content(value, node));
}

export function make_document_repeat_schema<const TItem extends InternalDocumentItemSchema>(
  item: TItem,
): InternalDocumentContentSchema<DocumentRepeatEvidence<ItemEvidence<TItem>>> {
  const itemNode = require_item_node(item);
  const node: DocumentContentNode = Object.freeze({
    kind: "repeat",
    category: "content",
    item: itemNode,
  });
  return document_token((value) => register_content(value, node));
}

export function make_document_counted_repeat_schema<
  const TCount extends number,
  const TItem extends InternalDocumentItemSchema,
>(
  count: TCount,
  item: TItem,
): InternalDocumentContentSchema<
  TCount extends 0
    ? DocumentSequenceEvidence<readonly []>
    : DocumentCountedRepeatEvidence<TCount, ItemEvidence<TItem>>
>;
export function make_document_counted_repeat_schema(
  count: number,
  item: InternalDocumentItemSchema,
): InternalDocumentContentSchema;
export function make_document_counted_repeat_schema(
  count: number,
  item: InternalDocumentItemSchema,
): InternalDocumentContentSchema {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new TypeError("Document repeat count must be a nonnegative safe integer.");
  }
  if (count === 0) return make_document_tuple_schema();
  const itemNode = require_item_node(item);
  const node: DocumentContentNode = Object.freeze({
    kind: "repeat",
    category: "content",
    item: itemNode,
    count,
  });
  return document_token((value) => register_content(value, node));
}

export function add_document_pick_capabilities<TValue extends object>(
  value: TValue,
  choices: readonly unknown[],
): TValue {
  if (choices.length === 0) {
    return value;
  }
  const itemNodes = choices.map(document_item_node);
  if (itemNodes.every((node): node is DocumentItemNode => node !== undefined)) {
    register_item(value, frozen_item_pick(itemNodes));
  }
  const contentNodes = choices.map(document_content_node);
  if (contentNodes.every((node): node is DocumentContentNode => node !== undefined)) {
    register_content(value, frozen_content_pick(contentNodes));
  }
  return value;
}

export function add_document_tuple_capability<TValue extends object>(
  value: TValue,
  items: readonly unknown[],
): TValue {
  const itemNodes = items.map(document_item_node);
  if (itemNodes.every((node): node is DocumentItemNode => node !== undefined)) {
    register_content(value, Object.freeze({
      kind: "sequence",
      category: "content",
      items: Object.freeze(itemNodes),
    }));
  }
  return value;
}

export function document_item_node(value: unknown): DocumentItemNode | undefined {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return undefined;
  }
  return DOCUMENT_ITEM_NODES.get(value);
}

export function document_content_node(value: unknown): DocumentContentNode | undefined {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return undefined;
  }
  return DOCUMENT_CONTENT_NODES.get(value);
}

function require_item_node(value: unknown): DocumentItemNode {
  const node = document_item_node(value);
  if (node !== undefined) return node;
  throw new TypeError("Document schema composition requires a document item schema.");
}

function document_content_from_children(children: readonly object[]): DocumentContentNode | undefined {
  if (children.length === 0) return undefined;
  if (children.length === 1) {
    const content = document_content_node(children[0]);
    if (content !== undefined) return content;
  }
  const items = children.map((child) => require_item_node(child));
  return Object.freeze({
    kind: "sequence",
    category: "content",
    items: Object.freeze(items),
  });
}

export function register_defined_document_schema(target: object, expression: unknown): boolean {
  const item = document_item_node(expression);
  const content = document_content_node(expression);
  const root = (typeof expression === "object" && expression !== null)
    ? DOCUMENT_ROOT_NODES.get(expression)
    : undefined;
  if (item !== undefined) register_item(target, item);
  if (content !== undefined) {
    register_content(target, content);
    DOCUMENT_ROOT_NODES.set(target, root ?? fragment_node(content));
  } else if (root !== undefined) {
    DOCUMENT_ROOT_NODES.set(target, root);
  }
  return item !== undefined || content !== undefined || root !== undefined;
}

export function require_document_root_schema<TMode extends DocumentLiveMapMode>(
  value: unknown,
  mode: TMode,
): Readonly<{
  value: InternalDocumentRootSchemaForMode<TMode>;
  node: DocumentRootNode;
}>;
export function require_document_root_schema(
  value: unknown,
): Readonly<{ value: InternalDocumentRootSchema; node: DocumentRootNode }>;
export function require_document_root_schema(
  value: unknown,
  mode?: DocumentLiveMapMode,
): Readonly<{ value: InternalDocumentRootSchema; node: DocumentRootNode }> {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    throw new TypeError("Document map schema.use(...) requires an element or fragment root schema.");
  }
  const node = DOCUMENT_ROOT_NODES.get(value);
  if (node === undefined) throw new TypeError("Document map schema.use(...) requires an element or fragment root schema.");
  const rootMode = node.kind === "fragment" ? "fragment" : "element";
  if (mode !== undefined && mode !== rootMode) {
    throw new TypeError(`Document schema root mode mismatch: expected ${mode}; received ${rootMode}.`);
  }
  return {
    value: value as InternalDocumentRootSchema,
    node: node as DocumentRootNode,
  };
}

export function validate_livemap_document_schema_root(
  schema: InternalDocumentRootSchema,
  root: HsonNode,
  mode: DocumentLiveMapMode,
): LiveMapSchemaValidation {
  const schemaNode = require_document_root_schema(schema).node;
  const schemaMode = schemaNode.kind === "fragment" ? "fragment" : "element";
  if (schemaMode !== mode) {
    return invalid([
      issue(
        "TYPE_MISMATCH",
        [],
        `Expected ${schemaMode} document root; received ${mode} document root.`,
        `${schemaMode} document root`,
        `${mode} document root`,
      ),
    ]);
  }

  if (schemaNode.kind === "element") {
    const elementRoot = root_element(root);
    if (elementRoot === undefined) {
      return invalid([
        issue("TYPE_MISMATCH", [], "Expected element document root.", "element", describe_root(root)),
      ]);
    }
    return validate_item(schemaNode, elementRoot, []);
  }

  const children = logical_root_children(root);
  if (children === undefined) {
    return invalid([
      issue("TYPE_MISMATCH", [], "Expected fragment document root.", "fragment", describe_root(root)),
    ]);
  }
  return validate_content(schemaNode.content, children, []);
}

function validate_item(
  schema: DocumentItemNode,
  value: HsonNode,
  path: readonly number[],
): LiveMapSchemaValidation {
  if (schema.kind === "pick") {
    return validate_pick(
      schema.choices.map((choice) => validate_item(choice, value, path)),
      path,
      "an allowed document item",
      describe_item(value),
    );
  }
  if (schema.kind === "text") {
    if (value.$_tag === STR_TAG
      && value.$_content.length === 1
      && typeof value.$_content[0] === "string") {
      return valid();
    }
    return invalid([
      issue(
        "TYPE_MISMATCH",
        path,
        `Expected text at ${JSON.stringify(path)}; received ${describe_item(value)}.`,
        "text",
        describe_item(value),
      ),
    ]);
  }
  if (schema.kind === "unknown") return valid();

  if (!is_ordinary_element_node(value)) {
    return invalid([
      issue(
        "TYPE_MISMATCH",
        path,
        `Expected element at ${JSON.stringify(path)}; received ${describe_item(value)}.`,
        "element",
        describe_item(value),
      ),
    ]);
  }
  if (schema.tag !== undefined && schema.tag !== value.$_tag) {
    return invalid([
      issue(
        "INVALID_LITERAL",
        path,
        `Expected tag ${JSON.stringify(schema.tag)} at ${JSON.stringify(path)}; received ${JSON.stringify(value.$_tag)}.`,
        JSON.stringify(schema.tag),
        JSON.stringify(value.$_tag),
      ),
    ]);
  }
  if (schema.content === undefined) return valid();
  const children = logical_element_children(value);
  if (children === undefined) {
    return invalid([
      issue(
        "INVALID_SCHEMA",
        path,
        `Element at ${JSON.stringify(path)} does not expose canonical logical content.`,
      ),
    ]);
  }
  return validate_content(schema.content, children, path);
}

function validate_content(
  schema: DocumentContentNode,
  children: readonly HsonNode[],
  path: readonly number[],
): LiveMapSchemaValidation {
  if (schema.kind === "pick") {
    return validate_pick(
      schema.choices.map((choice) => validate_content(choice, children, path)),
      path,
      "an allowed complete content layout",
      `content length ${children.length}`,
    );
  }
  if (schema.kind === "repeat") {
    if (schema.count !== undefined && children.length !== schema.count) {
      const mismatchPath = children.length < schema.count
        ? append_path(path, children.length)
        : path;
      const code: LiveMapSchemaIssueCode = children.length < schema.count
        ? "MISSING_REQUIRED"
        : "TUPLE_INDEX_OUT_OF_RANGE";
      return invalid([
        issue(
          code,
          mismatchPath,
          `Expected counted repeat length ${schema.count} at ${JSON.stringify(path)}; received length ${children.length}.`,
          `length ${schema.count}`,
          `length ${children.length}`,
        ),
      ]);
    }
    const issues: LiveMapSchemaIssue[] = [];
    children.forEach((child, index) => {
      const result = validate_item(schema.item, child, append_path(path, index));
      if (!result.ok) issues.push(...result.issues);
    });
    return issues.length === 0 ? valid() : invalid(issues);
  }

  if (children.length !== schema.items.length) {
    const mismatchPath = children.length < schema.items.length
      ? append_path(path, children.length)
      : path;
    const code: LiveMapSchemaIssueCode = children.length < schema.items.length
      ? "MISSING_REQUIRED"
      : "TUPLE_INDEX_OUT_OF_RANGE";
    return invalid([
      issue(
        code,
        mismatchPath,
        `Expected closed sequence length ${schema.items.length} at ${JSON.stringify(path)}; received length ${children.length}.`,
        `length ${schema.items.length}`,
        `length ${children.length}`,
      ),
    ]);
  }

  const issues: LiveMapSchemaIssue[] = [];
  schema.items.forEach((item, index) => {
    const result = validate_item(item, children[index] as HsonNode, append_path(path, index));
    if (!result.ok) issues.push(...result.issues);
  });
  return issues.length === 0 ? valid() : invalid(issues);
}

function validate_pick(
  branches: readonly LiveMapSchemaValidation[],
  path: readonly number[],
  expected: string,
  received: string,
): LiveMapSchemaValidation {
  if (branches.some((branch) => branch.ok)) return valid();
  const closest = [...branches].sort((left, right) => {
    const leftDepth = left.issues[0]?.path.length ?? 0;
    const rightDepth = right.issues[0]?.path.length ?? 0;
    if (leftDepth !== rightDepth) return rightDepth - leftDepth;
    return left.issues.length - right.issues.length;
  })[0];
  return invalid([
    issue(
      "TYPE_MISMATCH",
      path,
      `Expected ${expected} at ${JSON.stringify(path)}; received ${received}; no pick branch matched.`,
      expected,
      received,
    ),
    ...(closest?.issues ?? []),
  ]);
}

function root_element(root: HsonNode): HsonNode | undefined {
  const cluster = root.$_tag === ELEM_TAG
    ? root
    : root.$_tag === ROOT_TAG && is_Node(root.$_content[0]) && root.$_content[0].$_tag === ELEM_TAG
      ? root.$_content[0]
      : undefined;
  if (cluster === undefined || cluster.$_content.length !== 1) return undefined;
  const only = cluster.$_content[0];
  return is_ordinary_element_node(only) ? only : undefined;
}

function logical_root_children(root: HsonNode): readonly HsonNode[] | undefined {
  if (root.$_tag === ROOT_TAG && root.$_content.length === 0) return Object.freeze([]);
  const cluster = root.$_tag === ELEM_TAG
    ? root
    : root.$_tag === ROOT_TAG && is_Node(root.$_content[0]) && root.$_content[0].$_tag === ELEM_TAG
      ? root.$_content[0]
      : undefined;
  if (cluster === undefined) return undefined;
  return cluster.$_content.every(is_Node)
    ? Object.freeze([...cluster.$_content]) as readonly HsonNode[]
    : undefined;
}

function logical_element_children(element: HsonNode): readonly HsonNode[] | undefined {
  if (!is_ordinary_element_node(element)) return undefined;
  if (element.$_content.length === 0) return Object.freeze([]);
  if (element.$_content.length !== 1) return undefined;
  const cluster = element.$_content[0];
  if (!is_Node(cluster) || cluster.$_tag !== ELEM_TAG || !cluster.$_content.every(is_Node)) {
    return undefined;
  }
  return Object.freeze([...cluster.$_content]) as readonly HsonNode[];
}

function issue(
  code: LiveMapSchemaIssueCode,
  path: readonly number[],
  message: string,
  expected?: string,
  received?: string,
): LiveMapSchemaIssue {
  return Object.freeze({
    code,
    path: Object.freeze([...path]),
    message,
    ...(expected === undefined ? {} : { expected }),
    ...(received === undefined ? {} : { received }),
  });
}

function valid(): LiveMapSchemaValidation {
  return Object.freeze({ ok: true, issues: Object.freeze([]) });
}

function invalid(issues: readonly LiveMapSchemaIssue[]): LiveMapSchemaValidation {
  return Object.freeze({ ok: false, issues: Object.freeze([...issues]) });
}

function append_path(path: readonly number[], index: number): readonly number[] {
  return Object.freeze([...path, index]);
}

function describe_item(value: HsonNode): string {
  if (value.$_tag === STR_TAG) return "text";
  if (!value.$_tag.startsWith("_hson_")) return `element <${value.$_tag}>`;
  return `structural node <${value.$_tag}>`;
}

function describe_root(root: HsonNode): string {
  return `<${root.$_tag}>`;
}
