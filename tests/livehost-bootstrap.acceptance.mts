import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
// @hson-live-external-test
import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { hson } from "hson-live";
import type { JsonValue } from "hson-live/types";
import {
  LIVEHOST_BOOTSTRAP_FORMAT,
  LIVEHOST_BOOTSTRAP_MEDIA_TYPE,
  LiveHostBootstrapError,
  capture_livehost_bootstrap,
  create_livehost,
  create_livehost_bootstrap_client,
  decode_livehost_bootstrap,
  encode_livehost_bootstrap,
  install_livehost_bootstrap,
  type LiveHostBootstrapPackageV1,
  type LiveHostSocketLike,
} from "hson-live/livehost";
import {
  create_node_livehost_socket,
  handle_node_livehost_bootstrap_request,
  start_node_application_host,
  type NodeHostedApplication,
} from "hson-live/livehost/node";
import WebSocket from "ws";

let checks = 0;
let sequence = Promise.resolve();

function check(name: string, run: () => void | Promise<void>): void {
  sequence = sequence.then(async () => {
    await run();
    checks += 1;
    process.stdout.write(`ok ${checks} - ${name}\n`);
  });
}

function error_code(run: () => unknown): string | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    return error instanceof LiveHostBootstrapError ? error.code : undefined;
  }
}

function replace_package(
  bootstrap: LiveHostBootstrapPackageV1,
  replacement: Partial<LiveHostBootstrapPackageV1>,
): LiveHostBootstrapPackageV1 {
  return Object.freeze({ ...bootstrap, ...replacement });
}

function socket_pair(): Readonly<{
  client: LiveHostSocketLike;
  server: LiveHostSocketLike;
  clientSent: readonly string[];
  before_server_delivery(listener: (message: Readonly<{ type?: string }>) => void): void;
  close(): void;
}> {
  const clientMessages = new Set<(message: string) => void>();
  const serverMessages = new Set<(message: string) => void>();
  const clientCloses = new Set<() => void>();
  const serverCloses = new Set<() => void>();
  let beforeServerDelivery: ((message: Readonly<{ type?: string }>) => void) | undefined;
  const clientSent: string[] = [];
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
      close() {},
    }),
    clientSent,
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
  const authority = create_livehost({
    state,
    authority: "shared",
    logicalMapId: "bootstrap-map",
    incarnationId: "bootstrap-incarnation",
    ...(history === undefined ? {} : { history }),
  });
  return {
    authority,
    bootstrap: capture_livehost_bootstrap(
      authority,
      "probe:one",
      "/live?livehost=probe%3Aone",
    ),
  };
}

const base = fixture();

check("capture returns one exact canonical identity, revision, mode, and state cut", () => {
  assert.equal(base.bootstrap.logicalMapId, base.authority.stream.logicalMapId);
  assert.equal(base.bootstrap.incarnationId, base.authority.stream.incarnationId);
  assert.equal(base.bootstrap.rev, base.authority.stream.headRev);
  assert.equal(base.bootstrap.mode, base.authority.map.mode);
  assert.deepEqual(install_livehost_bootstrap(base.bootstrap).map.capture(), base.authority.map.capture());
});

