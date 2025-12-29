import { LiveTree } from "hson-live/types";
import { PropertyManager } from "../../../types-consts/at-property.types";
import { _DATA_QUID } from "../../../types-consts/constants";
import { CssValue, CssProp, CssHandle, CssHandleVoid, CssHandleBase } from "../../../types-consts/css.types";
import { apply_animation, bind_anim_api } from "./animate";
import { AnimAdapters, CssAnimHandle, CssAnimScope } from "./animate.types";
import { manage_property } from "./at-property";
import { KeyframesManager, manage_keyframes } from "./keyframes";
import { make_style_setter } from "./style-setter";
import { clear_globals, get_global, list_globals, remove_global, render_globals, set_global } from "./css-globals";
const CSS_HOST_TAG = "hson-_style";
const CSS_HOST_ID = "css-manager";
const CSS_STYLE_ID = "_hson";
function isLiveTree(x: unknown): x is LiveTree {
    return x instanceof LiveTree;
}
export function css_for_quids(quids: readonly string[]): CssHandleVoid;
export function css_for_quids(host: LiveTree, quids: readonly string[]): CssHandle;
export function css_for_quids(a: LiveTree | readonly string[], b?: readonly string[]): CssHandleBase<any> {
    const mgr = CssManager.invoke();
    if (isLiveTree(a)) {
        const host: LiveTree = a;
        const quids: readonly string[] = b ?? [];
        const ids = quids.map(q => q.trim()).filter(Boolean);
        const setter = make_style_setter<LiveTree>(host, {
            apply: (propCanon, value) => { for (const quid of ids)
                mgr.setForQuid(quid, propCanon, value); },
            remove: (propCanon) => { for (const quid of ids)
                mgr.unsetForQuid(quid, propCanon); },
            clear: () => { for (const quid of ids)
                mgr.clearQuid(quid); },
        });
        return {
            ...setter,
            atProperty: mgr.atProperty,
            keyframes: mgr.keyframes,
            anim: mgr.animForQuids(ids),
            debug_viewCss: () => mgr.renderCss?.(),
            debug_sync: () => mgr.syncNow?.(),
            debug_hardReset: () => mgr.debug_hardReset?.()
        };
    }
    const ids = a.map(q => q.trim()).filter(Boolean);
    const setter = make_style_setter<void>(undefined, {
        apply: (propCanon, value) => { for (const quid of ids)
            mgr.setForQuid(quid, propCanon, value); },
        remove: (propCanon) => { for (const quid of ids)
            mgr.unsetForQuid(quid, propCanon); },
        clear: () => { for (const quid of ids)
            mgr.clearQuid(quid); },
    });
    return {
        ...setter,
        atProperty: mgr.atProperty,
        keyframes: mgr.keyframes,
        anim: mgr.animForQuids(ids),
        debug_viewCss: () => mgr.renderCss(),
        debug_sync: () => mgr.syncNow(),
        debug_hardReset: () => mgr.debug_hardReset(),
    };
}
export function css_for_quid(host: LiveTree, quid: string): CssHandle {
    return css_for_quids(host, [quid]);
}
function renderCssValue(v: CssValue): string {
    if (typeof v === "string") {
        return v.trim();
    }
    if (typeof v === 'number' ||
        typeof v === 'boolean' ||
        !v) {
        return '';
    }
    const unit = v.unit === "_" ? "" : v.unit;
    return `${v.value}${unit}`;
}
function selectorForQuid(quid: string): string {
    return `[${_DATA_QUID}="${quid}"]`;
}
function canon_to_css_prop(propCanon: string): string {
    if (propCanon.startsWith("--"))
        return propCanon;
    if (propCanon.includes("-"))
        return propCanon;
    return propCanon.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`);
}
export class CssManager {
    private static instance: CssManager | null = null;
    private readonly rulesByQuid: Map<string, Map<string, string>> = new Map();
    private styleEl: HTMLStyleElement | null = null;
    private atPropManager: PropertyManager;
    private keyframeManager: KeyframesManager;
    private changed: boolean = false;
    private readonly globalCss: Map<string, string> = new Map();
    private scheduled: boolean = false;
    private rafId: number | null = null;
    private boundDoc: Document | null = null;
    private constructor() {
        this.atPropManager = manage_property({ onChange: () => this.mark_changed() });
        this.keyframeManager = manage_keyframes({ onChange: () => this.mark_changed() });
    }
    private mark_changed(): void {
        this.changed = true;
        this.scheduleSync();
    }
    private scheduleSync(): void {
        if (this.scheduled)
            return;
        if (this.isNodeRuntime()) {
            this.syncNow();
            return;
        }
        const raf = (globalThis as any).requestAnimationFrame as ((cb: FrameRequestCallback) => number) | undefined;
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
    public static invoke(): CssManager {
        if (!CssManager.instance)
            CssManager.instance = new CssManager();
        CssManager.instance.ensureStyleElement();
        return CssManager.instance;
    }
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
    private ensureStyleElement(): HTMLStyleElement | undefined {
        const doc = (globalThis as any).document as Document | undefined;
        if (!doc)
            return undefined;
        if (this.boundDoc !== doc) {
            this.boundDoc = doc;
            this.styleEl = null;
            this.resetManagersAndRules();
        }
        if (this.styleEl) {
            if (!this.styleEl.isConnected || this.styleEl.ownerDocument !== doc) {
                this.styleEl = null;
            }
            else {
                if (!this.changed && this.styleEl.textContent === "" && this.rulesByQuid.size > 0) {
                    this.rulesByQuid.clear();
                }
                return this.styleEl;
            }
        }
        const mount = (doc.head && doc.head.isConnected ? doc.head : null) ??
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
        if (!this.changed && styleEl.textContent === "" && this.rulesByQuid.size > 0) {
            this.rulesByQuid.clear();
        }
        this.styleEl = styleEl;
        return styleEl;
    }
    public devSnapshot(): string {
        const cssText = this.buildCombinedCss();
        const styleEl = this.ensureStyleElement();
        if (styleEl) {
            styleEl.textContent = cssText;
            this.changed = false;
        }
        return cssText;
    }
    public renderCss(): string {
        return this.buildCombinedCss();
    }
    private makeAnimAdapters(): AnimAdapters<CssAnimScope> {
        return {
            setStyleProp: (scope, prop, value) => {
                for (const quid of scope.quids) {
                    this.setForQuid(quid, prop, value);
                }
                return scope;
            },
            forEachDomElement: (scope, fn) => {
                for (const quid of scope.quids) {
                    const el = document.querySelector(selectorForQuid(quid));
                    if (el)
                        fn(el);
                }
            },
            getFirstDomElement: (scope) => {
                for (const quid of scope.quids) {
                    const el = document.querySelector(selectorForQuid(quid));
                    if (el)
                        return el;
                }
                return undefined;
            },
        };
    }
    public get atProperty(): PropertyManager {
        this.ensureStyleElement();
        return this.atPropManager;
    }
    public get keyframes(): KeyframesManager {
        this.ensureStyleElement();
        return this.keyframeManager;
    }
    public setForQuid(quid: string, propCanon: string, value: CssValue | string | number | boolean): void {
        this.ensureStyleElement();
        const q = quid.trim();
        if (!q)
            return;
        const p = propCanon.trim();
        if (!p)
            return;
        const rendered = typeof value === "string" || typeof value === "number" || typeof value === "boolean"
            ? String(value)
            : renderCssValue(value);
        if (rendered === null) {
            this.unsetForQuid(q, p);
            return;
        }
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
    public animForQuids(quids: readonly string[]): CssAnimHandle {
        this.ensureStyleElement();
        const core = apply_animation(this.makeAnimAdapters());
        const scope: CssAnimScope = { quids };
        return bind_anim_api(scope, core);
    }
    public setManyForQuid(quid: string, decls: CssProp): void {
        this.ensureStyleElement();
        const trimmedQuid = quid.trim();
        if (!trimmedQuid) {
            throw new Error("CssManager.setManyForQuid: quid must be non-empty");
        }
        for (const [propCanon, value] of Object.entries(decls)) {
            this.setForQuid(trimmedQuid, propCanon, value as any);
        }
    }
    public unsetForQuid(quid: string, propCanon: string): void {
        this.ensureStyleElement();
        const props = this.rulesByQuid.get(quid);
        if (!props)
            return;
        props.delete(propCanon);
        if (props.size === 0)
            this.rulesByQuid.delete(quid);
        this.mark_changed();
    }
    public debug_hardReset(): void {
        this.rulesByQuid.clear();
        this.changed = false;
        this.scheduled = false;
        if (this.rafId !== null && typeof cancelAnimationFrame === "function") {
            cancelAnimationFrame(this.rafId);
        }
        this.rafId = null;
        this.atPropManager = manage_property({ onChange: () => this.mark_changed() });
        this.keyframeManager = manage_keyframes({ onChange: () => this.mark_changed() });
        const styleEl = this.ensureStyleElement();
        if (styleEl) {
            styleEl.textContent = "";
        }
        this.globalCss.clear();
    }
    public clearQuid(quid: string): void {
        this.ensureStyleElement();
        if (!this.rulesByQuid.delete(quid))
            return;
        this.mark_changed();
    }
    public clearAll(): void {
        this.ensureStyleElement();
        if (this.rulesByQuid.size === 0)
            return;
        this.rulesByQuid.clear();
        this.mark_changed();
    }
    private buildCombinedCss(): string {
        for (const [quid, rules] of this.rulesByQuid) {
            for (const [prop, val] of rules) {
                if (typeof val !== "string") {
                    throw new Error(`CssManager invariant violated: non-string value at ${quid}.${prop}`);
                }
            }
        }
        const atPropCss = this.atPropManager.renderAll().trim();
        const keyframesCss = this.keyframeManager.renderAll().trim();
        const blocks: string[] = [];
        for (const [quid, props] of this.rulesByQuid.entries()) {
            if (props.size === 0)
                continue;
            const decls: string[] = [];
            for (const [propCanon, value] of props.entries()) {
                const prop = canon_to_css_prop(propCanon);
                decls.push(`${prop}: ${value};`);
            }
            blocks.push(`${selectorForQuid(quid)} { ${decls.join(" ")} }`);
        }
        const quidCss = blocks.join("\n\n").trim();
        const parts: string[] = [];
        const globalCss = render_globals(this.globalCss);
        if (globalCss)
            parts.push(globalCss);
        if (atPropCss)
            parts.push(atPropCss);
        if (keyframesCss)
            parts.push(keyframesCss);
        if (quidCss)
            parts.push(quidCss);
        return parts.join("\n\n");
    }
    private isNodeRuntime(): boolean {
        return typeof (globalThis as any).process !== "undefined"
            && !!(globalThis as any).process?.versions?.node;
    }
    public syncNow(): void {
        if (this.rafId !== null && typeof cancelAnimationFrame === "function") {
            cancelAnimationFrame(this.rafId);
        }
        this.rafId = null;
        this.scheduled = false;
        if (!this.changed)
            return;
        this.syncToDom();
    }
    public setGlobal(source: string, cssText: string): void {
        set_global(this.globalCss, source, cssText);
        this.mark_changed();
    }
    public removeGlobal(source: string): void {
        remove_global(this.globalCss, source);
        this.mark_changed();
    }
    public clearGlobals(): void {
        if (this.globalCss.size === 0)
            return;
        clear_globals(this.globalCss);
        this.mark_changed();
    }
    public listGlobals(): readonly string[] {
        return list_globals(this.globalCss);
    }
    public getGlobal(source: string): string | undefined {
        return get_global(this.globalCss, source);
    }
    private syncToDom(): void {
        const styleEl = this.ensureStyleElement();
        if (!styleEl)
            return;
        styleEl.textContent = this.buildCombinedCss();
        this.changed = false;
    }
}
