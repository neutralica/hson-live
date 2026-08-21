import assert from "node:assert/strict";

let checks = 0;

async function check(name, run) {
  await run();
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
  "LocusClientRecoveryError",
  "LocusClientSessionError",
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
  "create_locus_bootstrap_client",
  "create_locus_client",
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
    "create_locus",
    "create_locus_client",
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
  assert.equal("liveHost" in module.hson, false);
});

process.stdout.write(`1..${checks}\n`);
