import type { JsonValue } from "../../core/types.js";
import type {
  ClassifiedLiveMap,
  DocumentLiveMap,
  LiveMap,
  LiveMapAuthority,
  LiveMapRootMode,
} from "../../types/livemap.types.js";
import type {
  LiveHostClientForMap,
  LiveHostClientOptionsForMap,
  LiveHostRecoveryPlanner,
  LiveHostSnapshotEnvelope,
} from "../../types/livehost.types.js";
import type { LiveHostRoutingSelector } from "../../types/internal/livehost.routing.types.js";
import { make_classified_livemap } from "../livemap/livemap.core.js";
import { parse_hson } from "../transform/parsers/parse-hson.js";
import { parse_json } from "../transform/parsers/parse-json.js";
import { json_value_from_node } from "../transform/serializers/serialize-json.js";
import { serialize_hson } from "../transform/serializers/serialize-hson.js";
import { detach_hson_root_value } from "../transform/utils/node-utils/detach-hson-root-value.js";
import { create_livehost_client } from "./locus.client.js";
import { decode_livehost_document_snapshot } from "./locus.document-snapshot.js";

export const LIVEHOST_BOOTSTRAP_FORMAT = "hson-livehost-bootstrap" as const;
export const LIVEHOST_BOOTSTRAP_FORMAT_VERSION = 1 as const;
export const LIVEHOST_BOOTSTRAP_MEDIA_TYPE = "application/vnd.hson-live.livehost-bootstrap+hson; version=1" as const;
export const DEFAULT_LIVEHOST_BOOTSTRAP_MAX_BYTES = 1024 * 1024;
export const DEFAULT_LIVEHOST_BOOTSTRAP_MAX_GRAPH_DEPTH = 256;
export const DEFAULT_LIVEHOST_BOOTSTRAP_MAX_GRAPH_NODES = 100_000;

export type LiveHostBootstrapState = Readonly<{
  format: "hson";
  payload: string;
}>;

export type LiveHostBootstrapContinuation = Readonly<{
  transport: "websocket";
  endpoint: string;
  capabilities: Readonly<{ hsonSnapshots: true }>;
}>;

export type LiveHostBootstrapPackageV1 = Readonly<{
  format: typeof LIVEHOST_BOOTSTRAP_FORMAT;
  formatVersion: typeof LIVEHOST_BOOTSTRAP_FORMAT_VERSION;
  authoritySelector: string;
  logicalMapId: string;
  incarnationId: string;
  mode: LiveMapRootMode;
  rev: number;
  state: LiveHostBootstrapState;
  continuation: LiveHostBootstrapContinuation;
}>;

export type LiveHostBootstrapCodecOptions = Readonly<{
  maxBytes?: number;
  maxGraphDepth?: number;
  maxGraphNodes?: number;
}>;

export type LiveHostBootstrapErrorCode =
  | "LIVEHOST_BOOTSTRAP_MALFORMED_HSON"
  | "LIVEHOST_BOOTSTRAP_ENVELOPE_INVALID"
  | "LIVEHOST_BOOTSTRAP_FORMAT_UNSUPPORTED"
  | "LIVEHOST_BOOTSTRAP_VERSION_UNSUPPORTED"
  | "LIVEHOST_BOOTSTRAP_SELECTOR_INVALID"
  | "LIVEHOST_BOOTSTRAP_IDENTITY_INVALID"
  | "LIVEHOST_BOOTSTRAP_REVISION_INVALID"
  | "LIVEHOST_BOOTSTRAP_MODE_INVALID"
  | "LIVEHOST_BOOTSTRAP_STATE_INVALID"
  | "LIVEHOST_BOOTSTRAP_CONTINUATION_INVALID"
  | "LIVEHOST_BOOTSTRAP_TOO_LARGE"
  | "LIVEHOST_BOOTSTRAP_GRAPH_LIMIT_EXCEEDED"
  | "LIVEHOST_BOOTSTRAP_CAPTURE_FAILED";

export class LiveHostBootstrapError extends Error {
  public constructor(
    public readonly code: LiveHostBootstrapErrorCode,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "LiveHostBootstrapError";
  }
}

export type LiveHostBootstrapInstall = Readonly<{
  bootstrap: LiveHostBootstrapPackageV1;
  map: ClassifiedLiveMap;
  recovery: Readonly<{
    logicalMapId: string;
    cursor: Readonly<{ incarnationId: string; lastAppliedRev: number }>;
  }>;
}>;

