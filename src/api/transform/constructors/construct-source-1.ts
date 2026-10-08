// construct-source-1.ts

import { HsonNode } from "../../../core/types.js";
import { parseDocument } from "htmlparser2";
import { isComment, isTag, isText } from "domhandler";
import type { Element as SourceElement } from "domhandler";
import { HsonSourceConstructor_2 } from "../../../types/constructor.types.js";
import { JsonValue } from "../../../core/types.js";
import { _throw_transform_err } from "../utils/sys-utils/throw-transform-err.utils.js";
import { CREATE_NODE } from "../../../core/factories.js";
import { ELEM_TAG, ROOT_TAG } from "../../../core/constants.js";
import { parse_external_html } from "../parsers/parse-external-html.transform.js";
import { parse_hson } from "../parsers/parse-hson.js";
import { parse_html } from "../parsers/parse-html.js";
import { parse_json } from "../parsers/parse-json.js";
import { construct_output_2 } from "./construct-output-2.js";
import { SourceConstructor_1 } from "../../../types/constructor.types.js";
import type { TransformFrame, TransformOutput } from "../transform.types.js";

import {
  is_svg_markup,
  node_from_svg,
  SVG_NS,
} from "../utils/node-utils/node-from-svg.js";
import { admit_exact_portable_node } from "../node-exact.js";
import { detach_hson_root_value } from "../utils/node-utils/detach-hson-root-value.js";

/** Native XML decoding must not add elements absent from the source. In the
 * standalone SVG route there is no DTD prolog or element-producing entity
 * expansion. Comparing names, nesting and order catches inserted browser
 * diagnostics without reserving any authored element name or namespace.
 */
function svg_source_elements_match(source: SourceElement, decoded: Element): boolean {
  const pending = [{ source, decoded }];
  while (pending.length !== 0) {
    const pair = pending.pop();
    if (!pair) break;
    if (pair.source.name !== pair.decoded.tagName) return false;
    const sourceChildren = pair.source.children.filter(isTag);
    const decodedChildren = Array.from(pair.decoded.childNodes)
      .filter((child): child is Element => child.nodeType === 1);
    if (sourceChildren.length !== decodedChildren.length) return false;
    for (let index = 0; index < sourceChildren.length; index++) {
      pending.push({ source: sourceChildren[index], decoded: decodedChildren[index] });
    }
  }
  return true;
}

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
 * Unified Hson source constructor (NEW).
 *
 * This is stage 1 of the NEW pipeline:
 *   - It accepts *source formats* (HTML / JSON / Hson / DOM / IR),
 *   - Parses external formats or exactly admits complete portable node input,
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
 * Non-HTML sources (JSON / Hson / Node):
 * - Are treated as *structural* inputs.
 * - Are **not** passed through DOMPurify here.
 * - If they encode HTML AST and you want HTML-style sanitization, you must do
 *   that explicitly later (e.g. Node → HTML → DOMPurify → Node).
 *
 * @param pipelineOptions - Pipeline configuration (safe vs unsafe parsing).
 * @returns Stage-1 constructor API for privately owned source graph state.
 */
