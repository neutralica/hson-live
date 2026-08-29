import type { JsonValue } from "../../core/types.js";
import type {
  ClassifiedLiveMap,
  DocumentLiveMap,
  LiveMap,
  LiveMapAuthority,
  LiveMapRootMode,
} from "../../types/livemap.types.js";
import type {
  LocusClient,
  LocusClientOptions,
  LocusRecoveryPlanner,
  LocusSelector,
  LocusSnapshotEnvelope,
} from "../../types/locus.types.js";
import { make_classified_livemap } from "../livemap/livemap.core.js";
import { parse_hson } from "../transform/parsers/parse-hson.js";
import { parse_json } from "../transform/parsers/parse-json.js";
import { json_value_from_node } from "../transform/serializers/serialize-json.js";
import { serialize_hson } from "../transform/serializers/serialize-hson.js";
import { detach_hson_root_value } from "../transform/utils/node-utils/detach-hson-root-value.js";
import { create_locus_client } from "./locus.client.js";
import { decode_locus_document_snapshot } from "./locus.document-snapshot.js";

export const LOCUS_BOOTSTRAP_FORMAT = "hson-locus-bootstrap" as const;
export const LOCUS_BOOTSTRAP_MEDIA_TYPE = "application/vnd.hson-live.locus-bootstrap+hson" as const;
export const DEFAULT_LOCUS_BOOTSTRAP_MAX_BYTES = 1024 * 1024;
export const DEFAULT_LOCUS_BOOTSTRAP_MAX_GRAPH_DEPTH = 256;
export const DEFAULT_LOCUS_BOOTSTRAP_MAX_GRAPH_NODES = 100_000;

export type LocusBootstrapState = Readonly<{
  format: "hson";
  payload: string;
}>;

export type LocusBootstrapContinuation = Readonly<{
  transport: "websocket";
  endpoint: string;
  capabilities: Readonly<{ hsonSnapshots: true }>;
}>;

export type LocusBootstrap = Readonly<{
  format: typeof LOCUS_BOOTSTRAP_FORMAT;
  locusSelector: LocusSelector;
  logicalMapId: string;
  incarnationId: string;
  mode: LiveMapRootMode;
  rev: number;
  state: LocusBootstrapState;
  continuation: LocusBootstrapContinuation;
}>;

export type LocusBootstrapCodecOptions = Readonly<{
  maxBytes?: number;
  maxGraphDepth?: number;
  maxGraphNodes?: number;
}>;

export type LocusBootstrapErrorCode =
  | "LOCUS_BOOTSTRAP_MALFORMED_HSON"
  | "LOCUS_BOOTSTRAP_ENVELOPE_INVALID"
  | "LOCUS_BOOTSTRAP_FORMAT_UNSUPPORTED"
  | "LOCUS_BOOTSTRAP_SELECTOR_INVALID"
  | "LOCUS_BOOTSTRAP_IDENTITY_INVALID"
  | "LOCUS_BOOTSTRAP_REVISION_INVALID"
  | "LOCUS_BOOTSTRAP_MODE_INVALID"
  | "LOCUS_BOOTSTRAP_STATE_INVALID"
  | "LOCUS_BOOTSTRAP_CONTINUATION_INVALID"
  | "LOCUS_BOOTSTRAP_TOO_LARGE"
  | "LOCUS_BOOTSTRAP_GRAPH_LIMIT_EXCEEDED"
  | "LOCUS_BOOTSTRAP_CAPTURE_FAILED";

export class LocusBootstrapError extends Error {
  public constructor(
    public readonly code: LocusBootstrapErrorCode,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "LocusBootstrapError";
  }
}

export type LocusBootstrapInstall = Readonly<{
  bootstrap: LocusBootstrap;
  map: ClassifiedLiveMap;
  recovery: Readonly<{
    logicalMapId: string;
    cursor: Readonly<{ incarnationId: string; lastAppliedRev: number }>;
  }>;
}>;

/** Minimum authority surface required for one canonical bootstrap cut. */
export type LocusBootstrapAuthority = Readonly<{
  stream: Readonly<{ logicalMapId: string }>;
  recovery: LocusRecoveryPlanner;
}>;

