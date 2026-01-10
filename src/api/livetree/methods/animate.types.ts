// animate.types.ts

export type AnimationName = string;
export type AnimationEndMode = "name-only" | "clear-all";
export type AnimSpec = Readonly<{
  name: AnimationName;

  // Optional sugar: if omitted, user can define these in CSS rules/classes instead.
  duration: string;          // "250ms", "1s"
  timingFunction?: string;    // "ease", "linear", "cubic-bezier(...)"
  delay?: string;             // "0ms"
  iterationCount?: string;    // "1", "infinite"
  direction?: string;         // "normal", "reverse", ...
  fillMode?: string;          // "none", "forwards", "both", ...
  playState?: string;         // "running", "paused"
}>;

export type AnimAdapters<TTree> = Readonly<{
  //  one canonical way to set a single CSS property on the selection.
  setStyleProp: (tree: TTree, prop: string, value: string) => TTree;

  //  iterate selected DOM elements (for forcing reflow on all if desired).
  forEachDomElement: (tree: TTree, fn: (el: Element) => void) => void;

  //  get one DOM element (for minimal reflow poke).
  getFirstDomElement: (tree: TTree) => Element | undefined;
}>;

// CHANGED: AnimApi is bound to a particular tree via closure,
// so methods do NOT accept `tree` but DO return `TTree` for chaining.
export type AnimApi<TTree> = Readonly<{
  begin: (spec: AnimSpec) => TTree;
  restart: (spec: AnimSpec) => TTree;

  beginName: (name: AnimationName) => TTree;
  restartName: (name: AnimationName) => TTree;

  end: (mode?: AnimationEndMode) => TTree;

  // ADDED:
  setPlayState: (state: "running" | "paused") => TTree;
  pause: () => TTree;
  resume: () => TTree;
}>;
export type AnimApiCore<TTree> = Readonly<{
  begin: (tree: TTree, spec: AnimSpec) => TTree;
  restart: (tree: TTree, spec: AnimSpec) => TTree;

  beginName: (tree: TTree, name: AnimationName) => TTree;
  restartName: (tree: TTree, name: AnimationName) => TTree;

  end: (tree: TTree, mode?: AnimationEndMode) => TTree;

  // ADDED:
  setPlayState: (tree: TTree, state: "running" | "paused") => TTree;
  pause: (tree: TTree) => TTree;
  resume: (tree: TTree) => TTree;
}>;

export type CssAnimHandle = AnimApi<CssAnimScope>;
export type CssAnimScope = Readonly<{ quids: readonly string[]; }>;
