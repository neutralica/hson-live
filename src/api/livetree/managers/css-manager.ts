import { css_declaration, css_property } from "../../../core/css-map.js";
import { trim_css_value_boundary } from "../../../core/css-value-boundary.js";
// css-manager.ts

import { normalize_css_key } from "../../transform/utils/attrs-utils/normalize-css.js";
import { CssValue, CssProp } from "../../../core/style.types.js";
import { AnimAdapters, CssAnimScope, CssAnimHandle } from "../../../types/animate.types.js";
import { PropertyManager, PropertyRegistry } from "../../../types/at-property.types.js";
import { KeyframesManager, KeyframesInput, KeyframesRegistry } from "../../../types/keyframes.types.js";
import { CssGlobalHandle } from "../../../types/css.types.js";
import { apply_animation, bind_anim_api } from "../methods/anim.js";
import { canonical_property_registration, manage_property } from "./at-property-builder.js";
import { GlobalCss, GlobalCssRuntimeApi } from "./global-css.js";
import { canonical_keyframes_definition, manage_keyframes } from "./keyframes-manager.js";
import {
  default_livetree_runtime,
  register_runtime_document,
  type LiveTreeRuntime,
} from "../runtime/livetree-runtime.js";
import { mark_runtime_infrastructure } from "../../../internal/browser-realization/browser-realization-dom.js";
import { render_quid_rule, selector_for_quid } from "./css-render.js";
import { opaque_document_stylesheet } from "../../../internal/css/opaque-stylesheet.js";
import { render_property_registration } from "../../../internal/css/property-registration.js";
import { render_keyframes_definition } from "../../../internal/css/keyframes-definition.js";
import { runtime_has_document_css_binding } from "./bound-document-css.js";