export type LocusBootstrapClient<TMap extends LiveMapAuthority = ClassifiedLiveMap> = Readonly<{
  bootstrap: LocusBootstrap;
  map: TMap;
  readonly status:
    | "installed"
    | "socket-connecting"
    | "recovering"
    | "live"
    | "failed"
    | "disposed";
  readonly failure: unknown;
  client: LocusClient<TMap>;
  connect_and_recover(): Promise<Readonly<{
    status: "live";
    strategy: "current" | "replay" | "snapshot";
    headRev: number;
  }>>;
  dispose(): void;
}>;

const textEncoder = new TextEncoder();
function is_mode(value: unknown): value is LiveMapRootMode {
  return value === "data-object"
    || value === "data-array"
    || value === "element"
    || value === "fragment";
}

function is_revision(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value >= 0;
}

function is_document_map(map: ClassifiedLiveMap): map is DocumentLiveMap {
  return map.mode === "element" || map.mode === "fragment";
}

function is_data_map(map: ClassifiedLiveMap): map is LiveMap<JsonValue | undefined> {
  return map.mode === "data-object" || map.mode === "data-array";
}

function limit(value: number | undefined, fallback: number, name: string): number {
  const selected = value ?? fallback;
  if (!Number.isInteger(selected) || selected <= 0) {
    throw new LocusBootstrapError(
      "LOCUS_BOOTSTRAP_ENVELOPE_INVALID",
      `Locus bootstrap ${name} must be a positive integer.`,
    );
  }
  return selected;
}

function exact_record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new LocusBootstrapError(
      "LOCUS_BOOTSTRAP_ENVELOPE_INVALID",
      "Locus bootstrap envelope must be an object.",
    );
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new LocusBootstrapError(
      "LOCUS_BOOTSTRAP_ENVELOPE_INVALID",
      "Locus bootstrap envelope has an invalid prototype.",
    );
  }
  return value as Readonly<Record<string, unknown>>;
}

function require_keys(record: Readonly<Record<string, unknown>>, keys: readonly string[]): void {
  const actual = Object.keys(record);
  if (actual.length !== keys.length || !actual.every((key) => keys.includes(key))) {
    throw new LocusBootstrapError(
      "LOCUS_BOOTSTRAP_ENVELOPE_INVALID",
      "Locus bootstrap envelope contains missing or unexpected fields.",
    );
  }
}

function bounded_string(value: unknown, max: number): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= max
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function valid_websocket_endpoint(value: unknown): value is string {
  if (!bounded_string(value, 2048)) return false;
  try {
    const resolved = new URL(value, "ws://locus-bootstrap.invalid/");
    return (resolved.protocol === "ws:" || resolved.protocol === "wss:")
      && resolved.username === ""
      && resolved.password === "";
  } catch {
    return false;
  }
}

function validate_graph_limits(
  value: unknown,
  options: LocusBootstrapCodecOptions,
): void {
  const maxDepth = limit(options.maxGraphDepth, DEFAULT_LOCUS_BOOTSTRAP_MAX_GRAPH_DEPTH, "graph depth limit");
  const maxNodes = limit(options.maxGraphNodes, DEFAULT_LOCUS_BOOTSTRAP_MAX_GRAPH_NODES, "graph node limit");
  let nodes = 0;
  const visit = (current: unknown, depth: number): void => {
    nodes += 1;
    if (nodes > maxNodes || depth > maxDepth) {
      throw new LocusBootstrapError(
        "LOCUS_BOOTSTRAP_GRAPH_LIMIT_EXCEEDED",
        "Locus bootstrap graph exceeds its configured limits.",
      );
    }
    if (typeof current !== "object" || current === null) return;
    if (Array.isArray(current)) {
      for (const item of current) visit(item, depth + 1);
      return;
    }
    for (const item of Object.values(current)) visit(item, depth + 1);
  };
  visit(value, 0);
}

type LocusBootstrapSnapshotEnvelope = Extract<LocusSnapshotEnvelope, { hson: string }>;

