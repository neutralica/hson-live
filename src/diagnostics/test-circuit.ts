/**
 * Browser diagnostic compatibility facade for the strict semantic circuit.
 *
 * The engine itself is environment-neutral. This module deliberately injects
 * the complete browser `hson` facade so established `_circuit_test` callers
 * continue to exercise the DOMParser-backed HTML path.
 */

import { hson } from "../hson.js";
import type { HsonNode } from "../core/types.js";
import { is_Node } from "../core/node-guards.js";
import { make_string } from "../core/stringify.js";
import type {
  Artifact,
  CoreOpt,
  FixtureAtom,
  Fmt,
  LoopOpts,
  LoopReport,
  NodeMark,
  SourceFormat,
  Step,
} from "../types/diagnostics.types.js";
import {
  clamp_int,
  coerce_entry,
  err_to_string,
  finalize,
  is_html_element,
  step_fail,
  step_meh,
} from "./diagnostics-helpers.js";
import {
  execute_circuit,
  type CircuitDirection,
  type CircuitExecutionResult,
  type CircuitFailure,
  type CircuitLegDiagnostic,
} from "./circuit-engine.js";
import { create_circuit_transform_boundary } from "./circuit-transform-boundary.js";

const BROWSER_CIRCUIT_BOUNDARY = create_circuit_transform_boundary(
  "browser-domparser",
  {
    parseJson: (text) => hson.fromJson(text).toNode(),
    parseHtml: (text) => hson.fromTrustedHtml(text).toNode(),
    parseHson: (text) => hson.fromHson(text).toNode(),
    serializeJson: (node) => hson.fromNode(node).toJson().serialize(),
    serializeHtml: (node) => hson.fromNode(node).toHtml().serialize(),
    serializeHson: (node) => hson.fromNode(node).toHson().serialize(),
  },
);

/** Retained source-level compatibility for diagnostics helpers and audits. */
export const SPIN: Readonly<Record<Fmt, {
  emit(node: HsonNode): string;
  parse(text: string): HsonNode;
}>> = Object.freeze({
  json: Object.freeze({
    emit: (node: HsonNode) => BROWSER_CIRCUIT_BOUNDARY.serialize("json", node),
    parse: (text: string) => BROWSER_CIRCUIT_BOUNDARY.parse("json", text),
  }),
  html: Object.freeze({
    emit: (node: HsonNode) => BROWSER_CIRCUIT_BOUNDARY.serialize("html", node),
    parse: (text: string) => BROWSER_CIRCUIT_BOUNDARY.parse("html", text),
  }),
  hson: Object.freeze({
    emit: (node: HsonNode) => BROWSER_CIRCUIT_BOUNDARY.serialize("hson", node),
    parse: (text: string) => BROWSER_CIRCUIT_BOUNDARY.parse("hson", text),
  }),
});

function failure_step(failure: CircuitFailure, entry: Fmt): Step {
  const target = failure.targetFormat ?? failure.sourceFormat ?? entry;
  const step = failure.stage === "prepare"
    ? `enter:${target}`
    : failure.stage === "serialize"
      ? failure.leg === 3 ? `return:to:${target}` : `emit:${target}`
      : failure.stage === "parse"
        ? failure.leg === 3 ? `return:from:${target}` : `parse:${target}`
        : failure.stage === "cancel"
          ? "circuit:cancelled"
          : failure.leg === 3 ? `closure:${entry}` : `diff nodes:node -> ${target} -> node`;
  const difference = failure.difference;
  const error = difference === undefined
    ? failure.message
    : `${difference.kind} at ${difference.path}: ${difference.message}`;
  return { step, ok: false, error };
}

function append_failure(
  failure: CircuitFailure,
  entry: Fmt,
  failures: Step[],
  trace: Step[],
  verbose: boolean,
): void {
  const step = failure_step(failure, entry);
  failures.push(step);
  if (verbose) trace.push(step);
}

function trace_leg(
  leg: CircuitLegDiagnostic,
  entry: Fmt,
  failures: Step[],
  trace: Step[],
  verbose: boolean,
): void {
  const closure = leg.phase === "closure";
  const emitStep = closure ? `return:to:${leg.targetFormat}` : `emit:${leg.targetFormat}`;
  const parseStep = closure ? `return:from:${leg.targetFormat}` : `parse:${leg.targetFormat}`;
  const compareStep = closure
    ? `return:check:${entry}`
    : `diff nodes<OK>:node -> ${leg.targetFormat} -> node`;

  if (verbose && leg.failure?.stage !== "serialize") trace.push({ step: emitStep, ok: true });
  if (verbose && leg.comparison !== undefined) trace.push({ step: parseStep, ok: true });
  if (leg.failure !== undefined) append_failure(leg.failure, entry, failures, trace, verbose);
  else if (verbose && leg.comparison?.equal === true) trace.push({ step: compareStep, ok: true });
}

