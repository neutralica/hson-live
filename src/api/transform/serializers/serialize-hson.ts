import {
  ARR_TAG,
  ELEM_OBJ_ARR,
  ELEM_TAG,
  EVERY_VSN,
  HSON_SYS_PREFIX,
  II_TAG,
  OBJ_TAG,
  ROOT_TAG,
  STR_TAG,
  VAL_TAG,
  HSON_META_QUID,
} from "../../../core/constants.js";
import { assert_invariants } from "../../../core/assert-invariants.js";
import { collect_hson_node_quid_claims } from "../../../core/hson-node-quid.js";
import { is_Node } from "../../../core/node-guards.js";
import { is_persisted_quid } from "../../../core/persisted-quid.js";
import { is_valid_hson_attribute_name } from "../../../core/hson-name.js";
import { hson_metadata_policy } from "../../../core/hson-metadata.js";
import type { HsonAttrs, HsonMeta, HsonNode, Primitive } from "../../../core/types.js";
import { serialize_style } from "../utils/attrs-utils/serialize-style.js";
import { serialize_hson_tag_name } from "../utils/hson-utils/hson-tag-helpers.js";
import { serialize_primitive_hson } from "../utils/primitive-utils/serialize-primitive.utils.js";
import { _throw_transform_err } from "../utils/sys-utils/throw-transform-err.utils.js";
import type { HsonString } from "../transform.types.js";

type ParentCluster = typeof OBJ_TAG | typeof ELEM_TAG | typeof ARR_TAG;
type HsonLayout = "readable" | "compact";

type HsonSerializeInputOptions = Readonly<{
  noBreak?: boolean;
  noQuid?: boolean;
}>;

type HsonSerializeOptions = Readonly<{
  layout: HsonLayout;
  noQuid: boolean;
  ownedElementTextFragment: boolean;
}>;

type SerializeContext = Readonly<{
  options: HsonSerializeOptions;
  guard: ReturnType<typeof cycleGuard>;
}>;

function cycleGuard() {
  const seen = new WeakSet<object>();
  return {
    enter(node: object): void {
      if (seen.has(node)) {
        _throw_transform_err(
          "serialize-hson: cycle detected in node graph",
          "serialize_hson.cycleGuard.enter",
        );
      }
      seen.add(node);
    },
    leave(node: object): void {
      seen.delete(node);
    },
  };
}

function indent(ctx: SerializeContext, depth: number): string {
  return ctx.options.layout === "readable" ? "  ".repeat(depth) : "";
}

function childSeparator(ctx: SerializeContext, cluster: ParentCluster): string {
  if (ctx.options.layout === "readable") return "\n";
  return cluster === ELEM_TAG ? " " : "";
}