function snapshot_from_bootstrap(bootstrap: LocusBootstrap): LocusBootstrapSnapshotEnvelope {
  return Object.freeze({
    logicalMapId: bootstrap.logicalMapId,
    incarnationId: bootstrap.incarnationId,
    rev: bootstrap.rev,
    mode: bootstrap.mode,
    hson: bootstrap.state.payload,
  });
}

/**
 * Capture the one-map authority cut required for bootstrap recovery.
 *
 * This deliberately knows nothing about selector routing or continuation
 * delivery. The recovery planner remains the sole source of canonical map
 * identity, revision, mode, and Hson state.
 */
function with_locus_bootstrap_snapshot<T>(
  authority: LocusBootstrapAuthority,
  useSnapshot: (snapshot: LocusBootstrapSnapshotEnvelope) => T,
): T {
  let plan;
  try {
    plan = authority.recovery.plan({ logicalMapId: authority.stream.logicalMapId });
    if (plan.outcome !== "snapshot") {
      throw new Error("A bootstrap capture did not produce the required canonical Hson snapshot.");
    }
    if (!("hson" in plan.body)) {
      throw new Error("A bootstrap capture did not produce the required canonical Hson snapshot.");
    }
    return useSnapshot(plan.body);
  } finally {
    if (plan !== undefined && plan.outcome !== "reject") plan.dispose();
  }
}

/** Application/runtime-owned routing and continuation inputs for one bootstrap. */
type LocusBootstrapRoutingIngredients = Readonly<{
  locusSelector: LocusSelector;
  websocketEndpoint: string;
}>;

/** The only construction point that combines authority state with delivery metadata. */
function assemble_locus_bootstrap(
  snapshot: LocusBootstrapSnapshotEnvelope,
  routing: LocusBootstrapRoutingIngredients,
): LocusBootstrap {
  return Object.freeze({
    format: LOCUS_BOOTSTRAP_FORMAT,
    locusSelector: routing.locusSelector,
    logicalMapId: snapshot.logicalMapId,
    incarnationId: snapshot.incarnationId,
    mode: snapshot.mode,
    rev: snapshot.rev,
    state: Object.freeze({ format: "hson", payload: snapshot.hson }),
    continuation: Object.freeze({
      transport: "websocket",
      endpoint: routing.websocketEndpoint,
      capabilities: Object.freeze({ hsonSnapshots: true }),
    }),
  });
}

function map_from_snapshot(
  snapshot: LocusBootstrapSnapshotEnvelope,
  options: LocusBootstrapCodecOptions,
): ClassifiedLiveMap {
  let root;
  try {
    root = parse_hson(snapshot.hson, { allowTopLevelTextFragment: true });
  } catch (cause) {
    throw new LocusBootstrapError(
      "LOCUS_BOOTSTRAP_STATE_INVALID",
      "Locus bootstrap state Hson is malformed.",
      cause,
    );
  }
  validate_graph_limits(root, options);
  let map: ClassifiedLiveMap;
  try {
    map = make_classified_livemap(root);
  } catch (cause) {
    throw new LocusBootstrapError(
      "LOCUS_BOOTSTRAP_STATE_INVALID",
      "Locus bootstrap state is not a canonical LiveMap graph.",
      cause,
    );
  }
  if (map.mode !== snapshot.mode) {
    throw new LocusBootstrapError(
      "LOCUS_BOOTSTRAP_STATE_INVALID",
      "Locus bootstrap state mode does not match its envelope.",
    );
  }
  try {
    if (is_data_map(map)) {
      const capture = map.capture();
      map.restore(Object.freeze({
        rev: snapshot.rev,
        format: capture.format,
        payload: capture.payload,
        root: capture.root,
      }));
    } else if (is_document_map(map)) {
      const capture = decode_locus_document_snapshot(snapshot);
      map.restore(capture, { identity: "preserve-metadata" });
    } else {
      throw new Error("Locus bootstrap reconstructed an unsupported map mode.");
    }
  } catch (cause) {
    throw new LocusBootstrapError(
      "LOCUS_BOOTSTRAP_STATE_INVALID",
      "Locus bootstrap state could not be installed.",
      cause,
    );
  }
  return map;
}

