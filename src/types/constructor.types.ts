
import { $HSON_FRAME, $RENDER, } from "../consts/constants";
import { HsonNode } from "./node.types";
import { JsonValue } from "./core.types";
import { LiveTree } from "../api/livetree/livetree";

/**
 * Controls per-call HTML sanitization for `fromHtml(...)`.
 *
 * In the safe pipeline:
 *   - sanitize: true  → run HTML through DOMPurify (default).
 *   - sanitize: false → treat HTML as trusted.
 *
 * In the unsafe pipeline (`unsafe: true`):
 *   - this flag is ignored; HTML is always parsed raw.
 *
 * Use only to override sanitization on a specific call.
 */
export interface HtmlSourceOptions {
  /** Override per-call HTML sanitization.
   *
   * - `true` (default in safe pipeline): sanitize via DOMPurify.
   * - `false`: treat HTML as trusted/internal, even in safe pipeline.
   *
   * NOTE:
   * - In the UNSAFE pipeline (`pipelineOptions.unsafe === true`),
   *   this flag is ignored; HTML is never sanitized there.
   */
  sanitize?: boolean;
}

/***************
 * ParsedResult<K>
 *
 * Maps a chosen output format `K` to the result type of `parse()`:
 *
 *   - JSON → JsonValue
 *   - HSON → HsonNode
 *   - HTML → never   (HTML has no exposed AST in this API)
 *
 * Callers know which `toX()` they chose and must narrow accordingly.
 ***************/
export type ParsedResult<K extends RenderFormats> =
  K extends (typeof $RENDER)["JSON"]
  ? JsonValue
  : K extends (typeof $RENDER)["HSON"]
  ? HsonNode
  /* HTML is always returned as as string */
  : never;

/***************
 * FrameMode
 *
 * Indicates the *semantic origin* of the frame. Backed by `$HSON_FRAME`,
 * which typically distinguishes:
 *
 *   - "JSON"   → originally from JSON input
 *   - "HSON"   → originally from HSON input
 *   - "HTML"   → originally from HTML input
 *   - "NODE"   → originally from an existing HsonNode
 *
 * Primarily used internally for dispatch and sanity checks.
 ***************/
export type FrameMode = (typeof $HSON_FRAME)[keyof typeof $HSON_FRAME];

/***************
 * FrameConstructor
 *
 * Internal representation of the current transformation “frame”.
 *
 *  - input   → original caller input (string or Element)
 *  - node    → canonical HsonNode for this frame
 *
 *  - hson?   → cached HSON text (if materialized)
 *  - html?   → cached HTML text (if materialized)
 *  - json?   → cached JSON (value or string, depending on usage)
 *
 *  - mode?   → FrameMode describing origin
 *  - meta?   → pipeline metadata (debugging, provenance, etc.)
 *  - options?→ active FrameOptions (spacing, line length, linting, ...)
 *
 * The frame flows through the stages; each stage may update it but
 * MUST leave it structurally coherent.
 ***************/
export interface FrameConstructor {
  input: string | Element;
  node: HsonNode;
  hson?: string;
  html?: string;
  json?: JsonValue | string;
  mode?: FrameMode;
  meta?: Record<string, unknown>;
  options?: FrameOptions;
}

/***************
 * RenderFormats
 *
 * Discriminated union of supported output formats. Backed by the
 * `$RENDER` constant:
 *
 *   $RENDER = {
 *     JSON: "JSON",
 *     HSON: "HSON",
 *     HTML: "HTML",
 *   } as const;
 *
 * Used to drive `ParsedResult<K>` and to type the `toX()` methods.
 ***************/
export type RenderFormats = (typeof $RENDER)[keyof typeof $RENDER];


/******************************************************************************
 * LiveTree & DOM query surfaces
******************************************************************************/


/******************************************************************************
 * Source Constructor – Step 1 of Pipeline
 ******************************************************************************/

/***************
 * SourceConstructor_1
 *
 * Lowest-level “step 1” builder: given some input, produce a frame
 * and move to the *output selection* stage (OutputConstructor_2).
 *
 *  - fromHson(input)
 *      HSON string → Nodes.
 *
 *  - fromJson(input)
 *      JSON value or string → Nodes.
 *
 *  - fromHtml(input, options?)
 *      HTML string or HTMLElement → Nodes.
 *      Per-call sanitization controlled by HtmlSourceOptions in
 *      the SAFE pipeline; ignored for UNSAFE pipelines.
 *
 *  - fromNode(input)
 *      Identity entrypoint: an existing HsonNode becomes the frame.
 *
 *  - queryDOM(selector)
 *      Use `document.querySelector(selector).innerHTML` as HTML
 *      source. Pipeline configuration (safe vs unsafe) decides
 *      whether to sanitize.
 *
 *  - queryBody()
 *      Same as queryDOM, but for `document.body.innerHTML`.
 ***************/
