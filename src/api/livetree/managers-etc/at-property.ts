// at-property.ts

import { CssCustomPropName, PropertyInput, PropertyInputTuple, PropertyManager, PropertyRegistration, PropertySyntax } from "../../../types-consts/at-property.types";

/**
 * Type guard for `PropertyInput` tuple form.
 *
 * `@property` registrations can be provided either as:
 * - a tuple (runtime array), or
 * - an object (runtime plain object).
 *
 * This guard discriminates the tuple form using `Array.isArray`, which is
 * reliable at runtime for distinguishing arrays from objects.
 *
 * @param x
 *   A `PropertyInput` value in either tuple or object form.
 *
 * @returns
 *   `true` if `x` is the tuple form (`PropertyInputTuple`), otherwise `false`.
 */
function isPropTuple(x: PropertyInput): x is PropertyInputTuple {
    // tuples are arrays at runtime; objects are not.
    return Array.isArray(x);
}

/**
 * Normalize a `PropertyInput` into a canonical `PropertyRegistration`.
 *
 * Accepts either tuple-style or object-style inputs and produces a single,
 * normalized registration shape:
 * - trims `init` when present
 * - defaults `inh` to `false`
 * - enforces that `init` is provided when `syn !== "*"`
 *
 * This function is intended to be the single “front door” for input coercion
 * so the rest of the manager can assume stable, comparable values.
 *
 * @param input
 *   A `PropertyInput` in tuple form or object form.
 *
 * @returns
 *   A normalized `PropertyRegistration`.
 *
 * @throws
 *   If `syn !== "*"` and `init` is missing or empty after trimming.
 */
function coerce_atprop_input(input: PropertyInput): PropertyRegistration {
    // tuple:
    if (isPropTuple(input)) {
        const [name, syn, initOrUndefined, inhOrUndefined] = input;
        const init: string | undefined = initOrUndefined?.trim();
        const inh: boolean = inhOrUndefined ?? false;

        //  enforce init unless "*"
        if (syn !== "*" && (!init || init === "")) {
            throw new Error(`@property ${name}: init is required when syntax is not "*".`);
        }

        return { name, syn, inh, init };
    }

    // object:
    const name = input.name;
    const syn = input.syn;
    const inh = input.inh ?? false;
    const init = input.init?.trim();

    if (syn !== "*" && (!init || init === "")) {
        throw new Error(`@property ${name}: init is required when syntax is not "*".`);
    }

    return { name, syn, inh, init };
}

/**
 * Create a `PropertyManager` for CSS `@property` registrations.
 *
 * This manager stores normalized registrations keyed by custom property name
 * and can render either a single `@property` block or the full set.
 *
 * Design notes:
 * - Inputs are normalized through `coerce_atprop_input()` so internal state is
 *   canonical (stable comparisons, stable rendering).
 * - `onChange()` is invoked whenever registrations *meaningfully* change, so a
 *   caller (typically a higher-level CSS manager) can re-render/rebuild a style
 *   sheet snapshot.
 * - Rendering is deterministic: `renderAll()` sorts names to keep output stable
 *   across runs and avoid noisy diffs.
 *
 * @param args
 *   Construction options.
 *
 * @param args.onChange
 *   Callback invoked when the manager’s rendered output should be considered
 *   dirty (e.g., after register/unregister/batch updates).
 *
 * @returns
 *   A `PropertyManager` with register/unregister/query and render capabilities.
 */
export function manage_property(args: {
    // Called whenever registrations change.
    onChange: () => void;
}): PropertyManager {
    //  internal storage is canonical normalized registrations by name.
    const regByName: Map<CssCustomPropName, PropertyRegistration> = new Map();



/**
 * Render a single `@property` registration into canonical CSS text.
 *
 * Output is intentionally deterministic and diff-friendly:
 * - always emits `syntax` and `inherits`
 * - emits `initial-value` only when provided (optional only for `syn="*"`)
 * - uses stable indentation and newline joining
 *
 * @param r
 *   The normalized property registration to render.
 *
 * @returns
 *   A complete `@property … { … }` block as CSS text.
 */
    function renderReg(r: PropertyRegistration): string {
        //  build lines explicitly; init is optional only for "*".
        const lines: string[] = [];

        //  start at-rule block.
        lines.push(`@property ${r.name} {`);

        //  syntax is always required.
        lines.push(`  syntax: "${r.syn}";`);

        //  inherits is always emitted explicitly.
        lines.push(`  inherits: ${r.inh ? "true" : "false"};`);

        //  initial-value is emitted only if present.
        if (r.init !== undefined) {
            lines.push(`  initial-value: ${r.init};`);
        }

        //  end block.
        lines.push(`}`);

        //  join with newlines.
        return lines.join("\n");
    }

    //  public API implementation.
    return {
        register(input: PropertyInput): void {
            const next = coerce_atprop_input(input);
            const prev = regByName.get(next.name);

            //  cheap equality check; normalize ensures stable strings.
            const isSame =
                prev !== undefined &&
                prev.syn === next.syn &&
                prev.inh === next.inh &&
                prev.init === next.init;

            if (isSame) return; //  avoid pointless re-render.

            regByName.set(next.name, next);
            args.onChange();
        },

        registerMany(inputs: readonly PropertyInput[]): void {
            //  batch normalize + set.
            for (const input of inputs) {
                const reg: PropertyRegistration = coerce_atprop_input(input);
                regByName.set(reg.name, reg);
            }
            args.onChange();
        },

        unregister(name: CssCustomPropName): void {
            //  delete and mark changed if something was removed.
            const didDelete: boolean = regByName.delete(name);
            if (didDelete) args.onChange();
        },

        has(name: CssCustomPropName): boolean {
            //  trivial query.
            return regByName.has(name);
        },

        get(name: CssCustomPropName): PropertyRegistration | undefined {
            //  return canonical registration (already readonly).
            return regByName.get(name);
        },

        renderOne(name: CssCustomPropName): string {
            //  render one or empty string if missing.
            const reg: PropertyRegistration | undefined = regByName.get(name);
            return reg ? renderReg(reg) : "";
        },

        renderAll(): string {
            //  sort keys for deterministic output (diff/test friendly).
            const names: CssCustomPropName[] = Array.from(regByName.keys()).sort();

            //  render in sorted order.
            const blocks: string[] = [];
            for (const name of names) {
                const reg = regByName.get(name);
                if (reg) blocks.push(renderReg(reg));
            }

            return blocks.join("\n\n");
        }
    };
}