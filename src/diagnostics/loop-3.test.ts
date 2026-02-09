/**
 * loop-3.test.ts
 *
 * A deterministic 3-way round-trip validation rig for HSON.
 *
 * This module exercises the serialization ring:
 *   JSON ↔ HTML ↔ HSON
 *
 * NEW (dual mode):
 *   - Run the ring twice (cw + ccw) from the same entry.
 *   - Compare the final nodes from both directions.
 *   - Optionally (paranoid) compare per-step parsed nodes across directions.
 */

import { hson } from "../hson";
import { HsonNode } from "../types/node.types"
import { is_Node } from "../utils/node-utils/node-guards";
import { make_string } from "../utils/primitive-utils/make-string.nodes.utils";
import { _snip } from "../utils/sys-utils/snip.utils";
import { assert_invariants } from "./assert-invariants.test";
import { compare_nodes } from "./compare-nodes.test";

export type Fmt = "json" | "html" | "hson";
export type SourceFormat = Fmt | "auto" | "node" | "dom";
export type LoopDir = "cw" | "ccw";

export type LoopOpts = {
  times?: number;            // default 3
  dir?: LoopDir;             // default "cw" (only used when dual=false)
  entry?: SourceFormat;      // default "auto"
  verbose?: boolean;         // default false; when true, include trace
  stopOnFirstFail?: boolean; // default true
  capture?: boolean;         // capture emitted artifacts (strings)
  dual?: boolean;            //  run both cw + ccw and compare final nodes (default true)
  paranoid?: boolean;        // ADDED: also compare per-step parsed nodes across dirs (requires captureNodes)
};

export type Step = { step: string; ok: boolean; error?: string };

export type Artifact = {
  lap: number;
  fmt: Fmt;
  text: string;
  node: string;
  label?: string;


};

export type NodeMark = {
  lap: number;
  fmt: Fmt;
  phase: "parse" | "closure";
  node: HsonNode;
};

export type LoopReport = {
  ok: boolean;
  times: number;
  dir: LoopDir | "dual";           // CHANGED
  entry: SourceFormat;
  label?: string;
  failures: Step[];
  trace?: Step[];

  artifacts?: Artifact[];          // emitted strings
  marks?: NodeMark[];              // parsed nodes (only when paranoid/captureNodes)

  final?: { fmt: Fmt; text: string };

  // ADDED: dual summary
  dualFinals?: {
    cw: { fmt: Fmt; text: string };
    ccw: { fmt: Fmt; text: string };
  };
};

export type FixtureAtom =
  | string
  | number
  | boolean
  | null
  | object
  | HTMLElement
  | HsonNode;

/* =========================================================================
 * THE TEST CHAIN
 * =========================================================================
 */
const SPIN: Record<Fmt, { emit: (n: HsonNode) => string; parse: (s: string) => HsonNode }> = {
  json: {
    emit: (n) => hson.fromNode(n as any).toJson().serialize(),
    parse: (s) => hson.fromJson(s.trim()).toHson().parse() as any,
  },
  html: {
    emit: (n) => hson.fromNode(n as any).toHtml().serialize(),
    parse: (s) => hson.fromTrustedHtml(s).toHson().parse() as any,
  },
  hson: {
    emit: (n) => hson.fromNode(n as any).toHson().serialize(),
    parse: (s) => hson.fromHson(s).toHson().parse() as any,
  },
} as const;

/* =========================================================================
 * CORE LOOP — sequential and readable
 * ========================================================================= */

type CoreOpt = {
  trace: Step[];
  failures: Step[];
  verbose: boolean;
  stopOnFirstFail?: boolean;

  capture?: { artifacts: Artifact[] }; // emitted text artifacts
  marks?: { nodes: NodeMark[] };       //  parsed-node marks for paranoid mode
};

type RunResult = {
  ok: boolean;
  final: { fmt: Fmt; text: string };
  finalNode: HsonNode;                 // ADDED: needed for dual compare
};

