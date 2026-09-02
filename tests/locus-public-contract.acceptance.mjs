import assert from "node:assert/strict";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "locus.public-contract",
  title: "Locus public package contract",
  category: "Locus",
  runtime: "node",
  tags: Object.freeze(["locus", "exports", "public-api", "built-package"]),
});

const testEvents = create_test_event_emitter("locus.public-contract");
let checks = 0;

async function check(name, run) {
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
}

const locusRuntimeExports = [
  "DEFAULT_LOCUS_BOOTSTRAP_MAX_BYTES",
  "DEFAULT_LOCUS_BOOTSTRAP_MAX_GRAPH_DEPTH",
  "DEFAULT_LOCUS_BOOTSTRAP_MAX_GRAPH_NODES",
  "LOCUS_BOOTSTRAP_FORMAT",
  "LOCUS_BOOTSTRAP_MEDIA_TYPE",
  "LocusAuthorityError",
  "LocusBootstrapError",
  "LocusDisconnectedError",
  "LocusDuplicateActionIdError",
  "LocusGraphContentCodecError",
  "LocusPersistenceError",
  "LocusRecoveryError",
  "capture_locus_bootstrap",
  "create_browser_locus_socket",
  "create_live_trace_collector",
  "create_live_trace_console_sink",
  "create_locus",
  "create_persistent_locus",
  "decode_locus_bootstrap",
  "decode_locus_graph_content",
  "decode_locus_message",
  "decode_locus_server_message",
  "encode_locus_bootstrap",
  "encode_locus_graph_content",
  "encode_locus_message",
  "hsonLocus",
  "install_locus_bootstrap",
  "is_locus_encoded_graph_content",
  "make_locus_canonical_stream",
  "make_locus_recovery_planner",
  "make_locus_sync_manager",
].sort();

await check("the Locus package resolves with its exact runtime surface", async () => {
  const module = await import("hson-live/locus");
  assert.deepEqual(Object.keys(module).sort(), locusRuntimeExports);
});

await check("the Echo package resolves with its exact endpoint surface", async () => {
  const module = await import("hson-live/echo");
  assert.deepEqual(Object.keys(module).sort(), [
    "EchoRecoveryError",
    "EchoSessionError",
    "create_echo",
    "create_locus_bootstrap_echo",
    "hsonEcho",
  ]);
  assert.deepEqual(Object.keys(module.hsonEcho), ["create"]);
  assert.equal(module.hsonEcho.create, module.create_echo);
});

await check("removed architectural endpoint runtime names have no aliases", async () => {
  const root = await import("hson-live");
  const locus = await import("hson-live/locus");
  const echo = await import("hson-live/echo");
  for (const name of ["create_locus_client", "create_locus_bootstrap_client"]) {
    assert.equal(name in root, false);
    assert.equal(name in locus, false);
    assert.equal(name in echo, false);
  }
  assert.equal("create_locus_bootstrap_echo" in echo, true);
  assert.equal("create_locus_bootstrap_echo" in locus, false);
});

await check("solo Echo exposes only the camelCase endpoint method spellings", async () => {
  const { create_echo } = await import("hson-live/echo");
  const socket = {
    send() {},
    close() {},
    onMessage() { return () => {}; },
    onClose() { return () => {}; },
  };
  const endpoint = create_echo({ socket });
  for (const name of ["onEvent", "retryAction", "actionStatus", "dispose"]) {
    assert.equal(typeof endpoint[name], "function", `missing Echo method ${name}`);
  }
  assert.equal(typeof endpoint.recovery.onChange, "function");
  for (const name of ["on_event", "retry_action", "action_status"]) {
    assert.equal(name in endpoint, false, `unexpected Echo method ${name}`);
  }
  assert.equal("on_change" in endpoint.recovery, false);
  endpoint.dispose();
});

await check("the Locus Node package resolves with only one-map adapters", async () => {
  const module = await import("hson-live/locus/node");
  assert.deepEqual(Object.keys(module).sort(), [
    "create_node_locus_socket",
    "handle_node_locus_bootstrap_request",
  ]);
});

await check("the future-host Node package resolves without Locus adapters", async () => {
  const module = await import("hson-live/livehost/node");
  assert.deepEqual(Object.keys(module).sort(), [
    "LIVEHOST_NODE_MINIMUM_VERSION",
    "LIVEHOST_NODE_SUPPORTED_RANGE",
    "assert_supported_livehost_node_runtime",
    "create_node_development_security",
    "create_node_exact_origin_policy",
    "is_supported_livehost_node_runtime",
    "normalize_node_origin",
    "normalize_node_request",
    "start_node_application_host",
  ]);
});

await check("the generic LiveHost package root exposes only the approved runtime service", async () => {
  const module = await import("hson-live/livehost");
  assert.deepEqual(Object.keys(module).sort(), ["create_livehost_locus_registry"]);
});

await check("the root exposes Locus and no historical one-map aliases", async () => {
  const module = await import("hson-live");
  for (const name of [
    "hsonLocus",
    "hsonEcho",
    "create_locus",
    "create_echo",
    "create_locus_bootstrap_echo",
    "create_persistent_locus",
    "decode_locus_message",
    "decode_locus_server_message",
    "encode_locus_message",
  ]) assert.equal(name in module, true, `missing root export ${name}`);
  for (const name of [
    "hsonLiveHost",
    "liveHost",
    "create_livehost",
    "create_livehost_client",
    "create_persistent_livehost",
    "create_livehost_store",
    "create_livehost_registry",
    "create_livehost_persistent_store",
    "create_livehost_authority_registry",
  ]) assert.equal(name in module, false, `unexpected root export ${name}`);
  assert.equal(module.hson.locus, module.hsonLocus);
  assert.equal(module.hson.echo, module.hsonEcho);
  assert.equal(module.hsonEcho.create, module.create_echo);
  assert.equal("client" in module.hsonLocus, false);
  assert.equal("liveHost" in module.hson, false);
});

process.stdout.write(`1..${checks}\n`);
testEvents.terminal("pass");
