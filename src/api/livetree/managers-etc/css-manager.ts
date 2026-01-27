// css-manager.ts

import { PropertyManager } from "../../../types/at-property.types";
import { _DATA_QUID } from "../../../consts/constants";
import { CssValue, CssProp } from "../../../types/css.types";
import { apply_animation, bind_anim_api } from "../methods/anim";
import { AnimAdapters, CssAnimHandle, CssAnimScope } from "../../../types/animate.types";
import { manage_property } from "./at-prop-builder";
import { manage_keyframes } from "./keyframes-manager";
import { KeyframesManager } from "../../../types/keyframes.types";
import { LiveTree } from "../livetree";
import { camel_to_kebab } from "../../../utils/attrs-utils/camel_to_kebab";
import { GlobalCss } from "./global-css";

const CSS_HOST_TAG = "hson-_style";
const CSS_HOST_ID = "css-manager";
const CSS_STYLE_ID = "_hson";


type GlobalCssApi = ReturnType<typeof GlobalCss.api>;


// explicit type guard
export function isLiveTree(x: unknown): x is LiveTree {
  return x instanceof LiveTree;
}
/**
 * Render a `CssValue` into a CSS literal string.
 *
 * - `string` values are trimmed and returned as-is.
 * - `{ value, unit }` values are rendered as `${value}${unit}` with the special unit `"_"` meaning
 *   “no unit” (e.g. `{value: 1, unit: "_"}` → `"1"`).
 *
 * This is used in the stylesheet-backed pipeline (CssManager) to produce stable rule text.
 *
 * @param v A `CssValue` to render.
 * @returns A CSS-ready literal string (no surrounding property name).
 */
function renderCssValue(v: CssValue): string {
  // string → already a valid CSS literal
  if (typeof v === "string") {
    return v.trim();
  }
  if (
    typeof v === 'number' ||
    typeof v === 'boolean' ||
    !v
  ) {
    return '';
  }

  // object → { value, unit } → e.g. "12px", "1.5rem"
  const unit = v.unit === "_" ? "" : v.unit;
  return `${v.value}${unit}`;
}

/**
 * Map a QUID to the canonical CSS selector used by CssManager.
 *
 * This function centralizes the selector scheme so it stays consistent across:
 * - rule creation,
 * - rule updates,
 * - dev snapshots / debugging output.
 *
 * @param quid QUID to target.
 * @returns A selector string of the form `[data-_quid="..."]` (or whatever `_DATA_QUID` encodes).
 */
function selectorForQuid(quid: string): string {
  // SINGLE place where we define how a QUID maps to a CSS selector
  return `[${_DATA_QUID}="${quid}"]`;
}

/**
 * Convert a canonical property identifier into the exact CSS property name used in rule text.
 *
 * Rules:
 * - Custom properties (`--foo`) are returned unchanged.
 * - Keys already containing `-` are treated as kebab-case and returned unchanged.
 * - Otherwise, camelCase is converted to kebab-case.
 *
 * This exists to keep the StyleSetter-facing API flexible (camel or kebab in calls) while ensuring
 * CssManager emits stable, correct CSS text.
 *
 * @param propCanon Canonical property identifier (camelCase, kebab-case, or `--var`).
 * @returns The CSS property name to emit into a stylesheet rule.
 */

function canon_to_css_prop(propCanon: string): string {
  // CSS custom properties keep their spelling
  if (propCanon.startsWith("--")) return propCanon;

  if (propCanon.includes("-")) return propCanon.toLowerCase();

  // shared canonical implementation
  return camel_to_kebab(propCanon);
}