function runRing(
  entryFmt: Fmt,
  entryText: string,
  dir: LoopDir,
  times: number,
  opt: CoreOpt
): RunResult {
  // 1) enter the ring
  let node = safe_parse(entryFmt, entryText, `enter:${entryFmt}`, opt, { lap: 0, fmt: entryFmt, phase: "parse" });
  if (!node) {
    return { ok: false, final: { fmt: entryFmt, text: entryText }, finalNode: { _tag: "_bad", _content: [] } as any };
  }

  // 2) choose direction (a visible ring order)
  const ring: readonly Fmt[] =
    dir === "cw"
      ? (["json", "html", "hson"] as const)
      : (["json", "hson", "html"] as const);

  // rotate ring so we start at entryFmt
  const path = rotate_ring(ring, entryFmt);

  let carryText = entryText;

  // 3) walk the ring: emit -> parse -> diff -> advance
  for (let lap = 0; lap < times; lap++) {
    step_ok(opt, `lap ${lap + 1}/${times} begin`);

    for (let i = 0; i < path.length; i++) {
      const fmt = path[i];

      const text = safe_emit(fmt, node, `emit:${fmt}`, opt, { lap, dir, phase: "emit" });
      if (text === undefined) {
        return { ok: false, final: { fmt: entryFmt, text: carryText }, finalNode: node };
      }

      //  capture emitted artifacts here

      const next = safe_parse(fmt, text, `parse:${fmt}`, opt, { lap, fmt, phase: "parse" });
      if (!next) {
        return { ok: false, final: { fmt: entryFmt, text: carryText }, finalNode: node };
      }
      if (opt.capture) {
        opt.capture.artifacts.push({
          lap,
          fmt,
          text,
          node: make_string(next),
        });
      }

      const diffs = compare_nodes(node, next, false);
      if (diffs.length) {
        step_fail(opt, `diff nodes<ERR>:node -> ${fmt} -> node`, diffs[0]);
        if (opt.stopOnFirstFail) {
          return { ok: false, final: { fmt: entryFmt, text: carryText }, finalNode: node };
        }
      } else {
        step_ok(opt, `diff nodes<OK>:node -> ${fmt} -> node`);
      }

      node = next;
      carryText = text;
    }

    // 4) closure check: return to entry representation and re-parse once
    const closeText = safe_emit(entryFmt, node, `return:to:${entryFmt}`, opt);
    if (closeText !== undefined) {
      const closeNode = safe_parse(entryFmt, closeText, `return:from:${entryFmt}`, opt, { lap, fmt: entryFmt, phase: "closure" });
      if (closeNode) {
        const closeDiffs = compare_nodes(node, closeNode, false);
        if (closeDiffs.length) {
          step_fail(opt, `closure:${entryFmt}`, closeDiffs[0]);
          if (opt.stopOnFirstFail) {
            return { ok: false, final: { fmt: entryFmt, text: carryText }, finalNode: node };
          }
        } else {
          step_ok(opt, `return:check:${entryFmt}`);
        }
        node = closeNode;
        carryText = closeText;
      }
    }

    step_ok(opt, `lap ${lap + 1}/${times} end`);
  }

  return { ok: opt.failures.length === 0, final: { fmt: entryFmt, text: carryText }, finalNode: node };
}

/* =========================================================================
 * PUBLIC ENTRY
 * ========================================================================= */

/**
 * Runs a multi-lap round-trip validation across JSON, HTML, and HSON.
 *
 * Default behavior runs BOTH directions (dual=true) and compares the
 * final nodes from cw vs ccw to detect path-dependence.
 *
 * When paranoid=true, also captures parsed nodes ("marks") and compares
 * cw vs ccw at matching (lap, fmt, phase) checkpoints.
 */
