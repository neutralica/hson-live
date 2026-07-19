// constructor.types.ts


import { $HSON_FRAME, $RENDER, } from "../core/constants.js";
import { HsonNode } from "../core/types.js";
import { JsonValue } from "../core/types.js";
import { LiveTree } from "../api/livetree/livetree.js";
import { HtmlCreateHelper } from "./livetree.types.js";

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
 * Maps an output format that supports `parse()` to its result type:
 *
 *   - JSON → JsonValue
 *   - HTML → never   (HTML has no exposed AST in this API)
 *
 * Callers know which `toX()` they chose and must narrow accordingly.
 ***************/
export type ParsedResult<K extends ParsedRenderFormats> =
  K extends (typeof $RENDER)["JSON"]
  ? JsonValue
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
 *  - html?   → cached HTML text (if materialized)
 *  - json?   → cached JSON (value or string, depending on usage)
 *
 *  - mode?   → FrameMode describing origin
 *  - meta?   → pipeline metadata (debugging, provenance, etc.)
 *  - options?→ active serialization options
 *
 * The frame flows through the stages; each stage may update it but
 * MUST leave it structurally coherent.
 ***************/
export interface FrameConstructor {
  input: string | Element;
  node: HsonNode;
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

/** Output formats whose finalizer retains the legacy `parse()` action. */
export type ParsedRenderFormats =
  | (typeof $RENDER)["JSON"]
  | (typeof $RENDER)["HTML"];


/******************************************************************************
 * LiveTree & DOM query surfaces
******************************************************************************/


/******************************************************************************
 * Source Constructor – Step 1 of Pipeline
 ******************************************************************************/

/***************
 * SourceConstructor_1
 *
 * Lowest-level “step 1” builder. Most inputs produce a normalized frame and
 * move to `OutputConstructor_2`. Every normalized source also exposes the
 * direct `.toNode()` terminal.
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
  /**
   * HSON text → normalized HSON frame.
   *
   * Accepts a raw HSON source string and parses it into the stage-1 frame
   * used by the transformer pipeline.
   *
   * Call `.toNode()` to parse and return the canonical graph directly.
   * Other output projections, including HSON reserialization, remain available.
   */
  fromHson(input: string): HsonSourceConstructor_2;
  
   /**
   * JSON → normalized HSON frame.
   *
   * Accepts either a JSON string or an already-parsed `JsonValue` and
   * converts it into the stage-1 frame used by the transformer pipeline.
   *
   * JSON is treated as structured data here, not markup:
   * - no HTML sanitization is applied at this stage
   * - object / array / primitive structure is preserved
   *
   * This stage does not create `LiveTree` instances. It only prepares the
   * normalized node frame for later `toHtml()`, `toJson()`, `toHson()`,
   * `serialize()`, or `parse()` calls.
   */
  fromJson(input: string | JsonValue): OutputConstructor_2;
     /**
     * HTML → normalized HSON frame.
     *
     * Accepts an HTML string or `Element` and produces the stage-1 frame used
     * by the transformer pipeline.
     *
     * SAFE pipeline (`pipelineOptions.unsafe === false`):
     * - `options.sanitize !== false` → sanitize and parse via `parse_external_html`
     * - `options.sanitize === false` → parse raw HTML via `parse_html`
     *
     * UNSAFE pipeline (`pipelineOptions.unsafe === true`):
     * - parses raw HTML via `parse_html`
     * - external SVG markup is allowed and is converted through the SVG path
     *
     * This stage does not create `LiveTree` instances. It only prepares the
     * normalized node frame for later `toHtml()`, `toJson()`, `toHson()`,
     * `serialize()`, or `parse()` calls.
     */
  fromHtml(input: string | Element, options?: HtmlSourceOptions): OutputConstructor_2;
  /**
   * Existing `HsonNode` → normalized HSON frame.
   *
   * Accepts an already-constructed `HsonNode` graph and wraps it as the
   * stage-1 frame used by the transformer pipeline.
   *
   * This is the identity-style entrypoint for callers that already have
   * HSON in memory and want to use the same output pipeline as the parsers.
   *
   * This stage does not create `LiveTree` instances. It only prepares the
   * normalized node frame for later `toHtml()`, `toJson()`, `toHson()`,
   * `serialize()`, or `parse()` calls.
   */
  fromNode(input: HsonNode): OutputConstructor_2;
  
  /**
   * Existing DOM subtree → normalized HSON frame.
   *
   * Selects an element via `document.querySelector(selector)`, reads its
   * `innerHTML`, and converts that markup into the stage-1 frame used by
   * the transformer pipeline.
   *
   * Parsing still follows the current safe/unsafe pipeline rules:
   * - SAFE pipelines sanitize by default
   * - UNSAFE pipelines parse raw HTML
   *
   * This method snapshots DOM content into the transform pipeline. It does
   * not graft or construct `LiveTree` directly.
   */
  queryDOM(selector: string): OutputConstructor_2;
  