/**
 * Singleton manager for QUID-scoped stylesheet rules.
 *
 * `CssManager` owns the “stylesheet-backed” side of styling in HSON/LiveTree.
 * Rather than mutating inline `style=""`, it maintains an in-memory rule model:
 *
 *   QUID → (canonicalCssProp → renderedValue)
 *
 * and renders that model into a single `<style>` element in the active `document`.
 * Each QUID maps to one selector (via `selectorForQuid`), producing blocks like:
 *
 *   [data-_quid="…"] { opacity: 0.5; transform: translate(…); }
 *
 * Integration points:
 * - `css_for_quids()` creates a `CssHandle` by wiring a `StyleSetter` to this manager.
 *   The handle exposes a fluent surface (`setProp`, `setMany`, `remove`, `clear`, `set.*`)
 *   whose adapter methods call into `CssManager` (e.g. `setForQuid`, `unsetForQuid`).
 * - `PropertyManager` and `KeyframesManager` are owned sub-managers. Their `onChange`
 *   callbacks mark the stylesheet “dirty” and trigger a re-render so at-rules and
 *   keyframes stay in sync with the rule model.
 *
 * DOM contract:
 * - On first use, `invoke()` ensures a host container exists:
 *     `<hson-_style id="css-manager"> … </hson-_style>`
 *   and that it contains:
 *     `<style id="_hson"> … </style>`
 * - Rendering targets the *current* global `document`. If the document identity
 *   changes (e.g. test harness swapping `globalThis.document`), `CssManager`
 *   drops cached DOM references and resets internal state so rules and managers
 *   are not leaked across documents.
 *
 * Render policy:
 * - Mutations mark the manager as changed and schedule/perform a sync to DOM.
 *   (Exact batching behavior depends on `syncToDom()` implementation.)
 * - Output is deterministic where possible (e.g. sorted keys) to make diffs and
 *   snapshots stable in tests.
 *
 * Error handling:
 * - Write APIs may throw on programmer errors such as blank QUIDs or invalid
 *   property identifiers, to fail fast during development.
 */
export class CssManager {
  private static instance: CssManager | null = null;
  // QUID → (property → rendered value)
  private readonly rulesByQuid: Map<string, Map<string, string>> = new Map();
  private styleEl: HTMLStyleElement | null = null;
  private atPropManager: PropertyManager;
  private keyframeManager: KeyframesManager;
  private changed: boolean = false;
  private readonly globalCss: Map<string, string> = new Map();
  private globalsApi: GlobalCssApi | undefined;

  // Keep this private. It’s the “meaning” of onChange for your app.
  private notify_global_css_changed(): void {
    // pick ONE:
    this.mark_changed();      // preferred (batched)
    // this.syncToDom();           // if you really want immediate
  }

  // ADDED: coalescing state
  private scheduled: boolean = false;        // CHANGED: prevents multiple schedules
  private rafId: number | null = null;       // CHANGED: lets us cancel when forcing sync

  private boundDoc: Document | null = null;

  private constructor() {
    this.atPropManager = manage_property({ onChange: () => this.mark_changed() });
    this.keyframeManager = manage_keyframes({ onChange: () => this.mark_changed() });
  }
  /**
   * Marks the stylesheet state as updated and triggers a DOM sync.
   *
   * This is the single “invalidates + re-render” hook used by sub-managers
   * (`PropertyManager`, `KeyframesManager`) and by any rule write paths that
   * need to refresh the generated `<style>` text.
   *
   * Implementation note:
   * - This currently calls `syncToDom()` immediately. If you later introduce
   *   batching (e.g. microtask/RAF), this is the natural choke point to flip
   *   from “eager” to “scheduled” syncing.
   */
  private mark_changed(): void {
    // CHANGED: mark dirty, but DO NOT write immediately
    this.changed = true;

    // CHANGED: schedule a single flush
    this.scheduleSync();
  }

