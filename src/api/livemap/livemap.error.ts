// livemap.error.ts

import type { LivePath } from "./livemap.index.js";
import {
  clone_live_path,
  format_live_path,
} from "./livemap.path.js";
import type { HsonSchemaIssueCode } from "../../types/livemap.types.js";
import type { JsonValue } from "../../core/types.js";
import type { LiveMapDocumentRequestTarget } from "../../types/livemap.types.js";
import type {
  ProjectedValueAdmissionCode,
  ProjectedValuePath,
} from "../../core/projected-value-admission.js";
import { ProjectedValueAdmissionError } from "../../core/projected-value-admission.js";
import type { OrderedProjectedValue } from "../../core/ordered-projected-value.js";
import { materialize_projected_value } from "../../core/projected-value-materialization.js";
import { emit_ordered_json } from "../transform/utils/json-utils/ordered-json.js";

/** Structured public-mutation failure backed by neutral data admission. */
export class LiveMapProjectedValueError extends TypeError {
  readonly code = "INVALID_PROJECTED_VALUE" as const;
  readonly reasonCode: ProjectedValueAdmissionCode;
  readonly path: ProjectedValuePath;
  readonly originPath: ProjectedValuePath | undefined;

  constructor(admission: ProjectedValueAdmissionError) {
    super(
      `LiveMap value is not JSON at ${format_live_path(admission.path)}`,
      { cause: admission },
    );
    this.name = "LiveMapProjectedValueError";
    this.reasonCode = admission.code;
    this.path = Object.freeze([...admission.path]);
    this.originPath = admission.originPath === undefined
      ? undefined
      : Object.freeze([...admission.originPath]);
  }
}

export type LiveMapProjectedMutationErrorCode =
  | "INVALID_OBJECT_RENAME_SOURCE"
  | "INVALID_OBJECT_RENAME_DESTINATION"
  | "OBJECT_RENAME_SOURCE_NOT_FOUND"
  | "INVALID_ARRAY_MOVE_SOURCE"
  | "INVALID_ARRAY_MOVE_DESTINATION";

/** Stable data helper failure emitted before any canonical publication. */
export class LiveMapProjectedMutationError extends Error {
  readonly path: LivePath;

  constructor(
    readonly code: LiveMapProjectedMutationErrorCode,
    readonly operation: "rename" | "move",
    path: LivePath,
    readonly reason: string,
  ) {
    super(`Invalid LiveMap projected ${operation} at ${format_live_path(path)}: ${reason}`);
    this.name = "LiveMapProjectedMutationError";
    this.path = clone_live_path(path);
  }
}

export type LiveMapProjectedIdentityErrorCode =
  | "PROJECTED_IDENTITY_TARGET_NOT_FOUND"
  | "PROJECTED_IDENTITY_INELIGIBLE"
  | "PROJECTED_IDENTITY_INVARIANT"
  | "PROJECTED_IDENTITY_COLLISION"
  | "PROJECTED_IDENTITY_REUSE"
  | "PROJECTED_IDENTITY_ALLOCATOR_EXHAUSTED";

/** Stable projected-container identity failure emitted before publication. */
export class LiveMapProjectedIdentityError extends Error {
  readonly path: LivePath;

  constructor(
    readonly code: LiveMapProjectedIdentityErrorCode,
    path: LivePath,
    readonly reason: string,
    options?: ErrorOptions,
  ) {
    super(`Invalid LiveMap data identity at ${format_live_path(path)}: ${reason}`, options);
    this.name = "LiveMapProjectedIdentityError";
    this.path = clone_live_path(path);
  }
}

export type HsonSchemaIssue = Readonly<{
  code: HsonSchemaIssueCode;
  path: LivePath;
  message: string;
  expected?: string;
  received?: string;
  attributeName?: string;
}>;

export class HsonSchemaError extends Error {
  readonly code = "SCHEMA_VALIDATION" as const;
  readonly path: LivePath;
  readonly issues: readonly HsonSchemaIssue[];

