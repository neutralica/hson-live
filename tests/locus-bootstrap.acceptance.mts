import { create_test_event_emitter } from "./test-events.mjs";
// @hson-live-external-test
import assert from "node:assert/strict";
import { hson } from "hson-live";
import type { JsonValue } from "hson-live/types";
import type { LiveHostApplication, LiveHostApplicationContext, LiveHostConnection } from "hson-live/livehost";
import {
  LOCUS_BOOTSTRAP_FORMAT,
  LOCUS_BOOTSTRAP_MEDIA_TYPE,
  LocusBootstrapError,
  capture_locus_bootstrap,
  create_locus,
  decode_locus_bootstrap,
  encode_locus_bootstrap,
  install_locus_bootstrap,
  type LocusBootstrap,
  type LocusBootstrapAuthority,
  type LocusSocketLike,
} from "hson-live/locus";
import { create_locus_bootstrap_echo } from "hson-live/echo";
import { create_node_locus_socket } from "hson-live/locus/node";
import { start_node_application_host } from "hson-live/livehost/node";
import WebSocket from "ws";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "locus.bootstrap",
  title: "Locus HTTP Hson bootstrap",
  category: "Locus",
  runtime: "node-real-websocket",
  tags: Object.freeze(["bootstrap", "hson", "recovery", "http", "websocket", "externally-discoverable"]),
});

const testEvents = create_test_event_emitter("locus.bootstrap");
let checks = 0;
let sequence = Promise.resolve();

function check(name: string, run: () => void | Promise<void>): void {
  sequence = sequence.then(async () => {

  testEvents.case_begin(name, name);
  try {
    await run();
    testEvents.case_end(name, "pass");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Check failed.";
    testEvents.diagnostic(name, "assertion", message.slice(0, 1_000));
    testEvents.case_end(name, "fail");
    testEvents.terminal("fail");
    throw error;
  }
    checks += 1;
    process.stdout.write(`ok ${checks} - ${name}\n`);
  });
}

function error_code(run: () => unknown): string | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    return error instanceof LocusBootstrapError ? error.code : undefined;
  }
}

type BootstrapResolution =
  | Readonly<{ ok: true; authority: LocusBootstrapAuthority; websocketEndpoint: string; release?: () => void }>
  | Readonly<{ ok: false; status: 404 | 503; code: string; message: string }>;