export function _test_full_loop(atom: FixtureAtom, opts: LoopOpts = {}): LoopReport {
  const trace: Step[] = [];
  const failures: Step[] = [];
  const artifacts: Artifact[] = [];
  const marks: NodeMark[] = [];

  const coreBase: Omit<CoreOpt, "capture" | "marks"> = {
    trace,
    failures,
    verbose: !!opts.verbose,
    stopOnFirstFail: opts.stopOnFirstFail ?? false,
  };
  step_ok({ trace, failures, verbose: true, stopOnFirstFail: false }, `debug:opts.entry=${String(opts.entry)} typeofAtom=${typeof atom}`);
  //  dual by default
  const dual = opts.dual ?? true;

  const times = clamp_int(opts.times ?? 3, 1, 10_000);

  const entry = (opts.entry ?? "auto") as SourceFormat;
  const resolved = resolve_entry(atom, entry, coreBase);
  if (!resolved) {
    return finalize(false, times, dual ? "dual" : (opts.dir ?? "cw"), entry, trace, failures, undefined, undefined, undefined, undefined);
  }

  const { fmt, text } = resolved;

  // ---- single-direction mode (kept for simplicity / explicitness) ----
  if (!dual) {
    const dir: LoopDir = opts.dir ?? "cw";

    const core: CoreOpt = {
      ...coreBase,
      capture: opts.capture ? { artifacts } : undefined,
      marks: opts.paranoid ? { nodes: marks } : undefined,
    };

    const res = runRing(fmt, text, dir, times, core);
    return finalize(res.ok, times, dir, entry, trace, failures, opts.capture ? artifacts : undefined, opts.paranoid ? marks : undefined, res.final, undefined);
  }

  // ---- dual mode (cw + ccw) ----
  const cwArtifacts: Artifact[] = [];
  const ccwArtifacts: Artifact[] = [];
  const cwMarks: NodeMark[] = [];
  const ccwMarks: NodeMark[] = [];

  const cwCore: CoreOpt = {
    ...coreBase,
    capture: opts.capture ? { artifacts: cwArtifacts } : undefined,
    marks: opts.paranoid ? { nodes: cwMarks } : undefined,
  };

  const ccwCore: CoreOpt = {
    ...coreBase,
    capture: opts.capture ? { artifacts: ccwArtifacts } : undefined,
    marks: opts.paranoid ? { nodes: ccwMarks } : undefined,
  };

  const cwRes = runRing(fmt, text, "cw", times, cwCore);
  const ccwRes = runRing(fmt, text, "ccw", times, ccwCore);

  //  compare final nodes cw vs ccw (path dependence detector)
  const finalDiffs = compare_nodes(cwRes.finalNode, ccwRes.finalNode, false);
  if (finalDiffs.length) {
    step_fail({ trace, failures, verbose: !!opts.verbose, }, "dual:finalNode cw != ccw", finalDiffs[0]);
  } else {
    step_ok({ trace, failures, verbose: !!opts.verbose }, "dual:finalNode cw == ccw");
  }

  // ADDED: paranoid cross-check at each checkpoint (lap, fmt, phase)
  if (opts.paranoid) {
    const byKey = (m: NodeMark) => `${m.lap}|${m.fmt}|${m.phase}`;

    const cwMap = new Map<string, HsonNode>();
    for (const m of cwMarks) cwMap.set(byKey(m), m.node);

    const ccwMap = new Map<string, HsonNode>();
    for (const m of ccwMarks) ccwMap.set(byKey(m), m.node);

    const keys = new Set<string>([...cwMap.keys(), ...ccwMap.keys()]);
    for (const k of keys) {
      const a = cwMap.get(k);
      const b = ccwMap.get(k);
      if (!a || !b) {
        step_fail({ trace, failures, verbose: !!opts.verbose }, `paranoid:missing mark ${k}`, !a ? "missing cw mark" : "missing ccw mark");
        continue;
      }
      const diffs = compare_nodes(a, b, false);
      if (diffs.length) {
        step_fail({ trace, failures, verbose: !!opts.verbose }, `paranoid:mark mismatch ${k}`, diffs[0]);
        if (opts.stopOnFirstFail ?? true) break;
      } else {
        step_ok({ trace, failures, verbose: !!opts.verbose }, `paranoid:mark ok ${k}`);
      }
    }
  }

  const ok = failures.length === 0 && cwRes.ok && ccwRes.ok;

  // Merge optional capture payloads in a simple, readable way:
  const mergedArtifacts = opts.capture ? [...cwArtifacts, ...ccwArtifacts] : undefined;
  const mergedMarks = opts.paranoid ? [...cwMarks, ...ccwMarks] : undefined;

  return finalize(
    ok,
    times,
    "dual",
    entry,
    trace,
    failures,
    mergedArtifacts,
    mergedMarks,
    // pick one "final" for convenience; both are also returned in dualFinals
    cwRes.final,
    { cw: cwRes.final, ccw: ccwRes.final }
  );
}

/* =========================================================================
 * HELPERS
 * ========================================================================= */

function looks_like_json(s: string): boolean {
  const t = s.trim();
  if (!t) return false;

  const c0 = t[0]!;
  if (c0 === "{" || c0 === "[") return true;

  // JSON scalars
  if (c0 === `"` || c0 === "-" || (c0 >= "0" && c0 <= "9")) return true;
  return t === "true" || t === "false" || t === "null";
}

// CHANGED: only try HTML when it actually looks like markup.
// (Keep this conservative; “false negatives” are better than HTML swallowing JSON.)
function looks_like_html(s: string): boolean {
  const t = s.trim();
  if (!t) return false;

  // starts with a tag-like opener: <a  </a  <!doctype  <?xml  <_obj ...
  if (/^<\s*[A-Za-z_!/??]/.test(t)) return true;

  // or contains a tag-ish opener somewhere (avoid treating "< 3" as HTML)
  if (/<\s*[A-Za-z_!/??]/.test(t)) return true;

  return false;
}