  // -------------------------
  // ADDED: scheduling layer
  // -------------------------
  private scheduleSync(): void {
    if (this.scheduled) return;

    // CHANGED: in Node (tests), flush immediately for determinism
    if (this.isNodeRuntime()) {
      this.syncNow();
      return;
    }

    const raf = (globalThis as any).requestAnimationFrame as
      | ((cb: FrameRequestCallback) => number)
      | undefined;

    // CHANGED: if no RAF in a browser-ish env, fallback to immediate
    if (!raf) {
      this.syncNow();
      return;
    }

    this.scheduled = true;
    this.rafId = raf(() => {
      this.scheduled = false;
      this.rafId = null;
      this.syncNow();
    });
  }

  private ensureBoundDoc(): void {
    const doc = (globalThis as any).document as Document | undefined;
    if (!doc) return;

    if (this.boundDoc !== doc) {
      this.boundDoc = doc;
      this.styleEl = null;
      this.resetManagersAndRules();
    }
  }


  /**
   * Resets all in-memory CSS state and owned sub-managers to a clean baseline.
   *
   * This is primarily a test/host-environment safety valve:
   * - When the global `document` identity changes (e.g. Happy DOM replacing
   *   `globalThis.document`), previously cached DOM references and rule maps
   *   are no longer valid. This method clears rule state and recreates
   *   `@property` / keyframe managers so they are bound to the new document.
   *
   * Side effects:
   * - Clears all QUID-scoped rule maps.
   * - Clears internal scheduling/dirty flags.
   * - Reinitializes `PropertyManager` and `KeyframesManager` with fresh
   *   `onChange` hooks.
   * - If the current `<style>` element is still connected, empties its text.
   */
  private resetManagersAndRules(): void {
    this.rulesByQuid.clear();
    this.changed = false;
    this.scheduled = false;
    this.atPropManager = manage_property({ onChange: () => this.mark_changed() });
    this.keyframeManager = manage_keyframes({ onChange: () => this.mark_changed() });

    if (this.styleEl && this.styleEl.isConnected) {
      this.styleEl.textContent = "";
    }
  }

  /**
   * Ensures the manager has a live `<style>` element in the current `document`
   * and returns it.
   *
   * Responsibilities:
   * 1) Detect host-document swaps:
   *    - If `globalThis.document` is not the same object previously seen,
   *      cached DOM references are discarded and internal rule/manager state is
   *      reset to avoid leaking rules across documents.
   *
   * 2) Validate cached element:
   *    - If `this.styleEl` exists but is detached or belongs to a different
   *      document, it is discarded and recreated.
   *
   * 3) Create / locate the host container and style element:
   *    - Ensures a host element `${CSS_HOST_TAG}#${CSS_HOST_ID}` exists.
   *    - Ensures a child `<style id="${CSS_STYLE_ID}">` exists inside the host.
   *
   * 4) Mirror external resets:
   *    - If a test harness or caller manually clears the `<style>` text while
   *      the manager still has non-empty rule state, this method treats the DOM
   *      as authoritative and clears `rulesByQuid` to match.
   *
   * Mount policy:
   * - Prefers `document.head` when connected, otherwise `document.body`,
   *   otherwise `document.documentElement`. Throws if none are available.
   *
   * @throws Error if no connected mount point exists in the current document.
   * @returns The ensured `<style>` element used for rendered CSS output.
   */
  private ensureStyleElement(): HTMLStyleElement | undefined {
    // NEW: guard against true Node / no DOM
    this.ensureBoundDoc();

    const doc = this.boundDoc ?? ((globalThis as any).document as Document | undefined);
    if (!doc) return undefined;


    // CHANGED: use the local doc var instead of global `document`
    if (this.boundDoc !== doc) {
      this.boundDoc = doc;
      this.styleEl = null;
      this.resetManagersAndRules();
    }

    if (this.styleEl) {
      if (!this.styleEl.isConnected || this.styleEl.ownerDocument !== doc) {
        this.styleEl = null;
      } else {
        return this.styleEl;
      }
    }

    const mount =
      (doc.head && doc.head.isConnected ? doc.head : null) ??
      (doc.body && doc.body.isConnected ? doc.body : null) ??
      doc.documentElement;

    if (!mount) {
      throw new Error("CssManager.ensureStyleElement: document has no mount point");
    }

    let host = doc.querySelector<HTMLElement>(`${CSS_HOST_TAG}#${CSS_HOST_ID}`);
    if (!host) {
      host = doc.createElement(CSS_HOST_TAG);
      host.id = CSS_HOST_ID;
      mount.appendChild(host);
    }

    let styleEl = host.querySelector<HTMLStyleElement>(`style#${CSS_STYLE_ID}`);
    if (!styleEl) {
      styleEl = doc.createElement("style");
      styleEl.id = CSS_STYLE_ID;
      host.appendChild(styleEl);
    }


    this.styleEl = styleEl;
    return styleEl;
  }

