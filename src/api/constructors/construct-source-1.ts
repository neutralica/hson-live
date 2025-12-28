// construct-source-1.ts

import { HsonNode } from "../../types-consts/node.types";
import { FrameConstructor } from "../../types-consts/constructor.types";
import { OutputConstructor_2 } from "../../types-consts/constructor.types";
import { JsonValue } from "../../types-consts/core.types";
import { _throw_transform_err } from "../../utils/sys-utils/throw-transform-err.utils";
import { parse_external_html } from "../parsers/parse-external-html.transform";
import { parse_hson } from "../parsers/parse-hson.new.transform";
import { parse_html } from "../parsers/parse-html.new.transform";
import { parse_json } from "../parsers/parse-json.new.transform";
import { construct_output_2 } from "./construct-output-2";
import { SourceConstructor_1 } from "../../types-consts/constructor.types";
import { isSvgMarkup, node_from_svg } from "../../utils/node-utils/node-from-svg";

/**
 * Per-call HTML parsing options for `construct_source_1.fromHTML()`.
 */
export interface HtmlSourceOptions {
  /** Per-call override for HTML sanitization.
   *
   * SAFE pipeline (`pipelineOptions.unsafe === false`):
   *  - `sanitize !== false` → DOMPurify via `parse_external_html`.
   *  - `sanitize === false` → raw HTML via `parse_html` (no DOMPurify).
   *
   * UNSAFE pipeline (`pipelineOptions.unsafe === true`):
   *  - This flag is ignored; HTML is always parsed via `parse_html`.
   */
  sanitize?: boolean;
}

/**
 * Unified HSON source constructor (NEW).
 *
 * This is stage 1 of the NEW pipeline:
 *   - It accepts *source formats* (HTML / JSON / HSON / DOM / IR),
 *   - Normalizes them into a single HsonNode frame,
 *   - Then hands that frame to `construct_output_2` (stage 2).
 *
 * It does **not** attach anything to the DOM.
 *
 * Trust model:
 * - `pipelineOptions.unsafe === false` (SAFE pipeline):
 *   - HTML sources are sanitized by default (DOMPurify via `parse_external_html`).
 *   - You may override per-call with `{ sanitize: false }` if the HTML is
 *     truly internal / trusted. Doing that on untrusted content is a security risk.
 *
 * - `pipelineOptions.unsafe === true` (UNSAFE pipeline):
 *   - HTML sources bypass sanitization and go through `parse_html` verbatim.
 *   - Intended only for trusted, developer-authored content (fixtures, demos).
 *
 * Non-HTML sources (JSON / HSON / Node):
 * - Are treated as *structural* inputs.
 * - Are **not** passed through DOMPurify here.
 * - If they encode HTML AST and you want HTML-style sanitization, you must do
 *   that explicitly later (e.g. Node → HTML → DOMPurify → Node).
 *
 * @param pipelineOptions - Pipeline configuration (safe vs unsafe parsing).
 * @returns Stage-1 constructor API for creating a normalized HSON frame.
 */
