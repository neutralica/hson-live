import { SVG_TAGS } from "../../../consts/html-tags.js";
import { SvgTag } from "../../../types/livetree.types.js";
import { SvgBox, SvgLiveTree } from "../../../types/svg.types.js";
import { LiveTree } from "../livetree.js";


export interface SvgApi<TSelf> {
    /**
     * Returns true when this tree is currently in SVG namespace scope.
     *
     * Used by namespace-aware helpers such as `tree.create`, which switches
     * between HTML and SVG child factories depending on the current branch.
     */
    inScope(): boolean;

    /**
     * `viewBox` attribute helper for SVG root/viewport elements.
     *
     * Supports either a raw SVG viewBox string or numeric x/y/width/height
     * components.
     */
    viewBox: {
        /** Read the current `viewBox` attribute */
        get(): string | undefined;

        /** Set `viewBox` from a raw SVG value, e.g. `"0 0 100 100"` */
        set(value: string): TSelf;

        /** Set `viewBox` from numeric x/y/width/height components */
        set(x: number, y: number, w: number, h: number): TSelf;

        /** Remove the `viewBox` attribute */
        clear(): TSelf;
    };

    /**
     * `preserveAspectRatio` attribute helper.
     *
     * Controls how SVG content scales within its viewport.
     */
    preserveAspectRatio: {
        /** Read the current `preserveAspectRatio` attribute */
        get(): string | undefined;

        /** Set `preserveAspectRatio` from a raw SVG value */
        set(value: string): TSelf;

        /** Set `preserveAspectRatio="none"` */
        none(): TSelf;

        /** Remove the `preserveAspectRatio` attribute */
        clear(): TSelf;
    };

    /**
     * Path `d` attribute helper.
     *
     * Intended primarily for `<path>` elements.
     */
    d: {
        /** Read the current path `d` attribute */
        get(): string | undefined;

        /** Set the path `d` attribute */
        set(value: string): TSelf;

        /** Remove the path `d` attribute */
        clear(): TSelf;
    };

    /**
     * Return the mounted SVG element's bounding box when available.
     *
     * Returns `undefined` when this branch is not mounted, is not backed by an
     * SVG graphics element, or the browser cannot provide a bounding box.
     */
    bbox(): SvgBox | undefined;

    /**
     * Required SVG helpers.
     *
     * These variants throw instead of returning `undefined`.
     */
    must: {
        /**
         * Return the mounted SVG element's bounding box, or throw if unavailable.
         *
         * The optional label is included in the thrown error to identify the
         * caller or expected element.
         */
        bbox(label?: string): SvgBox;
    };

    /**
     * SVG `fill` attribute helper.
     */
    fill: {
        /** Read the current `fill` attribute */
        get(): string | undefined;

        /** Set the `fill` attribute */
        set(value: string): TSelf;

        /** Set `fill="none"` */
        none(): TSelf;

        /** Remove the `fill` attribute */
        clear(): TSelf;
    };

    /**
     * SVG `stroke` attribute helper.
     */
    stroke: {
        /** Read the current `stroke` attribute */
        get(): string | undefined;

        /** Set the `stroke` attribute */
        set(value: string): TSelf;

        /** Remove the `stroke` attribute */
        clear(): TSelf;
    };

    /**
     * SVG `stroke-width` attribute helper.
     */
    strokeWidth: {
        
        /** Read the current `stroke-width` attribute */
        get(): string | undefined;

        /**
         * Set the `stroke-width` attribute.
         *
         * Numeric values are accepted for convenience and serialized as attribute
         * values.
         */
        set(value: string | number): TSelf;

        /** Remove the `stroke-width` attribute */
        clear(): TSelf;
    };

    /**
     * SVG `vector-effect` attribute helper.
     * Commonly used to keep strokes visually stable while SVG content scales.
     */
    vectorEffect: {
        /** Read the current `vector-effect` attribute */
        get(): string | undefined;

        /** Set the `vector-effect` attribute */
        set(value: "none" | "non-scaling-stroke"): TSelf;

        /** Set `vector-effect="non-scaling-stroke"` */
        nonScalingStroke(): TSelf;

        /** Remove the `vector-effect` attribute */
        clear(): TSelf;
    };
}

export function make_svg_api<TTree extends LiveTree>(tree: TTree): SvgApi<TTree> {
    const bbox = (): SvgBox | undefined => {
        const el = tree.dom.el();
        if (!el || typeof (el as { getBBox?: unknown }).getBBox !== "function") {
            return undefined;
        }
        const b = (el as SVGGraphicsElement).getBBox();
        return {
            x: b.x,
            y: b.y,
            width: b.width,
            height: b.height,
        };
    };
    const getString = (name: string): string | undefined => {
        const v = tree.attr.get(name);
        return typeof v === "string" ? v : undefined;
    };

    const setAttr = (name: string, value: string): TTree => {
        tree.attr.set(name, value);
        return tree;
    };

    const clearAttr = (name: string): TTree => {
        tree.attr.drop(name);
        return tree;
    };
    return {
        inScope: () => SVG_TAGS.includes(tree.node._tag as SvgTag),


        preserveAspectRatio: {
            get: () => getString("preserveAspectRatio"),
            set: (value: string) => setAttr("preserveAspectRatio", value),
            none: () => setAttr("preserveAspectRatio", "none"),
            clear: () => clearAttr("preserveAspectRatio"),
        },

        viewBox: {
            get: () => getString("viewBox"),
            set: (...args: [string] | [number, number, number, number]) => {
                const value = args.length === 1
                    ? args[0]
                    : `${args[0]} ${args[1]} ${args[2]} ${args[3]}`;

                return setAttr("viewBox", value);
            },
            clear: () => clearAttr("viewBox"),
        },
        d: {
            get: () => getString("d"),
            set: (value: string) => {
                return setAttr("d", value);
            },
            clear: () => clearAttr("d"),
        },
        fill: {
            get: () => getString("fill"),
            set: (value: string) => setAttr("fill", value),
            none: () => setAttr("fill", "none"),
            clear: () => clearAttr("fill"),
        },
        stroke: {
            get: () => getString("stroke"),
            set: (value: string) => setAttr("stroke", value),
            clear: () => clearAttr("stroke"),
        },
        strokeWidth: {
            get: () => getString("stroke-width"),
            set: (value: string | number) => setAttr("stroke-width", String(value)),
            clear: () => clearAttr("stroke-width"),
        },
        vectorEffect: {
            get: () => getString("vector-effect"),
            set: (value: "none" | "non-scaling-stroke") => setAttr("vector-effect", value),
            nonScalingStroke: () => setAttr("vector-effect", "non-scaling-stroke"),
            clear: () => clearAttr("vector-effect"),
        },
        bbox,
        must: {
            bbox: (label?: string): SvgBox => {
                const b = bbox();
                if (!b) throw new Error(label ?? "[LiveTree.svg.must.bbox] no bbox available");
                return b;
            },
        },
    };
}
