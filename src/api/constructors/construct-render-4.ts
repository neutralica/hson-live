// construct-render-4.ts

import { RenderFormats } from "../../types/constructor.types.js";
import { $RENDER } from "../../core/constants.js";
import { make_string } from "../../core/stringify.js";
import { ParsedResult, RenderConstructor_4 } from "../../types/constructor.types.js";
import { FrameRender } from "../../types/constructor.types.js";

/**
 * HSON pipeline, stage 4: finalize the selected output.
 *
 * This is the terminal stage of the transformer chain. The incoming context
 * already contains:
 * - the chosen render format,
 * - the materialized representation on the frame,
 * - and any formatting options applied in stage 3.
 *
 * This stage exposes only the final data operations:
 * - `serialize()` → string output in the chosen format
 * - `parse()` → structured output for JSON or HSON
 *
 * LiveTree creation is not part of this final render stage.
 *
 * @param context - Render context containing the frame and chosen format.
 * @returns Stage-4 terminal render API.
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
     * - After `.toHson()` → HSON string.
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
     *     → not supported to minimize XSS risk.
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
