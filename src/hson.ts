
import { construct_source_1 } from "./api/constructors/construct-source-1.js";
import { DomQueryLiveTreeConstructor, OutputConstructor_2 } from "./types/constructor.types.js";
import { DomQuerySourceConstructor } from "./types/constructor.types.js";
import { HsonNode } from "./types/node.types.js";
import { JsonValue } from "./types/core.types.js";
import { LiveTree } from "./api/livetree/livetree.js";
import { construct_tree } from "./api/constructors/construct-tree.js";


(globalThis as any)._test_ON = () => { (globalThis as any).test = true; location.reload(); };
(globalThis as any)._test_OFF = () => { (globalThis as any).test = false; location.reload(); };

/**
 * HSON public facade 
 *
 * This is the primary entry point for all HSON operations.
 *
 * Design:
 * [SOURCE]
 * - Step 1: choose a source via:
 *     - `hson.fromUntrustedHtml(html)`
 *     - `hson.fromTrustedHtml(html)`
 *     - `hson.fromJson(json)`
 *     - `hson.fromHson(hson)`
 *     - `hson.fromNode(node)`
 *     - `hson.queryDOM(selector)`
 *     - `hson.queryBody()`
 *
 * [OUTPUT]
 *  - Step 2: chain into the output builder returned by step 1:
 *       .toHtml()  → HTML string
 *       .toJson()  → JSONValue
 *       .toHson()  → HSON string or underlying nodes
 *       .liveTree() → create LiveTree
 *
 * * [OPTIONS]
 * - Step 3: optional formatting and rendering controls:
 *       .spaced()            // human-readable formatting
 *       .noBreak()           // single-line output
 *       .linted()            // canonical formatting
 *       .withOptions({...})  // fine-grained control
 *
 * [RENDER]
 * - Step 4: finalize the chain:
 *       .serialize()  → string output (HTML, JSON, or HSON text)
 *       .parse()      → structured data (JSONValue or HsonNode)
 *    (liveTree:)
 *       .asBranch()   → LiveTree instance created from HTML
 *       .graft()      → append LiveTree's HTML representation to the parent of 
 *                        its root node in the DOM, replacing the original
 *
 * Together these four steps form the complete HSON transformation pipeline:
 *   1) choose source
 *   2) choose output format
 *   3) optionally configure output
 *   4) produce final result (string, data, or LiveTree)


 * Trust model overview:
 *
 * - `fromUntrustedHtml(html)`:
 *   - For external / untrusted / user-supplied HTML.
 *   - Always runs the HTML through DOMPurify via `parse_external_html`.
 *   - Produces Nodes that has been sanitized according to your HTML policy.
 *
 * - `fromTrustedHtml(html)`:
 *   - For internal / developer-authored HTML only.
 *   - Bypasses DOMPurify; HTML is parsed raw via `parse_html`.
 *   - The resulting Nodes can express SVG, script tags, and other features that
 *     are blocked in the safe pipeline.
 *
 * - `fromJson`, `fromHson`, `fromNode`:
 *   - Treat inputs as data, not markup.
 *   - No DOMPurify is applied here by default.
 *   - If these structures encode HTML AST and you need HTML-style sanitization,
 *     that should be done explicitly later (e.g. Nodes → HTML → DOMPurify → Nodes).
 * 
 * 
 * [SECURITY / SANITIZATION]
 * - HTML sources are *not* interchangeable:
 *     • fromUntrustedHtml(html) → always sanitized, DOM-Purify pipeline
 *     • fromTrustedHtml(html)   → raw parsing, no filtering
 *
 * - The output builder exposes one explicit escape hatch:
 *       .sanitizeBEWARE()
 *   This forcibly re-sanitizes the current frame *even if the source
 *   was declared trusted*. It is intended only for:
 *       • ingesting JSON that may hide HTML payloads
 *       • double-checking legacy or externally supplied data
 *
 *   Calling .sanitizeBEWARE() on non-HTML formats is allowed but may
 *   destroy content (e.g., JSON becomes empty HTML). This is by design.
 *   Treat the method as a last-resort “firewall pass,” not normal flow.
 */
 
