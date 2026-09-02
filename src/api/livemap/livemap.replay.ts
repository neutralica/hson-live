import { LiveMapReplayInputError } from "./livemap.error.js";
import {
  decode_livemap_replay_payload,
  LIVEMAP_STRUCTURAL_JSON_FORMAT,
  LiveMapTransportCodecError,
  materialize_livemap_projected_op,
  type LiveMapProjectedDataOp,
} from "./livemap.transport.js";

export type AdmittedLiveMapReplay = Readonly<{
  prevRev: number;
  ops: readonly LiveMapProjectedDataOp[];
}>;

/** Validate and defensively snapshot the canonical structural replay input. */
export function must_livemap_replay(input: unknown): AdmittedLiveMapReplay {
  if (!is_plain_object(input)) {
    throw new LiveMapReplayInputError("envelope is not an object");
  }

  if (!Number.isInteger(input.prevRev) || (input.prevRev as number) < 0) {
    throw new LiveMapReplayInputError("prevRev is not a non-negative integer");
  }

  const reduced = has_exact_keys(input, ["prevRev", "format", "payload"]);
  const fullCommit = has_exact_keys(input, ["changed", "prevRev", "rev", "ops", "format", "payload"]);
  if (!reduced && !fullCommit) {
    throw new LiveMapReplayInputError("envelope is not the canonical structural representation");
  }
  const admitted = must_exact_replay(input);
  if (fullCommit) must_consistent_commit(input, admitted.ops);
  return admitted;
}

function must_consistent_commit(
  input: Readonly<Record<string, unknown>>,
  transportOps: readonly LiveMapProjectedDataOp[],
): void {
  if (typeof input.changed !== "boolean") {
    throw new LiveMapReplayInputError("commit changed is not a boolean");
  }
  if (!Number.isInteger(input.rev) || (input.rev as number) < 0) {
    throw new LiveMapReplayInputError("commit rev is not a non-negative integer");
  }
  const expectedChanged = transportOps.length > 0;
  const expectedRev = expectedChanged ? (input.prevRev as number) + 1 : input.prevRev;
  if (input.changed !== expectedChanged || input.rev !== expectedRev) {
    throw new LiveMapReplayInputError("commit revision fields disagree with its payload");
  }
  if (!Array.isArray(input.ops) || input.ops.length !== transportOps.length) {
    throw new LiveMapReplayInputError("commit ops disagree with its payload");
  }
  for (let index = 0; index < transportOps.length; index += 1) {
    const expected = materialize_livemap_projected_op(transportOps[index]!);
    if (!same_public_value(input.ops[index], expected)) {
      throw new LiveMapReplayInputError("commit ops disagree with its payload", index);
    }
  }
}

function must_exact_replay(input: Readonly<Record<string, unknown>>): AdmittedLiveMapReplay {
  if (input.format !== LIVEMAP_STRUCTURAL_JSON_FORMAT) {
    throw new LiveMapReplayInputError("format is not supported");
  }
  if (typeof input.payload !== "string") {
    throw new LiveMapReplayInputError("payload is not a string");
  }
  try {
    return Object.freeze({
      prevRev: input.prevRev as number,
      ops: decode_livemap_replay_payload(input.payload),
    });
  } catch (error) {
    if (error instanceof LiveMapTransportCodecError) {
      throw new LiveMapReplayInputError(error.reason, error.opIndex);
    }
    throw error;
  }
}

function has_exact_keys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function is_plain_object(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function same_public_value(actual: unknown, expected: unknown): boolean {
  if (Object.is(actual, expected)) return true;
  if (typeof actual !== "object" || actual === null || typeof expected !== "object" || expected === null) {
    return false;
  }
  if (Array.isArray(actual) || Array.isArray(expected)) {
    if (!Array.isArray(actual) || !Array.isArray(expected) || actual.length !== expected.length) return false;
    for (let index = 0; index < expected.length; index += 1) {
      if (!Object.hasOwn(actual, index) || !same_public_value(actual[index], expected[index])) return false;
    }
    return Object.keys(actual).length === expected.length;
  }
  if (!is_plain_object(actual) || !is_plain_object(expected)) return false;
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  if (actualKeys.length !== expectedKeys.length) return false;
  return actualKeys.every((key, index) => key === expectedKeys[index]
    && Object.hasOwn(actual, key)
    && same_public_value(actual[key], expected[key]));
}
