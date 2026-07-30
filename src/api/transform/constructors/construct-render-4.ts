// construct-render-4.ts

import { $RENDER } from "../../../core/constants.js";
import { make_string } from "../../../core/stringify.js";
import { serialize_hson } from "../serializers/serialize-hson.js";
import type { JsonValue } from "../../../core/types.js";
import type {
  TransformFrameRender,
  TransformHsonSerialize,
  TransformJsonValue,
  TransformOutputRenderFormat,
  TransformSerialize,
} from "../transform.types.js";

function clone_json_value(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(clone_json_value);
  if (typeof value !== "object" || value === null) return value;

  const clone: Record<string, JsonValue> = {};
  for (const [key, child] of Object.entries(value)) clone[key] = clone_json_value(child);
  return clone;
}

/**
 * HSON pipeline, stage 4: finalize the selected output.
 *
 * This is the terminal stage of the transformer chain. The incoming context
 * already contains:
 * - the chosen render format,
 * - the materialized representation on the frame,
 * - and any formatting options applied in stage 3.
 *
 * This stage exposes the final data operations:
 * - `serialize()` → string output in the chosen format
 * - JSON `value()` → the in-memory JsonValue projection
 *
 * HSON and HTML use serialization-only finalizers. Canonical graph access is
 * handled uniformly by the source constructor's `toNode()` terminal.
 *
 * LiveTree creation is not part of this final render stage.
 *
 * @param context - Render context containing the frame and chosen format.
 * @returns Stage-4 terminal render API.
 */
function serialize_render(context: TransformFrameRender<TransformOutputRenderFormat>): string {
  const { frame, output } = context;

  switch (output) {
    case $RENDER.JSON:
      if (frame.json === undefined) throw new Error("serialize(): frame is missing JSON data");
      return make_string(frame.json);
    case $RENDER.HTML:
      if (frame.html == null) throw new Error("serialize(): frame is missing HTML data");
      return typeof frame.html === "string" ? frame.html : make_string(frame.html);
  }
}

/** HSON output is serialization-only; graph access belongs to source `.toNode()`. */
export function construct_hson_render_4(
  context: TransformFrameRender<(typeof $RENDER)["HSON"]>,
): TransformHsonSerialize {
  return {
    serialize: () => serialize_hson(context.frame.node, {
      noBreak: context.frame.options?.noBreak ?? false,
      noQuid: context.frame.options?.noQuid ?? false,
    }),
  };
}

export function construct_html_render_4(
  context: TransformFrameRender<(typeof $RENDER)["HTML"]>,
): TransformSerialize {
  return {
    serialize: () => serialize_render(context),
  };
}

export function construct_json_render_4(
  context: TransformFrameRender<(typeof $RENDER)["JSON"]>,
): TransformJsonValue {
  return {
    serialize: () => serialize_render(context),
    value: () => {
      if (context.frame.json === undefined) {
        throw new Error("value(): frame is missing JSON data");
      }
      return clone_json_value(context.frame.json);
    },
  };
}
