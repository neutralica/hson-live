// constructor.types.ts


import { $HSON_FRAME, $RENDER, } from "../core/constants.js";
import { HsonNode } from "../core/types.js";
import { JsonValue } from "../core/types.js";
import { LiveTree } from "../api/livetree/livetree.js";
import type { HsonCanonical, TransformOutput } from "../api/transform/transform.types.js";

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
 * FrameMode
 *
 * Indicates the *semantic origin* of the frame. Backed by `$HSON_FRAME`,
 * which typically distinguishes:
 *
 *   - "JSON"   → originally from JSON input
 *   - "Hson"   → originally from Hson input
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
  json?: JsonValue;
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
 *     Hson: "Hson",
 *     HTML: "HTML",
 *   } as const;
 *
 * Used to type the `toX()` methods.
 ***************/
export type RenderFormats = (typeof $RENDER)[keyof typeof $RENDER];

/** Non-Hson formats that participate in the shared option stage. */
export type OutputRenderFormats =
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
 * move to `TransformOutput`. Every normalized source also exposes the
 * direct `.toNode()` terminal.
 *
 *  - fromHson(input)
 *      Hson string → Nodes.
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
   * Hson text → normalized Hson frame.
   *
   * Accepts a raw Hson source string and parses it into the stage-1 frame
   * used by the transformer pipeline.
   *
   * Call `.toNode()` to parse and return the canonical graph directly.
   * Other output projections, including Hson reserialization, remain available.
   */
  fromHson(input: string): HsonSourceConstructor_2;
  
   /**
   * JSON → normalized Hson frame.
   *
   * Accepts either a JSON string or an already-parsed `JsonValue` and
   * converts it into the stage-1 frame used by the transformer pipeline.
   *
   * JSON is treated as structured data here, not markup:
   * - no HTML sanitization is applied at this stage
   * - object / array / primitive structure is preserved
   *
   * This stage does not create `LiveTree` instances. It only prepares the
   * normalized node frame for later `toNode()`, output selection, `value()`,
   * or `serialize()` calls.
   */
  fromJson(input: string | JsonValue): TransformOutput;
     /**
     * HTML → normalized Hson frame.
     *
     * Accepts an HTML string or `Element` and produces the stage-1 frame used
     * by the transformer pipeline.
     *
     * A supplied `Element` is the source root: the resulting graph includes
     * that element, its attributes and metadata, and its descendants. It is
     * not an `innerHTML` snapshot. The DOM has already normalized attribute
     * casing and namespaces and collapsed duplicate source attributes, so
     * those lexical distinctions cannot be recovered from an `Element`.
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
     * normalized node frame for later `toNode()`, output selection, `value()`,
     * or `serialize()` calls.
     */
  fromHtml(input: string | Element, options?: HtmlSourceOptions): TransformOutput;
  /**
   * Existing `HsonNode` → normalized Hson frame.
   *
   * Accepts an already-constructed `HsonNode` graph and wraps it as the
   * stage-1 frame used by the transformer pipeline.
   *
   * This is the identity-style entrypoint for callers that already have
   * Hson in memory and want to use the same output pipeline as the parsers.
   *
   * This stage does not create `LiveTree` instances. It only prepares the
   * normalized node frame for later `toNode()`, output selection, `value()`,
   * or `serialize()` calls.
   */
  fromNode(input: HsonNode): TransformOutput;
  
  /**
   * Existing DOM subtree → normalized Hson frame.
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
  queryDOM(selector: string): TransformOutput;
  
  /**
   * `document.body` subtree → normalized Hson frame.
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
  queryBody(): TransformOutput;
}

/**
 * Hson text source surface.
 *
 * Parsing terminates directly with `toNode()`. All ordinary output projections
 * are retained; the Hson serializer finalizer intentionally has no `parse()`.
 */
export interface HsonSourceConstructor_2 extends TransformOutput {}

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
 * Returned by DOM-targeting source constructors (`queryDom`, `queryBody`).
 *
 *  - graft()
 *      Parses the selected target element itself as the source root,
 *      re-projects its descendants as the Hson-controlled view, and returns
 *      the controlling LiveTree instance for that same root element.
 ***************/
export interface GraftConstructor {
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
export interface OptionsConstructor_3<K extends OutputRenderFormats> {
  withOptions(opts: PublicFrameOptions<K>): OptionsConstructor_3<K> & RenderConstructor_4<K>;
  noBreak(): OptionsConstructor_3<K> & RenderConstructor_4<K>;
}

/**
 * Active Hson serialization preferences. Readable output is the default;
 * `noBreak` selects canonical compact layout and `noQuid` filters only the
 * persisted `quid` metadata key from Hson output.
 */
export interface FrameOptions {
  noBreak?: boolean;
  noQuid?: boolean;
}

/** JSON/HTML retain their existing noBreak option surface. */
export type PublicFrameOptions<K extends OutputRenderFormats> =
  Pick<FrameOptions, "noBreak">;

/** Composable Hson-only option/finalizer methods. */
export interface HsonOptionsConstructor_3 {
  withOptions(opts: FrameOptions): HsonOptionsConstructor_3 & HsonSerializeConstructor_4;
  noBreak(): HsonOptionsConstructor_3 & HsonSerializeConstructor_4;
  noQuid(): HsonOptionsConstructor_3 & HsonSerializeConstructor_4;
}


/******************************************************************************
 * Final Actions – Step 4
 ******************************************************************************/

/***************
 * SerializeConstructor_4 / JsonValueConstructor_4
 *
 * Final “commit” surface for a chosen format `K`.
 *
 *  - serialize()
 *      Return a string representation in the selected format:
 *        JSON → JSON string
 *        Hson → Hson text (through SerializeConstructor_4)
 *        HTML → HTML string
 *
 *  - value()
 *      Return the in-memory JSON projection from a JSON output frame.
 ***************/
export interface SerializeConstructor_4 {
  serialize(): string;
  sha256(): Promise<string>;
}

export interface HsonSerializeConstructor_4 extends SerializeConstructor_4 {
  serialize(): HsonCanonical;
}

export interface JsonValueConstructor_4 extends SerializeConstructor_4 {
  value(): JsonValue;
}

export type RenderConstructor_4<K extends OutputRenderFormats> =
  K extends (typeof $RENDER)["JSON"]
    ? JsonValueConstructor_4
    : SerializeConstructor_4;