  constructor(
    message: string,
    path: LivePath,
    issues: readonly HsonSchemaIssue[],
  ) {
    super(message);

    this.name = "HsonSchemaError";
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
  readonly reasonCode: LiveMapDocumentInstallFailureCode;

  constructor(
    reason: string,
    options?: ErrorOptions,
    reasonCode: LiveMapDocumentInstallFailureCode = "MALFORMED_CAPTURE_ENVELOPE",
  ) {
    super(`Invalid LiveMap document install: ${reason}`, options);
    this.name = "LiveMapDocumentInstallError";
    this.reason = reason;
    this.reasonCode = reasonCode;
  }
}

export type LiveMapDocumentInstallFailureCode =
  | "MALFORMED_CAPTURE_ENVELOPE"
  | "DUPLICATE_PRESERVED_CLAIMS"
  | "IDENTITY_POLICY_MISMATCH";

export type LiveMapDocumentIdentityProvenanceErrorCode =
  | "SAME_EPOCH_PROVENANCE_REQUIRED"
  | "STALE_IDENTITY_EPOCH"
  | "FOREIGN_IDENTITY_EPOCH"
  | "IDENTITY_POLICY_MISMATCH"
  | "UNSUPPORTED_CAPTURE_CATEGORY";

/** Stable category/provenance failure without exposing capability internals. */
export class LiveMapDocumentIdentityProvenanceError extends Error {
  constructor(
    readonly code: LiveMapDocumentIdentityProvenanceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LiveMapDocumentIdentityProvenanceError";
  }
}

export type LiveMapDocumentMutationErrorCode =
  | "INVALID_DOCUMENT_TARGET"
  | "DOCUMENT_TARGET_NOT_FOUND"
  | "DOCUMENT_TARGET_KIND"
  | "INVALID_DOCUMENT_PATH"
  | "INVALID_DOCUMENT_PATH_INDEX"
  | "DOCUMENT_PATH_OUT_OF_RANGE"
  | "DOCUMENT_PATH_PRIMITIVE_DESCENT"
  | "INVALID_DOCUMENT_COMMIT_TARGET"
  | "INVALID_DOCUMENT_WITNESS"
  | "DOCUMENT_WITNESS_MISMATCH"
  | "INVALID_DOCUMENT_ATTRIBUTE_NAME"
  | "INVALID_DOCUMENT_ATTRIBUTE_VALUE"
  | "DOCUMENT_ATTRIBUTE_NOT_FOUND"
  | "PROTECTED_DOCUMENT_METADATA"
  | "INVALID_DOCUMENT_CONTENT_INDEX"
  | "INVALID_DOCUMENT_REPLACEMENT"
  | "INVALID_DOCUMENT_IDENTITY"
  | "DOCUMENT_IDENTITY_INELIGIBLE"
  | "DOCUMENT_IDENTITY_COLLISION"
  | "DOCUMENT_IDENTITY_REUSE"
  | "DOCUMENT_IDENTITY_DIFFERENT"
  | "DOCUMENT_MODE_MISMATCH";

export class LiveMapDocumentMutationError extends Error {
  readonly code: LiveMapDocumentMutationErrorCode;
  readonly operation:
    | "set-attr"
    | "remove-attr"
    | "replace-attrs"
    | "get-attr"
    | "has-attr"
    | "list-attrs"
    | "must-get-attr"
    | "replace-content"
    | "insert-content"
    | "remove-content"
    | "move-content"
    | "replace-root"
    | "ensure-quid";
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

export type LiveMapDocumentIdentityRegistrationErrorCode =
  | "LIVEMAP_IDENTITY_ALLOCATOR_EXHAUSTED"
  | "LIVEMAP_IDENTITY_PARTICIPANT_REQUIRED"
  | "LIVEMAP_IDENTITY_PROJECTION_NOT_APPLIED";

/** Stable internal-authority acquisition failure without exposing candidate values. */
export class LiveMapDocumentIdentityRegistrationError extends Error {
  public constructor(
    public readonly code: LiveMapDocumentIdentityRegistrationErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "LiveMapDocumentIdentityRegistrationError";
  }
}

export class LiveMapDocumentAttributeNotFoundError extends LiveMapDocumentMutationError {
  declare readonly code: "DOCUMENT_ATTRIBUTE_NOT_FOUND";
  declare readonly operation: "must-get-attr";
  readonly target: LiveMapDocumentRequestTarget;
  readonly attributeName: string;