export interface SourceConstructor_1 {
  fromHson(input: string): OutputConstructor_2;
  fromJson(input: string | JsonValue): OutputConstructor_2;
  fromHtml(input: string | Element, options?: HtmlSourceOptions): OutputConstructor_2;
  fromNode(input: HsonNode): OutputConstructor_2;
  queryDOM(selector: string): OutputConstructor_2;
  queryBody(): OutputConstructor_2;
}

/***************
 * TreeConstructor_Source
 *
 * High-level façade for choosing a *source* and then immediately
 * getting either a LiveTree branch or graft handle.
 *
 * Creation flows:
 *
 *  - fromHtml(html)
 *      Parse HTML/HSON-HTML into nodes, return BranchConstructor.
 *
 *  - fromJson(json)
 *      Parse JSON into nodes, return BranchConstructor.
 *
 *  - fromHson(hson)
 *      Parse HSON text into nodes, return BranchConstructor.
 *
 *  - queryDom(selector)
 *      Use `document.querySelector(selector).innerHTML` as HTML
 *      source; return a GraftConstructor for replacement.
 *
 *  - queryBody()
 *      Use `document.body.innerHTML` as HTML source; same semantics
 *      as queryDom, but for the whole document body.
 ***************/
export interface TreeConstructor_Source {
  fromHtml(htmlString: string): BranchConstructor;
  fromJson(json: string | JsonValue): BranchConstructor;
  fromHson(hsonString: string): BranchConstructor;
  queryDom(selector: string): GraftConstructor;
  queryBody(): GraftConstructor;
}

/***************
 * DomQuerySourceConstructor
 *
 * Source constructor using legacy DOM query methods. Typically used by
 * `hson.queryDOM(...)` and friends.
 *
 *  - liveTree()
 *      Returns a DomQueryLiveTreeConstructor2 for performing the
 *      actual graft into the DOM.
 ***************/
export interface DomQuerySourceConstructor {
  liveTree(): DomQueryLiveTreeConstructor;
}

/******************************************************************************
 * Output Selection – Step 2
 ******************************************************************************/

/***************
 * OutputConstructor_2
 *
 * “Step 2” of the pipeline: choose the *output* representation for
 * the current frame. Each `toX()`:
 *
 *   1) selects a render format (JSON / HSON / HTML),
 *   2) ensures that representation is materialized in the frame,
 *   3) returns a merged type that exposes:
 *        - step 3: OptionsConstructor_3<K>
 *        - step 4: RenderConstructor_4<K>
 *
 * Methods:
 *
 *  - toJson()
 *      Choose JSON output. parse() will yield a JsonValue.
 *
 *  - toHson()
 *      Choose HSON text output. parse() will yield a HsonNode.
 *
 *  - toHtml()
 *      Choose HTML output. parse() is currently `never`.
 *
 *  - liveTree()
 *      Project directly into a LiveTree constructor instead of
 *      serializing. Returns LiveTreeConstructor_3.
 *
 *  - sanitizeBEWARE()
 *      Special case: take the current frame.node:
 *
 *        1. serialize it to HTML (unsafe/raw),
 *        2. run that HTML through the *untrusted* HTML sanitizer
 *           (DOMPurify via parse_external_html / sanitize_html),
 *        3. parse the sanitized HTML back into nodes,
 *        4. return a *new* OutputConstructor_2 rooted at those nodes.
 *
 *      This only makes sense when the frame encodes HTML semantics.
 *      If used on non-HTML-shaped trees, the sanitizer will happily
 *      delete underscored tags and may return nothing.
 ***************/
export interface OutputConstructor_2 {
  toJson(): OptionsConstructor_3<(typeof $RENDER)["JSON"]> & RenderConstructor_4<(typeof $RENDER)["JSON"]>;
  toHson(): OptionsConstructor_3<(typeof $RENDER)["HSON"]> & RenderConstructor_4<(typeof $RENDER)["HSON"]>;
  toHtml(): OptionsConstructor_3<(typeof $RENDER)["HTML"]> & RenderConstructor_4<(typeof $RENDER)["HTML"]>;
  liveTree: LiveTreeConstructor_3;

