import { HsonNode } from "../core/types.js";

/**
 * Canonical wire formats exercised by the round-trip loop.
 */

export type Fmt = "json" | "html" | "hson";
/**
 * Entry format selector for `_circuit_test`.
 *
 * `auto` attempts to infer the format from the input atom.
 */
export type SourceFormat = Fmt | "auto" | "node" | "dom";
/**
 * Direction of traversal around the JSON ↔ HTML ↔ HSON ring.
 */
export type LoopDir = "cw" | "ccw";
/**
 * Options controlling `_circuit_test`.
 */

export type LoopOpts = {
  times?: number; // default 3
  dir?: LoopDir; // default "cw" (only used when dual=false)
  entry?: SourceFormat; // default "auto"
  verbose?: boolean; // default false; when true, include trace
  stopOnFirstFail?: boolean; // default true
  capture?: boolean; // capture emitted artifacts (strings)
  dual?: boolean; //  run both cw + ccw and compare final nodes (default true)
  paranoid?: boolean; // also compare per-step parsed nodes across dirs (requires captureNodes)
};
/**
 * Single trace/failure record produced during a run.
 */

export type Step = { step: string; ok: boolean; error?: string; };
/**
 * Captured emission snapshot (text + stringified node) for a single step.
 */

export type Artifact = {
  lap: number;
  fmt: Fmt;
  text: string;
  node: string;
  label?: string;


};
/**
 * Captured parsed node at a specific lap/format/phase.
 */

export type NodeMark = {
  lap: number;
  fmt: Fmt;
  phase: "parse" | "closure";
  node: HsonNode;
};
/**
 * Summary report returned by `_circuit_test`.
 */

export type LoopReport = {
  ok: boolean;
  times: number;
  dir: LoopDir | "dual" | "oneway"; 
  entry: SourceFormat;
  label?: string;
  failures: Step[];
  trace?: Step[];

  artifacts?: Artifact[]; // emitted strings
  marks?: NodeMark[]; // parsed nodes (only when paranoid/captureNodes)

  final?: { fmt: Fmt; text: string; };

  // dual summary
  dualFinals?: {
    cw: { fmt: Fmt; text: string; };
    ccw: { fmt: Fmt; text: string; };
  };
};
/**
 * Input accepted by `_circuit_test`.
 */

export type FixtureAtom = string |
  number |
  boolean |
  null |
  object |
  HTMLElement |
  HsonNode;
/* =========================================================================
 * CORE LOOP — sequential and readable
 * ========================================================================= */
export type CoreOpt = {
  trace: Step[];
  failures: Step[];
  verbose: boolean;
  stopOnFirstFail?: boolean;

  capture?: { artifacts: Artifact[]; }; // emitted text artifacts
  marks?: { nodes: NodeMark[]; }; //  parsed-node marks for paranoid mode
};
export type RunResult = {
  ok: boolean;
  final: { fmt: Fmt; text: string; };
  finalNode: HsonNode; // needed for dual compare
};