export const hson = {
  /**
   * External / untrusted HTML → sanitized HSON Nodes → (chained output).
   *
   * Use this when the HTML comes from:
   * - user input,
   * - a CMS,
   * - remote content,
   * - or any source you do not fully control.
   *
   * Behavior:
   * - Runs HTML through DOMPurify via `parse_external_html`.
   * - Produces a frame that records `{ origin: "html", sanitized: true }`.
   * - Does **not** attach anything to the DOM; further calls decide whether to:
   *     - serialize (`.toHtml()`, `.toJson()`, `.toHson()`),
   *     - or project into a LiveTree (`.branch()`).
   */
  fromUntrustedHtml(input: string | Element): OutputConstructor_2 {
    return construct_source_1({ unsafe: false }).fromHtml(input, {
      sanitize: true,
    });
  },

  /**
   * Internal / trusted HTML → raw HSON Nodes → (chained output).
   *
   * Use this only when the HTML comes from:
   * - your own source files,
   * - templates under your control,
   * - fixtures / demos / test content you own.
   *
   * Behavior:
   * - Bypasses DOMPurify; parses HTML via `parse_html` with no sanitization.
   * - The resulting Nodes can include SVG, script tags, and attributes which the
   *   safe pipeline would strip or reject.
   * - Meta is marked as `{ origin: "html", unsafePipeline: true, sanitized: false }`.
   *
   * Never feed untrusted / user-supplied HTML through this method.
   */
  fromTrustedHtml(input: string | Element): OutputConstructor_2 {
    return construct_source_1({ unsafe: true }).fromHtml(input, {
      sanitize: false,
    });
  },

  // ────────────────────────────────────────────────────────────
  // Structural formats: JSON / HSON text / Nodes
  // ────────────────────────────────────────────────────────────

  /**
   * JSON → HSON Nodes → (chained output).
   *
   * Treats the input as *structured data*, not markup.
   *
   * Behavior:
   * - Parses JSON via `parse_json` to HsonNode.
   * - No DOMPurify is applied.
   * - If your JSON encodes an HTML AST and you want HTML-style sanitization,
   *   you must handle that explicitly (e.g. Nodes → HTML → DOMPurify → Nodes).
   */
  fromJson(input: string | JsonValue): OutputConstructor_2 {
    // You can choose `{ unsafe: true }` or `{ unsafe: false }` here; for JSON,
    // the "unsafe" flag only tags meta and affects follow-up HTML parsing
    // decisions, not this step itself. Using `unsafe: true` makes it explicit
    // that this pipeline is free to express everything internally.
    return construct_source_1({ unsafe: true }).fromJson(input);
  },

  /**
   * HSON text → HSON Nodes → (chained output).
   *
   * Parses HSON source text into Nodes. No DOMPurify is used here.
   */
  fromHson(input: string): OutputConstructor_2 {
    return construct_source_1({ unsafe: true }).fromHson(input);
  },

  /**
   * Existing HsonNode → (chained output).
   *
   * Initializes the pipeline from an already-constructed Node.
   * No sanitization is applied here.
   */
  fromNode(node: HsonNode): OutputConstructor_2 {
    return construct_source_1({ unsafe: true }).fromNode(node);
  },

  // ────────────────────────────────────────────────────────────
  // DOM snapshot helpers (HTML taken from the live document)
  // ────────────────────────────────────────────────────────────

  /**
   * `document.querySelector(selector).innerHTML` → HSON Nodes.
   *
   * Snapshot helper for existing DOM.
   *
   * Behavior:
   * - Reads `innerHTML` of the matched element.
   * - Uses the *trusted* HTML path by default (no DOMPurify), since the
   *   current document is typically authored by you.
   * - Throws a structured transform error if the selector matches nothing.
   */
  queryDOM(selector: string): DomQuerySourceConstructor {
    const el = document.querySelector<HTMLElement>(selector);
    return {
      liveTree(): DomQueryLiveTreeConstructor {
        return {
          graft(): LiveTree {
            return construct_tree({ unsafe: false }).queryDom(selector).graft();
          },
        };
      },
    };
  },

  /**
   * `document.body.innerHTML` → HSON Nodes.
   *
   * Snapshot helper for the entire page.
   *
   - Uses the *trusted* HTML path by default (no DOMPurify).
   * - Throws a structured transform error if `document.body` is unavailable.
   */
  queryBody(): DomQuerySourceConstructor {
    return {
      liveTree(): DomQueryLiveTreeConstructor {
        return {
          graft(): LiveTree {
            return construct_tree({ unsafe: false }).queryBody().graft();
          },
        };
      },
    };
  },

};