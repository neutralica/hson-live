// construct-render-4.ts

import { RenderFormats } from "../../types-consts/constructor.types";
import { $RENDER } from "../../types-consts/constants";
import { make_string } from "../../utils/primitive-utils/make-string.nodes.utils";
import { ParsedResult, RenderConstructor_4 } from "../../types-consts/constructor.types";
import { FrameRender } from "../../types-consts/constructor.types";

/**
 * Stage 4 (NEW, terminal): serialize or project the final data.
 *
 * This is the final stage of the fluent API chain.
 *
 * The `FrameRender` context coming in here already knows:
 * - which format was chosen in stage 2 (`output: RenderΔ`),
 * - which representation(s) were materialized on the frame
 *   (`frame.html` / `frame.json` / `frame.hson`),
 * - any formatting options that were set in stage 3 (`frame.options`).
 *
 * This constructor exposes three terminal operations:
 *
 * - `serialize()` → string in the chosen format,
 * - `parse()`     → structured value (JSON / Nodes),
 * - `asBranch()`  → LiveTree projection for DOM interaction.
 *
 * @param context - Render context containing the frame and output format.
 * @returns Stage-4 terminal render API for the chosen format.
 */
export function construct_render_4<K extends RenderFormats>(
  context: FrameRender<K>
): RenderConstructor_4<K> {
  const { frame, output } = context;

  return {
    /**
     * Return the final output as a string in the chosen format,
     * formatted according to any options supplied in stage 3.
     *
     * - After `.toHson()` → HSON source text.
     * - After `.toJson()` → JSON string.
     * - After `.toHtml()` → HTML string.
     */
    serialize(): string {
      switch (output) {
        case $RENDER.HSON: {
          if (!frame.hson) {
            throw new Error("serialize(): frame is missing HSON data");
          }
          return frame.hson;
        }

        case $RENDER.JSON: {
          if (frame.json == null) {
            throw new Error("serialize(): frame is missing JSON data");
          }
          return typeof frame.json === "string"
            ? frame.json
            : make_string(frame.json);
        }

        case $RENDER.HTML: {
          if (frame.html == null) {
            throw new Error("serialize(): frame is missing HTML data");
          }
          return typeof frame.html === "string"
            ? frame.html
            : make_string(frame.html);
        }

        default:
          throw new Error("serialize(): invalid output format");
      }
    },

    /**
     * Return the "valueful" data representation for inspection / manipulation.
     *
     * - After `.toJson()`:
     *     → parsed JSON value (object / array / primitive).
     * - After `.toHson()`:
     *     → the internal HsonNode tree (Nodes).
     * - After `.toHtml()`:
     *     → not supported; HTML is inherently stringy, so `.parse()` throws.
     *
     * This is intentionally typed as `unknown`; callers should narrow
     * based on which `toX()` they used:
     *
     *   const val = hson.fromJson(data).toJson().parse(); // val: unknown
     *   if (Array.isArray(val)) { ... }
     */
    parse(): ParsedResult<K>  {
      switch (output) {
        case $RENDER.JSON: {
          if (frame.json == null) {
            throw new Error("parse(): frame is missing JSON data");
          }

          if (typeof frame.json === "string") {
            // JSON string → parse
            return JSON.parse(frame.json) as ParsedResult<K> ;
          }

          // Already a structured JSON value.
          return frame.json as ParsedResult<K> ;
        }

        case $RENDER.HSON: {
          if (!frame.node) {
            throw new Error("parse(): frame is missing HSON node data");
          }
          // The Node itself is the “parsed” representation.
          return frame.node as ParsedResult<K> ;
        }

        case $RENDER.HTML: {
          // Explicitly refuse a "parsed" HTML value.
          throw new Error(
            ".parse() is not available for the HTML output format.\n" +
              "Use .serialize() to get the HTML string."
          );
        }

        default:
          throw new Error("parse(): could not find a format to parse");
      }
    },

  };
}