export function construct_source_1(
  pipelineOptions: { unsafe: boolean } = { unsafe: false }
): SourceConstructor_1 {
  return {
    fromHtml(
      input: string | Element,
      options: HtmlSourceOptions = { sanitize: true }
    ): TransformOutput {
      // An Element is the source root. `outerHTML` is needed only when the
      // untrusted browser sanitizer must cross its string-based security
      // boundary; trusted HTML and direct SVG Elements retain the DOM object.
      const isElementInput = typeof input !== "string";
      const raw = isElementInput ? input.outerHTML : input;
      const trimmed = raw.trimStart();
      // The existing tokenizer ends PIs at the first '>', whereas XML permits
      // markup-looking PI data up to '?>'. Ignore instructions only in this
      // topology observation; preserve comments/CDATA and parse the raw XML
      // unchanged below. This also keeps lawful epilog PIs out of sibling routing.
      const topologySource = is_svg_markup(trimmed)
        ? raw.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>/g,
          token => token.startsWith("<?") ? "" : token)
        : raw;
      const sourceChildren = isElementInput ? [] : parseDocument(topologySource, {
        xmlMode: true, recognizeSelfClosing: true,
      }).children.filter(child => isTag(child) || (isText(child) && child.data.trim() !== "")
        || (isComment(child) && child.data.startsWith("hson-text")));
      const isSvgInput = isElementInput
        ? input.namespaceURI === SVG_NS
        : is_svg_markup(trimmed) && sourceChildren.length === 1
          && isTag(sourceChildren[0]) && sourceChildren[0].name.toLowerCase() === "svg";
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

        let el: Element;
        if (isElementInput) el = input;
        else {
          // A source-absent PI checks completion, but recoverable namespace
          // errors can retain it and insert diagnostics inside the SVG root.
          // Independently require every decoded element to have source origin.
          let completion = "hson-svg-source-end";
          while (raw.includes(completion)) completion += "_";
          const parsed = new DOMParser().parseFromString(`${raw}<?${completion}?>`, "image/svg+xml");
          const sourceRoot = sourceChildren.find(isTag);
          if (parsed.lastChild?.nodeType !== 7 || parsed.lastChild.nodeName !== completion
            || parsed.documentElement.tagName.toLowerCase() !== "svg"
            || !sourceRoot || !svg_source_elements_match(sourceRoot, parsed.documentElement)) {
            _throw_transform_err("SVG XML parsing failed", "fromHtml", raw.slice(0, 200), undefined,
              { stage: "source-decoding" });
          }
          el = parsed.documentElement;
        }
        node = CREATE_NODE({
          $_tag: ROOT_TAG,
          $_content: [CREATE_NODE({ $_tag: ELEM_TAG, $_content: [node_from_svg(el)] })],
        });
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

      // Qualify the semantic child in its complete receiving context, while
      // retaining source ROOT ownership (including ROOT[]) outside that role.
      if (node.$_content.length === 1) admit_exact_portable_node(node.$_content[0], "fromHtml");

      const meta: Record<string, unknown> = {
        // Both routes establish HTML source ownership, including SVG branches.
        origin: "html",
        unsafePipeline: pipelineOptions.unsafe,
        sanitized,
        rawInput: raw,
      };

      const frame: TransformFrame = { input: raw, node, meta };
      return construct_output_2(frame);
    },

    /**
     * JSON → Hson Node.
     *
     * Accepts a JSON string or parsed JSON value and normalizes it to HsonNode.
     *
     * Security notes:
     * - JSON here is treated as *structured data*, not markup.
     * - No HTML sanitization is applied at this stage.
     * - If your JSON encodes an HTML-like AST and you want HTML-style
     *   sanitization, you must opt into that later (Node → HTML → DOMPurify → Node).
     */
    fromJson(input: string | JsonValue): TransformOutput {
      const node: HsonNode = parse_json(input);
      const raw: string =
        typeof input === "string" ? input : "[JSON value]";

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
     * Hson text → direct Hson Node constructor.
     *
     * Retains the source until `.toNode()` (or a cross-format conversion)
     * invokes the existing Hson parser. A successful parse is cached within
     * this source frame.
     *
     * Security notes:
     * - Hson is treated as an internal/intermediate format.
     * - No HTML sanitization is applied here.
     * - If your Hson ultimately encodes risky HTML, that must be handled
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

      const getOutput = (): TransformOutput => construct_output_2(getFrame());

      return {
        toNode(): HsonNode {
          return getOutput().toNode();
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
    fromNode(input: HsonNode): TransformOutput {
      const node = admit_exact_portable_node(input, "fromNode");
      const frame: TransformFrame = {
        input: "[HsonNode]",
        node,
        meta: {
          origin: "node",
          unsafePipeline: pipelineOptions.unsafe,
          sanitized: false,
        },
      };

      return construct_output_2(frame);
    },

    /**
     * `document.querySelector(selector).innerHTML` → Hson Node.
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
    queryDOM(selector: string): TransformOutput {
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
     * `document.body.innerHTML` → Hson Node.
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
    queryBody(): TransformOutput {
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
