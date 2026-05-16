import { SVG_TAGS } from "../../../consts/html-tags.js";
import { SvgTag } from "../../../types/livetree.types.js";
import { SvgBox, SvgLiveTree } from "../../../types/svg.types.js";
import { LiveTree } from "../livetree.js";

// export type SvgApi<TTree extends SvgLiveTree> = {
//   viewBox: {
//     get(): string | undefined;
//     set(value: string): TTree;
//     set(x: number, y: number, w: number, h: number): TTree;
//     clear(): TTree;
//   };

//   preserveAspectRatio: {
//     get(): string | undefined;
//     set(value: string): TTree;
//     clear(): TTree;
//   };

//   d: {
//     get(): string | undefined;
//     set(value: string): TTree;
//     clear(): TTree;
//   };

//   bbox: {
//     get(): DOMRect | undefined;
//     must(label?: string): DOMRect;
//   };
// };
export interface SvgApi<TSelf> {
    inScope(): boolean;

    viewBox: {
        get(): string | undefined;
        set(value: string): TSelf;
        set(x: number, y: number, w: number, h: number): TSelf;
        clear(): TSelf;
    };

    preserveAspectRatio: {
        get(): string | undefined;
        set(value: string): TSelf;
        none(): TSelf;
        clear(): TSelf;
    };

    d: {
        get(): string | undefined;
        set(value: string): TSelf;
        clear(): TSelf;
    };

    bbox(): SvgBox | undefined;

    must: {
        bbox(label?: string): SvgBox;
    };
    fill: {
        get(): string | undefined;
        set(value: string): TSelf;
        none(): TSelf;
        clear(): TSelf;
    };

    stroke: {
        get(): string | undefined;
        set(value: string): TSelf;
        clear(): TSelf;
    };

    strokeWidth: {
        get(): string | undefined;
        set(value: string | number): TSelf;
        clear(): TSelf;
    };

    vectorEffect: {
        get(): string | undefined;
        set(value: "none" | "non-scaling-stroke"): TSelf;
        nonScalingStroke(): TSelf;
        clear(): TSelf;
    };

};

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
