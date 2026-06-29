/**
 * test-circuit.ts
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

import { hson } from "../hson.js";
import { HsonNode } from "../types/node.types.js"
import { is_Node } from "../utils/node-utils/node-guards.js";
import { make_string } from "../utils/primitive-utils/make-string.nodes.utils.js";
import { assert_invariants } from "./assert-invariants.test.js";
import { compare_nodes } from "./compare-nodes.test.js";
import { Fmt, LoopDir, CoreOpt, RunResult, FixtureAtom, LoopOpts, LoopReport, Step, Artifact, NodeMark, SourceFormat } from "../types/diagnostics.types.js";
import { safe_parse, rotate_ring, step_ok, safe_emit, step_fail, clamp_int, finalize, coerce_entry, is_html_element, err_to_string, step_meh } from "./diagnostics-helpers.js";

/* =========================================================================
 * TEST CHAIN
 * =========================================================================
 */
export const SPIN: Record<Fmt, { emit: (n: HsonNode) => string; parse: (s: string) => HsonNode }> = {
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
    return { ok: false, final: { fmt: entryFmt, text: entryText }, finalNode: { $_tag: "_bad", $_content: [] } as any };
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
 * When `capture=true`, emitted text artifacts are stored in the report.
 * When `paranoid=true`, parsed nodes are captured and compared across
 * directions at matching (lap, fmt, phase) checkpoints.
 */
export function _circuit_test(atom: FixtureAtom, opts: LoopOpts = {}): LoopReport {
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

  // paranoid cross-check at each checkpoint (lap, fmt, phase)
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

function looks_like_hson(s: string): boolean {
  const t = s.trim();
  if (!t) return false;

  if (/[«»]/.test(t)) return true;
  if (/(?:^|\n)\s*\/?>\s*(?:\/\/.*)?(?:\n|$)/.test(t)) return true;
  if (/(?:^|\n)\s*"\s*/.test(t)) return true;
  if (/<>\s*/.test(t)) return true;

  return false;
}

// only try HTML when it actually looks like markup.
// (conservative; false negatives are better than HTML swallowing JSON.)
function looks_like_html(s: string): boolean {
  const t = s.trim();
  if (!t) return false;

  // starts with a tag-like opener: <a  </a  <!doctype  <?xml  <_-obj ...
  if (/^<\s*[A-Za-z_!/??]/.test(t)) return true;

  // or contains a tag-ish opener somewhere (avoid treating "< 3" as HTML)
  if (/<\s*[A-Za-z_!/??]/.test(t)) return true;

  return false;
}

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
  // commit by shape first, but give explicit HTML closer syntax priority
  // over HSON because some HTML is parseable as HSON and contaminates source-sensitive tests.
  const likeJson = looks_like_json(s);
  const likeHson = looks_like_hson(s);
  const likeHtml = looks_like_html(s);

  // strong HTML signal for auto-detect in diagnostics/tests
  const hasHtmlCloser = s.includes("</");

  // Prefer JSON if it looks JSON-ish.
  if (likeJson) {
    if (!is_json_source_text(s)) {
      step_fail(opt, "resolve_entry:auto", "Looks like JSON but JSON.parse failed (invalid JSON)");
      return undefined;
    }

    try {
      const n = SPIN.json.parse(s);
      assert_invariants(n, "auto:json");
      return { fmt: "json", text: s };
    } catch (err) {
      step_fail(opt, "resolve_entry:auto", `Looks like JSON but SPIN.json.parse failed: ${err_to_string(err)}`);
      return undefined;
    }
  }

  // explicit HTML closing tags are a strong diagnostic signal.
  // HSON normally does not use </tag> closers, so prefer HTML here.
  if (hasHtmlCloser) {
    try {
      const n = SPIN.html.parse(s);
      assert_invariants(n, "auto:html");
      return { fmt: "html", text: s };
    } catch (htmlErr) {
      step_fail(
        opt,
        "resolve_entry:auto",
        `Contains '</' so auto preferred HTML, but HTML parse failed: ${err_to_string(htmlErr)}`
      );
      return undefined;
    }
  }

  let hsonErr: unknown = undefined;

  // prefer HSON for remaining markup-ish input
  if (likeHson || likeHtml) {
    try {
      const n = SPIN.hson.parse(s);
      assert_invariants(n, "auto:hson");
      return { fmt: "hson", text: s };
    } catch (err) {
      hsonErr = err;
      step_meh(
        opt,
        `resolve_entry:auto:hson-failed - ${err_to_string(err)}\n... trying html`
      );
    }
  }

  // HTML fallback only after HSON fails, unless the strong </ signal already handled it above
  if (likeHtml) {
    try {
      const n = SPIN.html.parse(s);
      assert_invariants(n, "auto:html");
      return { fmt: "html", text: s };
    } catch (htmlErr) {
      step_fail(
        opt,
        "resolve_entry:auto",
        [
          "Markup-like input failed HSON parse, then failed HTML parse.",
          `HSON: ${err_to_string(hsonErr)}`,
          `HTML: ${err_to_string(htmlErr)}`,
        ].join("\n")
      );
      return undefined;
    }
  }

  step_fail(
    opt,
    "resolve_entry:auto",
    `Markup-like input failed HSON parse: ${err_to_string(hsonErr)}`
  );
  return undefined;
}