check("version-1 encoding is deterministic canonical HSON", () => {
  const first = encode_livehost_bootstrap(base.bootstrap);
  assert.equal(encode_livehost_bootstrap(base.bootstrap), first);
  assert.doesNotMatch(first, /^\s*\{/u);
  const value = hson.fromHson(first).toJson().value();
  assert.equal(typeof value === "object" && value !== null && !Array.isArray(value) ? value.format : undefined, LIVEHOST_BOOTSTRAP_FORMAT);
});

check("valid HSON decodes with exact continuation metadata", () => {
  const decoded = decode_livehost_bootstrap(encode_livehost_bootstrap(base.bootstrap));
  assert.equal(decoded.continuation.transport, "websocket");
  assert.equal(decoded.continuation.endpoint, "/live?livehost=probe%3Aone");
  assert.equal(decoded.continuation.capabilities.hsonSnapshots, true);
  assert.equal(
    error_code(() => encode_livehost_bootstrap(replace_package(base.bootstrap, {
      continuation: {
        transport: "websocket",
        endpoint: "https://example.test/not-a-websocket",
        capabilities: { hsonSnapshots: true },
      },
    }))),
    "LIVEHOST_BOOTSTRAP_CONTINUATION_INVALID",
  );
});

check("malformed HSON rejects structurally", () => {
  assert.equal(error_code(() => decode_livehost_bootstrap("<broken")), "LIVEHOST_BOOTSTRAP_MALFORMED_HSON");
});

check("wrong discriminator rejects explicitly", () => {
  assert.equal(
    error_code(() => encode_livehost_bootstrap(replace_package(base.bootstrap, { format: "wrong" as typeof LIVEHOST_BOOTSTRAP_FORMAT }))),
    "LIVEHOST_BOOTSTRAP_FORMAT_UNSUPPORTED",
  );
});

check("unsupported version rejects without downgrade", () => {
  assert.equal(
    error_code(() => encode_livehost_bootstrap(replace_package(base.bootstrap, { formatVersion: 2 as 1 }))),
    "LIVEHOST_BOOTSTRAP_VERSION_UNSUPPORTED",
  );
});

check("missing and extra fields reject under exact-key policy", () => {
  const plain = hson.fromHson(encode_livehost_bootstrap(base.bootstrap)).toJson().value() as Record<string, unknown>;
  const { rev: _rev, ...missing } = plain;
  assert.equal(
    error_code(() => decode_livehost_bootstrap(hson.fromJson(JSON.stringify(missing)).toHson().noBreak().serialize())),
    "LIVEHOST_BOOTSTRAP_ENVELOPE_INVALID",
  );
  assert.equal(
    error_code(() => decode_livehost_bootstrap(hson.fromJson(JSON.stringify({ ...plain, extra: true })).toHson().noBreak().serialize())),
    "LIVEHOST_BOOTSTRAP_ENVELOPE_INVALID",
  );
});

check("invalid selector and canonical identities reject", () => {
  assert.equal(
    error_code(() => encode_livehost_bootstrap(replace_package(base.bootstrap, { authoritySelector: "" }))),
    "LIVEHOST_BOOTSTRAP_SELECTOR_INVALID",
  );
  assert.equal(
    error_code(() => encode_livehost_bootstrap(replace_package(base.bootstrap, { logicalMapId: "" }))),
    "LIVEHOST_BOOTSTRAP_IDENTITY_INVALID",
  );
});

check("invalid revision and mode reject", () => {
  assert.equal(
    error_code(() => encode_livehost_bootstrap(replace_package(base.bootstrap, { rev: -1 }))),
    "LIVEHOST_BOOTSTRAP_REVISION_INVALID",
  );
  assert.equal(
    error_code(() => encode_livehost_bootstrap(replace_package(base.bootstrap, { mode: "unknown" as "data-object" }))),
    "LIVEHOST_BOOTSTRAP_MODE_INVALID",
  );
});

check("mode/state mismatch rejects before installation", () => {
  assert.equal(
    error_code(() => install_livehost_bootstrap(replace_package(base.bootstrap, { mode: "data-array" }))),
    "LIVEHOST_BOOTSTRAP_STATE_INVALID",
  );
});

check("malformed graph and duplicate document QUIDs reject", () => {
  const malformed = replace_package(base.bootstrap, {
    state: { format: "hson", payload: "<main" },
  });
  assert.equal(error_code(() => install_livehost_bootstrap(malformed)), "LIVEHOST_BOOTSTRAP_STATE_INVALID");
  const duplicate = replace_package(base.bootstrap, {
    mode: "fragment",
    state: {
      format: "hson",
      payload: `<div @0000000000000001/> <span @0000000000000001/>`,
    },
  });
  assert.equal(error_code(() => install_livehost_bootstrap(duplicate)), "LIVEHOST_BOOTSTRAP_STATE_INVALID");
});

check("encoded-byte and graph limits reject structurally", () => {
  assert.equal(
    error_code(() => decode_livehost_bootstrap(encode_livehost_bootstrap(base.bootstrap), { maxBytes: 10 })),
    "LIVEHOST_BOOTSTRAP_TOO_LARGE",
  );
  assert.equal(
    error_code(() => install_livehost_bootstrap(base.bootstrap, { maxGraphNodes: 1 })),
    "LIVEHOST_BOOTSTRAP_GRAPH_LIMIT_EXCEEDED",
  );
});

function verify_mode(name: string, authority: ReturnType<typeof create_livehost>): void {
  const bootstrap = capture_livehost_bootstrap(authority, `probe:${name}`, `/ws/${name}`);
  const installed = install_livehost_bootstrap(decode_livehost_bootstrap(encode_livehost_bootstrap(bootstrap)));
  assert.equal(installed.map.mode, authority.map.mode);
  assert.equal(installed.map.rev, authority.stream.headRev);
  assert.deepEqual(installed.map.capture(), authority.map.capture());
}

check("data-object bootstrap installs exact state and revision", () => {
  const authority = create_livehost({ state: { value: {} }, authority: "shared" });
  verify_mode("data-object", authority);
});

check("data-array bootstrap installs exact state and revision", () => {
  verify_mode("data-array", create_livehost({ state: [1, 2], authority: "shared" }));
});

check("element bootstrap installs exact state and revision", () => {
  verify_mode("element", create_livehost({
    map: hson.liveMap.fromHson(`<main @0000000000000001 "hello"/>`),
    authority: "shared",
  }));
});

check("fragment bootstrap installs exact state and revision", () => {
  verify_mode("fragment", create_livehost({
    map: hson.liveMap.fromHson(`"before" <em @0000000000000002 "middle"/>`),
    authority: "shared",
  }));
});

check("preinstalled mirror continues as current through existing recovery", async () => {
  const { authority, bootstrap } = fixture();
  const pair = socket_pair();
  authority.connect(pair.server);
  const installed = install_livehost_bootstrap(bootstrap);
  const client = create_livehost_bootstrap_client(installed, { socket: pair.client });
  assert.equal(client.status, "installed");
  const result = await client.connect_and_recover();
  assert.equal(result.strategy, "current");
  assert.equal(result.headRev, bootstrap.rev);
  assert.equal(client.client.recovery.status, "caught_up");
  assert.equal(client.status, "live");
  client.dispose();
  client.dispose();
  assert.equal(client.status, "disposed");
});

check("commits after HTTP cut replay exactly once", async () => {
  const { authority, bootstrap } = fixture();
  authority.map.set(["value"], 2);
  authority.map.set(["value"], 3);
  const pair = socket_pair();
  authority.connect(pair.server);
  const client = create_livehost_bootstrap_client(install_livehost_bootstrap(bootstrap), { socket: pair.client });
  const result = await client.connect_and_recover();
  assert.equal(result.strategy, "replay");
  assert.equal(client.map.rev, authority.stream.headRev);
  assert.deepEqual(client.map.capture(), authority.map.capture());
  assert.equal(client.client.recovery.debug().duplicateCommitsIgnored, 0);
  client.dispose();
});

check("duplicate revision delivery after bootstrap recovery is ignored", async () => {
  const { authority, bootstrap } = fixture();
  authority.map.set(["value"], 2);
  const commit = authority.stream.history.replay_after(0)?.[0];
  assert.ok(commit);
  const pair = socket_pair();
  authority.connect(pair.server);
  const client = create_livehost_bootstrap_client(install_livehost_bootstrap(bootstrap), { socket: pair.client });
  await client.connect_and_recover();
  const request = pair.clientSent.map((raw) => JSON.parse(raw)).find((message) => message.type === "recover");
  assert.ok(request);
  pair.server.send(JSON.stringify({ type: "commit", id: request.id, commit }));
  assert.equal(client.client.recovery.debug().duplicateCommitsIgnored, 1);
  assert.deepEqual(client.map.capture(), authority.map.capture());
  client.dispose();
});

check("revision gap after bootstrap recovery fails through the existing client policy", async () => {
  const { authority, bootstrap } = fixture();
  const pair = socket_pair();
  authority.connect(pair.server);
  const client = create_livehost_bootstrap_client(install_livehost_bootstrap(bootstrap), { socket: pair.client });
  await client.connect_and_recover();
  const request = pair.clientSent.map((raw) => JSON.parse(raw)).find((message) => message.type === "recover");
  assert.ok(request);
  const other = create_livehost({
    state: { value: 1 },
    logicalMapId: bootstrap.logicalMapId,
    incarnationId: bootstrap.incarnationId,
    authority: "shared",
  });
  other.map.set(["value"], 2);
  other.map.set(["value"], 3);
  const gap = other.stream.history.replay_after(1)?.[0];
  assert.ok(gap);
  pair.server.send(JSON.stringify({ type: "commit", id: request.id, commit: gap }));
  assert.equal(client.client.recovery.status, "failed");
  assert.equal(client.client.recovery.failure?.code, "LIVEHOST_RECOVERY_COMMIT_GAP");
  client.dispose();
  other.dispose();
});

check("commit published during recovery is ordered after the selected body", async () => {
  const { authority, bootstrap } = fixture();
  authority.map.set(["value"], 2);
  const pair = socket_pair();
  let publishedTail = false;
  pair.before_server_delivery((message) => {
    if (message.type !== "recovery-plan" || publishedTail) return;
    publishedTail = true;
    authority.map.set(["value"], 3);
  });
  authority.connect(pair.server);
  const client = create_livehost_bootstrap_client(install_livehost_bootstrap(bootstrap), { socket: pair.client });
  const result = await client.connect_and_recover();
  assert.equal(result.strategy, "replay");
  assert.equal(publishedTail, true);
  assert.deepEqual(client.map.capture(), authority.map.capture());
  assert.equal(client.client.recovery.lastAppliedRev, authority.stream.headRev);
  client.dispose();
});

check("history eviction replaces the bootstrap mirror through existing snapshot recovery", async () => {
  const { authority, bootstrap } = fixture({ value: 1 }, { maxCommits: 0 });
  authority.map.set(["value"], 2);
  const pair = socket_pair();
  authority.connect(pair.server);
  const client = create_livehost_bootstrap_client(install_livehost_bootstrap(bootstrap), { socket: pair.client });
  const result = await client.connect_and_recover();
  assert.equal(result.strategy, "snapshot");
  assert.equal(client.map.rev, authority.stream.headRev);
  assert.deepEqual(client.map.capture(), authority.map.capture());
  client.dispose();
});

check("incarnation replacement never treats revision equality as current", async () => {
  const first = fixture();
  const replacement = create_livehost({
    state: { value: 9 },
    authority: "shared",
    logicalMapId: first.bootstrap.logicalMapId,
    incarnationId: "replacement-incarnation",
  });
  const pair = socket_pair();
  replacement.connect(pair.server);
  const client = create_livehost_bootstrap_client(install_livehost_bootstrap(first.bootstrap), { socket: pair.client });
  const result = await client.connect_and_recover();
  assert.equal(result.strategy, "snapshot");
  assert.equal(result.headRev, replacement.stream.headRev);
  assert.deepEqual(client.map.capture(), replacement.map.capture());
  client.dispose();
});

check("different logical authority rejects continuation", async () => {
  const first = fixture();
  const wrong = create_livehost({ state: { value: 9 }, logicalMapId: "other-map", authority: "shared" });
  const pair = socket_pair();
  wrong.connect(pair.server);
  const client = create_livehost_bootstrap_client(install_livehost_bootstrap(first.bootstrap), { socket: pair.client });
  await assert.rejects(client.connect_and_recover(), /different logical map|invalid target/i);
  assert.equal(client.client.recovery.status, "failed");
  client.dispose();
});

check("equal route-local selectors stay isolated across application-owned authorities", () => {
  const left = create_livehost({
    state: { owner: "left" },
    logicalMapId: "left-map",
    authority: "shared",
  });
  const right = create_livehost({
    state: { owner: "right" },
    logicalMapId: "right-map",
    authority: "shared",
  });
  const leftBootstrap = capture_livehost_bootstrap(left, "local:equal", "/left");
  const rightBootstrap = capture_livehost_bootstrap(right, "local:equal", "/right");
  assert.equal(leftBootstrap.authoritySelector, rightBootstrap.authoritySelector);
  assert.notEqual(leftBootstrap.logicalMapId, rightBootstrap.logicalMapId);
  assert.notDeepEqual(
    install_livehost_bootstrap(leftBootstrap).map.capture(),
    install_livehost_bootstrap(rightBootstrap).map.capture(),
  );
  left.dispose();
  assert.deepEqual(
    install_livehost_bootstrap(capture_livehost_bootstrap(right, "local:equal", "/right")).map.capture(),
    right.map.capture(),
  );
  right.dispose();
});

check("socket failure remains distinct from installed state and releases cleanly", async () => {
  const { bootstrap } = fixture();
  const pair = socket_pair();
  const client = create_livehost_bootstrap_client(install_livehost_bootstrap(bootstrap), { socket: pair.client });
  const installedCapture = client.map.capture();
  const recovery = client.connect_and_recover();
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
  const captured = capture_livehost_bootstrap(create_livehost({ state: { ready: true }, authority: "shared" }), "probe:dom-free", "/ws");
  const capture = install_livehost_bootstrap(captured).map.capture();
  assert.equal("value" in capture, true);
  assert.deepEqual("value" in capture ? capture.value : undefined, { ready: true });
});

check("real HTTP helper and WebSocket continuation share one application authority", async () => {
  const authority = create_livehost({
    state: { value: 1 },
    authority: "shared",
    logicalMapId: "network-map",
    incarnationId: "network-incarnation",
  });
  const selector = "probe:network";
  let resolutions = 0;
  let acquisitionReleases = 0;
  const application: NodeHostedApplication = {
    name: "bootstrap-probe",
    authorities: [{ kind: "exact", value: selector }],
    httpRoutes: Object.freeze(["GET", "POST"].map((method) => Object.freeze({
      method,
      path: "/bootstrap",
      handle(request: IncomingMessage, response: ServerResponse) {
        return handle_node_livehost_bootstrap_request(request, response, {
          resolve(candidate) {
            resolutions += 1;
            return candidate === selector
              ? {
                  ok: true,
                  authority,
                  websocketEndpoint: `/?livehost=${encodeURIComponent(selector)}`,
                  release: () => { acquisitionReleases += 1; },
                }
              : {
                  ok: false,
                  status: 404,
                  code: "LIVEHOST_BOOTSTRAP_AUTHORITY_UNKNOWN",
                  message: "Unknown bootstrap authority.",
                };
          },
        });
      },
    }))),
    acceptWebSocket(candidate, websocket) {
      assert.equal(candidate, selector);
      authority.connect(create_node_livehost_socket(websocket));
    },
    dispose() {
      authority.dispose();
    },
  };
  const host = await start_node_application_host({ port: 0, applications: [application] });
  try {
    const response = await fetch(`${host.httpUrl}/bootstrap?livehost=${encodeURIComponent(selector)}`, {
      headers: { accept: LIVEHOST_BOOTSTRAP_MEDIA_TYPE },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), LIVEHOST_BOOTSTRAP_MEDIA_TYPE);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const bootstrap = decode_livehost_bootstrap(await response.text());
    authority.map.set(["value"], 2);
    const websocket = new WebSocket(new URL(bootstrap.continuation.endpoint, host.url));
    await new Promise<void>((resolve, reject) => {
      websocket.once("open", resolve);
      websocket.once("error", reject);
    });
    const client = create_livehost_bootstrap_client(
      install_livehost_bootstrap(bootstrap),
      { socket: create_node_livehost_socket(websocket) },
    );
    const recovered = await client.connect_and_recover();
    assert.equal(recovered.strategy, "replay");
    authority.map.set(["value"], 3);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(client.map.capture(), authority.map.capture());
    assert.equal(client.map.rev, authority.stream.headRev);
    assert.equal(resolutions, 1);
    assert.equal(acquisitionReleases, 1);
    client.dispose();
    websocket.close();
  } finally {
    await host.stop();
  }
});

check("HTTP accepts wildcard media type and rejects incompatible Accept", async () => {
  const authority = create_livehost({ state: { value: 1 }, authority: "shared" });
  const application: NodeHostedApplication = {
    name: "accept-probe",
    authorities: [{ kind: "exact", value: "accept:one" }],
    httpRoutes: Object.freeze([Object.freeze({
      method: "GET",
      path: "/bootstrap",
      handle(request: IncomingMessage, response: ServerResponse) {
        return handle_node_livehost_bootstrap_request(request, response, {
          resolve: () => ({ ok: true, authority, websocketEndpoint: "/ws" }),
        });
      },
    })]),
    acceptWebSocket() {},
    dispose() { authority.dispose(); },
  };
  const host = await start_node_application_host({ port: 0, applications: [application] });
  try {
    assert.equal((await fetch(`${host.httpUrl}/bootstrap?livehost=accept%3Aone`, { headers: { accept: "*/*" } })).status, 200);
    const rejected = await fetch(`${host.httpUrl}/bootstrap?livehost=accept%3Aone`, { headers: { accept: "application/json" } });
    assert.equal(rejected.status, 406);
    assert.deepEqual(await rejected.json(), {
      error: {
        code: "LIVEHOST_BOOTSTRAP_NOT_ACCEPTABLE",
        message: "The requested response media type is not available.",
      },
    });
  } finally {
    await host.stop();
  }
});

check("HTTP rejects method, missing selector, unknown authority, and hides stacks", async () => {
  const authority = create_livehost({ state: { value: 1 }, authority: "shared" });
  const handler = (request: IncomingMessage, response: ServerResponse) =>
    handle_node_livehost_bootstrap_request(request, response, {
      resolve: (selector) => selector === "known"
        ? { ok: true, authority, websocketEndpoint: "/ws" }
        : {
            ok: false,
            status: 404,
            code: "LIVEHOST_BOOTSTRAP_AUTHORITY_UNKNOWN",
            message: "Unknown authority.",
          },
    });
  const application: NodeHostedApplication = {
    name: "errors",
    authorities: [{ kind: "exact", value: "known" }],
    httpRoutes: Object.freeze(["GET", "POST"].map((method) => Object.freeze({
      method,
      path: "/bootstrap",
      handle: handler,
    }))),
    acceptWebSocket() {},
    dispose() { authority.dispose(); },
  };
  const host = await start_node_application_host({ port: 0, applications: [application] });
  try {
    const method = await fetch(`${host.httpUrl}/bootstrap?livehost=known`, { method: "POST" });
    assert.equal(method.status, 405);
    assert.equal(method.headers.get("allow"), "GET");
    assert.equal((await fetch(`${host.httpUrl}/bootstrap`)).status, 400);
    const unknown = await fetch(`${host.httpUrl}/bootstrap?livehost=unknown`);
    assert.equal(unknown.status, 404);
    assert.doesNotMatch(await unknown.text(), /at .+\\.ts|stack/iu);
  } finally {
    await host.stop();
  }
});

check("HTTP encoded-size failure is deterministic and no-store", async () => {
  const authority = create_livehost({ state: { payload: "large" }, authority: "shared" });
  const application: NodeHostedApplication = {
    name: "size",
    authorities: [{ kind: "exact", value: "size:one" }],
    httpRoutes: Object.freeze([Object.freeze({
      method: "GET",
      path: "/bootstrap",
      handle(request: IncomingMessage, response: ServerResponse) {
        return handle_node_livehost_bootstrap_request(request, response, {
          maxBytes: 10,
          resolve: () => ({ ok: true, authority, websocketEndpoint: "/ws" }),
        });
      },
    })]),
    acceptWebSocket() {},
    dispose() { authority.dispose(); },
  };
  const host = await start_node_application_host({ port: 0, applications: [application] });
  try {
    const response = await fetch(`${host.httpUrl}/bootstrap?livehost=size%3Aone`);
    assert.equal(response.status, 413);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.json()).error.code, "LIVEHOST_BOOTSTRAP_TOO_LARGE");
  } finally {
    await host.stop();
  }
});

await sequence;
base.authority.dispose();
process.stdout.write(`1..${checks}\n`);
emit_hson_live_test_completion("livehost.bootstrap", checks, checks, 0);
