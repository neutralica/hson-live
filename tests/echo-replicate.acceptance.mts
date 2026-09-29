import assert from "node:assert/strict";
import { hsonEcho, hsonLiveMap, hsonLocus, type Locus, type LocusOptions, type LocusSocketLike } from "../src/index.ts";
import { create_registry_locus_internal } from "../src/api/locus/locus.registry.ts";
import { encode_hosted_root } from "../src/api/livemap/livemap.hosted.ts";
import { parse_hson_exact_runtime } from "../src/internal/exact-runtime-hson-codec.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "echo.replicate", title: "Echo retained-session replica establishment", category: "Echo", runtime: "node",
  tags: Object.freeze(["echo", "recovery", "session", "headless", "public"]),
});

function socket_pair() {
  const toServer = new Set<(raw: string) => void>();
  const toClient = new Set<(raw: string) => void>();
  const client: LocusSocketLike = {
    send(raw) { for (const listener of [...toServer]) listener(raw); }, close() {},
    onMessage(listener) { toClient.add(listener); return () => { toClient.delete(listener); }; },
    onClose() { return () => {}; },
  };
  const server: LocusSocketLike = {
    send(raw) { for (const listener of [...toClient]) listener(raw); }, close() {},
    onMessage(listener) { toServer.add(listener); return () => { toServer.delete(listener); }; },
    onClose() { return () => {}; },
  };
  return { client, server, clientListenerCount: () => toClient.size };
}

for (const expected of ["current", "replay", "snapshot"] as const) {
  const map = hsonLiveMap.fromLibraries({ state: { data: { value: 0 } } });
  const options: LocusOptions<typeof map> = {
    map,
    exposure: [{ library: "state", exposure: "client-public" as const }],
    defaultProjection: { libraries: ["state"] },
    authorizeProjection: () => ({ libraries: ["state"] }),
  };
  const locus: Locus<typeof map> = expected === "snapshot"
    ? create_registry_locus_internal(options, { maxHistoryBytes: 1 }).locus
    : hsonLocus.create(options);
  const session = await locus.session.create({ libraries: ["state"] });
  const cut = session.cut();
  if (expected !== "current") await locus.mutate((draft) => {
    const state = draft.lib("state");
    if (!("at" in state)) throw new Error("Expected a data draft.");
    state.at(["value"]).set(1);
  });
  const pair = socket_pair();
  const detach = locus.connect(pair.server);
  if (expected === "current") {
    await assert.rejects(hsonEcho.replicate({ cut: { libs: { ...cut.libs, projectionDigest: "0".repeat(64) } },
      credential: session.credential!, socket: pair.client }), /digest|projection/i);
    assert.equal(pair.clientListenerCount(), 0, "invalid cut does not install transport listeners");
    const ahead = socket_pair();
    const detachAhead = locus.connect(ahead.server);
    await assert.rejects(hsonEcho.replicate({ cut: { libs: { ...cut.libs, revision: cut.libs.revision + 1 } },
      credential: session.credential!, socket: ahead.client }), /ahead|recovery/i);
    assert.equal(ahead.clientListenerCount(), 0, "failed recovery releases transport listeners");
    detachAhead();
  }
  const echo = await hsonEcho.replicate({ cut, credential: session.credential!, socket: pair.client });
  assert.equal(echo.session.status, "attached");
  assert.equal(echo.recovery.status, "caught_up");
  assert.equal(echo.recovery.strategy, expected);
  assert.equal(echo.recovery.debug().lastAppliedRev, locus.rev);
  const state = echo.map.lib("state");
  if (state.mode === "document") throw new Error("Expected a data library.");
  assert.equal(state.snap(["value"]), expected === "current" ? 0 : 1);
  assert.throws(() => state.at(["value"]).set(2), /authority|managed|controlled|reserved/i);
  echo.dispose();
  assert.equal(pair.clientListenerCount(), 0);
  detach(); locus.dispose();
}

{
  const map = hsonLiveMap.fromLibraries({ state: { data: { value: 0 } } });
  const locus = hsonLocus.create({ map,
    exposure: [{ library: "state", exposure: "client-public" }],
    authorizeProjection: () => ({ libraries: ["state"] }),
  });
  const session = await locus.session.create({ libraries: ["state"] });
  const pair = socket_pair();
  const detach = locus.connect(pair.server);
  await assert.rejects(hsonEcho.replicate({ cut: session.cut(), credential: "invalid-credential", socket: pair.client }));
  assert.equal(pair.clientListenerCount(), 0, "failed attachment releases transport listeners");
  const empty = await locus.session.create({ libraries: [] });
  assert.deepEqual(empty.cut().libs.libraries, []);
  await assert.rejects(hsonEcho.replicate({ cut: empty.cut(), credential: empty.credential!, socket: pair.client }), /no LiveMap|application libraries/i);
  assert.equal(pair.clientListenerCount(), 0, "action-only cut does not create a replica endpoint");
  detach(); locus.dispose();
}

{
  const map = hsonLiveMap.fromLibraries({ state: { data: { value: 0 } } });
  const locus = hsonLocus.create({ map,
    exposure: [{ library: "state", exposure: "client-public" }],
    authorizeProjection: () => ({ libraries: ["state"] }),
  });
  const session = await locus.session.create({ libraries: ["state"] }, { connection: { principalId: "alice" } });
  const pair = socket_pair();
  const detach = locus.connect(pair.server, { principalId: "mallory" });
  await assert.rejects(hsonEcho.replicate({ cut: session.cut(), credential: session.credential!, socket: pair.client }));
  assert.equal(pair.clientListenerCount(), 0, "principal rejection releases transport listeners");
  detach(); locus.dispose();
}

{
  const map = hsonLiveMap.fromLibraries({ page: { document: "<main/>" } });
  const locus = hsonLocus.create({ map,
    exposure: [{ library: "page", exposure: "client-public" }],
    authorizeProjection: () => ({ libraries: ["page"] }),
  });
  const session = await locus.session.create({ libraries: ["page"] });
  const cut = session.cut();
  const quidRoot = encode_hosted_root(parse_hson_exact_runtime("<main @000000001/>", { allowTopLevelDocumentText: true }));
  const forged = { libs: { ...cut.libs, libraries: cut.libs.libraries.map((entry) => ({ ...entry, root: quidRoot })) } };
  const pair = socket_pair();
  await assert.rejects(hsonEcho.replicate({ cut: forged, credential: session.credential!, socket: pair.client }), /malformed/i);
  assert.equal(pair.clientListenerCount(), 0);
  locus.dispose();
}

console.log("Echo high-level replication current, replay, snapshot, admission, QUID fencing, and failure cleanup passed.");