function validate_package(
  value: unknown,
  options: LocusBootstrapCodecOptions,
): LocusBootstrap {
  const record = exact_record(value);
  require_keys(record, [
    "format",
    "locusSelector",
    "logicalMapId",
    "incarnationId",
    "mode",
    "rev",
    "state",
    "continuation",
  ]);
  if (record.format !== LOCUS_BOOTSTRAP_FORMAT) {
    throw new LocusBootstrapError(
      "LOCUS_BOOTSTRAP_FORMAT_UNSUPPORTED",
      "Locus bootstrap format is unsupported.",
    );
  }
  if (!bounded_string(record.locusSelector, 512)) {
    throw new LocusBootstrapError(
      "LOCUS_BOOTSTRAP_SELECTOR_INVALID",
      "Locus bootstrap selector is invalid.",
    );
  }
  if (!bounded_string(record.logicalMapId, 512) || !bounded_string(record.incarnationId, 512)) {
    throw new LocusBootstrapError(
      "LOCUS_BOOTSTRAP_IDENTITY_INVALID",
      "Locus bootstrap canonical identity is invalid.",
    );
  }
  if (!is_revision(record.rev)) {
    throw new LocusBootstrapError(
      "LOCUS_BOOTSTRAP_REVISION_INVALID",
      "Locus bootstrap revision is invalid.",
    );
  }
  if (!is_mode(record.mode)) {
    throw new LocusBootstrapError(
      "LOCUS_BOOTSTRAP_MODE_INVALID",
      "Locus bootstrap map mode is invalid.",
    );
  }
  const state = exact_record(record.state);
  require_keys(state, ["format", "payload"]);
  if (state.format !== "hson" || typeof state.payload !== "string") {
    throw new LocusBootstrapError(
      "LOCUS_BOOTSTRAP_STATE_INVALID",
      "Locus bootstrap state encoding is invalid.",
    );
  }
  const continuation = exact_record(record.continuation);
  require_keys(continuation, ["transport", "endpoint", "capabilities"]);
  const capabilities = exact_record(continuation.capabilities);
  require_keys(capabilities, ["hsonSnapshots"]);
  if (
    continuation.transport !== "websocket"
    || !valid_websocket_endpoint(continuation.endpoint)
    || capabilities.hsonSnapshots !== true
  ) {
    throw new LocusBootstrapError(
      "LOCUS_BOOTSTRAP_CONTINUATION_INVALID",
      "Locus bootstrap continuation metadata is invalid.",
    );
  }

  const bootstrap: LocusBootstrap = Object.freeze({
    format: LOCUS_BOOTSTRAP_FORMAT,
    locusSelector: record.locusSelector,
    logicalMapId: record.logicalMapId,
    incarnationId: record.incarnationId,
    mode: record.mode,
    rev: record.rev,
    state: Object.freeze({ format: "hson", payload: state.payload }),
    continuation: Object.freeze({
      transport: "websocket",
      endpoint: continuation.endpoint,
      capabilities: Object.freeze({ hsonSnapshots: true }),
    }),
  });
  map_from_snapshot(snapshot_from_bootstrap(bootstrap), options);
  return bootstrap;
}

/** Encode one fully validated current HTTP bootstrap package as canonical Hson text. */
export function encode_locus_bootstrap(
  bootstrap: LocusBootstrap,
  options: LocusBootstrapCodecOptions = {},
): string {
  const validated = validate_package(bootstrap, options);
  const representation: JsonValue = {
    format: validated.format,
    locusSelector: validated.locusSelector,
    logicalMapId: validated.logicalMapId,
    incarnationId: validated.incarnationId,
    mode: validated.mode,
    rev: validated.rev,
    state: {
      format: validated.state.format,
      payload: validated.state.payload,
    },
    continuation: {
      transport: validated.continuation.transport,
      endpoint: validated.continuation.endpoint,
      capabilities: {
        hsonSnapshots: validated.continuation.capabilities.hsonSnapshots,
      },
    },
  };
  const encoded = serialize_hson(
    detach_hson_root_value(parse_json(representation)),
    { noBreak: true },
  );
  const maxBytes = limit(options.maxBytes, DEFAULT_LOCUS_BOOTSTRAP_MAX_BYTES, "byte limit");
  if (textEncoder.encode(encoded).byteLength > maxBytes) {
    throw new LocusBootstrapError(
      "LOCUS_BOOTSTRAP_TOO_LARGE",
      "Locus bootstrap package exceeds its configured byte limit.",
    );
  }
  return encoded;
}