  // --- INTERNAL: BUILD + SYNC -------------------------------------------
  /**
 * Builds the complete stylesheet text managed by `CssManager`.
 *
 * Composition order:
 * 1) `@property` registrations (from `atPropManager.renderAll()`)
 * 2) keyframes / animation definitions (from `keyframeManager.renderAll()`)
 * 3) QUID-scoped rule blocks (from `rulesByQuid`)
 *
 * QUID rule format:
 * - Each QUID **must** emit exactly one selector block:
 *   `[data-_quid="..."] { prop: value; ... }`
 * - Properties are stored internally as *canonical* keys (camelCase, kebab-case,
 *   or `--custom-prop`) and are converted to emitted CSS property names via
 *   `canon_to_css_prop()`.
 * - Values in `rulesByQuid` are **final rendered strings** (no `{value, unit}`
 *   objects survive into this map). A defensive invariant check enforces this.
 *
 * Determinism:
 * - This function is pure with respect to DOM (string-in/string-out).
 * - Output ordering is defined by the iteration order of `rulesByQuid` and each
 *   per-QUID property map; if you need strict stability across runs, ensure
 *   insertion order is deterministic or sort keys before emitting.
 *
 * @returns The full stylesheet text ready to assign to `<style>.textContent`.
 * @throws Error If an invariant check detects a non-string value in `rulesByQuid`.
 */
  private buildCombinedCss(opts?: { globalsCss?: string }): string {
    // INVARIANT:
    // Each QUID MUST emit exactly one selector block.
    // rulesByQuid is Map<quid, Map<prop, string>> and MUST be folded
    // into a single `[data-_quid="..."] { ... }` block.
    // Do NOT emit per-property selector blocks.
    //
    // Boundary: rulesByQuid stores final rendered strings only (no objects).

    // Optional guard (no process.env):
    for (const [quid, rules] of this.rulesByQuid) {
      for (const [prop, val] of rules) {
        if (typeof val !== "string") {
          throw new Error(
            `CssManager invariant violated: non-string value at ${quid}.${prop}`
          );
        }
      }
    }
    const atPropCss = this.atPropManager.renderAll().trim();
    const keyframesCss = this.keyframeManager.renderAll().trim();

    const blocks: string[] = [];

    for (const [quid, props] of this.rulesByQuid.entries()) {
      if (props.size === 0) continue;

      const decls: string[] = [];
      for (const [propCanon, value] of props.entries()) {
        const prop = canon_to_css_prop(propCanon);
        decls.push(`${prop}: ${value};`);
      }

      blocks.push(`${selectorForQuid(quid)} { ${decls.join(" ")} }`);
    }

    const quidCss = blocks.join("\n\n").trim();

    const parts: string[] = [];

    const globals = opts?.globalsCss?.trim();
    if (globals) parts.push(globals);

    if (atPropCss) parts.push(atPropCss);
    if (keyframesCss) parts.push(keyframesCss);
    if (quidCss) parts.push(quidCss);

    return parts.join("\n\n");
  }

  // added
  private isNodeRuntime(): boolean {
    return typeof (globalThis as any).process !== "undefined"
      && !!(globalThis as any).process?.versions?.node;
  }

