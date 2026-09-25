// at-property-builder.ts

import { CssCustomPropName, PropertyInput, PropertyInputTuple, PropertyRegistration, PropertyRegistry, PropertySyntax } from "../../../types/at-property.types.js";

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
export function canonical_property_registration(input: PropertyInput): PropertyRegistration {
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

/** Pure deterministic rendering shared by runtime and portable document stylesheets. */
export function render_property_registration(r: PropertyRegistration): string {
    const lines = [`@property ${r.name} {`, `  syntax: "${r.syn}";`, `  inherits: ${r.inh ? "true" : "false"};`];
    if (r.init !== undefined) lines.push(`  initial-value: ${r.init};`);
    lines.push("}");
    return lines.join("\n");
}

/**
 * Create a `PropertyManager` for CSS `@property` registrations.
 *
 * This manager stores normalized registrations keyed by custom property name
 * and can render either a single `@property` block or the full set.
 *
 * Design notes:
 * - Inputs are normalized through `canonical_property_registration()` so internal state is
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
}): PropertyRegistry {
    //  internal storage is canonical normalized registrations by name.
    const regByName: Map<CssCustomPropName, PropertyRegistration> = new Map();



    //  public API implementation.
    return {
        register(input: PropertyInput): void {
            const next = canonical_property_registration(input);
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

        registerMany(inputs): void {
            let changed = false;

            for (const input of inputs) {
                const next = canonical_property_registration(input);
                const prev = regByName.get(next.name);

                const isSame =
                    prev !== undefined &&
                    prev.syn === next.syn &&
                    prev.inh === next.inh &&
                    prev.init === next.init;

                if (isSame) continue;

                regByName.set(next.name, next);
                changed = true;
            }

            if (changed) args.onChange();
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

        renderAll(): string {
            //  sort keys for deterministic output (diff/test friendly).
            const names: CssCustomPropName[] = Array.from(regByName.keys()).sort();

            //  render in sorted order.
            const blocks: string[] = [];
            for (const name of names) {
                const reg = regByName.get(name);
                if (reg) blocks.push(render_property_registration(reg));
            }

            return blocks.join("\n\n");
        }
    };
}