// OPTIONAL: if you want a “hard” JSON check (syntax-valid JSON), keep it here.
// Using JSON.parse is fast and gives you crisp “this isn't JSON” classification.
function is_json_source_text(s: string): boolean {
  const t = s.trim();
  if (!looks_like_json(t)) return false;
  try { JSON.parse(t); return true; } catch { return false; }
}

function resolve_entry(
  atom: FixtureAtom,
  entry: SourceFormat,
  opt: Pick<CoreOpt, "trace" | "failures" | "verbose" | "stopOnFirstFail">
): { fmt: Fmt; text: string } | undefined {
  if (entry !== "auto") {
    return coerce_entry(atom, entry, opt);
  }

  if (is_Node(atom)) {
    const text = safe_emit("hson", atom, "emit:node->hson(entry)", opt);
    if (text === undefined) return undefined;
    return { fmt: "hson", text };
  }

  if (is_html_element(atom)) {
    return { fmt: "html", text: atom.outerHTML };
  }

  if (typeof atom !== "string") {
    return { fmt: "json", text: JSON.stringify(atom) };
  }

  const s = atom.trim();

  // CHANGED: commit by shape; do NOT “try-parse vacuum” through HTML.
  const likeJson = looks_like_json(s);
  const likeHtml = looks_like_html(s);

  // Prefer JSON if it looks JSON-ish.
  if (likeJson) {
    // Optional: if you want “invalid JSON should never be treated as HTML/HSON”
    // then enforce syntax validity up front.
    if (!is_json_source_text(s)) {
      step_fail(opt, "resolve_entry:auto", "Looks like JSON but JSON.parse failed (invalid JSON)");
      return undefined;
    }

    try {
      const n = SPIN.json.parse(s);
      assert_invariants(n, "auto:json");
      return { fmt: "json", text: s };
    } catch (err) {
      // CHANGED: do not fall through to HTML; this was the bug pattern.
      step_fail(opt, "resolve_entry:auto", `Looks like JSON but SPIN.json.parse failed: ${err_to_string(err)}`);
      return undefined;
    }
  }

  // Only try HTML if it actually looks like HTML.
  if (likeHtml) {
    return { fmt: "html", text: s };
  }

  // Otherwise, try HSON as the final fallback.
  try {
    const n = SPIN.hson.parse(s);
    assert_invariants(n, "auto:hson");
    return { fmt: "hson", text: s };
  } catch { /* ignore */ }

  step_fail(opt, "resolve_entry:auto", "Could not detect entry format (shape-gated json/html/hson)");
  return undefined;
}

// function resolve_entry(
//   atom: FixtureAtom,
//   entry: SourceFormat,
//   opt: Pick<CoreOpt, "trace" | "failures" | "verbose" | "stopOnFirstFail">
// ): { fmt: Fmt; text: string } | undefined {
//   if (entry !== "auto") {
//     return coerce_entry(atom, entry, opt);
//   }

//   if (is_Node(atom)) {
//     const text = safe_emit("hson", atom, "emit:node->hson(entry)", opt);
//     if (text === undefined) return undefined;
//     return { fmt: "hson", text };
//   }

//   if (is_html_element(atom)) {
//     return { fmt: "html", text: atom.outerHTML };
//   }

//   if (typeof atom !== "string") {
//     return { fmt: "json", text: JSON.stringify(atom) };
//   }

//   const s = atom.trim();

//   try {
//     const n = SPIN.json.parse(s);
//     assert_invariants(n, "auto:json");
//     return { fmt: "json", text: s };
//   } catch { /* ignore */ }

//   try {
//     const n = SPIN.html.parse(s);
//     assert_invariants(n, "auto:html");
//     return { fmt: "html", text: s };
//   } catch { /* ignore */ }

//   try {
//     const n = SPIN.hson.parse(s);
//     assert_invariants(n, "auto:hson");
//     return { fmt: "hson", text: s };
//   } catch { /* ignore */ }

//   step_fail(opt, "resolve_entry:auto", "Could not detect entry format via try-parse (json/html/hson)");
//   return undefined;
// }



