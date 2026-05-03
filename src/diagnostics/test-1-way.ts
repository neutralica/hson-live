import { make_string } from "../utils/primitive-utils/make-string.nodes.utils.js";
import { compare_nodes } from "./compare-nodes.test.js";
import { Artifact, CoreOpt, FixtureAtom, Fmt, LoopReport, Step } from "../types/diagnostics.types.js";
import { step_ok, safe_parse, safe_emit, step_fail } from "./diagnostics-helpers.js";

export type ProjectionOpts = {
  entry: Fmt;
  emit?: Fmt;
  label?: string;
  verbose?: boolean;
  stopOnFirstFail?: boolean;
  capture?: boolean;
  compare?: boolean; // default true: parse emitted text and diff against source node
};

export function _test_one_format(
  atom: FixtureAtom,
  opts: ProjectionOpts
): LoopReport {
  const trace: Step[] = [];
  const failures: Step[] = [];
  const artifacts: Artifact[] = [];

  const opt: CoreOpt = {
    trace,
    failures,
    verbose: opts.verbose ?? false,
    stopOnFirstFail: opts.stopOnFirstFail ?? true,
    capture: opts.capture ? { artifacts } : undefined,
  };

  const entryFmt = opts.entry;
  const emitFmt = opts.emit ?? entryFmt;
  const compare = opts.compare ?? true;

  const entryText =
    typeof atom === "string"
      ? atom
      : entryFmt === "json"
        ? JSON.stringify(atom, null, 2)
        : String(atom);

  step_ok(opt, `enter:${entryFmt}`);

  const node = safe_parse(entryFmt, entryText, `parse:${entryFmt}`, opt, {
    lap: 0,
    fmt: entryFmt,
    phase: "parse",
  });

  if (!node) {
    return {
      ok: false,
      times: 1,
      dir: "oneway",
      entry: entryFmt,
      label: opts.label,
      failures,
      trace,
      artifacts: opts.capture ? artifacts : undefined,
    };
  }

  const text = safe_emit(emitFmt, node, `emit:${emitFmt}`, opt, {
    lap: 0,
    dir: "cw",
    phase: "emit",
  });

  if (text === undefined) {
    return {
      ok: false,
      times: 1,
      dir: "dual",
      entry: entryFmt,
      label: opts.label,
      failures,
      trace,
      artifacts: opts.capture ? artifacts : undefined,
    };
  }

  let finalNode = node;

  if (compare) {
    const reparsed = safe_parse(emitFmt, text, `parse:${emitFmt}`, opt, {
      lap: 0,
      fmt: emitFmt,
      phase: "parse",
    });

    if (reparsed) {
      const diffs = compare_nodes(node, reparsed, false);

      if (diffs.length) {
        step_fail(opt, `diff nodes<ERR>:${entryFmt} -> ${emitFmt} -> node`, diffs[0]);
      } else {
        step_ok(opt, `diff nodes<OK>:${entryFmt} -> ${emitFmt} -> node`);
      }

      finalNode = reparsed;
    }
  }

  if (opts.capture) {
    artifacts.push({
      lap: 0,
      fmt: emitFmt,
      text,
      node: make_string(finalNode),
      label: `${entryFmt}->${emitFmt}`,
    });
  }

  return {
    ok: failures.length === 0,
    times: 1,
    dir: "dual",
    entry: entryFmt,
    label: opts.label,
    failures,
    trace,
    artifacts: opts.capture ? artifacts : undefined,
    final: { fmt: emitFmt, text },
  };
}