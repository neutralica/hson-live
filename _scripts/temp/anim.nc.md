import { AnimAdapters, AnimApi, AnimApiCore, AnimSpec, AnimationName, AnimationEndMode } from "./animate.types";
export function bind_anim_api<TTarget>(target: TTarget, core: AnimApiCore<TTarget>): AnimApi<TTarget> {
    return {
        begin: (spec) => core.begin(target, spec),
        restart: (spec) => core.restart(target, spec),
        beginName: (name) => core.beginName(target, name),
        restartName: (name) => core.restartName(target, name),
        end: (mode) => core.end(target, mode),
        setPlayState: (state) => core.setPlayState(target, state),
        pause: () => core.pause(target),
        resume: () => core.resume(target),
    };
}
export function normalizeName(name: string): string {
    const n = name.trim();
    if (n === "")
        throw new Error(`animation name cannot be empty.`);
    return n;
}
function applyNameOnly<TTree>(tree: TTree, name: string, a: AnimAdapters<TTree>): TTree {
    return a.setStyleProp(tree, "animation-name", normalizeName(name));
}
function normalizeSpec(spec: AnimSpec): AnimSpec {
    const name = normalizeName(spec.name);
    const duration = spec.duration.trim();
    if (duration === "") {
        throw new Error(`begin_animation: spec.duration cannot be empty.`);
    }
    return {
        ...spec,
        name,
        duration,
        timingFunction: spec.timingFunction?.trim(),
        delay: spec.delay?.trim(),
        iterationCount: spec.iterationCount?.trim(),
        direction: spec.direction?.trim(),
        fillMode: spec.fillMode?.trim(),
        playState: spec.playState?.trim(),
    };
}
function applyAnimationProps<TTree>(tree: TTree, spec: AnimSpec, a: AnimAdapters<TTree>): TTree {
    tree = a.setStyleProp(tree, "animation-name", spec.name);
    if (spec.duration !== undefined) {
        tree = a.setStyleProp(tree, "animation-duration", spec.duration.trim());
    }
    if (spec.timingFunction !== undefined) {
        tree = a.setStyleProp(tree, "animation-timing-function", spec.timingFunction.trim());
    }
    if (spec.delay !== undefined) {
        tree = a.setStyleProp(tree, "animation-delay", spec.delay.trim());
    }
    if (spec.iterationCount !== undefined) {
        tree = a.setStyleProp(tree, "animation-iteration-count", spec.iterationCount.trim());
    }
    if (spec.direction !== undefined) {
        tree = a.setStyleProp(tree, "animation-direction", spec.direction.trim());
    }
    if (spec.fillMode !== undefined) {
        tree = a.setStyleProp(tree, "animation-fill-mode", spec.fillMode.trim());
    }
    if (spec.playState !== undefined) {
        tree = a.setStyleProp(tree, "animation-play-state", spec.playState.trim());
    }
    return tree;
}
function forceReflow(tree: unknown, el: Element): void {
    const h = el as HTMLElement;
    if (typeof h.offsetHeight === "number") {
        h.offsetHeight;
        return;
    }
    el.getBoundingClientRect().height;
}
export function apply_animation<TTarget>(adapters: AnimAdapters<TTarget>): AnimApiCore<TTarget> {
    return {
        begin(target: TTarget, spec: AnimSpec): TTarget {
            const s = normalizeSpec(spec);
            return applyAnimationProps(target, s, adapters);
        },
        beginName(target: TTarget, name: AnimationName): TTarget {
            return applyNameOnly(target, name, adapters);
        },
        end(target: TTarget, mode: AnimationEndMode = "name-only"): TTarget {
            target = adapters.setStyleProp(target, "animation-name", "none");
            if (mode === "clear-all") {
                target = adapters.setStyleProp(target, "animation-duration", "");
                target = adapters.setStyleProp(target, "animation-timing-function", "");
                target = adapters.setStyleProp(target, "animation-delay", "");
                target = adapters.setStyleProp(target, "animation-iteration-count", "");
                target = adapters.setStyleProp(target, "animation-direction", "");
                target = adapters.setStyleProp(target, "animation-fill-mode", "");
                target = adapters.setStyleProp(target, "animation-play-state", "");
            }
            return target;
        },
        restart(target: TTarget, spec: AnimSpec): TTarget {
            const s = normalizeSpec(spec);
            target = adapters.setStyleProp(target, "animation-name", "none");
            const first = adapters.getFirstDomElement(target);
            if (first)
                forceReflow(target, first);
            return applyAnimationProps(target, s, adapters);
        },
        restartName(target: TTarget, name: AnimationName): TTarget {
            target = adapters.setStyleProp(target, "animation-name", "none");
            const first = adapters.getFirstDomElement(target);
            if (first)
                forceReflow(target, first);
            return applyNameOnly(target, name, adapters);
        },
        setPlayState(target: TTarget, state: "running" | "paused"): TTarget {
            return adapters.setStyleProp(target, "animation-play-state", state);
        },
        pause(target: TTarget): TTarget {
            return adapters.setStyleProp(target, "animation-play-state", "paused");
        },
        resume(target: TTarget): TTarget {
            return adapters.setStyleProp(target, "animation-play-state", "running");
        },
    };
}
