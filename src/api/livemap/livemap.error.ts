// livemap.error.ts

import { LivePath } from "./livemap.index.js";
import { clone_live_path } from "./livemap.path.js";
import { LiveMapSchemaIssue } from "./livemap.schema.js";

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