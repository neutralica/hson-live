import { $RENDER } from "../../../core/constants.js";
import type {
  TransformFrameOptions,
  TransformFrameRender,
  TransformHsonOptions,
  TransformHsonSerialize,
  TransformJsonValue,
  TransformOutputOptions,
  TransformRenderFormat,
  TransformSerialize,
} from "../transform.types.js";
import { construct_hson_render_4, construct_html_render_4, construct_json_render_4 } from "./construct-render-4.js";

type JsonOptionFinalizer =
  TransformOutputOptions<(typeof $RENDER)["JSON"]> & TransformJsonValue;

type HtmlOptionFinalizer =
  TransformOutputOptions<(typeof $RENDER)["HTML"]> & TransformSerialize;

type HsonOptionFinalizer =
  TransformHsonOptions & TransformHsonSerialize;

function with_frame_options<K extends TransformRenderFormat>(
  render: TransformFrameRender<K>,
  options: TransformFrameOptions,
): TransformFrameRender<K> {
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
  render: TransformFrameRender<(typeof $RENDER)["JSON"]>,
): JsonOptionFinalizer {
  const finalize = (
    next: TransformFrameRender<(typeof $RENDER)["JSON"]>,
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
  render: TransformFrameRender<(typeof $RENDER)["HTML"]>,
): HtmlOptionFinalizer {
  const finalize = (
    next: TransformFrameRender<(typeof $RENDER)["HTML"]>,
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
  render: TransformFrameRender<(typeof $RENDER)["HSON"]>,
): HsonOptionFinalizer {
  const finalize = (
    next: TransformFrameRender<(typeof $RENDER)["HSON"]>,
  ): HsonOptionFinalizer => construct_hson_options_3(next);

  return {
    withOptions(opts: TransformFrameOptions): HsonOptionFinalizer {
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
