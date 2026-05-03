import { hson } from "../hson.js";
import { FixtureAtom, SourceFormat, CoreOpt, Fmt, LoopDir, Step, Artifact, NodeMark, LoopReport } from "../types/diagnostics.types.js";
import { HsonNode } from "../types/node.types.js";
import { is_Node } from "../utils/node-utils/node-guards.js";
import { make_string } from "../utils/primitive-utils/make-string.nodes.utils.js";
import { _snip } from "../utils/sys-utils/snip.utils.js";
import { assert_invariants } from "./assert-invariants.test.js";
import { SPIN } from "./test-3-loop.js";

export function coerce_entry(
  atom: FixtureAtom,
  entry: SourceFormat,
  opt: Pick<CoreOpt, "trace" | "failures" | "verbose" | "stopOnFirstFail">): { fmt: Fmt; text: string; } | undefined {
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
export function safe_emit(
  fmt: Fmt,
  node: HsonNode,
  stepName: string,
  opt: CoreOpt,
  mark?: { lap: number; dir?: "cw" | "ccw"; phase: "emit"; } // add lap/dir context
): string | undefined {
  try {
    const s = SPIN[fmt].emit(node);
    step_ok(opt, stepName);

    // capture emitted string immediately, even if subsequent parse fails
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
export function safe_parse(
  fmt: Fmt,
  text: string,
  stepName: string,
  opt: CoreOpt,
  mark?: { lap: number; fmt: Fmt; phase: "parse" | "closure"; }): HsonNode | undefined {
  try {
    const n = SPIN[fmt].parse(text);
    assert_invariants(n, `loop_test:${fmt}`);
    step_ok(opt, stepName);

    // capture parsed nodes for paranoid cross-direction comparisons
    if (opt.marks && mark) {
      opt.marks.nodes.push({ ...mark, node: n });
    }

    return n;
  } catch (err) {
    step_fail(opt, stepName, `${err_to_string(err)} :\n ${_snip(text, 300)}`);
    return undefined;
  }
}

export function rotate_ring(ring: readonly Fmt[], entry: Fmt): readonly Fmt[] {
  const idx = ring.indexOf(entry);
  if (idx < 0) return ring;
  return [...ring.slice(idx), ...ring.slice(0, idx)];
}

export function step_ok(
  opt: Pick<CoreOpt, "trace" | "failures" | "verbose" | "stopOnFirstFail">,
  step: string
): void {
  if (opt.verbose) opt.trace.push({ step, ok: true });
}
export function step_meh(
  opt: Pick<CoreOpt, "trace" | "failures" | "verbose" | "stopOnFirstFail">,
  step: string): void {
  if (opt.verbose) opt.trace.push({ step, ok: false });
}
export function step_fail(
  opt: Pick<CoreOpt, "trace" | "failures" | "verbose" | "stopOnFirstFail">,
  step: string,
  error: string): void {
  opt.failures.push({ step, ok: false, error });
  if (opt.verbose) opt.trace.push({ step, ok: false, error });
}
export function finalize(
  ok: boolean,
  times: number,
  dir: LoopDir | "dual",
  entry: SourceFormat,
  trace: Step[],
  failures: Step[],
  artifacts?: Artifact[],
  marks?: NodeMark[],
  final?: { fmt: Fmt; text: string; },
  dualFinals?: { cw: { fmt: Fmt; text: string; }; ccw: { fmt: Fmt; text: string; }; }): LoopReport {
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
export function clamp_int(n: number, min: number, max: number): number {
  const x = Math.trunc(n);
  if (Number.isNaN(x)) return min;
  if (x < min) return min;
  if (x > max) return max;
  return x;
}
export function err_to_string(err: unknown): string {
  if (err instanceof Error) return err.message || String(err);
  return String(err);
}
export function is_html_element(x: unknown): x is HTMLElement {
  const g: any = globalThis as any;
  const H = g.HTMLElement;
  return typeof H === "function" && x instanceof H;
}
function snapshot_node_hson(n: HsonNode, max = 4000): string {
  const s = make_string(hson.fromNode(n as any).toHson().parse());
  return s.length > max ? s.slice(0, max) + `…(+${s.length - max})` : s;
}
