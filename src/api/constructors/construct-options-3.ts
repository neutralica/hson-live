// construct-options-3.ts

import { RenderFormats } from "../../types/constructor.types";
import { construct_render_4 } from "./construct-render-4"; 
import { OptionsConstructor_3, FrameOptions, RenderConstructor_4 } from "../../types/constructor.types";
import { FrameRender } from "../../types/constructor.types";

/**
 * Stage 3 : applying output options.
 *
 * These methods configure the final output's formatting.
 *
 * Each call:
 * - merges new flags into `frame.options`,
 * - then returns the final render object (stage 4),
 *   immediately ready for `serialize()` / `parse()` / `asBranch()`.
 *
 * This keeps the original behavior but is typed against the NEW
 * constructor interfaces used by `construct_output_2`.
 *
 * @param render - the render context from stage 2 (format already chosen).
 * @returns an object exposing the options surface (stage 3).
 */
export function construct_options_3<K extends RenderFormats>(
  render: FrameRender<K>
): OptionsConstructor_3<K> {
  const { frame, output } = render;

  return {
    /**
     * Apply a custom set of formatting options.
     *
     * Convenience helpers like `.noBreak()` and `.spaced()` are shorthands
     * for calling this with specific flags.
     */
    withOptions(opts: FrameOptions):  RenderConstructor_4<K> {
      const updatedFrame: FrameRender<K>["frame"] = {
        ...frame,
        options: { ...frame.options, ...opts },
      };
      return construct_render_4({ frame: updatedFrame, output });
    },

    /**
     * Format the output on a single line with no line breaks.
     */
    noBreak():  RenderConstructor_4<K> {
      const updatedFrame: FrameRender<K>["frame"] = {
        ...frame,
        options: { ...frame.options, noBreak: true },
      };
      return construct_render_4({ frame: updatedFrame, output });
    },

    /**
     * Add human-readable spacing and indentation to the output.
     */
    spaced():  RenderConstructor_4<K> {
      const updatedFrame: FrameRender<K>["frame"] = {
        ...frame,
        options: { ...frame.options, spaced: true },
      };
      return construct_render_4({ frame: updatedFrame, output });
    },

  };
}