function coerce_entry(
  atom: FixtureAtom,
  entry: SourceFormat,
  opt: Pick<CoreOpt, "trace" | "failures" | "verbose" | "stopOnFirstFail">
): { fmt: Fmt; text: string } | undefined {
  if (entry === "json") {
    const text = typeof atom === "string" ? atom : JSON.stringify(atom);
    return { fmt: "json", text };
  }

  if (entry === "html") {
    if (typeof atom === "string") return { fmt: "html", text: atom };
    if (is_html_element(atom)) return { fmt: "html", text: atom.outerHTML };
    step_fail(opt, "resolve_entry:html", "Non-string/non-HTMLElement provided for html entry");
    return undefined;
  }

  if (entry === "hson") {
    if (typeof atom === "string") return { fmt: "hson", text: atom };
    step_fail(opt, "resolve_entry:hson", "Non-string provided for hson entry");
    return undefined;
  }

  if (entry === "node") {
    if (!is_Node(atom)) {
      step_fail(opt, "resolve_entry:node", "Non-HsonNode provided for node entry");
      return undefined;
    }
    const text = safe_emit("hson", atom, "emit:node->hson(entry)", opt);
    if (text === undefined) return undefined;
    return { fmt: "hson", text };
  }

  if (entry === "dom") {
    if (!is_html_element(atom)) {
      step_fail(opt, "resolve_entry:dom", "Non-HTMLElement provided for dom entry");
      return undefined;
    }
    return { fmt: "html", text: atom.outerHTML };
  }

  step_fail(opt, "resolve_entry", `Unsupported entry: ${String(entry)}`);
  return undefined;
}

function safe_emit(
  fmt: Fmt,
  node: HsonNode,
  stepName: string,
  opt: CoreOpt,
  mark?: { lap: number; dir?: "cw" | "ccw"; phase: "emit" } // CHANGED: add lap/dir context
): string | undefined {
  try {
    const s = SPIN[fmt].emit(node);
    step_ok(opt, stepName);

    // CHANGED: capture emitted string immediately, even if subsequent parse fails
    if (opt.capture && mark) {
      opt.capture.artifacts.push({
        lap: mark.lap,
        fmt,
        text: s,
        node: JSON.stringify(node, null, 2), // or your existing node serializer
        // dir: mark.dir, // only if your Artifact type includes it
      });

    }

    return s;
  } catch (err) {
    step_fail(opt, stepName, err_to_string(err));
    return undefined;
  }
}

function safe_parse(
  fmt: Fmt,
  text: string,
  stepName: string,
  opt: CoreOpt,
  mark?: { lap: number; fmt: Fmt; phase: "parse" | "closure" } // ADDED
): HsonNode | undefined {
  try {
    const n = SPIN[fmt].parse(text);
    assert_invariants(n, `loop_test:${fmt}`);
    step_ok(opt, stepName);

    // ADDED: capture parsed nodes for paranoid cross-direction comparisons
    if (opt.marks && mark) {
      opt.marks.nodes.push({ ...mark, node: n });
    }

    return n;
  } catch (err) {
    step_fail(opt, stepName, `${err_to_string(err)} :\n ${_snip(text, 300)}`);
    return undefined;
  }
}

function rotate_ring(ring: readonly Fmt[], entry: Fmt): readonly Fmt[] {
  const idx = ring.indexOf(entry);
  if (idx < 0) return ring;
  return [...ring.slice(idx), ...ring.slice(0, idx)];
}

function step_ok(
  opt: Pick<CoreOpt, "trace" | "failures" | "verbose" | "stopOnFirstFail">,
  step: string
): void {
  if (opt.verbose) opt.trace.push({ step, ok: true });
}

function step_fail(
  opt: Pick<CoreOpt, "trace" | "failures" | "verbose" | "stopOnFirstFail">,
  step: string,
  error: string
): void {
  opt.failures.push({ step, ok: false, error });
  if (opt.verbose) opt.trace.push({ step, ok: false, error });
}

function finalize(
  ok: boolean,
  times: number,
  dir: LoopDir | "dual",
  entry: SourceFormat,
  trace: Step[],
  failures: Step[],
  artifacts?: Artifact[],
  marks?: NodeMark[],
  final?: { fmt: Fmt; text: string },
  dualFinals?: { cw: { fmt: Fmt; text: string }; ccw: { fmt: Fmt; text: string } }
): LoopReport {
  return {
    ok,
    times,
    dir,
    entry,
    failures,
    trace: trace.length ? trace : undefined,
    artifacts,
    marks,
    final,
    dualFinals,
  };
}

function clamp_int(n: number, min: number, max: number): number {
  const x = Math.trunc(n);
  if (Number.isNaN(x)) return min;
  if (x < min) return min;
  if (x > max) return max;
  return x;
}

function err_to_string(err: unknown): string {
  if (err instanceof Error) return err.message || String(err);
  return String(err);
}

function is_html_element(x: unknown): x is HTMLElement {
  const g: any = globalThis as any;
  const H = g.HTMLElement;
  return typeof H === "function" && x instanceof H;
}
function snapshot_node_hson(n: HsonNode, max = 4000): string {
  const s = make_string(hson.fromNode(n as any).toHson().parse());
  return s.length > max ? s.slice(0, max) + `…(+${s.length - max})` : s;
}