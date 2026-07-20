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

export class LiveMapDocumentInstallError extends Error {
  readonly code = "INVALID_DOCUMENT_INSTALL" as const;
  readonly reason: string;

  constructor(reason: string, options?: ErrorOptions) {
    super(`Invalid LiveMap document install: ${reason}`, options);
    this.name = "LiveMapDocumentInstallError";
    this.reason = reason;
  }
}

export type LiveMapDocumentMutationErrorCode =
  | "INVALID_DOCUMENT_TARGET"
  | "DOCUMENT_TARGET_NOT_FOUND"
  | "DOCUMENT_TARGET_KIND"
  | "INVALID_DOCUMENT_PATH"
  | "DOCUMENT_PATH_OUT_OF_RANGE"
  | "INVALID_DOCUMENT_ATTRIBUTE_NAME"
  | "INVALID_DOCUMENT_ATTRIBUTE_VALUE"
  | "PROTECTED_DOCUMENT_METADATA"
  | "INVALID_DOCUMENT_CONTENT_INDEX"
  | "INVALID_DOCUMENT_REPLACEMENT"
  | "INVALID_DOCUMENT_IDENTITY"
  | "DOCUMENT_MODE_MISMATCH";

export class LiveMapDocumentMutationError extends Error {
  readonly code: LiveMapDocumentMutationErrorCode;
  readonly operation:
    | "set-attr"
    | "remove-attr"
    | "replace-content"
    | "insert-content"
    | "remove-content"
    | "move-content";
  readonly reason: string;

  constructor(
    code: LiveMapDocumentMutationErrorCode,
    operation: LiveMapDocumentMutationError["operation"],
    reason: string,
    options?: ErrorOptions,
  ) {
    super(`Invalid LiveMap document ${operation}: ${reason}`, options);
    this.name = "LiveMapDocumentMutationError";
    this.code = code;
    this.operation = operation;
    this.reason = reason;
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