export function construct_source_1(
  pipelineOptions: { unsafe: boolean } = { unsafe: false }
): SourceConstructor_1 {
  return {
    /**
     * HTML → HSON Node.
     *
     * Accepts an HTML string or Element and produces a normalized HsonNode frame.
     *
     * SAFE pipeline (`pipelineOptions.unsafe === false`):
     *   - `options.sanitize !== false` → `parse_external_html` (DOMPurify + parser).
     *   - `options.sanitize === false` → `parse_html` (raw HTML, no DOMPurify).
     *
     * UNSAFE pipeline (`pipelineOptions.unsafe === true`):
     *   - always `parse_html` (no DOMPurify), regardless of `options.sanitize`.
     *
     * This only prepares Node + meta; later steps choose whether to:
     *   - serialize (`.toHtml()`, `.toJson()`, `.toHson()`),
     *   - or project into a LiveTree (`.asBranch()`).
     */
    fromHTML(
      input: string | Element,
      options: HtmlSourceOptions = { sanitize: true }
    ): OutputConstructor_2 {
      const raw: string =
        typeof input === "string" ? input : input.innerHTML;

      const trimmed = raw.trimStart();

      let node: HsonNode;
      let sanitized = false;

      // 1) SVG special case (UNSAFE only)
      if (isSvgMarkup(trimmed)) {
        if (!pipelineOptions.unsafe) {
          _throw_transform_err(
            "fromHTML(): external SVG is only allowed on the UNSAFE pipeline or via internal VSN→SVG nodes.",
            "fromHTML",
            raw.slice(0, 200)
          );
        }

        // Match old behavior: parse SVG via XML + node_from_svg
        const el = new DOMParser()
          .parseFromString(raw, "image/svg+xml")
          .documentElement;
        node = node_from_svg(el);
        sanitized = false; // no DOMPurify here
      } else {
        // 2) Normal HTML path: safe vs unsafe, with DOMPurify when appropriate
        const shouldSanitize: boolean =
          !pipelineOptions.unsafe && options.sanitize !== false;

        node = shouldSanitize
          ? parse_external_html(raw) // DOMPurify + HTML semantics
          : parse_html(raw);         // raw HTML→Node, no DOMPurify

        sanitized = shouldSanitize;
      }

      const meta: Record<string, unknown> = {
        origin: isSvgMarkup(trimmed) ? "svg-html" : "html",
        unsafePipeline: pipelineOptions.unsafe,
        sanitized,
        rawInput: raw,
      };

      const frame: FrameConstructor = { input: raw, node, meta };
      return construct_output_2(frame);
    },

    /**
     * JSON → HSON Node.
     *
     * Accepts a JSON string or parsed JSON value and normalizes it to HsonNode.
     *
     * Security notes:
     * - JSON here is treated as *structured data*, not markup.
     * - No HTML sanitization is applied at this stage.
     * - If your JSON encodes an HTML-like AST and you want HTML-style
     *   sanitization, you must opt into that later (Node → HTML → DOMPurify → Node).
     */
    fromJSON(input: string | JsonValue): OutputConstructor_2 {
      const raw: string =
        typeof input === "string" ? input : JSON.stringify(input);

      const node: HsonNode = parse_json(raw);

      const frame: FrameConstructor = {
        input: raw,
        node,
        meta: {
          origin: "json",
          unsafePipeline: pipelineOptions.unsafe,
          sanitized: false,
        },
      };

      return construct_output_2(frame);
    },

    /**
     * HSON text → HSON Node.
     *
     * Parses HSON source text into a HsonNode tree.
     *
     * Security notes:
     * - HSON is treated as an internal/intermediate format.
     * - No HTML sanitization is applied here.
     * - If your HSON ultimately encodes risky HTML, that must be handled
     *   at the HTML stage, not here.
     */
    fromHSON(input: string): OutputConstructor_2 {
      const node: HsonNode = parse_hson(input);

      const frame: FrameConstructor = {
        input,
        node,
        meta: {
          origin: "hson-text",
          unsafePipeline: pipelineOptions.unsafe,
          sanitized: false,
        },
      };

      return construct_output_2(frame);
    },

    /**
     * Node → Node (identity entrypoint).
     *
     * Initializes the pipeline from an existing HsonNode.
     * Useful for:
     * - advanced workflows,
     * - tests,
     * - internal transforms/adapters.
     *
     * No sanitization is applied; the node is assumed to already be in
     * canonical Node form. If it originated from untrusted HTML, that choice
     * should already be reflected in how it was constructed.
     */
    fromNode(input: HsonNode): OutputConstructor_2 {
      const frame: FrameConstructor = {
        input: JSON.stringify(input),
        node: input,
        meta: {
          origin: "node",
          unsafePipeline: pipelineOptions.unsafe,
          sanitized: false,
        },
      };

      return construct_output_2(frame);
    },

    /**
     * `document.querySelector(selector).innerHTML` → HSON Node.
     *
     * Snapshot helper for existing DOM. Semantics:
     * - Reads `innerHTML` of the matched element.
     * - Delegates to `.fromHTML(html)` using the *current pipeline*’s
     *   safe/unsafe mode:
     *     - if `pipelineOptions.unsafe === true` → no sanitization,
     *     - if `pipelineOptions.unsafe === false` → sanitize by default.
     *
     * In the public facade you wired:
     * - `hson.queryDOM(...)` uses `{ unsafe: true }` → no sanitization
     *   for page snapshots (trusted).
     *
     * A missing selector throws a structured transform error.
     */
    queryDOM(selector: string): OutputConstructor_2 {
      const element = document.querySelector<HTMLElement>(selector);

      if (!element) {
        _throw_transform_err(
          `queryDOM(): no element for selector "${selector}"`,
          "queryDOM",
          selector
        );
      }

      const html: string = element.innerHTML;
      return this.fromHTML(html);
    },

    /**
     * `document.body.innerHTML` → HSON Node.
     *
     * Snapshot helper for the entire page.
     *
     * Behavior:
     * - Throws a structured transform error if `document.body` is unavailable.
     * - Delegates to `.fromHTML(body.innerHTML)` using the *current* pipeline’s
     *   safe/unsafe mode (same as `queryDOM`).
     *
     * In your new facade:
     * - `hson.queryBody()` uses `{ unsafe: true }`, so body snapshots are
     *   treated as trusted and never sanitized.
     */
    queryBody(): OutputConstructor_2 {
      const body = document.body as HTMLElement | null;

      if (!body) {
        _throw_transform_err(
          "queryBody(): document.body is not available",
          "queryBody"
        );
      }

      const html: string = body.innerHTML;
      return this.fromHTML(html);
    },
  };
}
