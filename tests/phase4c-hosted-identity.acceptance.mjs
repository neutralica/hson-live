// @hson-live-external-test
import assert from "node:assert/strict";
import { hson } from "../src/index.ts";
import { capture_locus_bootstrap, install_locus_bootstrap } from "../src/api/locus/locus.bootstrap.ts";
import { encode_locus_client_message } from "../src/api/locus/locus.protocol.ts";
import { encode_locus_graph_content } from "../src/api/locus/locus.graph-content-codec.ts";
import { set_livemap_document_quid_candidate_source_for_tests } from "../src/api/livemap/livemap.document.registration.ts";
import { livemap_identity_epoch_accounting } from "../src/api/livemap/livemap.identity-epoch.ts";
import { parse_hson_exact_runtime } from "../src/internal/exact-runtime-hson-codec.ts";
import { admit_exact_runtime_livemap_node } from "../src/internal/exact-runtime-node-admission.ts";
import { acquire_document_identity } from "./helpers/livemap-identity-internal.mts";

const A = "000004001";
const B = "000004002";
const C = "000004003";
const D = "000004004";
const E = "000004005";
const main = { kind: "path", path: [0, 0] };
const subject = { kind: "path", path: [0, 0, 0] };

function document(source) {
  const map = admit_exact_runtime_livemap_node(parse_hson_exact_runtime(source, { allowTopLevelDocumentText: true }));
  assert.equal(map.mode, "document");
  return map;
}
function node(source) { return document(source).at([]).snap(); }
function pair() {
  const toServer = new Set();
  const toClient = new Set();
  const clientSent = [];
  const serverSent = [];
  return {
    clientSent, serverSent,
    client: {
      send(raw) { clientSent.push(raw); for (const receive of [...toServer]) receive(raw); },
      onMessage(receive) { toClient.add(receive); return () => toClient.delete(receive); },
      onClose() { return () => {}; },
    },
    server: {
      send(raw) { serverSent.push(raw); for (const receive of [...toClient]) receive(raw); },
      onMessage(receive) { toServer.add(receive); return () => toServer.delete(receive); },
      onClose() { return () => {}; },
    },
  };
}
function portable(map) { return map.capture({ identity: "strip" }); }
function assert_wire_portable(messages) {
  for (const raw of messages) {
    const message = JSON.parse(raw);
    if (!["action", "commit", "recovery-commit", "recovery-snapshot", "progress", "recovery-progress"].includes(message.type)) continue;
    assert.equal(raw.includes('"quid"') || raw.includes('\\"quid\\"'), false, raw);
    for (const quid of [A, B, C, D, E]) assert.equal(raw.includes(`@${quid}`), false, raw);
  }
}

const authority = document(`<main <p @${A} "old"/> <span/>/>`);
const locus = hson.locus.create({ map: authority, logicalMapId: "phase4c-namespace", sessions: {} });
const bootstrap = capture_locus_bootstrap(locus, "phase4c", "/socket");
assert.equal(bootstrap.format, "hson-locus-bootstrap-v2");
assert.equal(bootstrap.state.payload.includes(A), false);
assert.throws(() => install_locus_bootstrap({
  ...bootstrap,
  state: { format: "hson-client-snapshot-v1", payload: `<main <p @${E}/>/>` },
}), /state|identity|QUID/i);
const installed = install_locus_bootstrap(bootstrap);
const replica = installed.map;
assert.equal(replica.mode, "document");
assert.equal(replica.document.byQuid(A), undefined);
set_livemap_document_quid_candidate_source_for_tests(replica.document, () => B);
const localHandle = acquire_document_identity(replica.document, subject);
assert.equal(localHandle.snap()?.$_meta?.quid, B);
assert.equal(replica.rev, 0);
assert.equal(locus.stream.headRev, 0);

const wire = pair();
locus.connect(wire.server);
const echo = hson.echo.create({ socket: wire.client, map: replica, session: {}, recovery: installed.recovery });
echo.connect();
await echo.session.create();
await echo.recovery.recover();
assert.equal(authority.document.byQuid(A)?.$_tag, "p");
assert.equal(replica.document.byQuid(B)?.$_tag, "p");
assert.equal(authority.document.byQuid(B), undefined);
assert.equal(replica.document.byQuid(A), undefined);
assert_wire_portable([...wire.serverSent, ...wire.clientSent]);

await locus.mutate((draft) => draft.document.content.move(main, 0, 1));
assert.equal(authority.document.byQuid(A)?.$_tag, "p");
assert.equal(replica.document.byQuid(B)?.$_tag, "p");
assert.deepEqual(portable(replica), portable(authority));

await locus.mutate((draft) => draft.document.content.replace(main, 1, node('<article "server"/>'), [{ source: [], destination: [] }]));
assert.equal(authority.document.byQuid(A)?.$_tag, "article");
assert.equal(replica.document.byQuid(B)?.$_tag, "article");
assert.deepEqual(portable(replica), portable(authority));

await locus.mutate((draft) => draft.document.content.insert(main, 2, node('<aside/>')));
set_livemap_document_quid_candidate_source_for_tests(authority.document, () => C);
assert.equal(acquire_document_identity(authority.document, { kind: "path", path: [0, 0, 2] }).snap()?.$_meta?.quid, C);
assert.equal(replica.document.byQuid(C), undefined);
assert.deepEqual(portable(replica), portable(authority));