  constructor(target: LiveMapDocumentRequestTarget, attributeName: string) {
    super(
      "DOCUMENT_ATTRIBUTE_NOT_FOUND",
      "must-get-attr",
      `ordinary attribute ${JSON.stringify(attributeName)} is absent`,
    );
    this.name = "LiveMapDocumentAttributeNotFoundError";
    this.target = clone_document_target(target);
    this.attributeName = attributeName;
  }
}

function clone_document_target(target: LiveMapDocumentRequestTarget): LiveMapDocumentRequestTarget {
  return target.kind === "path"
    ? Object.freeze({ kind: "path", path: Object.freeze([...target.path]) })
    : Object.freeze({ kind: "quid", quid: target.quid });
}

export class LiveMapReplayError extends Error {
  readonly code = "REPLAY_CONFLICT" as const;
  readonly path: LivePath;
  readonly expected: JsonValue | undefined;
  readonly actual: JsonValue | undefined;
  readonly expectedPayload: string | undefined;
  readonly actualPayload: string | undefined;

  constructor(
    path: LivePath,
    expected: OrderedProjectedValue | undefined,
    actual: OrderedProjectedValue | undefined,
  ) {
    const expectedPayload = expected === undefined ? undefined : emit_ordered_json(expected);
    const actualPayload = actual === undefined ? undefined : emit_ordered_json(actual);
    super(
      `LiveMap replay conflict at ${format_live_path(path)}: expected ${expectedPayload ?? "<absent>"}, actual ${actualPayload ?? "<absent>"}`,
    );

    this.name = "LiveMapReplayError";
    this.path = clone_live_path(path);
    this.expected = expected === undefined ? undefined : materialize_projected_value(expected);
    this.actual = actual === undefined ? undefined : materialize_projected_value(actual);
    this.expectedPayload = expectedPayload;
    this.actualPayload = actualPayload;
  }
}

export class LiveMapProjectedTransportError extends TypeError {
  readonly code = "INVALID_PROJECTED_TRANSPORT" as const;
  readonly context: "apply" | "restore";
  readonly reason: string;

  constructor(context: "apply" | "restore", reason: string, options?: ErrorOptions) {
    super(`Invalid LiveMap ${context} transport: ${reason}`, options);
    this.name = "LiveMapProjectedTransportError";
    this.context = context;
    this.reason = reason;
  }
}

export class LiveMapReplayInputError extends Error {
  readonly code = "INVALID_REPLAY" as const;
  readonly reasonCode:
    | "INVALID_REPLAY_ENVELOPE"
    | "ROOT_OPERATION_COMPOSITION"
    | "UNCHANGED_STAGED_OPERATION"
    | "EMPTY_GRAPH_COMMIT";
  readonly reason: string;
  readonly opIndex: number | undefined;

  constructor(
    reason: string,
    opIndex?: number,
    reasonCode: LiveMapReplayInputError["reasonCode"] = "INVALID_REPLAY_ENVELOPE",
  ) {
    super(
      opIndex === undefined
        ? `Invalid LiveMap replay: ${reason}`
        : `Invalid LiveMap replay operation ${opIndex}: ${reason}`,
    );

    this.name = "LiveMapReplayInputError";
    this.reasonCode = reasonCode;
    this.reason = reason;
    this.opIndex = opIndex;
  }
}

/** One canonical graph operation failed against its ordinal staged graph. */
export class LiveMapDocumentStagingError extends Error {
  readonly code = "DOCUMENT_STAGING_CONFLICT" as const;
  readonly reasonCode: LiveMapDocumentMutationErrorCode;
  readonly opIndex: number;

  constructor(opIndex: number, cause: LiveMapDocumentMutationError) {
    super(
      `Invalid LiveMap replay operation ${opIndex}: ${cause.reason}`,
      { cause },
    );
    this.name = "LiveMapDocumentStagingError";
    this.reasonCode = cause.code;
    this.opIndex = opIndex;
  }
}