  /**
   * 🔥 HTML-style sanitization applied *after* source selection.
   *
   * This:
   *   1) takes the current Node (frame.node),
   *   2) serializes it to HTML,
   *   3) runs that HTML through the *untrusted* HTML pipeline
   *      (DOMPurify via `parse_external_html` / 'sanitize_html'),
   *   4) parses the sanitized HTML back into Nodes,
   *   5) returns a NEW builder rooted at that sanitized Nodes.
   *
   * Use cases:
   * - unknown/untrusted JSON/HSON/Nodes that semantically encode HTML
   *   may need to be run through the HTML sanitizer before touching the DOM.
   *
   * Dangers:
   * - If your data is *not* HTML-shaped (e.g. is JSON, or nodes encoding same),
   *   this will return an empty string; the DOMPuriufy sees underscored tags
   *   as invalid markup and strips aggressively.
   *
   *  *** ONLY call this on HsonNodes that encode HTML ***
   *
   */
  sanitizeBEWARE(): OutputConstructor_2;
}

/**
 * Bundles:
 *   - frame  → FrameConstructor
 *   - output → selected render format
 *
 * Used internally for dispatch and debugging.
 */
export interface FrameRender<K extends RenderFormats> {
  frame: FrameConstructor;
  output: K;
}


/***************
 * GraftConstructor
 *
 * Returned by DOM-targeteing source constructors (`queryDom`, `queryBody`).
 *
 *  - graft()
 *      Parses the target DOM element’s content into a HsonNode tree,
 *      replaces that element’s contents with the HSON-controlled view,
 *      and returns the controlling LiveTree instance.
 ***************/
export interface GraftConstructor {
  graft(): LiveTree;
}

/***************
 * BranchConstructor
 *
 * Returned by data-based source constructors (`fromJson`, `fromHson`,
 * `fromHtml`, `fromNode`).
 *
 *  - asBranch()
 *      Creates and returns a *detached* LiveTree rooted at the frame’s
 *      nodes. The caller is responsible for grafting / appending it
 *      into some host LiveTree or DOM.
 ***************/
export interface BranchConstructor {
  asBranch(): LiveTree;
}

/***************
 * LiveTreeConstructor_3
 *
 * Returned by `OutputConstructor_2.liveTree()` when the caller wants
 * to bypass string serialization and go straight to LiveTree.
 *
 *  - asBranch()
 *      Builds a LiveTree projection rooted at the current frame’s node.
 ***************/
export interface LiveTreeConstructor_3 {
  asBranch(): LiveTree;
}


/***************
 * DomQueryLiveTreeConstructor
 *
 * Result of `DomQuerySourceConstructor.liveTree()`.
 *
 *  - graft()
 *      Performs the DOM replacement and returns the LiveTree that
 *      now controls that DOM subtree.
 ***************/
export interface DomQueryLiveTreeConstructor {
  graft(): LiveTree;
}

/******************************************************************************
 * Options – Step 3
 ******************************************************************************/

/***************
 * OptionsConstructor_3<K>
 *
 * Optional “step 3” configuration layer for the chosen format `K`.
 * All methods return the final RenderConstructor_4<K>, so callers
 * can chain or skip them as desired.
 *
 *  - withOptions(opts)
 *      Attach a partial FrameOptions object to the frame. This is the
 *      escape hatch for advanced formatting.
 *
 *  - noBreak()
 *      Shorthand for withOptions({ noBreak: true }).
 *
 *  - spaced()
 *      Shorthand for withOptions({ spaced: true }).
 ***************/
export interface OptionsConstructor_3<K extends RenderFormats> {
  withOptions(opts: Partial<FrameOptions>): RenderConstructor_4<K>;
  noBreak(): RenderConstructor_4<K>;
  spaced(): RenderConstructor_4<K>;
  /* (linter deprecated) */
  // linted(): RenderConstructor_4<K>;
}

/**
 * Shared formatting preferences for serialization:
 *
 * - spaced     → pretty-printed, multi-line output
 * - lineLength → advisory max width for inline candidates
 * - linted     → request normalized output (serializer-dependent)
 * - noBreak    → force single-line output when possible
 *
 * Not all serializers honor every flag, but this is the common vocabulary.
 */
export interface FrameOptions {
  spaced?: boolean;
  lineLength?: number;
  linted?: boolean;
  noBreak?: boolean;
}


/******************************************************************************
 * Final Actions – Step 4
 ******************************************************************************/

/***************
 * RenderConstructor_4<K>
 *
 * Final “commit” surface for a chosen format `K`.
 *
 *  - serialize()
 *      Return a string representation in the selected format:
 *        JSON → JSON string
 *        HSON → HSON text
 *        HTML → HTML string
 *
 *  - parse()
 *      Return a structured representation of the rendered form:
 *        JSON → JsonValue
 *        HSON → HsonNode
 *        HTML → never
 *
 *      The caller is responsible for narrowing based on `toX()`.
 ***************/
export interface RenderConstructor_4<K extends RenderFormats> {
  serialize(): string;
  parse(): ParsedResult<K>;
}
