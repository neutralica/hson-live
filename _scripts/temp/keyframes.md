import { canon_to_css_prop } from "../../../utils/attrs-utils/normalize-css";
export type KeyframesName = string;
export type KeyframeSelector = "from" | "to" | `${number}%`;
export type CssDeclMap = Readonly<Record<string, string>>;
export type KeyframeStep = Readonly<{
    at: KeyframeSelector;
    decls: CssDeclMap;
}>;
export type KeyframesDef = Readonly<{
    name: KeyframesName;
    steps: readonly KeyframeStep[];
}>;
export type KeyframesInputObject = Readonly<{
    name: KeyframesName;
    steps: Readonly<Partial<Record<KeyframeSelector, CssDeclMap>>>;
}>;
export type KeyframesInputTuple = Readonly<{
    name: KeyframesName;
    steps: readonly (readonly [
        KeyframeSelector,
        CssDeclMap
    ])[];
}>;
export type KeyframesInput = KeyframesInputObject | KeyframesInputTuple;
export interface KeyframesManager {
    set(input: KeyframesInput): void;
    setMany(inputs: readonly KeyframesInput[]): void;
    delete(name: KeyframesName): void;
    has(name: KeyframesName): boolean;
    get(name: KeyframesName): KeyframesDef | undefined;
    renderOne(name: KeyframesName): string;
    renderAll(): string;
}
function isKeyframesTupleInput(x: KeyframesInput): x is KeyframesInputTuple {
    const first = (x as KeyframesInputTuple).steps[0] as unknown;
    return Array.isArray(first);
}
function assertValidSelector(at: KeyframeSelector): void {
    if (at === "from" || at === "to")
        return;
    const n = Number(at.slice(0, -1));
    if (!Number.isFinite(n)) {
        throw new Error(`@keyframes: invalid selector "${at}" (not a number%).`);
    }
    if (n < 0 || n > 100) {
        throw new Error(`@keyframes: invalid selector "${at}" (must be 0%..100%).`);
    }
}
function normalizeDecls(decls: CssDeclMap): CssDeclMap {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(decls)) {
        if (!k || k.trim() === "")
            continue;
        const vv = String(v).trim();
        if (vv === "")
            continue;
        out[k.trim()] = vv;
    }
    return out;
}
function sortSteps(steps: readonly KeyframeStep[]): KeyframeStep[] {
    const copy = [...steps];
    copy.sort((a, b) => {
        if (a.at === "from" && b.at !== "from")
            return -1;
        if (b.at === "from" && a.at !== "from")
            return 1;
        if (a.at === "to" && b.at !== "to")
            return 1;
        if (b.at === "to" && a.at !== "to")
            return -1;
        const na = Number(a.at.slice(0, -1));
        const nb = Number(b.at.slice(0, -1));
        return na - nb;
    });
    return copy;
}
function normalizeKeyframesInput(input: KeyframesInput): KeyframesDef {
    const name: KeyframesName = input.name.trim();
    if (name === "") {
        throw new Error(`@keyframes: name cannot be empty.`);
    }
    const steps: KeyframeStep[] = [];
    if (isKeyframesTupleInput(input)) {
        for (const [at, decls] of input.steps) {
            assertValidSelector(at);
            steps.push({ at, decls: normalizeDecls(decls) });
        }
    }
    else {
        for (const [atRaw, decls] of Object.entries(input.steps)) {
            if (!decls)
                continue;
            const at = atRaw as KeyframeSelector;
            assertValidSelector(at);
            steps.push({ at, decls: normalizeDecls(decls) });
        }
    }
    if (steps.length === 0) {
        throw new Error(`@keyframes ${name}: must have at least one step.`);
    }
    const byAt: Map<KeyframeSelector, KeyframeStep> = new Map();
    for (const s of steps)
        byAt.set(s.at, s);
    const sorted = sortSteps(Array.from(byAt.values()));
    return { name, steps: sorted };
}
function renderDecls(decls: CssDeclMap): string[] {
    const keys = Object.keys(decls).sort();
    return keys.map((k) => {
        const prop = canon_to_css_prop(k);
        const val = decls[k] ?? "";
        return `    ${prop}: ${val};`;
    });
}
function renderKeyframes(def: KeyframesDef): string {
    const lines: string[] = [];
    lines.push(`@keyframes ${def.name} {`);
    for (const step of def.steps) {
        lines.push(`  ${step.at} {`);
        lines.push(...renderDecls(step.decls));
        lines.push(`  }`);
    }
    lines.push(`}`);
    return lines.join("\n");
}
export function manage_keyframes(args: {
    onChange: () => void;
}): KeyframesManager {
    const byName: Map<KeyframesName, KeyframesDef> = new Map();
    return {
        set(input: KeyframesInput): void {
            const next = normalizeKeyframesInput(input);
            const prev = byName.get(next.name);
            const isSame = prev !== undefined && JSON.stringify(prev) === JSON.stringify(next);
            if (isSame)
                return;
            byName.set(next.name, next);
            args.onChange();
        },
        setMany(inputs: readonly KeyframesInput[]): void {
            for (const input of inputs) {
                const next = normalizeKeyframesInput(input);
                byName.set(next.name, next);
            }
            args.onChange();
        },
        delete(name: KeyframesName): void {
            const did = byName.delete(name.trim());
            if (did)
                args.onChange();
        },
        has(name: KeyframesName): boolean {
            return byName.has(name.trim());
        },
        get(name: KeyframesName): KeyframesDef | undefined {
            return byName.get(name.trim());
        },
        renderOne(name: KeyframesName): string {
            const def = byName.get(name.trim());
            return def ? renderKeyframes(def) : "";
        },
        renderAll(): string {
            const names = Array.from(byName.keys()).sort();
            const blocks: string[] = [];
            for (const n of names) {
                const def = byName.get(n);
                if (def)
                    blocks.push(renderKeyframes(def));
            }
            return blocks.join("\n\n");
        },
    };
}