  private syncToDom(): void {
    const styleEl = this.ensureStyleElement();
    if (!styleEl) return;

    const cssText = this.buildCombinedCss({
      globalsCss: GlobalCss.invoke().renderAll(),
    });

    styleEl.textContent = cssText;
    this.changed = false;
  }

  /**
   * Constructs the adapter surface used by the animation subsystem for QUID scopes.
   *
   * The returned adapters translate generic animation operations into this
   * manager’s concrete mechanisms:
   * - style writes are routed through `setForQuid()` for each QUID in scope
   * - DOM pokes are performed by querying elements via `selectorForQuid()`
   *
   * Design intent:
   * - Keep the animation engine generic (it only knows about `scope`),
   *   while `CssManager` owns how scope maps to CSS rules and DOM elements.
   *
   * @returns An `AnimAdapters<CssAnimScope>` implementation bound to this manager.
   */
  private makeAnimAdapters(): AnimAdapters<CssAnimScope> {
    return {
      setStyleProp: (scope, prop, value) => {
        for (const quid of scope.quids) this.setForQuid(quid, prop, value);
        return scope;
      },

      forEachDomElement: (scope, fn) => {
        // CHANGED: guard document
        const doc = (globalThis as any).document as Document | undefined;
        if (!doc) return;

        for (const quid of scope.quids) {
          const el = doc.querySelector(selectorForQuid(quid));
          if (el) fn(el);
        }
      },

      getFirstDomElement: (scope) => {
        // CHANGED: guard document
        const doc = (globalThis as any).document as Document | undefined;
        if (!doc) return undefined;

        for (const quid of scope.quids) {
          const el = doc.querySelector(selectorForQuid(quid));
          if (el) return el;
        }
        return undefined;
      },
    };
  }


  public static invoke(): CssManager {
    if (!CssManager.instance) CssManager.instance = new CssManager();

    // CHANGED: bind doc if present, but do NOT create <style> here
    CssManager.instance.ensureBoundDoc();

    return CssManager.instance;
  }
  // ADDED: read the last-written value for quid+propCanon
  public getForQuid(quid: string, propCanon: string): string | undefined {
    return this.rulesByQuid.get(quid)?.get(propCanon);
  }

  // CHANGED: helper if you want “does this element have any css at all?”
  public hasAnyRules(quid: string): boolean {
    return (this.rulesByQuid.get(quid)?.size ?? 0) > 0;
  }

  /**
   * Dev-only helper that hard-resets all CSS state and re-ensures the DOM host.
   *
   * Behavior:
   * - Clears all QUID-scoped rules.
   * - Recreates the `@property` and keyframes managers.
   * - Empties the managed `<style>` element (if connected).
   *
   * This is primarily intended for tests (e.g. to avoid cross-test leakage)
   * and for manual debugging when the manager state must be rebuilt from zero.
   */
  public renderCss(): string {
    return this.buildCombinedCss();
  }

  /**
   * Exposes the `@property` registration manager used by this `CssManager`.
   *
   * Access guarantees:
   *   before returning the manager, so subsequent registrations can be rendered.
   *
   * @returns The live `PropertyManager` instance (singleton-owned).
   */
  public get atProperty(): PropertyManager {
    return this.atPropManager;
  }

  /**
   * Exposes the keyframes/animation definition manager used by this `CssManager`.
   *
   * Access guarantees:
   * - Ensures the managed `<style>` element exists for the current `document`
   *   before returning the manager, so keyframe writes can be rendered.
   *
   * @returns The live `KeyframesManager` instance (singleton-owned).
   */
  public get keyframes(): KeyframesManager {
    return this.keyframeManager;

  }