function collect_report_material(
  result: CircuitExecutionResult,
  entry: Fmt,
  opts: LoopOpts,
  trace: Step[],
  failures: Step[],
): Readonly<{ artifacts?: Artifact[]; marks?: NodeMark[] }> {
  const artifacts: Artifact[] | undefined = opts.capture ? [] : undefined;
  const marks: NodeMark[] | undefined = opts.paranoid ? [] : undefined;
  const verbose = opts.verbose === true;

  if (result.prepareFailure !== undefined) {
    append_failure(result.prepareFailure, entry, failures, trace, verbose);
    return Object.freeze({ artifacts, marks });
  }
  if (verbose) trace.push({ step: `enter:${entry}`, ok: true });

  for (const direction of result.directions) {
    if (marks !== undefined && result.prepared !== undefined) {
      marks.push({ lap: 0, fmt: entry, phase: "parse", node: result.prepared.node });
    }
    for (const lap of direction.laps ?? []) {
      if (verbose) trace.push({ step: `lap ${lap.lap + 1}/${direction.requestedLaps} begin`, ok: true });
      for (const leg of lap.legs ?? []) {
        trace_leg(leg, entry, failures, trace, verbose);
        if (artifacts !== undefined && leg.phase === "conversion" && leg.material !== undefined) {
          artifacts.push({
            lap: leg.lap,
            fmt: leg.targetFormat,
            text: leg.material.serializedOutput,
            node: JSON.stringify(leg.material.sourceNode, null, 2),
          });
          artifacts.push({
            lap: leg.lap,
            fmt: leg.targetFormat,
            text: leg.material.serializedOutput,
            node: make_string(leg.material.parsedNode),
          });
        }
      }
      if (verbose && lap.completed) {
        trace.push({ step: `lap ${lap.lap + 1}/${direction.requestedLaps} end`, ok: true });
      }
    }
    if (marks !== undefined) {
      for (const checkpoint of direction.checkpoints ?? []) {
        marks.push({
          lap: checkpoint.lap,
          fmt: checkpoint.targetFormat,
          phase: checkpoint.phase === "closure" ? "closure" : "parse",
          node: checkpoint.node,
        });
      }
    }
    if (direction.laps === undefined) {
      for (const failure of direction.failures) append_failure(failure, entry, failures, trace, verbose);
    } else {
      for (const failure of direction.failures) {
        if (failure.stage === "cancel") append_failure(failure, entry, failures, trace, verbose);
      }
    }
  }

  if (result.executionFailure !== undefined) {
    append_failure(result.executionFailure, entry, failures, trace, verbose);
  }

  const finalComparison = result.finalComparison;
  if (finalComparison?.performed === true) {
    if (finalComparison.failure !== undefined) {
      append_failure(finalComparison.failure, entry, failures, trace, verbose);
    } else if (verbose) {
      trace.push({ step: "dual:finalNode cw == ccw", ok: true });
      if (opts.paranoid) {
        trace.push({ step: `paranoid:${finalComparison.paranoidComparisons} strict checkpoint comparisons`, ok: true });
      }
    }
  }
  return Object.freeze({ artifacts, marks });
}

/**
 * Runs the browser-backed circuit synchronously through the strict staged
 * engine. Omitted `stopOnFirstFail` is fail-fast (`true`); callers requesting
 * exhaustive independent diagnostics must pass `false` explicitly.
 */