/** Minimum authority surface required for one canonical bootstrap cut. */
export type LiveHostBootstrapAuthority = Readonly<{
  stream: Readonly<{ logicalMapId: string }>;
  recovery: LiveHostRecoveryPlanner;
}>;

export type LiveHostBootstrapClient<TMap extends LiveMapAuthority = ClassifiedLiveMap> = Readonly<{
  bootstrap: LiveHostBootstrapPackageV1;
  map: TMap;
  readonly status:
    | "installed"
    | "socket-connecting"
    | "recovering"
    | "live"
    | "failed"
    | "disposed";
  readonly failure: unknown;
  client: LiveHostClientForMap<TMap>;
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
    throw new LiveHostBootstrapError(
      "LIVEHOST_BOOTSTRAP_ENVELOPE_INVALID",
      `LiveHost bootstrap ${name} must be a positive integer.`,
    );
  }
  return selected;
}

function exact_record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new LiveHostBootstrapError(
      "LIVEHOST_BOOTSTRAP_ENVELOPE_INVALID",
      "LiveHost bootstrap envelope must be an object.",
    );
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new LiveHostBootstrapError(
      "LIVEHOST_BOOTSTRAP_ENVELOPE_INVALID",
      "LiveHost bootstrap envelope has an invalid prototype.",
    );
  }
  return value as Readonly<Record<string, unknown>>;
}