  // --- WRITE API (QUID-based) -------------------------------------------
  /**
   * Sets (or unsets) a single CSS declaration for a specific QUID selector.
   *
   * Rules:
   * - `quid` and `propCanon` are trimmed; blank inputs are treated as no-ops.
   * - Values are normalized to a string:
   *   - primitives are stringified
   *   - `CssValue` objects are rendered by `renderCssValue`
   * - Delete semantics:
   *   - if rendering yields `null`, the property is removed
   *   - if the rendered string trims to `""`, the property is removed
   *   - `"0"` and other non-empty strings are preserved (not treated as delete)
   *
   * Side effects:
   * - Mutates the in-memory rules map for the QUID.
   * - Marks the stylesheet dirty and triggers a DOM sync via `mark_changed()`.
   *
   * @param quid The QUID whose selector will receive the declaration.
   * @param propCanon The canonical property key (e.g. `"opacity"`, `"--k"`).
   * @param value The value to assign; may be a primitive or a structured `CssValue`.
   */
  public setForQuid(
    quid: string,
    propCanon: string,
    value: CssValue | string | number | boolean
  ): void {

    const q = quid.trim();
    if (!q) return;

    const p = propCanon.trim();
    if (!p) return;

    //  treat null-delete semantics only if renderCssValue returns null
    const rendered =
      typeof value === "string" || typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : renderCssValue(value); // <-- must return string or null

    //  explicit delete if null
    if (rendered === null) {
      this.unsetForQuid(q, p);
      return;
    }

    //  don't treat "0" as delete; only empty string deletes
    const v = rendered.trim();
    if (v.length === 0) {
      this.unsetForQuid(q, p);
      return;
    }

    let props = this.rulesByQuid.get(q);
    if (!props) {
      props = new Map<string, string>();
      this.rulesByQuid.set(q, props);
    }

    props.set(p, v);
    this.mark_changed();
  }

  /**
   * Creates an animation handle bound to a set of QUIDs.
   *
   * This wires the generic animation engine (`apply_animation`) to a concrete
   * QUID scope by providing adapters (via `makeAnimAdapters()`) that:
   * - write animation-related CSS properties through `setForQuid()`
   * - locate and poke DOM elements via `selectorForQuid()`
   *
   * The returned handle is intentionally small and explicit: callers can begin,
   * restart, or end animations either by spec or by animation-name.
   *
   * @param quids The QUIDs that comprise the animation scope.
   * @returns A `CssAnimHandle` that controls animations for that scope.
   */
  public animForQuids(quids: readonly string[]): CssAnimHandle {

    const core = apply_animation(this.makeAnimAdapters()); // AnimApiCore<CssAnimScope>
    const scope: CssAnimScope = { quids };

    return bind_anim_api(scope, core); // AnimApi<CssAnimScope>
  }

  /**
   * Sets multiple CSS declarations for a single QUID in one call.
   *
   * Notes:
   * - This is a bulk-write convenience API over the per-QUID rule map.
   * - Unlike `setForQuid`, it currently throws on a blank/whitespace QUID
   *   (programmer error), and it syncs via `syncToDom()` directly.
   *
   * Behavior:
   * - Trims and validates `quid`.
   * - Ensures a per-QUID property map exists.
   * - Iterates `decls` and writes each non-blank property name after trimming.
   * - Renders each value using `renderCssValue`.
   * - Forces a stylesheet rebuild via `syncToDom()`.
   *
   * @param quid The QUID whose selector will receive the declarations.
   * @param decls A property map (already canonicalized at the call site).
   * @throws Error if `quid` is blank after trimming.
   */
  public setManyForQuid(quid: string, decls: CssProp): void {
    const trimmedQuid = quid.trim();
    if (!trimmedQuid) {
      throw new Error("CssManager.setManyForQuid: quid must be non-empty");
    }
    for (const [propCanon, value] of Object.entries(decls)) {
      this.setForQuid(trimmedQuid, propCanon, value);
    }
  }

