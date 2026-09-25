// Pure @property normalization and rendering shared by LiveTree and LiveMap

import { CssCustomPropName, PropertyInput, PropertyInputTuple, PropertyRegistration, PropertyRegistry, PropertySyntax } from "../../types/at-property.types.js";

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