const inserted = await echo.action("document.content.insert", { target: main, index: 3, content: node('<strong/>') });
assert.equal(inserted.type, "ack");
assert.equal(authority.document.byQuid(D), undefined);
assert.equal(replica.document.byQuid(D), undefined);
assert.deepEqual(portable(replica), portable(authority));

const replaced = await echo.action("document.content.replace", {
  target: main,
  index: 1,
  replacement: node('<em "client"/>'),
  lineage: [{ source: [], destination: [] }],
});
assert.equal(replaced.type, "ack", JSON.stringify(replaced));
assert.equal(authority.document.byQuid(A)?.$_tag, "em");
assert.equal(replica.document.byQuid(B)?.$_tag, "em");
assert.deepEqual(portable(replica), portable(authority));
assert_wire_portable([...wire.serverSent, ...wire.clientSent]);

const priorRev = authority.rev;
const priorState = authority.capture();
const priorLedger = livemap_identity_epoch_accounting(authority.document);
const hostileContent = encode_locus_graph_content(node(`<i @${E}/>`));
wire.client.send(encode_locus_client_message({
  type: "action",
  id: "phase4c-hostile",
  name: "document.content.insert",
  payload: { target: main, index: 0, content: { format: "hson-graph-portable-v1", payload: hostileContent.payload } },
}));
await Promise.resolve();
const hostileResponse = wire.serverSent.map(JSON.parse).find((message) => message.id === "phase4c-hostile");
assert.equal(hostileResponse?.type, "error");
assert.equal(authority.rev, priorRev);
assert.deepEqual(authority.capture(), priorState);
assert.deepEqual(livemap_identity_epoch_accounting(authority.document), priorLedger);
assert_wire_portable([...wire.serverSent, ...wire.clientSent].filter((raw) => JSON.parse(raw).id !== "phase4c-hostile"));

const reconnectCursor = { incarnationId: echo.recovery.incarnationId, lastAppliedRev: echo.recovery.lastAppliedRev };
echo.dispose();
await locus.mutate((draft) => draft.document.attrs.set({ kind: "path", path: [0, 0, 1] }, "title", "rejoined"));
const reconnectWire = pair();
locus.connect(reconnectWire.server);
const rejoinedEcho = hson.echo.create({
  socket: reconnectWire.client,
  map: replica,
  session: {},
  recovery: { logicalMapId: installed.recovery.logicalMapId, cursor: reconnectCursor },
});
rejoinedEcho.connect();
await rejoinedEcho.session.create();
assert.equal((await rejoinedEcho.recovery.recover()).strategy, "replay");
assert.equal(replica.document.byQuid(B)?.$_attrs?.title, "rejoined");
assert.equal(replica.document.byQuid(A), undefined);
assert.deepEqual(portable(replica), portable(authority));
assert_wire_portable([...reconnectWire.serverSent, ...reconnectWire.clientSent]);
rejoinedEcho.dispose();
locus.dispose();

// A disconnected Echo with a client-local identity replays the retained path
// effects and replacement lineage without resetting its epoch.
const replayAuthority = document(`<main <p @${A} "old"/> <span/>/>`);
const replayLocus = hson.locus.create({ map: replayAuthority, logicalMapId: "phase4c-retained", sessions: {} });
const replayInstall = install_locus_bootstrap(capture_locus_bootstrap(replayLocus, "phase4c-retained", "/socket"));
const replayReplica = replayInstall.map;
set_livemap_document_quid_candidate_source_for_tests(replayReplica.document, () => B);
const retainedHandle = acquire_document_identity(replayReplica.document, subject);
const replayEpoch = livemap_identity_epoch_accounting(replayReplica.document).epoch;
await replayLocus.mutate((draft) => draft.document.content.move(main, 0, 1));
await replayLocus.mutate((draft) => draft.document.content.replace(main, 1, node('<article "retained"/>'), [{ source: [], destination: [] }]));
const replayWire = pair();
replayLocus.connect(replayWire.server);
const replayEcho = hson.echo.create({ socket: replayWire.client, map: replayReplica, session: {}, recovery: replayInstall.recovery });
replayEcho.connect();
await replayEcho.session.create();
assert.equal((await replayEcho.recovery.recover()).strategy, "replay");
assert.equal(replayReplica.document.byQuid(B)?.$_tag, "article");
assert.equal(replayReplica.document.byQuid(A), undefined);
assert.equal(retainedHandle.active, true);
assert.equal(livemap_identity_epoch_accounting(replayReplica.document).epoch, replayEpoch);
assert.deepEqual(portable(replayReplica), portable(replayAuthority));
assert_wire_portable([...replayWire.serverSent, ...replayWire.clientSent]);
replayEcho.dispose();
replayLocus.dispose();

const errorAuthority = document(`<main <p @${A}/>/>`);
const errorLocus = hson.locus.create({
  map: errorAuthority,
  actions: {
    duplicate: (context) => context.mutate((draft) => draft.document.content.insert(main, 1, node(`<aside @${A}/>`))),
  },
});
const errorResponse = await errorLocus.dispatchAction({ type: "action", id: "identity-error", name: "duplicate" });
assert.equal(errorResponse.type, "error");
assert.equal(errorResponse.error.message.includes(A), false);
assert.equal(errorAuthority.rev, 0);
errorLocus.dispose();
process.stdout.write("Phase 4C two-runtime QUID namespace and hosted wire acceptance passed.\n");