const CSS_HOST_TAG = "hson-_style";
const CSS_HOST_ID = "css-manager";
const CSS_STYLE_ID = "_hson";


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
/** @internal */
export function render_css_value(v: CssValue): string {
  // string → already a valid CSS literal
  if (typeof v === "string") {
    return trim_css_value_boundary(v);
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
 * Runtime-owned manager for QUID-scoped stylesheet rules.
 *
 * `CssManager` owns the “stylesheet-backed” side of styling in Hson/LiveTree.
 * Rather than mutating inline `style=""`, it maintains an in-memory rule model:
 *
 *   QUID → (canonicalCssProp → renderedValue)
 *
 * and renders that model into ordered runtime-owned `<style>` carriers per
 * registered projection document.
 * Each QUID maps to one selector (via `selectorForQuid`), producing blocks like:
 *
 *   [hson\:quid="…"] { opacity: 0.5; transform: translate(…); }
 *
 * Integration points:
 * - `css_for_quid()` creates a `CssHandle` by wiring a `StyleSetter` to this manager.
 *   The handle exposes a fluent surface (`setProp`, `setMany`, `remove`, `clear`, `set.*`)
 *   whose adapter methods call into `CssManager` (e.g. `setForQuid`, `unsetForQuid`).
 * - `PropertyManager` and `KeyframesManager` are owned sub-managers. Their `onChange`
 *   callbacks mark the stylesheet “dirty” and trigger a re-render so at-rules and
 *   keyframes stay in sync with the rule model.
 *
 * DOM contract:
 * - On first use in a document, the manager ensures a host container exists:
 *     `<hson-_style id="css-manager"> … </hson-_style>`
 *   and that it contains:
 *     `<style id="_hson"> … </style>`
 * - Existing public APIs use the compatibility-default runtime. Isolated
 *   runtimes register the documents that host their projections.
 * - Document changes add independent style hosts; they never reset another
 *   document's or runtime's rule state.
 *
 * Render policy:
 * - Mutations mark the manager as changed and schedule/perform a sync to DOM.
 * - Global and QUID selector rules share first-write order. Updating a rule
 *   retains its place; deleting and re-adding it gives it a new place.
 * - Browser synchronization writes the exact result of `renderCss()`.
 *
 * Error handling:
 * - Write APIs may throw on programmer errors such as blank QUIDs or invalid
 *   property identifiers, to fail fast during development.
 */
/** Runtime stylesheet implementation. @internal */
export class CssRuntimeManager {
  // QUID → (property → rendered value)
  private readonly rulesByQuid: Map<string, Map<string, string>> = new Map();
  private readonly quidRuleOrder = new Map<string, number>();
  private nextRuleOrder = 0;
  private readonly styleEls = new Map<Document, HTMLStyleElement[]>();
  private readonly opaqueStyles: { order: number; text: string }[] = [];
  private atPropManager: PropertyRegistry;
  private keyframeManager: KeyframesRegistry;
  private atPropertyApi: PropertyManager | undefined;
  private keyframesApi: KeyframesManager | undefined;
  private changed: boolean = false;
  private readonly globalCss = new GlobalCss(() => this.nextRuleOrder++);
  private readonly orderedGlobalDefinitions = new Map<string, number>();
  private hasStylesheetIngress = false;
  private globalsApi: GlobalCssRuntimeApi | undefined;
  private readonly documentListener = (): void => {
    this.changed = true;
    this.scheduleSync();
  };
  private notify_global_css_changed(): void {
    this.markChanged();      //  (batched)
    // this.syncToDom();           // immediate
  }

  // coalescing state
  private scheduled: boolean = false;        // prevents multiple schedules
  private rafId: number | null = null;       // lets us cancel when forcing sync

  private constructor(private readonly runtime: LiveTreeRuntime) {
    this.atPropManager = manage_property({ onChange: () => this.markChanged() });
    this.keyframeManager = manage_keyframes({
      onChange: () => this.markChanged(),
    });
    this.runtime.styleDocumentListeners.add(this.documentListener);
    this.runtime.disposeCss = () => this.disposeRuntimeStyles();
  }

  /**
   * Marks the stylesheet state as updated and triggers a DOM sync.
   *
   * This is the single “invalidates + re-render” hook used by sub-managers
   * (`PropertyManager`, `KeyframesManager`) and by any rule write paths that
   * need to refresh the generated `<style>` text.
   *
   * Implementation note:
   * - DOM-capable rendering contexts coalesce writes through requestAnimationFrame.
   * - Contexts without a DOM render loop flush immediately for deterministic behavior.
   */
  private markChanged(): void {
    // mark dirty, but DO NOT write immediately
    this.changed = true;

    // schedule a single flush
    this.scheduleSync();
  }


  private hasDomRenderLoop(): boolean {
    return (
      typeof globalThis.document !== "undefined" &&
      typeof globalThis.requestAnimationFrame === "function"
    );
  }

  // -------------------------
  // scheduling layer
  // -------------------------
  private scheduleSync(): void {
    if (this.scheduled) return;

    // If there is no DOM render loop, flush immediately.
    // This covers Node-only contexts, tests without RAF, and other non-rendering runtimes.
    if (!this.hasDomRenderLoop()) {
      this.syncNow();
      return;
    }

    this.scheduled = true;
    this.rafId = globalThis.requestAnimationFrame(() => {
      this.scheduled = false;
      this.rafId = null;
      this.syncNow();
    });
  }

  /** Runtime styles share an infrastructure host, never a CSS parser context. */
  private ensureStyleElements(doc: Document, count: number): HTMLStyleElement[] {
    let styles = this.styleEls.get(doc) ?? [];
    const mount = doc.head ?? doc.body ?? doc.documentElement;
    if (!mount) throw new Error("CssManager requires a style mount.");
    let host = styles[0]?.parentElement;
    if (!host?.isConnected) {
      host = doc.createElement(CSS_HOST_TAG);
      host.id = CSS_HOST_ID;
      mount.appendChild(host);
      mark_runtime_infrastructure(host);
      styles = [];
    }
    while (styles.length > count) styles.pop()!.remove();
    while (styles.length < count) {
      const style = doc.createElement("style");
      if (styles.length === 0) style.id = CSS_STYLE_ID;
      host.appendChild(style);
      mark_runtime_infrastructure(style);
      styles.push(style);
    }
    this.styleEls.set(doc, styles);
    return styles;
  }

  private runtimeDocuments(): readonly Document[] {
    return [...this.runtime.styleDocuments];
  }




  // private clearPseudoForQuid(quid: string): void {
  //   if (this.pseudoRulesByQuid.delete(quid)) this.markChanged();
  // }

  // --- INTERNAL: BUILD + SYNC -------------------------------------------
  /** Complete DOM-free stylesheet read, shared with browser synchronization. */
  public renderCss(): string {
    return this.renderCarriers().join("\n\n");
  }

  private renderCarriers(): readonly string[] {
    for (const [quid, props] of this.rulesByQuid) {
      for (const [prop, value] of props) {
        if (typeof value !== "string") {
          throw new Error(`CssManager invariant violated: non-string value at ${quid}.${prop}`);
        }
      }
    }
    const rules = [...this.globalCss.renderEntries()];
    for (const name of this.atPropManager.list()) {
      const order = this.orderedGlobalDefinitions.get(`property:${name}`);
      const definition = this.atPropManager.get(name);
      if (order !== undefined && definition) rules.push({ order, text: render_property_registration(definition) });
    }
    for (const name of this.keyframeManager.list()) {
      const order = this.orderedGlobalDefinitions.get(`keyframes:${name}`);
      const definition = this.keyframeManager.get(name);
      if (order !== undefined && definition) rules.push({ order, text: render_keyframes_definition(definition, definition.name, false) });
    }
    for (const [quid, props] of this.rulesByQuid) {
      if (props.size === 0) continue;
      const order = this.quidRuleOrder.get(quid);
      if (order === undefined) throw new Error(`Missing CSS order for QUID ${quid}.`);
      rules.push({ order, text: render_quid_rule(quid, props) });
    }
    const prelude = [
      ...this.atPropManager.list().filter(name => !this.orderedGlobalDefinitions.has(`property:${name}`))
        .map(name => render_property_registration(this.atPropManager.get(name)!)),
      ...this.keyframeManager.list().filter(name => !this.orderedGlobalDefinitions.has(`keyframes:${name}`))
        .map(name => render_keyframes_definition(this.keyframeManager.get(name)!, name)),
    ];
    const opaque = new Set(this.opaqueStyles);
    const carriers: string[] = prelude.length ? [prelude.join("\n\n")] : [];
    let structured = prelude.length > 0;
    for (const entry of [...rules, ...this.opaqueStyles].sort((a, b) => a.order - b.order)) {
      const raw = opaque.has(entry);
      if (!raw && structured) carriers[carriers.length - 1] += `\n\n${entry.text}`;
      else carriers.push(entry.text);
      structured = !raw;
    }
    return carriers;
  }

  /** Each append owns one opaque contribution, including empty authored text. */
  private appendStylesheet(cssText: string): void {
    opaque_document_stylesheet(cssText); // Exact string admission; no CSS inspection.
    this.opaqueStyles.push({ order: this.nextRuleOrder++, text: cssText });
    this.hasStylesheetIngress = true;
    this.markChanged();
  }

  private syncToDom(): void {
    const carriers = this.renderCarriers();
    for (const document of this.runtimeDocuments()) {
      if (carriers.length === 0 && !this.styleEls.has(document)
        && runtime_has_document_css_binding(this.runtime)) continue;
      const styles = this.ensureStyleElements(document, Math.max(1, carriers.length));
      styles.forEach((style, index) => { style.textContent = carriers[index] ?? ""; });
    }
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
      removeStyleProp: (scope, prop) => {
        for (const quid of scope.quids) this.unsetForQuid(quid, normalize_css_key(prop));
        return scope;
      },
      setStyleProp: (scope, prop, value) => {
        const propCanon = normalize_css_key(prop);

        for (const quid of scope.quids) {
          this.setForQuid(quid, propCanon, value);
        }

        return scope;
      },

      forEachDomElement: (scope, fn) => {
        // guard document
        for (const document of this.runtimeDocuments()) {
          for (const quid of scope.quids) {
            const el = document.querySelector(selector_for_quid(quid));
            if (el) fn(el);
          }
        }
      },

      getFirstDomElement: (scope) => {
        // guard document
        for (const document of this.runtimeDocuments()) {
          for (const quid of scope.quids) {
            const el = document.querySelector(selector_for_quid(quid));
            if (el) return el;
          }
        }
        return undefined;
      },


    };
  }


  /**
   * Return the compatibility-default runtime's `CssManager` instance.
   *
   * Note: this does **not** force creation of a `<style>` element. It only
   * registers the current `document` on first rendering use if one exists.
   */
  public static invoke(): CssRuntimeManager {
    return CssRuntimeManager.forRuntime(
      default_livetree_runtime(),
      { claimAmbientDocument: true },
    );
  }

  /** Resolve the stylesheet owner for one LiveTree runtime. @internal */
  public static forRuntime(
    runtime: LiveTreeRuntime,
    opts?: { claimAmbientDocument?: boolean },
  ): CssRuntimeManager {
    if (opts?.claimAmbientDocument) {
      const ambient = (globalThis as { document?: Document }).document;
      if (
        ambient !== undefined
        && (
          runtime === default_livetree_runtime()
          || runtime.styleDocuments.size === 0
        )
      ) {
        register_runtime_document(runtime, ambient);
      }
    }
    if (runtime.cssManager instanceof CssRuntimeManager) return runtime.cssManager;
    const manager = new CssRuntimeManager(runtime);
    runtime.cssManager = manager;
    return manager;
  }

  /** Canonical selector for one QUID inside this runtime's owned Document. @internal */
  public selectorForQuid(quid: string): string {
    return selector_for_quid(quid);
  }

  /**
   * Read the last-written value for a QUID + canonical property pair.
   *
   * This reflects the in-memory rule model, not computed style.
   */
  public getForQuid(quid: string, propCanon: string): string | undefined {
    return this.rulesByQuid.get(quid)?.get(propCanon);
  }

  /**
 * Read all last-written declarations for one QUID.
 *
 * This returns a defensive plain-object copy in canonical setMany-compatible
 * key spelling. Mutating the returned object cannot mutate CssManager state.
 *
 * @param quid QUID whose scoped declaration map should be read.
 * @returns A declaration object, or `undefined` when the QUID has no rule map.
 */
  public getAllForQuid(quid: string): Record<string, string> | undefined {
    const q = quid.trim();
    if (!q) return undefined;

    const found = this.rulesByQuid.get(q);
    if (!found) return undefined;

    return Object.fromEntries(found);
  }
  /**
   * Check whether a QUID currently has any rule entries.
   */
  public hasAnyRules(quid: string): boolean {
    return (this.rulesByQuid.get(quid)?.size ?? 0) > 0;
  }

  /**
   * Exposes the `@property` registration manager used by this `CssManager`.
   *
   * @returns The live `PropertyManager` instance owned by this runtime.
   */
  public get atProperty(): PropertyManager {
    if (!this.atPropertyApi) {
      this.atPropertyApi = {
        register: (input: Parameters<PropertyManager["register"]>[0]) => {
          const definition = canonical_property_registration(input);
          const existed = this.atPropManager.has(definition.name);
          if (this.hasStylesheetIngress && !existed) this.orderedGlobalDefinitions.set(`property:${definition.name}`, this.nextRuleOrder++);
          try { this.atPropManager.register(definition); }
          catch (error) {
            if (!existed) this.orderedGlobalDefinitions.delete(`property:${definition.name}`);
            throw error;
          }
        },
        registerMany: (inputs: Parameters<PropertyManager["registerMany"]>[0]) => {
          if (!this.hasStylesheetIngress) { this.atPropManager.registerMany(inputs); return; }
          const definitions = inputs.map(canonical_property_registration);
          for (const definition of definitions) {
            if (this.atPropManager.has(definition.name) || this.orderedGlobalDefinitions.has(`property:${definition.name}`)) continue;
            this.orderedGlobalDefinitions.set(`property:${definition.name}`, this.nextRuleOrder++);
          }
          this.atPropManager.registerMany(definitions);
        },
        unregister: (name: Parameters<PropertyManager["unregister"]>[0]) => {
          this.atPropManager.unregister(name);
          this.orderedGlobalDefinitions.delete(`property:${name}`);
        },
        has: (name: Parameters<PropertyManager["has"]>[0]) => this.atPropManager.has(name),
        get: (name: Parameters<PropertyManager["get"]>[0]) => this.atPropManager.get(name),
      };
    }
    return this.atPropertyApi;
  }

  /**
   * Exposes the keyframes/animation definition manager used by this `CssManager`.
   *
   * @returns The live `KeyframesManager` instance owned by this runtime.
   */
  public get keyframes(): KeyframesManager {
    if (!this.keyframesApi) {
      this.keyframesApi = {
        set: (input: Parameters<KeyframesManager["set"]>[0]) => {
          const definition = canonical_keyframes_definition(input);
          const existed = this.keyframeManager.has(definition.name);
          if (this.hasStylesheetIngress && !existed) this.orderedGlobalDefinitions.set(`keyframes:${definition.name}`, this.nextRuleOrder++);
          try { this.keyframeManager.set(input); }
          catch (error) {
            if (!existed) this.orderedGlobalDefinitions.delete(`keyframes:${definition.name}`);
            throw error;
          }
        },
        setMany: (inputs: Parameters<KeyframesManager["setMany"]>[0]) => {
          if (!this.hasStylesheetIngress) { this.keyframeManager.setMany(inputs); return; }
          const definitions = inputs.map(canonical_keyframes_definition);
          for (const definition of definitions) {
            if (this.keyframeManager.has(definition.name) || this.orderedGlobalDefinitions.has(`keyframes:${definition.name}`)) continue;
            this.orderedGlobalDefinitions.set(`keyframes:${definition.name}`, this.nextRuleOrder++);
          }
          this.keyframeManager.setMany(inputs);
        },
        delete: (name: Parameters<KeyframesManager["delete"]>[0]) => {
          this.keyframeManager.delete(name);
          this.orderedGlobalDefinitions.delete(`keyframes:${name}`);
        },
        has: (name: Parameters<KeyframesManager["has"]>[0]) => this.keyframeManager.has(name),
        get: (name: Parameters<KeyframesManager["get"]>[0]) => this.keyframeManager.get(name),
      };
    }
    return this.keyframesApi;

  }

  /**
   * Register keyframes owned by a QUID-scoped node/branch.
   *
   * The keyframes are emitted globally as CSS `@keyframes`, but their lifecycle
   * is tied to the owner QUID. Use `tree.css.global.keyframes.set()` for
   * durable/global keyframes that should not be auto-released.
   */
  public setOwnedKeyframesForQuid(quid: string, input: KeyframesInput): void {
    const q = quid.trim();
    if (!q) return;
    this.keyframeManager.setOwned(q, input);
  }

  /**
   * Release stylesheet artifacts owned by one QUID.
   *
   * This is intended for branch/node teardown paths. It clears QUID-scoped
   * declarations and generated keyframes owned by the
   * QUID. Durable/global CSS created through `tree.css.global` is unaffected.
   */
  public releaseOwnedCssForQuid(quid: string): void {
    const q = quid.trim();
    if (!q) return;

    this.clearQuid(q);
    this.keyframeManager.releaseOwner(q);
    this.globals_invoke().dropBySelectorFragment(this.selectorForQuid(q));
  }

  /** Drop selector-backed rules owned by one internal LiveTree CSS handle. */
  public dropGlobalRulesByPrefix(prefix: string): void {
    this.globals_invoke().dropByPrefix(prefix);
  }

  // --- WRITE API (QUID-based) -------------------------------------------
  /** Prepare before touching declarations, rule order, or publication state. */
  private prepareDeclaration(property: string, value: CssValue | boolean): string | undefined {
    if (!property) return undefined;
    css_property(property);
    return value === undefined ? undefined : css_declaration(value);
  }

  /**
   * Sets (or unsets) a single CSS declaration for a specific QUID selector.
   *
   * Rules:
   * - `quid` and `propCanon` are trimmed; blank inputs are treated as no-ops.
   * - Values are normalized to a string:
   *   - primitives are stringified
   *   - `CssValue` objects are rendered by `renderCssValue`
   * - Explicit undefined removes the property; defined strings, including empty, are stored.
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

    // Only explicit undefined deletes; defined empty strings retain the rule.
    const v = this.prepareDeclaration(p, value);
    if (v === undefined) {
      this.unsetForQuid(q, p);
      return;
    }

    let props = this.rulesByQuid.get(q);
    if (!props) {
      props = new Map<string, string>();
      this.rulesByQuid.set(q, props);
      this.quidRuleOrder.set(q, this.nextRuleOrder++);
    }

    if (props.get(p) === v) return;
    props.set(p, v);
    this.markChanged();
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
    const entries: [string, string | undefined][] = Object.entries(decls).map(([property, value]) =>
      [property, this.prepareDeclaration(property.trim(), value)]);
    for (const [propCanon, value] of entries) {
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
    if (props.size === 0) {
      this.rulesByQuid.delete(quid);
      this.quidRuleOrder.delete(quid);
    }

    this.markChanged();
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
    this.quidRuleOrder.clear();
    this.orderedGlobalDefinitions.clear();
    this.opaqueStyles.length = 0;
    this.hasStylesheetIngress = false;
    this.changed = false;
    this.scheduled = false;

    if (this.rafId !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.rafId);
    }
    this.rafId = null;

    // recreate managers to drop all registrations
    this.atPropManager = manage_property({ onChange: () => this.markChanged() });
    this.keyframeManager = manage_keyframes({
      onChange: () => this.markChanged(),
    });

    // clear style element if it exists
    for (const styles of this.styleEls.values()) {
      const host = styles[0]?.parentElement;
      for (const style of styles) style.remove();
      if (host?.childNodes.length === 0) host.remove();
    }
    this.styleEls.clear();
    this.globals_invoke().clearAll();
  }

  private disposeRuntimeStyles(): void {
    if (this.rafId !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.rafId);
    }
    this.rafId = null;
    this.scheduled = false;
    this.changed = false;
    this.runtime.styleDocumentListeners.delete(this.documentListener);
    for (const styles of this.styleEls.values()) for (const styleEl of styles) {
      const host = styleEl.parentElement;
      styleEl.remove();
      if (host?.childNodes.length === 0) host.remove();
    }
    this.styleEls.clear();
    this.rulesByQuid.clear();
    this.quidRuleOrder.clear();
    this.orderedGlobalDefinitions.clear();
    this.opaqueStyles.length = 0;
    this.hasStylesheetIngress = false;
    this.globals_invoke().clearAll();
    this.globalsApi?.dispose();
    this.globalsApi = undefined;
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
    this.quidRuleOrder.delete(quid);
    this.markChanged();
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
    this.quidRuleOrder.clear();
    this.markChanged();
  }

  /** 
   * Immediately writes the current in-memory CSS to the DOM.
   * This is the "force it now" path used by devFlush and (optionally) tests.
   */
  // TODO make private/dev mode
  public syncNow(): void {
    // cancel any pending scheduled flush to avoid double work
    if (this.rafId !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.rafId);
    }
    this.rafId = null;
    this.scheduled = false;
    // no-op if nothing changed
    if (!this.changed) return;

    // perform the actual write
    this.syncToDom();
  }

  private globals_invoke(): GlobalCssRuntimeApi {
    if (!this.globalsApi) {
      this.globalsApi = this.globalCss.api(() => this.notify_global_css_changed());
    }
    return this.globalsApi;
  }

  /** Runtime-local CSS facade for LiveTree handles. @internal */
  public static apiForRuntime(runtime: LiveTreeRuntime): CssGlobalHandle {
    const mgr = CssRuntimeManager.forRuntime(runtime, {
      claimAmbientDocument: runtime === default_livetree_runtime(),
    });
    const globalApi = mgr.globals_invoke();

    return {
      stylesheet: (cssText: string) => mgr.appendStylesheet(cssText),
      rule: globalApi.rule,
      sel: globalApi.sel,
      var: globalApi.var,
      drop: globalApi.drop,
      clearAll: () => { mgr.opaqueStyles.length = 0; globalApi.clearAll(); mgr.markChanged(); },
      scope: globalApi.scope,
      media: globalApi.media,
      supports: globalApi.supports,
      layer: globalApi.layer,
      has: globalApi.has,
      list: globalApi.list,
      get: globalApi.get,
      atProperty: mgr.atProperty,
      keyframes: mgr.keyframes,
    };
  }

}