function escape_hson_quoted_attr_value(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

/**
 * Validate metadata and create the small effective on-wire view. This is not a
 * graph clone: only the metadata map for the current ordinary node is copied.
 */
function effectiveMeta(
  nodeTag: string,
  meta: Readonly<HsonMeta> | undefined,
  noQuid: boolean,
): Readonly<Record<string, string>> | undefined {
  if (!meta) return undefined;

  const out: Record<string, string> = {};
  for (const key of Object.keys(meta)) {
    const policy = hson_metadata_policy(nodeTag, key);
    if (!policy.valid) {
      _throw_transform_err(
        `serialize-hson: metadata key "${key}" is invalid on <${nodeTag}>: ${policy.reason}`,
        "serialize_hson",
      );
    }

    const value = (meta as Readonly<Record<string, unknown>>)[key];
    if (!policy.definition.validateValue(value)) {
      _throw_transform_err(
        `serialize-hson: invalid value for metadata "${key}"`,
        "serialize_hson",
      );
    }

    if (noQuid && key === HSON_META_QUID) continue;
    if (policy.definition.hsonProjection === "quid-sigil") {
      out[key] = value;
    }
  }

  return Object.keys(out).length === 0 ? undefined : out;
}

function serializeAttribute(name: string, value: unknown): string {
  if (!is_valid_hson_attribute_name(name)) {
    _throw_transform_err(
      `serialize-hson: invalid attribute name "${name}"`,
      "serialize_hson.serializeAttribute",
    );
  }
  if (name === "style" && value && typeof value === "object" && !Array.isArray(value)) {
    const css = serialize_style(value as Record<string, string>);
    return `${name}="${escape_hson_quoted_attr_value(css)}"`;
  }

  if (typeof value !== "string") {
    _throw_transform_err(
      `serialize-hson: canonical ordinary attribute "${name}" must be a string`,
      "serialize_hson.serializeAttribute",
    );
  }
  const serializedValue = escape_hson_quoted_attr_value(value);
  return `${name}="${serializedValue}"`;
}

function compareKeys([left]: readonly [string, unknown], [right]: readonly [string, unknown]): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Sort ordinary attributes canonically; flags remain after valued entries. */
function emitAttrsAndMeta(
  attrs: Readonly<HsonAttrs> | undefined,
): string {
  const entries = Object.entries(attrs ?? {});
  const valued = entries
    .filter(([key, value]) => value !== key)
    .sort(compareKeys);
  const flags = entries
    .filter(([key, value]) => value === key)
    .sort(compareKeys);

  const terms: string[] = [];
  for (const [key, value] of valued) terms.push(serializeAttribute(key, value));
  for (const [key] of flags) terms.push(key);
  return terms.length === 0 ? "" : ` ${terms.join(" ")}`;
}

function emitLeaf(node: HsonNode, depth: number, ctx: SerializeContext): string {
  if (node.$_content.length !== 1) {
    _throw_transform_err(
      `serialize-hson: ${node.$_tag} must contain exactly one primitive`,
      "serialize_hson.emitLeaf",
    );
  }

  const value = node.$_content[0];
  if (node.$_tag === STR_TAG) {
    if (typeof value !== "string") {
      _throw_transform_err(
        "serialize-hson: _hson_str must contain a string",
        "serialize_hson.emitLeaf",
      );
    }
    return indent(ctx, depth) + JSON.stringify(value);
  }

  if (!(typeof value === "number" || typeof value === "boolean" || value === null)) {
    _throw_transform_err(
      "serialize-hson: _hson_val must contain number|boolean|null",
      "serialize_hson.emitLeaf",
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    _throw_transform_err(
      `serialize-hson: invalid HSON number ${String(value)}; numbers must be finite`,
      "serialize_hson.emitLeaf",
    );
  }
  return indent(ctx, depth) + (Object.is(value, -0) ? "-0" : String(value));
}

function arrayItemNode(wrapper: HsonNode, ctx: SerializeContext): HsonNode {
  ctx.guard.enter(wrapper);
  try {
    if (wrapper.$_tag !== II_TAG) {
      _throw_transform_err(
        "serialize-hson: only _hson_ii allowed directly under _hson_arr",
        "serialize_hson.emitArray",
      );
    }
    const content = wrapper.$_content;
    if (content.length !== 1 || !is_Node(content[0])) {
      _throw_transform_err(
        "serialize-hson: _hson_ii must contain exactly one child node",
        "serialize_hson.emitArray",
      );
    }
    return content[0];
  } finally {
    ctx.guard.leave(wrapper);
  }
}

function emitArray(node: HsonNode, depth: number, ctx: SerializeContext): string {
  const pad = indent(ctx, depth);
  const wrappers = node.$_content;
  if (wrappers.length === 0) return `${pad}«»`;

  const rendered = wrappers.map((wrapper) => {
    if (!is_Node(wrapper)) {
      _throw_transform_err(
        "serialize-hson: non-node item in _hson_arr",
        "serialize_hson.emitArray",
      );
    }
    const item = arrayItemNode(wrapper, ctx);
    return emitNode(
      item,
      ctx.options.layout === "readable" ? depth + 1 : 0,
      undefined,
      ctx,
    );
  });

  if (ctx.options.layout === "compact") return `«${rendered.join(",")}»`;
  return `${pad}«\n${rendered.join(",\n")}\n${pad}»`;
}

function emitObjectMember(
  property: HsonNode,
  depth: number,
  ctx: SerializeContext,
): string {
  ctx.guard.enter(property);
  try {
    const pad = indent(ctx, depth);
    if (property.$_attrs && Object.keys(property.$_attrs).length !== 0) {
      _throw_transform_err(
        `serialize-hson: object member <${property.$_tag}> cannot carry attributes or flags`,
        "serialize_hson.emitObjectMember",
      );
    }
    if (property.$_meta && Object.keys(property.$_meta).length !== 0) {
      _throw_transform_err(
        `serialize-hson: object member <${property.$_tag}> cannot carry metadata or a QUID`,
        "serialize_hson.emitObjectMember",
      );
    }
    if (property.$_content.length !== 1 || !is_Node(property.$_content[0])) {
      _throw_transform_err(
        `serialize-hson: object member <${property.$_tag}> must own exactly one canonical value`,
        "serialize_hson.emitObjectMember",
      );
    }

    const relationship = property.$_content[0];
    let semanticValue = relationship;
    if (
      relationship.$_tag === OBJ_TAG
      && relationship.$_content.length === 1
      && is_Node(relationship.$_content[0])
      && (relationship.$_content[0].$_tag === STR_TAG || relationship.$_content[0].$_tag === VAL_TAG)
    ) {
      semanticValue = relationship.$_content[0];
    }
    const value = emitNode(semanticValue, depth, OBJ_TAG, ctx).trimStart();
    return `${pad}${serialize_hson_tag_name(property.$_tag)} ${value}`;
  } finally {
    ctx.guard.leave(property);
  }
}

function emitObject(node: HsonNode, depth: number, ctx: SerializeContext): string {
  const pad = indent(ctx, depth);
  if (node.$_attrs && Object.keys(node.$_attrs).length !== 0) {
    _throw_transform_err(
      "serialize-hson: _hson_obj may not carry $_attrs",
      "serialize_hson.emitObject",
    );
  }
  if (node.$_content.length === 0) return `${pad}<>`;

  if (
    node.$_content.length === 1
    && is_Node(node.$_content[0])
    && (node.$_content[0].$_tag === STR_TAG || node.$_content[0].$_tag === VAL_TAG)
  ) {
    _throw_transform_err(
      "serialize-hson: detached scalar _hson_obj carrier is not a canonical semantic object value",
      "serialize_hson.emitObject",
    );
  }

  const rendered = node.$_content.map((property) => {
    if (!is_Node(property)) {
      _throw_transform_err(
        "serialize-hson: non-node in _hson_obj.$_content",
        "serialize_hson.emitObject",
      );
    }
    if (EVERY_VSN.includes(property.$_tag)) {
      _throw_transform_err(
        `serialize-hson: _hson_obj must contain ordinary named members, found ${property.$_tag}`,
        "serialize_hson.emitObject",
      );
    }
    return emitObjectMember(property, ctx.options.layout === "readable" ? depth + 1 : 0, ctx);
  });

  if (ctx.options.layout === "readable") {
    if (rendered.length === 1 && !rendered[0].includes("\n")) {
      return `${pad}<${rendered[0].trimStart()}>`;
    }
    return `${pad}<\n${rendered.join("\n")}\n${pad}>`;
  }
  return `<${rendered.join(" ")}>`;
}

function emitElementCluster(
  node: HsonNode,
  depth: number,
  isRootSemanticValue: boolean,
  ctx: SerializeContext,
): string {
  if (node.$_attrs && Object.keys(node.$_attrs).length !== 0) {
    _throw_transform_err(
      "serialize-hson: _hson_elem may not carry $_attrs",
      "serialize_hson.emitElement",
    );
  }
  if (
    !(ctx.options.ownedElementTextFragment && isRootSemanticValue)
    && node.$_content.length === 1
    && is_Node(node.$_content[0])
    && (node.$_content[0].$_tag === STR_TAG || node.$_content[0].$_tag === VAL_TAG)
  ) {
    _throw_transform_err(
      "serialize-hson: detached scalar _hson_elem carrier is not a canonical semantic element value",
      "serialize_hson.emitElementCluster",
    );
  }
  return node.$_content.map((child) => {
    if (!is_Node(child)) {
      _throw_transform_err(
        "serialize-hson: non-node in _hson_elem.$_content",
        "serialize_hson.emitElement",
      );
    }
    return emitNode(child, depth, ELEM_TAG, ctx);
  }).join(childSeparator(ctx, ELEM_TAG));
}

function standardContent(node: HsonNode): Readonly<{
  children: readonly HsonNode[];
  closer: ">" | "/>";
  cluster: ParentCluster;
}> {
  const content = node.$_content;
  if (
    content.length === 1
    && is_Node(content[0])
    && ELEM_OBJ_ARR.includes(content[0].$_tag)
  ) {
    const cluster = content[0];
    if (cluster.$_tag === ELEM_TAG) {
      return {
        children: cluster.$_content.filter(is_Node),
        closer: "/>",
        cluster: ELEM_TAG,
      };
    }
    if (
      cluster.$_tag === OBJ_TAG
      && cluster.$_content.length === 1
      && is_Node(cluster.$_content[0])
      && (cluster.$_content[0].$_tag === STR_TAG || cluster.$_content[0].$_tag === VAL_TAG)
    ) {
      return {
        children: [cluster.$_content[0]],
        closer: ">",
        cluster: OBJ_TAG,
      };
    }
    return {
      children: [cluster],
      closer: ">",
      cluster: cluster.$_tag === ARR_TAG ? ARR_TAG : OBJ_TAG,
    };
  }

  return {
    children: content.filter(is_Node),
    closer: "/>",
    cluster: ELEM_TAG,
  };
}

function emitStandardNode(
  node: HsonNode,
  depth: number,
  ctx: SerializeContext,
): string {
  const pad = indent(ctx, depth);
  const tag = serialize_hson_tag_name(node.$_tag);
  const meta = effectiveMeta(node.$_tag, node.$_meta, ctx.options.noQuid);
  const quid = meta?.[HSON_META_QUID];
  if (quid !== undefined && !is_persisted_quid(quid)) {
    _throw_transform_err(`serialize-hson: invalid quid`, "serialize_hson");
  }
  const header = `<${tag}${quid === undefined ? "" : ` @${quid}`}${emitAttrsAndMeta(node.$_attrs)}`;
  const { children, closer, cluster } = standardContent(node);

  if (children.length === 0) return `${pad}${header}${closer}`;

  if (children.length === 1 && (children[0].$_tag === STR_TAG || children[0].$_tag === VAL_TAG)) {
    const value = children[0].$_content[0] as Primitive;
    return `${pad}${header} ${serialize_primitive_hson(value)}${closer}`;
  }

  const childDepth = ctx.options.layout === "readable" ? depth + 1 : 0;
  const rendered = children.map((child) => emitNode(child, childDepth, cluster, ctx));

  if (ctx.options.layout === "compact") {
    return `${header} ${rendered.join(childSeparator(ctx, cluster))}${closer}`;
  }

  return `${pad}${header}\n${rendered.join("\n")}\n${pad}${closer}`;
}

/** One structural recursive emitter shared by readable and compact layouts. */
function emitNode(
  node: HsonNode,
  depth: number,
  parentCluster: ParentCluster | undefined,
  ctx: SerializeContext,
): string {
  ctx.guard.enter(node);
  try {
    if (node.$_tag.startsWith(HSON_SYS_PREFIX) && !EVERY_VSN.includes(node.$_tag)) {
      _throw_transform_err(
        `serialize-hson: unknown VSN-like tag <${node.$_tag}>`,
        "serialize_hson.emitNode",
      );
    }

    if (node.$_tag === STR_TAG || node.$_tag === VAL_TAG) {
      return emitLeaf(node, depth, ctx);
    }
    if (node.$_tag === II_TAG) {
      const content = node.$_content;
      if (content.length !== 1 || !is_Node(content[0])) {
        _throw_transform_err(
          "serialize-hson: _hson_ii must contain exactly one child node",
          "serialize_hson.emitNode",
        );
      }
      return emitNode(content[0], depth, parentCluster, ctx);
    }
    if (node.$_tag === ARR_TAG) return emitArray(node, depth, ctx);
    if (node.$_tag === OBJ_TAG) return emitObject(node, depth, ctx);
    if (node.$_tag === ELEM_TAG) {
      return emitElementCluster(node, depth, parentCluster === undefined, ctx);
    }
    return emitStandardNode(node, depth, ctx);
  } finally {
    ctx.guard.leave(node);
  }
}

/** Serialize a canonical HSON graph in readable (default) or compact layout. */
function serialize_hson_with_ownership(
  root: HsonNode,
  inputOptions: HsonSerializeInputOptions = {},
  ownedElementTextFragment = false,
): HsonString {
  if (!is_Node(root)) {
    _throw_transform_err(
      "serialize-hson: root must be a HsonNode",
      "serialize-hson",
    );
  }
  if (root.$_tag === ROOT_TAG) {
    _throw_transform_err(
      "serialize-hson: _hson_root is an internal attachment carrier and cannot be serialized",
      "serialize_hson",
    );
  }

  assert_invariants(root, "serialize_hson");
  // Egress is a cold canonical boundary: validate every supplied identity,
  // while deliberately allowing equal valid claims on distinct graph nodes.
  collect_hson_node_quid_claims(root);
  const ctx: SerializeContext = {
    options: {
      layout: inputOptions.noBreak ? "compact" : "readable",
      noQuid: inputOptions.noQuid ?? false,
      ownedElementTextFragment,
    },
    guard: cycleGuard(),
  };
  return emitNode(root, 0, undefined, ctx).trim() as HsonString;
}

/** Serialize an ordinary detached semantic value; malformed carriers reject. */
export function serialize_hson(
  root: HsonNode,
  inputOptions: HsonSerializeInputOptions = {},
): HsonString {
  return serialize_hson_with_ownership(root, inputOptions, false);
}

/** @internal LiveMap/LiveHost ownership evidence for a root-owned text fragment. */
export function serialize_hson_owned_element_text_fragment(
  root: HsonNode,
  inputOptions: HsonSerializeInputOptions = {},
): HsonString {
  return serialize_hson_with_ownership(root, inputOptions, true);
}