function bootstrap_error(status: number, code: string, message: string, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "content-type": "application/problem+json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

async function bootstrap_response(
  request: Request,
  resolve: (selector: string) => BootstrapResolution | Promise<BootstrapResolution>,
  maxBytes?: number,
): Promise<Response> {
  if (request.method !== "GET") {
    return bootstrap_error(405, "LOCUS_BOOTSTRAP_METHOD_UNSUPPORTED", "Locus bootstrap supports GET only.", { allow: "GET" });
  }
  const accept = request.headers.get("accept");
  if (accept !== null && !accept.split(",").map((value) => value.trim().toLowerCase())
    .some((value) => value === "*/*" || value === LOCUS_BOOTSTRAP_MEDIA_TYPE)) {
    return bootstrap_error(406, "LOCUS_BOOTSTRAP_NOT_ACCEPTABLE", "The requested response media type is not available.");
  }
  const selector = new URL(request.url).searchParams.get("locus");
  if (selector === null || selector.trim() === "") {
    return bootstrap_error(400, "LOCUS_BOOTSTRAP_SELECTOR_INVALID", "A non-empty Locus selector is required.");
  }
  const resolution = await resolve(selector);
  if (!resolution.ok) return bootstrap_error(resolution.status, resolution.code, resolution.message);
  try {
    const codecOptions = maxBytes === undefined ? {} : { maxBytes };
    const body = encode_locus_bootstrap(
      capture_locus_bootstrap(resolution.authority, selector, resolution.websocketEndpoint, codecOptions),
      codecOptions,
    );
    return new Response(body, {
      status: 200,
      headers: { "content-type": LOCUS_BOOTSTRAP_MEDIA_TYPE, "cache-control": "no-store" },
    });
  } catch (cause) {
    const error = cause instanceof LocusBootstrapError ? cause : undefined;
    const status = error?.code === "LOCUS_BOOTSTRAP_TOO_LARGE" ? 413 : 500;
    return bootstrap_error(
      status,
      error?.code ?? "LOCUS_BOOTSTRAP_ENCODING_FAILED",
      status === 413 ? "Locus bootstrap package exceeds its configured byte limit." : "Locus bootstrap package could not be produced.",
    );
  } finally {
    resolution.release?.();
  }
}

function generic_locus_socket(connection: LiveHostConnection): LocusSocketLike {
  return Object.freeze({
    send(message) { connection.send(message); },
    close(code, reason) { connection.close(code, reason); },
    onMessage(listener) {
      return connection.onMessage((data) => {
        if (typeof data === "string") listener(data);
        else connection.close(1003, "Locus accepts text messages only.");
      });
    },
    onClose(listener) { return connection.onClose(listener); },
  });
}

function replace_package(
  bootstrap: LocusBootstrap,
  replacement: Partial<LocusBootstrap>,
): LocusBootstrap {
  return Object.freeze({ ...bootstrap, ...replacement });
}

function encode_unknown_bootstrap(value: Record<string, unknown>): string {
  return hson.fromJson(JSON.stringify(value)).toHson().noBreak().serialize();
}

function socket_pair(): Readonly<{
  client: LocusSocketLike;
  server: LocusSocketLike;
  clientSent: readonly string[];
  clientLifecycle(): Readonly<{ messageListeners: number; closeListeners: number; closeCalls: number }>;
  before_server_delivery(listener: (message: Readonly<{ type?: string }>) => void): void;
  close(): void;
}> {
  const clientMessages = new Set<(message: string) => void>();
  const serverMessages = new Set<(message: string) => void>();
  const clientCloses = new Set<() => void>();
  const serverCloses = new Set<() => void>();
  let beforeServerDelivery: ((message: Readonly<{ type?: string }>) => void) | undefined;
  const clientSent: string[] = [];
  let clientCloseCalls = 0;
  return Object.freeze({
    client: Object.freeze({
      send(message: string) {
        clientSent.push(message);
        for (const listener of [...serverMessages]) listener(message);
      },
      onMessage(listener: (message: string) => void) {
        clientMessages.add(listener);
        return () => clientMessages.delete(listener);
      },
      onClose(listener: () => void) {
        clientCloses.add(listener);
        return () => clientCloses.delete(listener);
      },
      close() { clientCloseCalls += 1; },
    }),
    clientSent,
    clientLifecycle() {
      return Object.freeze({
        messageListeners: clientMessages.size,
        closeListeners: clientCloses.size,
        closeCalls: clientCloseCalls,
      });
    },
    server: Object.freeze({
      send(message: string) {
        beforeServerDelivery?.(JSON.parse(message));
        for (const listener of [...clientMessages]) listener(message);
      },
      onMessage(listener: (message: string) => void) {
        serverMessages.add(listener);
        return () => serverMessages.delete(listener);
      },
      onClose(listener: () => void) {
        serverCloses.add(listener);
        return () => serverCloses.delete(listener);
      },
      close() {},
    }),
    before_server_delivery(listener) {
      beforeServerDelivery = listener;
    },
    close() {
      for (const listener of [...clientCloses]) listener();
      for (const listener of [...serverCloses]) listener();
    },
  });
}

function fixture(state: JsonValue = { value: 1 }, history?: Readonly<{ maxCommits: number }>) {
  const authority = create_locus({
    state,
    logicalMapId: "bootstrap-map",
    incarnationId: "bootstrap-incarnation",
    ...(history === undefined ? {} : { history }),
  });
  return {
    authority,
    bootstrap: capture_locus_bootstrap(
      authority,
      "probe:one",
      "/live?locus=probe%3Aone",
    ),
  };
}

const base = fixture();

const established_base_bootstrap: LocusBootstrap = Object.freeze({
  format: LOCUS_BOOTSTRAP_FORMAT,
  locusSelector: "probe:one",
  logicalMapId: "bootstrap-map",
  incarnationId: "bootstrap-incarnation",
  mode: "data-object",
  rev: 0,
  state: Object.freeze({ format: "hson", payload: "<value 1>" }),
  continuation: Object.freeze({
    transport: "websocket",
    endpoint: "/live?locus=probe%3Aone",
    capabilities: Object.freeze({ hsonSnapshots: true }),
  }),
});

const established_base_encoding = '<format "hson-locus-bootstrap" locusSelector "probe:one" logicalMapId "bootstrap-map" incarnationId "bootstrap-incarnation" mode "data-object" rev 0 state <format "hson" payload "<value 1>"> continuation <transport "websocket" endpoint "/live?locus=probe%3Aone" capabilities <hsonSnapshots true>>>';

check("capture assembles the established authority cut and delivery contract exactly", () => {
  assert.deepEqual(base.bootstrap, established_base_bootstrap);
  assert.equal(encode_locus_bootstrap(base.bootstrap), established_base_encoding);
  assert.equal(LOCUS_BOOTSTRAP_MEDIA_TYPE, "application/vnd.hson-live.locus-bootstrap+hson");
});

check("capture returns one exact canonical identity, revision, mode, and state cut", () => {
  assert.equal(base.bootstrap.logicalMapId, base.authority.stream.logicalMapId);
  assert.equal(base.bootstrap.incarnationId, base.authority.stream.incarnationId);
  assert.equal(base.bootstrap.rev, base.authority.stream.headRev);
  assert.equal(base.bootstrap.mode, base.authority.map.mode);
  assert.deepEqual(install_locus_bootstrap(base.bootstrap).map.capture(), base.authority.map.capture());
});

check("current unversioned encoding is deterministic canonical Hson", () => {
  const first = encode_locus_bootstrap(base.bootstrap);
  assert.equal(encode_locus_bootstrap(base.bootstrap), first);
  assert.doesNotMatch(first, /^\s*\{/u);
  const value = hson.fromHson(first).toJson().value();
  assert.equal(typeof value === "object" && value !== null && !Array.isArray(value) ? value.format : undefined, LOCUS_BOOTSTRAP_FORMAT);
});

check("valid Hson decodes with exact continuation metadata", () => {
  const decoded = decode_locus_bootstrap(encode_locus_bootstrap(base.bootstrap));
  assert.equal(decoded.continuation.transport, "websocket");
  assert.equal(decoded.continuation.endpoint, "/live?locus=probe%3Aone");
  assert.equal(decoded.continuation.capabilities.hsonSnapshots, true);
  assert.equal(
    error_code(() => encode_locus_bootstrap(replace_package(base.bootstrap, {
      continuation: {
        transport: "websocket",
        endpoint: "https://example.test/not-a-websocket",
        capabilities: { hsonSnapshots: true },
      },
    }))),
    "LOCUS_BOOTSTRAP_CONTINUATION_INVALID",
  );
});

check("malformed Hson rejects structurally", () => {
  assert.equal(error_code(() => decode_locus_bootstrap("<broken")), "LOCUS_BOOTSTRAP_MALFORMED_HSON");
});

check("a removed LiveHost discriminator rejects through current discriminator validation", () => {
  assert.equal(
    error_code(() => decode_locus_bootstrap(encode_unknown_bootstrap({ ...base.bootstrap, format: "hson-livehost-bootstrap" }))),
    "LOCUS_BOOTSTRAP_FORMAT_UNSUPPORTED",
  );
});

check("removed outer version field rejects without normalization", () => {
  const plain = hson.fromHson(encode_locus_bootstrap(base.bootstrap)).toJson().value() as Record<string, unknown>;
  assert.equal(
    error_code(() => decode_locus_bootstrap(encode_unknown_bootstrap({ ...plain, formatVersion: 1 }))),
    "LOCUS_BOOTSTRAP_ENVELOPE_INVALID",
  );
});

check("missing and extra fields reject under exact-key policy", () => {
  const plain = hson.fromHson(encode_locus_bootstrap(base.bootstrap)).toJson().value() as Record<string, unknown>;
  const { rev: _rev, ...missing } = plain;
  assert.equal(
    error_code(() => decode_locus_bootstrap(hson.fromJson(JSON.stringify(missing)).toHson().noBreak().serialize())),
    "LOCUS_BOOTSTRAP_ENVELOPE_INVALID",
  );
  assert.equal(
    error_code(() => decode_locus_bootstrap(hson.fromJson(JSON.stringify({ ...plain, extra: true })).toHson().noBreak().serialize())),
    "LOCUS_BOOTSTRAP_ENVELOPE_INVALID",
  );
});

check("invalid selector, old selector field, and canonical identities reject", () => {
  assert.equal(
    error_code(() => encode_locus_bootstrap(replace_package(base.bootstrap, { locusSelector: "" }))),
    "LOCUS_BOOTSTRAP_SELECTOR_INVALID",
  );
  const plain = hson.fromHson(encode_locus_bootstrap(base.bootstrap)).toJson().value() as Record<string, unknown>;
  const { locusSelector: _locusSelector, ...withoutSelector } = plain;
  assert.equal(
    error_code(() => decode_locus_bootstrap(encode_unknown_bootstrap({ ...withoutSelector, authoritySelector: "probe:one" }))),
    "LOCUS_BOOTSTRAP_ENVELOPE_INVALID",
  );
  assert.equal(
    error_code(() => encode_locus_bootstrap(replace_package(base.bootstrap, { logicalMapId: "" }))),
    "LOCUS_BOOTSTRAP_IDENTITY_INVALID",
  );
});

check("invalid revision and mode reject", () => {
  assert.equal(
    error_code(() => encode_locus_bootstrap(replace_package(base.bootstrap, { rev: -1 }))),
    "LOCUS_BOOTSTRAP_REVISION_INVALID",
  );
  assert.equal(
    error_code(() => encode_locus_bootstrap(replace_package(base.bootstrap, { mode: "unknown" as "data-object" }))),
    "LOCUS_BOOTSTRAP_MODE_INVALID",
  );
});

check("mode/state mismatch rejects before installation", () => {
  assert.equal(
    error_code(() => install_locus_bootstrap(replace_package(base.bootstrap, { mode: "data-array" }))),
    "LOCUS_BOOTSTRAP_STATE_INVALID",
  );
});

check("malformed graph and duplicate document QUIDs reject", () => {
  const malformed = replace_package(base.bootstrap, {
    state: { format: "hson", payload: "<main" },
  });
  assert.equal(error_code(() => install_locus_bootstrap(malformed)), "LOCUS_BOOTSTRAP_STATE_INVALID");
  const duplicate = replace_package(base.bootstrap, {
    mode: "document",
    state: {
      format: "hson",
      payload: `<div @000000001/> <span @000000001/>`,
    },
  });
  assert.equal(error_code(() => install_locus_bootstrap(duplicate)), "LOCUS_BOOTSTRAP_STATE_INVALID");
});

check("encoded-byte and graph limits reject structurally", () => {
  assert.equal(
    error_code(() => decode_locus_bootstrap(encode_locus_bootstrap(base.bootstrap), { maxBytes: 10 })),
    "LOCUS_BOOTSTRAP_TOO_LARGE",
  );
  assert.equal(
    error_code(() => install_locus_bootstrap(base.bootstrap, { maxGraphNodes: 1 })),
    "LOCUS_BOOTSTRAP_GRAPH_LIMIT_EXCEEDED",
  );
});

function verify_mode(name: string, authority: ReturnType<typeof create_locus>): void {
  const bootstrap = capture_locus_bootstrap(authority, `probe:${name}`, `/ws/${name}`);
  const installed = install_locus_bootstrap(decode_locus_bootstrap(encode_locus_bootstrap(bootstrap)));
  assert.equal(installed.map.mode, authority.map.mode);
  assert.equal(installed.map.rev, authority.stream.headRev);
  assert.deepEqual(installed.map.capture(), authority.map.capture());
}

check("data-object bootstrap installs exact state and revision", () => {
  const authority = create_locus({ state: { value: {} } });
  verify_mode("data-object", authority);
});

check("data-array bootstrap installs exact state and revision", () => {
  verify_mode("data-array", create_locus({ state: [1, 2] }));
});

check("element bootstrap installs exact state and revision", () => {
  verify_mode("element", create_locus({
    map: hson.liveMap.fromHson(`<main @000000001 "hello"/>`),
  }));
});

check("multiNodeDocument bootstrap installs exact state and revision", () => {
  verify_mode("multiNodeDocument", create_locus({
    map: hson.liveMap.fromHson(`"before" <em @000000002 "middle"/>`),
  }));
});

check("preinstalled mirror continues as current through existing recovery", async () => {
  const { authority, bootstrap } = fixture();
  const pair = socket_pair();
  authority.connect(pair.server);
  const installed = install_locus_bootstrap(bootstrap);
  const client = create_locus_bootstrap_echo(installed, { socket: pair.client });
  assert.equal(client.status, "installed");
  const result = await client.connectAndRecover();
  assert.equal(result.strategy, "current");
  assert.equal(result.headRev, bootstrap.rev);
  assert.equal(client.echo.recovery.status, "caught_up");
  assert.equal(client.status, "live");
  client.dispose();
  client.dispose();
  assert.equal(client.status, "disposed");
  assert.equal(client.echo.recovery.status, "disposed");
  assert.equal(client.echo.session.status, "disposed");
  assert.deepEqual(pair.clientLifecycle(), { messageListeners: 0, closeListeners: 0, closeCalls: 1 });
  const releasedMap = client.map;
  if (releasedMap.mode !== "data-object" && releasedMap.mode !== "data-array") {
    throw new Error("Expected projected bootstrap mirror.");
  }
  assert.doesNotThrow(() => releasedMap.set(["value"], 2));
});

check("commits after HTTP cut replay exactly once", async () => {
  const { authority, bootstrap } = fixture();
  await authority.mutate((draft) => draft.set(["value"], 2));
  await authority.mutate((draft) => draft.set(["value"], 3));
  const pair = socket_pair();
  authority.connect(pair.server);
  const client = create_locus_bootstrap_echo(install_locus_bootstrap(bootstrap), { socket: pair.client });
  const result = await client.connectAndRecover();
  assert.equal(result.strategy, "replay");
  assert.equal(client.map.rev, authority.stream.headRev);
  assert.deepEqual(client.map.capture(), authority.map.capture());
  assert.equal(client.echo.recovery.debug().duplicateCommitsIgnored, 0);
  client.dispose();
});

check("duplicate revision delivery after bootstrap recovery is ignored", async () => {
  const { authority, bootstrap } = fixture();
  await authority.mutate((draft) => draft.set(["value"], 2));
  const commit = authority.stream.history.replay_after(0)?.[0];
  assert.ok(commit);
  const pair = socket_pair();
  authority.connect(pair.server);
  const client = create_locus_bootstrap_echo(install_locus_bootstrap(bootstrap), { socket: pair.client });
  await client.connectAndRecover();
  const request = pair.clientSent.map((raw) => JSON.parse(raw)).find((message) => message.type === "recover");
  assert.ok(request);
  pair.server.send(JSON.stringify({ type: "commit", id: request.id, commit }));
  assert.equal(client.echo.recovery.debug().duplicateCommitsIgnored, 1);
  assert.deepEqual(client.map.capture(), authority.map.capture());
  client.dispose();
});

check("revision gap after bootstrap recovery fails through the existing client policy", async () => {
  const { authority, bootstrap } = fixture();
  const pair = socket_pair();
  authority.connect(pair.server);
  const client = create_locus_bootstrap_echo(install_locus_bootstrap(bootstrap), { socket: pair.client });
  await client.connectAndRecover();
  const request = pair.clientSent.map((raw) => JSON.parse(raw)).find((message) => message.type === "recover");
  assert.ok(request);
  const other = create_locus({
    state: { value: 1 },
    logicalMapId: bootstrap.logicalMapId,
    incarnationId: bootstrap.incarnationId,
  });
  await other.mutate((draft) => draft.set(["value"], 2));
  await other.mutate((draft) => draft.set(["value"], 3));
  const gap = other.stream.history.replay_after(1)?.[0];
  assert.ok(gap);
  pair.server.send(JSON.stringify({ type: "commit", id: request.id, commit: gap }));
  assert.equal(client.echo.recovery.status, "failed");
  assert.equal(client.echo.recovery.failure?.code, "LOCUS_RECOVERY_COMMIT_GAP");
  client.dispose();
  other.dispose();
});

check("commit published during recovery is ordered after the selected body", async () => {
  const { authority, bootstrap } = fixture();
  await authority.mutate((draft) => draft.set(["value"], 2));
  const pair = socket_pair();
  let publishedTail = false;
  pair.before_server_delivery((message) => {
    if (message.type !== "recovery-plan" || publishedTail) return;
    publishedTail = true;
    void authority.mutate((draft) => draft.set(["value"], 3));
  });
  authority.connect(pair.server);
  const client = create_locus_bootstrap_echo(install_locus_bootstrap(bootstrap), { socket: pair.client });
  const result = await client.connectAndRecover();
  assert.equal(result.strategy, "replay");
  assert.equal(publishedTail, true);
  assert.deepEqual(client.map.capture(), authority.map.capture());
  assert.equal(client.echo.recovery.lastAppliedRev, authority.stream.headRev);
  client.dispose();
});

check("history eviction replaces the bootstrap mirror through existing snapshot recovery", async () => {
  const { authority, bootstrap } = fixture({ value: 1 }, { maxCommits: 0 });
  await authority.mutate((draft) => draft.set(["value"], 2));
  const pair = socket_pair();
  authority.connect(pair.server);
  const client = create_locus_bootstrap_echo(install_locus_bootstrap(bootstrap), { socket: pair.client });
  const result = await client.connectAndRecover();
  assert.equal(result.strategy, "snapshot");
  assert.equal(client.map.rev, authority.stream.headRev);
  assert.deepEqual(client.map.capture(), authority.map.capture());
  client.dispose();
});

check("incarnation replacement never treats revision equality as current", async () => {
  const first = fixture();
  const replacement = create_locus({
    state: { value: 9 },
    logicalMapId: first.bootstrap.logicalMapId,
    incarnationId: "replacement-incarnation",
  });
  const pair = socket_pair();
  replacement.connect(pair.server);
  const client = create_locus_bootstrap_echo(install_locus_bootstrap(first.bootstrap), { socket: pair.client });
  const result = await client.connectAndRecover();
  assert.equal(result.strategy, "snapshot");
  assert.equal(result.headRev, replacement.stream.headRev);
  assert.deepEqual(client.map.capture(), replacement.map.capture());
  client.dispose();
});

check("different logical authority rejects continuation", async () => {
  const first = fixture();
  const wrong = create_locus({ state: { value: 9 }, logicalMapId: "other-map" });
  const pair = socket_pair();
  wrong.connect(pair.server);
  const client = create_locus_bootstrap_echo(install_locus_bootstrap(first.bootstrap), { socket: pair.client });
  await assert.rejects(client.connectAndRecover(), /different logical map|invalid target/i);
  assert.equal(client.echo.recovery.status, "failed");
  client.dispose();
});

check("equal route-local selectors stay isolated across application-owned authorities", () => {
  const left = create_locus({
    state: { owner: "left" },
    logicalMapId: "left-map",
  });
  const right = create_locus({
    state: { owner: "right" },
    logicalMapId: "right-map",
  });
  const leftBootstrap = capture_locus_bootstrap(left, "local:equal", "/left");
  const rightBootstrap = capture_locus_bootstrap(right, "local:equal", "/right");
  assert.equal(leftBootstrap.locusSelector, rightBootstrap.locusSelector);
  assert.notEqual(leftBootstrap.logicalMapId, rightBootstrap.logicalMapId);
  assert.notDeepEqual(
    install_locus_bootstrap(leftBootstrap).map.capture(),
    install_locus_bootstrap(rightBootstrap).map.capture(),
  );
  left.dispose();
  assert.deepEqual(
    install_locus_bootstrap(capture_locus_bootstrap(right, "local:equal", "/right")).map.capture(),
    right.map.capture(),
  );
  right.dispose();
});

check("socket failure remains distinct from installed state and releases cleanly", async () => {
  const { bootstrap } = fixture();
  const pair = socket_pair();
  const client = create_locus_bootstrap_echo(install_locus_bootstrap(bootstrap), { socket: pair.client });
  const installedCapture = client.map.capture();
  const recovery = client.connectAndRecover();
  pair.close();
  await assert.rejects(recovery, /disconnected/i);
  assert.equal(client.status, "failed");
  assert.deepEqual(client.map.capture(), installedCapture);
  client.dispose();
  assert.equal(client.status, "disposed");
});

check("bootstrap capture and installation are DOM, CSS, and LiveTree-runtime free", () => {
  assert.equal("document" in globalThis, false);
  assert.equal("window" in globalThis, false);
  assert.equal("CSSStyleSheet" in globalThis, false);
  const captured = capture_locus_bootstrap(create_locus({ state: { ready: true } }), "probe:dom-free", "/ws");
  const installed = install_locus_bootstrap(captured).map;
  if (installed.mode !== "data-object" && installed.mode !== "data-array") {
    throw new Error(`Expected projected bootstrap map, observed ${installed.mode}.`);
  }
  assert.equal("value" in installed.capture(), false);
  assert.deepEqual(installed.snap(), { ready: true });
});

check("real HTTP helper and WebSocket continuation share one application authority", async () => {
  const authority = create_locus({
    state: { value: 1 },
    logicalMapId: "network-map",
    incarnationId: "network-incarnation",
  });
  const selector = "probe:network";
  let resolutions = 0;
  let acquisitionReleases = 0;
  const application: LiveHostApplication = {
    name: "bootstrap-probe",
    requests: Object.freeze(["GET", "POST"].map((method) => Object.freeze({
      method,
      path: "/bootstrap",
      handle(request: Request) {
        return bootstrap_response(request, (candidate) => {
          resolutions += 1;
          return candidate === selector
            ? {
                ok: true,
                authority,
                websocketEndpoint: `/bootstrap-connect?locus=${encodeURIComponent(selector)}`,
                release: () => { acquisitionReleases += 1; },
              }
            : {
                ok: false,
                status: 404,
                code: "LOCUS_BOOTSTRAP_AUTHORITY_UNKNOWN",
                message: "Unknown bootstrap authority.",
              };
        });
      },
    }))),
    connections: Object.freeze([Object.freeze({
      path: "/bootstrap-connect",
      accept(request: Request, connection: LiveHostConnection, _context: LiveHostApplicationContext) {
        const candidate = new URL(request.url).searchParams.get("locus");
        assert.equal(candidate, selector);
        authority.connect(generic_locus_socket(connection));
      },
    })]),
    dispose() {
      authority.dispose();
    },
  };
  const host = await start_node_application_host({ port: 0, applications: [application] });
  try {
    const response = await fetch(`${host.httpUrl}/bootstrap?locus=${encodeURIComponent(selector)}`, {
      headers: { accept: LOCUS_BOOTSTRAP_MEDIA_TYPE },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), LOCUS_BOOTSTRAP_MEDIA_TYPE);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const bootstrap = decode_locus_bootstrap(await response.text());
    await authority.mutate((draft) => draft.set(["value"], 2));
    const websocket = new WebSocket(new URL(bootstrap.continuation.endpoint, host.url));
    await new Promise<void>((resolve, reject) => {
      websocket.once("open", resolve);
      websocket.once("error", reject);
    });
    const client = create_locus_bootstrap_echo(
      install_locus_bootstrap(bootstrap),
      { socket: create_node_locus_socket(websocket) },
    );
    const recovered = await client.connectAndRecover();
    assert.equal(recovered.strategy, "replay");
    await authority.mutate((draft) => draft.set(["value"], 3));
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(client.map.capture(), authority.map.capture());
    assert.equal(client.map.rev, authority.stream.headRev);
    assert.equal(resolutions, 1);
    assert.equal(acquisitionReleases, 1);
    client.dispose();
    websocket.close();
  } finally {
    await host.dispose();
  }
});

check("HTTP accepts wildcard media type and rejects incompatible Accept", async () => {
  const authority = create_locus({ state: { value: 1 } });
  const application: LiveHostApplication = {
    name: "accept-probe",
    requests: Object.freeze([Object.freeze({
      method: "GET",
      path: "/bootstrap",
      handle(request: Request) {
        return bootstrap_response(request, () => ({ ok: true, authority, websocketEndpoint: "/ws" }));
      },
    })]),
    dispose() { authority.dispose(); },
  };
  const host = await start_node_application_host({ port: 0, applications: [application] });
  try {
    assert.equal((await fetch(`${host.httpUrl}/bootstrap?locus=accept%3Aone`, { headers: { accept: "*/*" } })).status, 200);
    const rejected = await fetch(`${host.httpUrl}/bootstrap?locus=accept%3Aone`, { headers: { accept: "application/json" } });
    assert.equal(rejected.status, 406);
    assert.deepEqual(await rejected.json(), {
      error: {
        code: "LOCUS_BOOTSTRAP_NOT_ACCEPTABLE",
        message: "The requested response media type is not available.",
      },
    });
    const oldVersioned = await fetch(`${host.httpUrl}/bootstrap?locus=accept%3Aone`, {
      headers: { accept: "application/vnd.hson-live.livehost-bootstrap+hson; version=1" },
    });
    assert.equal(oldVersioned.status, 406);
  } finally {
    await host.dispose();
  }
});

check("HTTP rejects method, missing selector, unknown authority, and hides stacks", async () => {
  const authority = create_locus({ state: { value: 1 } });
  const handler = (request: Request) =>
    bootstrap_response(request, (selector) => selector === "known"
        ? { ok: true, authority, websocketEndpoint: "/ws" }
        : {
            ok: false,
            status: 404,
            code: "LOCUS_BOOTSTRAP_AUTHORITY_UNKNOWN",
            message: "Unknown authority.",
          });
  const application: LiveHostApplication = {
    name: "errors",
    requests: Object.freeze(["GET", "POST"].map((method) => Object.freeze({
      method,
      path: "/bootstrap",
      handle: handler,
    }))),
    dispose() { authority.dispose(); },
  };
  const host = await start_node_application_host({ port: 0, applications: [application] });
  try {
    const method = await fetch(`${host.httpUrl}/bootstrap?locus=known`, { method: "POST" });
    assert.equal(method.status, 405);
    assert.equal(method.headers.get("allow"), "GET");
    assert.equal((await fetch(`${host.httpUrl}/bootstrap`)).status, 400);
    const unknown = await fetch(`${host.httpUrl}/bootstrap?locus=unknown`);
    assert.equal(unknown.status, 404);
    assert.doesNotMatch(await unknown.text(), /at .+\\.ts|stack/iu);
  } finally {
    await host.dispose();
  }
});

check("HTTP encoded-size failure is deterministic and no-store", async () => {
  const authority = create_locus({ state: { payload: "large" } });
  const application: LiveHostApplication = {
    name: "size",
    requests: Object.freeze([Object.freeze({
      method: "GET",
      path: "/bootstrap",
      handle(request: Request) {
        return bootstrap_response(request, () => ({ ok: true, authority, websocketEndpoint: "/ws" }), 10);
      },
    })]),
    dispose() { authority.dispose(); },
  };
  const host = await start_node_application_host({ port: 0, applications: [application] });
  try {
    const response = await fetch(`${host.httpUrl}/bootstrap?locus=size%3Aone`);
    assert.equal(response.status, 413);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.json()).error.code, "LOCUS_BOOTSTRAP_TOO_LARGE");
  } finally {
    await host.dispose();
  }
});

await sequence;
base.authority.dispose();
process.stdout.write(`1..${checks}\n`);
testEvents.terminal("pass");