  /**
   * `document.body` subtree → normalized HSON frame.
   *
   * Reads `document.body.innerHTML` and converts it into the stage-1 frame
   * used by the transformer pipeline.
   *
   * Parsing follows the current safe/unsafe pipeline rules, just like
   * `queryDOM(...)`.
   *
   * This method snapshots the current body content into the transform
   * pipeline. It does not graft or construct `LiveTree` directly.
   */
  queryBody(): OutputConstructor_2;
}

/***************
 * TreeConstructor_Source
 *
 * Direct `LiveTree` construction facade.
 *
 * Source-format semantics are the same as `SourceConstructor_1`; see that
 * interface for the detailed parsing / trust / normalization behavior of
 * `fromTrustedHtml`, `fromUntrustedHtml`, `fromJson`, `fromHson`, and `fromNode`.
 *
 * The difference here is the return type:
 * - source constructors return detached `LiveTree` branches directly
 * - DOM query constructors return `GraftConstructor`, whose `.graft()`
 *   binds an existing DOM subtree into LiveTree
 *
 * Use this interface when the goal is `LiveTree`, not the transform pipeline.
 ***************/
export interface TreeConstructor_Source {
  fromTrustedHtml(input: string | Element): LiveTree;
  fromUntrustedHtml(input: string | Element): LiveTree;
  fromJson(input: string | JsonValue): LiveTree;
  fromHson(input: string): LiveTree;
  fromNode(input: HsonNode): LiveTree;
  queryDom(selector: string): GraftConstructor;
  queryBody(): GraftConstructor;
  create: HtmlCreateHelper
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
  liveTree: DomQueryLiveTreeConstructor;
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
 *      Choose HSON text output. Its finalizer serializes only; use the
 *      source-level toNode() terminal for the canonical graph.
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
  /** Return the canonical normalized graph without serializing and reparsing. */
  toNode(): HsonNode;
  toJson(): OptionsConstructor_3<(typeof $RENDER)["JSON"]> & RenderConstructor_4<(typeof $RENDER)["JSON"]>;
  toHson(): HsonOptionsConstructor_3 & SerializeConstructor_4;
  toHtml(): OptionsConstructor_3<(typeof $RENDER)["HTML"]> & RenderConstructor_4<(typeof $RENDER)["HTML"]>;
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
 * HSON text source surface.
 *
 * Parsing terminates directly with `toNode()`. All ordinary output projections
 * are retained; the HSON serializer finalizer intentionally has no `parse()`.
 */
export interface HsonSourceConstructor_2 extends OutputConstructor_2 {}

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
 * Methods return the same option/finalizer surface so repeated options compose.
 *
 *  - withOptions(opts)
 *      Attach a partial FrameOptions object to the frame. This is the
 *      escape hatch for advanced formatting.
 *
 *  - noBreak()
 *      Shorthand for withOptions({ noBreak: true }).
 *
 ***************/
export interface OptionsConstructor_3<K extends ParsedRenderFormats> {
  withOptions(opts: PublicFrameOptions<K>): OptionsConstructor_3<K> & RenderConstructor_4<K>;
  noBreak(): OptionsConstructor_3<K> & RenderConstructor_4<K>;
}

/**
 * Active HSON serialization preferences. Readable output is the default;
 * `noBreak` selects canonical compact layout and `noQuid` filters only the
 * persisted `data-_quid` metadata key from HSON output.
 */
export interface FrameOptions {
  noBreak?: boolean;
  noQuid?: boolean;
}

/** JSON/HTML retain their existing noBreak option surface. */
export type PublicFrameOptions<K extends ParsedRenderFormats> =
  Pick<FrameOptions, "noBreak">;

/** Composable HSON-only option/finalizer methods. */
export interface HsonOptionsConstructor_3 {
  withOptions(opts: FrameOptions): HsonOptionsConstructor_3 & SerializeConstructor_4;
  noBreak(): HsonOptionsConstructor_3 & SerializeConstructor_4;
  noQuid(): HsonOptionsConstructor_3 & SerializeConstructor_4;
}


/******************************************************************************
 * Final Actions – Step 4
 ******************************************************************************/

/***************
 * SerializeConstructor_4 / RenderConstructor_4<K>
 *
 * Final “commit” surface for a chosen format `K`.
 *
 *  - serialize()
 *      Return a string representation in the selected format:
 *        JSON → JSON string
 *        HSON → HSON text (through SerializeConstructor_4)
 *        HTML → HTML string
 *
 *  - parse()
 *      Return a structured representation of the rendered form:
 *        JSON → JsonValue
 *        HTML → never
 *
 *      The caller is responsible for narrowing based on `toX()`.
 ***************/
export interface SerializeConstructor_4 {
  serialize(): string;
}

export interface RenderConstructor_4<K extends ParsedRenderFormats>
  extends SerializeConstructor_4 {
  parse(): ParsedResult<K>;
}