/** Decode and completely validate one current HTTP bootstrap package. */
export function decode_locus_bootstrap(
  encoded: string,
  options: LocusBootstrapCodecOptions = {},
): LocusBootstrap {
  const maxBytes = limit(options.maxBytes, DEFAULT_LOCUS_BOOTSTRAP_MAX_BYTES, "byte limit");
  if (textEncoder.encode(encoded).byteLength > maxBytes) {
    throw new LocusBootstrapError(
      "LOCUS_BOOTSTRAP_TOO_LARGE",
      "Locus bootstrap package exceeds its configured byte limit.",
    );
  }
  let value: JsonValue;
  try {
    value = json_value_from_node(parse_hson(encoded));
  } catch (cause) {
    throw new LocusBootstrapError(
      "LOCUS_BOOTSTRAP_MALFORMED_HSON",
      "Locus bootstrap package is malformed Hson.",
      cause,
    );
  }
  return validate_package(value, options);
}

/** Capture a single exact authority cut using the established recovery planner. */
export function capture_locus_bootstrap(
  authority: LocusBootstrapAuthority,
  locusSelector: LocusSelector,
  websocketEndpoint: string,
  options: LocusBootstrapCodecOptions = {},
): LocusBootstrap {
  try {
    return with_locus_bootstrap_snapshot(authority, (snapshot) => {
      const bootstrap = assemble_locus_bootstrap(snapshot, {
        locusSelector,
        websocketEndpoint,
      });
      validate_package(bootstrap, options);
      return bootstrap;
    });
  } catch (cause) {
    if (cause instanceof LocusBootstrapError) throw cause;
    throw new LocusBootstrapError(
      "LOCUS_BOOTSTRAP_CAPTURE_FAILED",
      "Locus authority bootstrap capture failed.",
      cause,
    );
  }
}

/** Install a validated detached mirror and its exact existing-recovery cursor. */
export function install_locus_bootstrap(
  bootstrap: LocusBootstrap,
  options: LocusBootstrapCodecOptions = {},
): LocusBootstrapInstall {
  const validated = validate_package(bootstrap, options);
  const map = map_from_snapshot(snapshot_from_bootstrap(validated), options);
  return Object.freeze({
    bootstrap: validated,
    map,
    recovery: Object.freeze({
      logicalMapId: validated.logicalMapId,
      cursor: Object.freeze({
        incarnationId: validated.incarnationId,
        lastAppliedRev: validated.rev,
      }),
    }),
  });
}

/** Create the existing Locus client around an installed bootstrap mirror. */
export function create_locus_bootstrap_client<TMap extends LiveMapAuthority>(
  install: LocusBootstrapInstall & Readonly<{ map: TMap }>,
  options: Omit<LocusClientOptions<TMap>, "map" | "recovery">,
): LocusBootstrapClient<TMap> {
  const client = create_locus_client({
    ...options,
    map: install.map,
    recovery: install.recovery,
  });
  let disposed = false;
  let connected = false;
  let status: LocusBootstrapClient<TMap>["status"] = "installed";
  let failure: unknown;
  const result: LocusBootstrapClient<TMap> = {
    bootstrap: install.bootstrap,
    map: install.map,
    get status() {
      return status;
    },
    get failure() {
      return failure;
    },
    client,
    async connect_and_recover() {
      if (disposed) throw new Error("Locus bootstrap client is disposed.");
      try {
        if (!connected) {
          status = "socket-connecting";
          client.connect();
          connected = true;
        }
        status = "recovering";
        const recovered = await client.recovery.recover();
        status = "live";
        return Object.freeze({
          status: "live" as const,
          strategy: recovered.strategy,
          headRev: recovered.headRev,
        });
      } catch (cause) {
        failure = cause;
        status = "failed";
        throw cause;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      status = "disposed";
      client.recovery.dispose();
      client.session.dispose();
      client.disconnect();
      options.socket.close(1000, "Locus bootstrap client disposed.");
    },
  };
  return Object.freeze(result);
}
