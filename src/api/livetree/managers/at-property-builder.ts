import { canonical_property_registration, render_property_registration } from "../../../internal/css/property-registration.js";
import type { CssCustomPropName, PropertyInput, PropertyRegistration, PropertyRegistry } from "../../../types/at-property.types.js";
export { canonical_property_registration, render_property_registration } from "../../../internal/css/property-registration.js";

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
