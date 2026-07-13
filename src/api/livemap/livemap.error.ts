// livemap.error.ts

import type { LivePath } from "./livemap.index.js";
import {
  clone_live_path,
  format_live_path,
} from "./livemap.path.js";
import type { LiveMapSchemaIssue } from "./livemap.schema.js";
import type { JsonValue } from "../../core/types.js";

export class LiveMapSchemaError extends Error {
  readonly code = "SCHEMA_VALIDATION" as const;
  readonly path: LivePath;
  readonly issues: readonly LiveMapSchemaIssue[];

  constructor(
    message: string,
    path: LivePath,
    issues: readonly LiveMapSchemaIssue[],
  ) {
    super(message);

    this.name = "LiveMapSchemaError";
    this.path = clone_live_path(path);
    this.issues = Object.freeze([...issues]);
  }
}

export class LiveMapRevError extends Error {
  readonly code = "STALE_REV" as const;
  readonly expectedRev: number;
  readonly actualRev: number;

  constructor(
    expectedRev: number,
    actualRev: number,
  ) {
    super(
      `LiveMap revision mismatch: expected ${expectedRev}, actual ${actualRev}`,
    );

    this.name = "LiveMapRevError";
    this.expectedRev = expectedRev;
    this.actualRev = actualRev;
  }
}

export class LiveMapReplayError extends Error {
  readonly code = "REPLAY_CONFLICT" as const;
  readonly path: LivePath;
  readonly expected: JsonValue | undefined;
  readonly actual: JsonValue | undefined;

  constructor(
    path: LivePath,
    expected: JsonValue | undefined,
    actual: JsonValue | undefined,
  ) {
    super(
      `LiveMap replay conflict at ${format_live_path(path)}: expected ${JSON.stringify(expected)}, actual ${JSON.stringify(actual)}`,
    );

    this.name = "LiveMapReplayError";
    this.path = clone_live_path(path);
    this.expected = expected;
    this.actual = actual;
  }
}

export class LiveMapReplayInputError extends Error {
  readonly code = "INVALID_REPLAY" as const;
  readonly reason: string;
  readonly opIndex: number | undefined;

  constructor(
    reason: string,
    opIndex?: number,
  ) {
    super(
      opIndex === undefined
        ? `Invalid LiveMap replay: ${reason}`
        : `Invalid LiveMap replay operation ${opIndex}: ${reason}`,
    );

    this.name = "LiveMapReplayInputError";
    this.reason = reason;
    this.opIndex = opIndex;
  }
}
