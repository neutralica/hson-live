import { $RENDER } from "../../../core/constants.js";
import type {
  FrameOptions,
  FrameRender,
  HsonOptionsConstructor_3,
  JsonValueConstructor_4,
  OptionsConstructor_3,
  RenderFormats,
  SerializeConstructor_4,
} from "../../../types/constructor.types.js";
import { construct_hson_render_4, construct_html_render_4, construct_json_render_4 } from "./construct-render-4.js";

type JsonOptionFinalizer =
  OptionsConstructor_3<(typeof $RENDER)["JSON"]> & JsonValueConstructor_4;

type HtmlOptionFinalizer =
  OptionsConstructor_3<(typeof $RENDER)["HTML"]> & SerializeConstructor_4;

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

/** Build the composable JSON option/value surface. */
export function construct_json_options_3(
  render: FrameRender<(typeof $RENDER)["JSON"]>,
): JsonOptionFinalizer {
  const finalize = (
    next: FrameRender<(typeof $RENDER)["JSON"]>,
  ): JsonOptionFinalizer => construct_json_options_3(next);

  return {
    withOptions(opts): JsonOptionFinalizer {
      return finalize(with_frame_options(render, opts));
    },

    noBreak(): JsonOptionFinalizer {
      return finalize(with_frame_options(render, { noBreak: true }));
    },

    ...construct_json_render_4(render),
  };
}

/** Build the composable HTML serialization surface. */
export function construct_html_options_3(
  render: FrameRender<(typeof $RENDER)["HTML"]>,
): HtmlOptionFinalizer {
  const finalize = (
    next: FrameRender<(typeof $RENDER)["HTML"]>,
  ): HtmlOptionFinalizer => construct_html_options_3(next);

  return {
    withOptions(opts): HtmlOptionFinalizer {
      return finalize(with_frame_options(render, opts));
    },

    noBreak(): HtmlOptionFinalizer {
      return finalize(with_frame_options(render, { noBreak: true }));
    },

    ...construct_html_render_4(render),
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