  /**
   * Removes a single CSS declaration for a specific QUID selector.
   *
   * Behavior:
   * - If the QUID has no rule map, this is a no-op.
   * - If removing the property empties the QUID’s rule map, the QUID entry
   *   is removed entirely.
   * - Marks the stylesheet dirty and triggers a DOM sync via `mark_changed()`.
   *
   * @param quid The QUID whose selector will have the property removed.
   * @param propCanon The canonical property key to remove.
   */
  public unsetForQuid(quid: string, propCanon: string): void {
    const props = this.rulesByQuid.get(quid);
    if (!props) return;

    props.delete(propCanon);
    if (props.size === 0) this.rulesByQuid.delete(quid);

    this.mark_changed();
  }

  /**
 * Debug-only nuclear reset.
 * Clears all CssManager-owned state:
 * - QUID rules
 * - global sheets (if present)
 * - @property + keyframes managers
 * - style element contents
 * - scheduling flags
 */
  public debug_hardReset(): void {
    // clear all internal state
    this.rulesByQuid.clear();
    this.changed = false;
    this.scheduled = false;

    if (this.rafId !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.rafId);
    }
    this.rafId = null;

    // recreate managers to drop all registrations
    this.atPropManager = manage_property({ onChange: () => this.mark_changed() });
    this.keyframeManager = manage_keyframes({ onChange: () => this.mark_changed() });

    // clear style element if it exists
    const styleEl = this.ensureStyleElement();
    if (styleEl) {
      styleEl.textContent = "";
    }
    this.globalCss.clear();
  }

  /**
   * Removes all CSS declarations for a specific QUID selector.
   *
   * Behavior:
   * - No-ops if the QUID has no entry.
   * - Marks the stylesheet dirty and triggers a DOM sync via `mark_changed()`
   *   only when something was actually cleared.
   *
   * @param quid The QUID whose entire rule block should be removed.
   */
  public clearQuid(quid: string): void {
    if (!this.rulesByQuid.delete(quid)) return;
    this.mark_changed();
  }

  /**
   * Clears all QUID-scoped CSS declarations managed by this instance.
   *
   * Behavior:
   * - No-ops if no rules are stored.
   * - Clears the entire `rulesByQuid` map.
   * - Marks the stylesheet dirty and triggers a DOM sync via `mark_changed()`.
   *
   * This does not reset `@property` registrations or keyframe definitions.
   * Use `devReset()` (or an explicit manager reset path) when you need a full
   * reset of all CSS-related state.
   */
  public clearAll(): void {
    if (this.rulesByQuid.size === 0) return;
    this.rulesByQuid.clear();
    this.mark_changed();
  }

  /** 
   * Immediately writes the current in-memory CSS to the DOM.
   * This is the "force it now" path used by devFlush and (optionally) tests.
   */
  // TODO make private/dev mode
  public syncNow(): void {
    // CHANGED: cancel any pending scheduled flush to avoid double work
    if (this.rafId !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.rafId);
    }
    this.rafId = null;
    this.scheduled = false;
    // CHANGED: no-op if nothing changed
    if (!this.changed) return;

    // CHANGED: perform the actual write
    this.syncToDom();
  }
  
  public static readonly globals = {
    invoke(): GlobalCssApi {
      const mgr = CssManager.invoke();

      if (!mgr.globalsApi) {
        // IMPORTANT: closure resolves *this instance*, but since CssManager is singleton
        // that’s fine. If you ever allow multiple managers, revisit.
        mgr.globalsApi = GlobalCss.api(() => mgr.notify_global_css_changed());
      }

      return mgr.globalsApi;
    },
  } as const;


  /** @internal */
  public _copyRulesForQuidMap(quidMap: ReadonlyMap<string, string>): void {
    for (const [oldQ, newQ] of quidMap) {
      const rules = this.rulesByQuid.get(oldQ);
      if (!rules) continue;

      // CHANGED: clone the inner map so edits don’t alias
      this.rulesByQuid.set(newQ, new Map(rules));
    }
    this.mark_changed();
  }

}