export function _circuit_test(atom: FixtureAtom, opts: LoopOpts = {}): LoopReport {
  const trace: Step[] = [];
  const failures: Step[] = [];
  const core: Pick<CoreOpt, "trace" | "failures" | "verbose" | "stopOnFirstFail"> = {
    trace,
    failures,
    verbose: opts.verbose === true,
    stopOnFirstFail: opts.stopOnFirstFail ?? true,
  };
  const dual = opts.dual ?? true;
  const times = clamp_int(opts.times ?? 3, 1, 10_000);
  const requestedEntry: SourceFormat = opts.entry ?? "auto";
  const resolved = resolve_entry(atom, requestedEntry, core);
  if (resolved === undefined) {
    return finalize(false, times, dual ? "dual" : opts.dir ?? "cw", requestedEntry, trace, failures);
  }

  const direction: CircuitDirection = opts.dir ?? "cw";
  const result = execute_circuit(
    BROWSER_CIRCUIT_BOUNDARY,
    resolved.fmt,
    resolved.text,
    { times, dual, direction },
    {
      capture: opts.capture === true,
      verbose: opts.verbose === true,
      paranoid: opts.paranoid === true,
      stopOnFirstFail: opts.stopOnFirstFail ?? true,
    },
  );
  const material = collect_report_material(result, resolved.fmt, opts, trace, failures);
  const cw = result.directions.find((item) => item.direction === "cw");
  const ccw = result.directions.find((item) => item.direction === "ccw");
  const selected = dual ? cw : result.directions[0];
  const final = selected === undefined
    ? undefined
    : { fmt: selected.final.format, text: selected.final.text };
  const dualFinals = cw === undefined || ccw === undefined
    ? undefined
    : {
        cw: { fmt: cw.final.format, text: cw.final.text },
        ccw: { fmt: ccw.final.format, text: ccw.final.text },
      };

  return finalize(
    result.ok,
    times,
    dual ? "dual" : direction,
    requestedEntry,
    trace,
    failures,
    material.artifacts,
    material.marks,
    final,
    dualFinals,
  );
}

function looks_like_json(source: string): boolean {
  const text = source.trim();
  if (!text) return false;
  const first = text[0]!;
  if (first === "{" || first === "[") return true;
  if (first === `"` || first === "-" || (first >= "0" && first <= "9")) return true;
  return text === "true" || text === "false" || text === "null";
}

function looks_like_hson(source: string): boolean {
  const text = source.trim();
  if (!text) return false;
  return /[«»]/.test(text)
    || /(?:^|\n)\s*\/?>\s*(?:\/\/.*)?(?:\n|$)/.test(text)
    || /(?:^|\n)\s*"\s*/.test(text)
    || /<>\s*/.test(text);
}

function looks_like_html(source: string): boolean {
  const text = source.trim();
  return text.length > 0 && ( /^<\s*[A-Za-z_!/?]/.test(text) || /<\s*[A-Za-z_!/?]/.test(text) );
}

function is_json_source_text(source: string): boolean {
  const text = source.trim();
  if (!looks_like_json(text)) return false;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function resolve_entry(
  atom: FixtureAtom,
  entry: SourceFormat,
  opt: Pick<CoreOpt, "trace" | "failures" | "verbose" | "stopOnFirstFail">,
): { fmt: Fmt; text: string } | undefined {
  if (entry !== "auto") return coerce_entry(atom, entry, opt);

  if (is_Node(atom)) {
    try {
      return { fmt: "hson", text: SPIN.hson.emit(atom) };
    } catch (error) {
      step_fail(opt, "emit:node->hson(entry)", err_to_string(error));
      return undefined;
    }
  }
  if (is_html_element(atom)) return { fmt: "html", text: atom.outerHTML };
  if (typeof atom !== "string") return { fmt: "json", text: JSON.stringify(atom) };

  const source = atom.trim();
  const likeJson = looks_like_json(source);
  const likeHson = looks_like_hson(source);
  const likeHtml = looks_like_html(source);

  if (likeJson) {
    if (!is_json_source_text(source)) {
      step_fail(opt, "resolve_entry:auto", "Looks like JSON but JSON.parse failed (invalid JSON)");
      return undefined;
    }
    try {
      SPIN.json.parse(source);
      return { fmt: "json", text: source };
    } catch (error) {
      step_fail(opt, "resolve_entry:auto", `Looks like JSON but JSON parse failed: ${err_to_string(error)}`);
      return undefined;
    }
  }

  if (source.includes("</")) {
    try {
      SPIN.html.parse(source);
      return { fmt: "html", text: source };
    } catch (error) {
      step_fail(opt, "resolve_entry:auto", `Contains '</' but HTML parse failed: ${err_to_string(error)}`);
      return undefined;
    }
  }

  let hsonError: unknown;
  if (likeHson || likeHtml) {
    try {
      SPIN.hson.parse(source);
      return { fmt: "hson", text: source };
    } catch (error) {
      hsonError = error;
      step_meh(opt, `resolve_entry:auto:hson-failed - ${err_to_string(error)}\n... trying html`);
    }
  }

  if (likeHtml) {
    try {
      SPIN.html.parse(source);
      return { fmt: "html", text: source };
    } catch (error) {
      step_fail(opt, "resolve_entry:auto", [
        "Markup-like input failed Hson parse, then failed HTML parse.",
        `Hson: ${err_to_string(hsonError)}`,
        `HTML: ${err_to_string(error)}`,
      ].join("\n"));
      return undefined;
    }
  }

  step_fail(opt, "resolve_entry:auto", `Markup-like input failed Hson parse: ${err_to_string(hsonError)}`);
  return undefined;
}
