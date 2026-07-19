import { $RENDER } from "../../../core/constants.js";
import type {
  FrameOptions,
  FrameRender,
  HsonOptionsConstructor_3,
  OptionsConstructor_3,
  PublicFrameOptions,
  RenderConstructor_4,
  ParsedRenderFormats,
  RenderFormats,
  SerializeConstructor_4,
} from "../../../types/constructor.types.js";
import { construct_hson_render_4, construct_render_4 } from "./construct-render-4.js";

type OptionFinalizer<K extends ParsedRenderFormats> =
  OptionsConstructor_3<K> & RenderConstructor_4<K>;

type HsonOptionFinalizer =
  HsonOptionsConstructor_3 & SerializeConstructor_4;

function with_frame_options<K extends RenderFormats>(
  render: FrameRender<K>,
  options: FrameOptions,
): FrameRender<K> {
  return {
    output: render.output,
    frame: {
      ...render.frame,
      options: { ...render.frame.options, ...options },
    },
  };
}

/** Build the composable legacy JSON/HTML option surface. */
export function construct_options_3<K extends ParsedRenderFormats>(
  render: FrameRender<K>,
): OptionFinalizer<K> {
  const finalize = (next: FrameRender<K>): OptionFinalizer<K> =>
    construct_options_3(next);

  return {
    withOptions(opts: PublicFrameOptions<K>): OptionFinalizer<K> {
      return finalize(with_frame_options(render, opts));
    },

    noBreak(): OptionFinalizer<K> {
      return finalize(with_frame_options(render, { noBreak: true }));
    },

    ...construct_render_4(render),
  };
}

/** Build the composable HSON option/finalizer surface. */
export function construct_hson_options_3(
  render: FrameRender<(typeof $RENDER)["HSON"]>,
): HsonOptionFinalizer {
  const finalize = (
    next: FrameRender<(typeof $RENDER)["HSON"]>,
  ): HsonOptionFinalizer => construct_hson_options_3(next);

  return {
    withOptions(opts: FrameOptions): HsonOptionFinalizer {
      return finalize(with_frame_options(render, opts));
    },

    noBreak(): HsonOptionFinalizer {
      return finalize(with_frame_options(render, { noBreak: true }));
    },

    noQuid(): HsonOptionFinalizer {
      return finalize(with_frame_options(render, { noQuid: true }));
    },

    ...construct_hson_render_4(render),
  };
}
