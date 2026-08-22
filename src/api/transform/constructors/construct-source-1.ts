// construct-source-1.ts

import { HsonNode } from "../../../core/types.js";
import { HsonSourceConstructor_2, OutputConstructor_2 } from "../../../types/constructor.types.js";
import { JsonValue } from "../../../core/types.js";
import { _throw_transform_err } from "../utils/sys-utils/throw-transform-err.utils.js";
import { parse_external_html } from "../parsers/parse-external-html.transform.js";
import { parse_hson } from "../parsers/parse-hson.js";
import { parse_html } from "../parsers/parse-html.js";
import { parse_json } from "../parsers/parse-json.js";
import { construct_output_2 } from "./construct-output-2.js";
import { SourceConstructor_1 } from "../../../types/constructor.types.js";
import type { TransformFrame } from "../transform.types.js";

import {
  is_svg_markup,
  node_from_svg,
  SVG_NS,
} from "../utils/node-utils/node-from-svg.js";
import { scan_ingested_hson_node_quids } from "../utils/hson-utils/quid-ingress.js";
import { normalize_detached_hson_semantic_value } from "../../../core/normalize-hson-semantic-value.js";
import { assert_invariants } from "../../../core/assert-invariants.js";
import { detach_hson_root_value } from "../utils/node-utils/detach-hson-root-value.js";

/**
 * Per-call HTML parsing options for `construct_source_1.fromHtml()`.
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
    fromHtml(
      input: string | Element,
      options: HtmlSourceOptions = { sanitize: true }
    ): OutputConstructor_2 {
      // An Element is the source root. `outerHTML` is needed only when the
      // untrusted browser sanitizer must cross its string-based security
      // boundary; trusted HTML and direct SVG Elements retain the DOM object.
      const isElementInput = typeof input !== "string";
      const raw = isElementInput ? input.outerHTML : input;
      const trimmed = raw.trimStart();
      const isSvgInput = isElementInput
        ? input.namespaceURI === SVG_NS
        : is_svg_markup(trimmed);
      let node: HsonNode;
      let sanitized = false;

      // 1) SVG special case (UNSAFE only)
      if (isSvgInput) {
        if (!pipelineOptions.unsafe) {
          _throw_transform_err(
            "fromHtml(): external SVG is only allowed on the UNSAFE pipeline or via internal VSN→SVG nodes.",
            "fromHtml",
            raw.slice(0, 200)
          );
        }

        const el = isElementInput
          ? input
          : new DOMParser()
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
          : parse_html(input);       // raw HTML/DOM→Node, no DOMPurify

        sanitized = shouldSanitize;
      }

      const meta: Record<string, unknown> = {
        origin: isSvgInput ? "svg-html" : "html",
        unsafePipeline: pipelineOptions.unsafe,
        sanitized,
        rawInput: raw,
      };

      const frame: TransformFrame = { input: raw, node, meta };
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
    fromJson(input: string | JsonValue): OutputConstructor_2 {
      const node: HsonNode = parse_json(input);
      const raw: string =
        typeof input === "string" ? input : JSON.stringify(input);

      const frame: TransformFrame = {
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
     * HSON text → direct HSON Node constructor.
     *
     * Retains the source until `.toNode()` (or a cross-format conversion)
     * invokes the existing HSON parser. A successful parse is cached within
     * this source frame.
     *
     * Security notes:
     * - HSON is treated as an internal/intermediate format.
     * - No HTML sanitization is applied here.
     * - If your HSON ultimately encodes risky HTML, that must be handled
     *   at the HTML stage, not here.
     */
    fromHson(input: string): HsonSourceConstructor_2 {
      let frame: TransformFrame | undefined;

      const getFrame = (): TransformFrame => {
        if (frame) return frame;

        const parserRoot = parse_hson(input);
        frame = {
          input,
          node: detach_hson_root_value(parserRoot),
          meta: {
            origin: "hson-text",
            unsafePipeline: pipelineOptions.unsafe,
            sanitized: false,
          },
        };
        return frame;
      };

      const getOutput = (): OutputConstructor_2 => construct_output_2(getFrame());

      return {
        toNode(): HsonNode {
          return getFrame().node;
        },
        toBinary() {
          return getOutput().toBinary();
        },
        toHson() {
          return getOutput().toHson();
        },
        toJson() {
          return getOutput().toJson();
        },
        toHtml() {
          return getOutput().toHtml();
        },
        sanitizeBEWARE(): OutputConstructor_2 {
          return getOutput().sanitizeBEWARE();
        },
      };
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
      const node = normalize_detached_hson_semantic_value(input, "fromNode");
      scan_ingested_hson_node_quids(node, "fromNode");
      assert_invariants(node, "fromNode");
      const frame: TransformFrame = {
        input: JSON.stringify(node),
        node,
        meta: {
          origin: "node",
          unsafePipeline: pipelineOptions.unsafe,
          sanitized: false,
          binaryNode: input,
        },
      };

      return construct_output_2(frame);
    },

    /**
     * `document.querySelector(selector).innerHTML` → HSON Node.
     *
     * Snapshot helper for existing DOM. Semantics:
     * - Reads `innerHTML` of the matched element.
     * - Delegates to `.fromHtml(html)` using the *current pipeline*’s
     *   safe/unsafe mode:
     *     - if `pipelineOptions.unsafe === true` → no sanitization,
     *     - if `pipelineOptions.unsafe === false` → sanitize by default.
     *
     * This Transform-only helper intentionally snapshots children. It is
     * distinct from `hson.liveTree.queryDom(...).graft()`, which treats the
     * selected Element itself as the managed root.
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
      return this.fromHtml(html);
    },

    /**
     * `document.body.innerHTML` → HSON Node.
     *
     * Snapshot helper for the entire page.
     *
     * Behavior:
     * - Throws a structured transform error if `document.body` is unavailable.
     * - Delegates to `.fromHtml(body.innerHTML)` using the *current* pipeline’s
     *   safe/unsafe mode (same as `queryDOM`).
     *
     * This Transform-only helper intentionally snapshots body children. It is
     * distinct from `hson.liveTree.queryBody().graft()`, which treats the body
     * Element itself as the managed root.
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
      return this.fromHtml(html);
    },
  };
}
