// livemap.error.ts

import type { LivePath } from "./livemap.index.js";
import { clone_live_path } from "./livemap.path.js";
import type { LiveMapSchemaIssue } from "./livemap.schema.js";

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