function require_keys(record: Readonly<Record<string, unknown>>, keys: readonly string[]): void {
  const actual = Object.keys(record);
  if (actual.length !== keys.length || !actual.every((key) => keys.includes(key))) {
    throw new LiveHostBootstrapError(
      "LIVEHOST_BOOTSTRAP_ENVELOPE_INVALID",
      "LiveHost bootstrap envelope contains missing or unexpected fields.",
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
    const resolved = new URL(value, "ws://livehost-bootstrap.invalid/");
    return (resolved.protocol === "ws:" || resolved.protocol === "wss:")
      && resolved.username === ""
      && resolved.password === "";
  } catch {
    return false;
  }
}

function validate_graph_limits(
  value: unknown,
  options: LiveHostBootstrapCodecOptions,
): void {
  const maxDepth = limit(options.maxGraphDepth, DEFAULT_LIVEHOST_BOOTSTRAP_MAX_GRAPH_DEPTH, "graph depth limit");
  const maxNodes = limit(options.maxGraphNodes, DEFAULT_LIVEHOST_BOOTSTRAP_MAX_GRAPH_NODES, "graph node limit");
  let nodes = 0;
  const visit = (current: unknown, depth: number): void => {
    nodes += 1;
    if (nodes > maxNodes || depth > maxDepth) {
      throw new LiveHostBootstrapError(
        "LIVEHOST_BOOTSTRAP_GRAPH_LIMIT_EXCEEDED",
        "LiveHost bootstrap graph exceeds its configured limits.",
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

type LiveHostBootstrapSnapshotEnvelope = Extract<LiveHostSnapshotEnvelope, { hson: string }>;

function snapshot_from_bootstrap(bootstrap: LiveHostBootstrapPackageV1): LiveHostBootstrapSnapshotEnvelope {
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
 * identity, revision, mode, and HSON state.
 */
function with_livehost_bootstrap_snapshot<T>(
  authority: LiveHostBootstrapAuthority,
  useSnapshot: (snapshot: LiveHostBootstrapSnapshotEnvelope) => T,
): T {
  let plan;
  try {
    plan = authority.recovery.plan({ logicalMapId: authority.stream.logicalMapId });
    if (plan.outcome !== "snapshot") {
      throw new Error("A bootstrap capture did not produce the required canonical HSON snapshot.");
    }
    if (!("hson" in plan.body)) {
      throw new Error("A bootstrap capture did not produce the required canonical HSON snapshot.");
    }
    return useSnapshot(plan.body);
  } finally {
    if (plan !== undefined && plan.outcome !== "reject") plan.dispose();
  }
}

/** Application/host-owned routing and continuation inputs for one bootstrap. */
type LiveHostBootstrapRoutingIngredients = Readonly<{
  authoritySelector: LiveHostRoutingSelector;
  websocketEndpoint: string;
}>;

/** The only construction point that combines authority state with delivery metadata. */
function assemble_livehost_bootstrap(
  snapshot: LiveHostBootstrapSnapshotEnvelope,
  routing: LiveHostBootstrapRoutingIngredients,
): LiveHostBootstrapPackageV1 {
  return Object.freeze({
    format: LIVEHOST_BOOTSTRAP_FORMAT,
    formatVersion: LIVEHOST_BOOTSTRAP_FORMAT_VERSION,
    authoritySelector: routing.authoritySelector,
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
  snapshot: LiveHostBootstrapSnapshotEnvelope,
  options: LiveHostBootstrapCodecOptions,
): ClassifiedLiveMap {
  let root;
  try {
    root = parse_hson(snapshot.hson, { allowTopLevelTextFragment: true });
  } catch (cause) {
    throw new LiveHostBootstrapError(
      "LIVEHOST_BOOTSTRAP_STATE_INVALID",
      "LiveHost bootstrap state HSON is malformed.",
      cause,
    );
  }
  validate_graph_limits(root, options);
  let map: ClassifiedLiveMap;
  try {
    map = make_classified_livemap(root);
  } catch (cause) {
    throw new LiveHostBootstrapError(
      "LIVEHOST_BOOTSTRAP_STATE_INVALID",
      "LiveHost bootstrap state is not a canonical LiveMap graph.",
      cause,
    );
  }
  if (map.mode !== snapshot.mode) {
    throw new LiveHostBootstrapError(
      "LIVEHOST_BOOTSTRAP_STATE_INVALID",
      "LiveHost bootstrap state mode does not match its envelope.",
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
      const capture = decode_livehost_document_snapshot(snapshot);
      map.restore(capture, { identity: "preserve-metadata" });
    } else {
      throw new Error("LiveHost bootstrap reconstructed an unsupported map mode.");
    }
  } catch (cause) {
    throw new LiveHostBootstrapError(
      "LIVEHOST_BOOTSTRAP_STATE_INVALID",
      "LiveHost bootstrap state could not be installed.",
      cause,
    );
  }
  return map;
}

function validate_package(
  value: unknown,
  options: LiveHostBootstrapCodecOptions,
): LiveHostBootstrapPackageV1 {
  const record = exact_record(value);
  require_keys(record, [
    "format",
    "formatVersion",
    "authoritySelector",
    "logicalMapId",
    "incarnationId",
    "mode",
    "rev",
    "state",
    "continuation",
  ]);
  if (record.format !== LIVEHOST_BOOTSTRAP_FORMAT) {
    throw new LiveHostBootstrapError(
      "LIVEHOST_BOOTSTRAP_FORMAT_UNSUPPORTED",
      "LiveHost bootstrap format is unsupported.",
    );
  }
  if (record.formatVersion !== LIVEHOST_BOOTSTRAP_FORMAT_VERSION) {
    throw new LiveHostBootstrapError(
      "LIVEHOST_BOOTSTRAP_VERSION_UNSUPPORTED",
      "LiveHost bootstrap format version is unsupported.",
    );
  }
  if (!bounded_string(record.authoritySelector, 512)) {
    throw new LiveHostBootstrapError(
      "LIVEHOST_BOOTSTRAP_SELECTOR_INVALID",
      "LiveHost bootstrap authority selector is invalid.",
    );
  }
  if (!bounded_string(record.logicalMapId, 512) || !bounded_string(record.incarnationId, 512)) {
    throw new LiveHostBootstrapError(
      "LIVEHOST_BOOTSTRAP_IDENTITY_INVALID",
      "LiveHost bootstrap canonical identity is invalid.",
    );
  }
  if (!is_revision(record.rev)) {
    throw new LiveHostBootstrapError(
      "LIVEHOST_BOOTSTRAP_REVISION_INVALID",
      "LiveHost bootstrap revision is invalid.",
    );
  }
  if (!is_mode(record.mode)) {
    throw new LiveHostBootstrapError(
      "LIVEHOST_BOOTSTRAP_MODE_INVALID",
      "LiveHost bootstrap map mode is invalid.",
    );
  }
  const state = exact_record(record.state);
  require_keys(state, ["format", "payload"]);
  if (state.format !== "hson" || typeof state.payload !== "string") {
    throw new LiveHostBootstrapError(
      "LIVEHOST_BOOTSTRAP_STATE_INVALID",
      "LiveHost bootstrap state encoding is invalid.",
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
    throw new LiveHostBootstrapError(
      "LIVEHOST_BOOTSTRAP_CONTINUATION_INVALID",
      "LiveHost bootstrap continuation metadata is invalid.",
    );
  }

  const bootstrap: LiveHostBootstrapPackageV1 = Object.freeze({
    format: LIVEHOST_BOOTSTRAP_FORMAT,
    formatVersion: LIVEHOST_BOOTSTRAP_FORMAT_VERSION,
    authoritySelector: record.authoritySelector,
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

/** Encode one fully validated version-1 HTTP bootstrap package as canonical HSON text. */
export function encode_livehost_bootstrap(
  bootstrap: LiveHostBootstrapPackageV1,
  options: LiveHostBootstrapCodecOptions = {},
): string {
  const validated = validate_package(bootstrap, options);
  const representation: JsonValue = {
    format: validated.format,
    formatVersion: validated.formatVersion,
    authoritySelector: validated.authoritySelector,
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
  const maxBytes = limit(options.maxBytes, DEFAULT_LIVEHOST_BOOTSTRAP_MAX_BYTES, "byte limit");
  if (textEncoder.encode(encoded).byteLength > maxBytes) {
    throw new LiveHostBootstrapError(
      "LIVEHOST_BOOTSTRAP_TOO_LARGE",
      "LiveHost bootstrap package exceeds its configured byte limit.",
    );
  }
  return encoded;
}

/** Decode and completely validate one version-1 HTTP bootstrap package. */
export function decode_livehost_bootstrap(
  encoded: string,
  options: LiveHostBootstrapCodecOptions = {},
): LiveHostBootstrapPackageV1 {
  const maxBytes = limit(options.maxBytes, DEFAULT_LIVEHOST_BOOTSTRAP_MAX_BYTES, "byte limit");
  if (textEncoder.encode(encoded).byteLength > maxBytes) {
    throw new LiveHostBootstrapError(
      "LIVEHOST_BOOTSTRAP_TOO_LARGE",
      "LiveHost bootstrap package exceeds its configured byte limit.",
    );
  }
  let value: JsonValue;
  try {
    value = json_value_from_node(parse_hson(encoded));
  } catch (cause) {
    throw new LiveHostBootstrapError(
      "LIVEHOST_BOOTSTRAP_MALFORMED_HSON",
      "LiveHost bootstrap package is malformed HSON.",
      cause,
    );
  }
  return validate_package(value, options);
}

/** Capture a single exact authority cut using the established recovery planner. */
export function capture_livehost_bootstrap(
  authority: LiveHostBootstrapAuthority,
  authoritySelector: string,
  websocketEndpoint: string,
  options: LiveHostBootstrapCodecOptions = {},
): LiveHostBootstrapPackageV1 {
  try {
    return with_livehost_bootstrap_snapshot(authority, (snapshot) => {
      const routingSelector: LiveHostRoutingSelector = authoritySelector;
      const bootstrap = assemble_livehost_bootstrap(snapshot, {
        authoritySelector: routingSelector,
        websocketEndpoint,
      });
      validate_package(bootstrap, options);
      return bootstrap;
    });
  } catch (cause) {
    if (cause instanceof LiveHostBootstrapError) throw cause;
    throw new LiveHostBootstrapError(
      "LIVEHOST_BOOTSTRAP_CAPTURE_FAILED",
      "LiveHost authority bootstrap capture failed.",
      cause,
    );
  }
}

/** Install a validated detached mirror and its exact existing-recovery cursor. */
export function install_livehost_bootstrap(
  bootstrap: LiveHostBootstrapPackageV1,
  options: LiveHostBootstrapCodecOptions = {},
): LiveHostBootstrapInstall {
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

/** Create the existing LiveHost client around an installed bootstrap mirror. */
export function create_livehost_bootstrap_client<TMap extends LiveMapAuthority>(
  install: LiveHostBootstrapInstall & Readonly<{ map: TMap }>,
  options: Omit<LiveHostClientOptionsForMap<TMap>, "map" | "recovery">,
): LiveHostBootstrapClient<TMap> {
  const client = create_livehost_client({
    ...options,
    map: install.map,
    recovery: install.recovery,
  });
  let disposed = false;
  let connected = false;
  let status: LiveHostBootstrapClient<TMap>["status"] = "installed";
  let failure: unknown;
  const result: LiveHostBootstrapClient<TMap> = {
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
      if (disposed) throw new Error("LiveHost bootstrap client is disposed.");
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
      options.socket.close(1000, "LiveHost bootstrap client disposed.");
    },
  };
  return Object.freeze(result);
}
