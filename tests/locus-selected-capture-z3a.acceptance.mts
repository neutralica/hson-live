import assert from "node:assert/strict";
import { MemoryCheckpointAdapter } from "./helpers/memory-checkpoint-adapter.mts";
import { Hson, hsonLiveMap, render_hosted_document, type HsonSchema } from "../src/index.ts";
import type { LocusSocketLike } from "../src/types/locus.types.ts";
import { create_registry_locus_internal } from "../src/api/locus/locus.registry.ts";
import { create_echo_socket_client_internal } from "../src/api/echo/echo.aggregate-replica.ts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";
import { capture_selected_authority_projection_snapshot } from "../src/api/locus/locus.authority-projection-snapshot.ts";
import { make_locus_hosted_projection_policy, normalize_locus_effective_projection } from "../src/api/locus/locus.projection.ts";
import { validate_document_path } from "../src/api/livemap/livemap.document.path.ts";
import { create_persistent_locus } from "../src/api/locus/index.ts";

const Data: HsonSchema = Hson.schema`<type "data" content <value "string">>`;
const Page: HsonSchema = Hson.schema`<type "document" tag "main" content <sequence [<tag "p" content "string">]>>`;
const privateValue = `PRIVATE_ROOT_SENTINEL${"x".repeat(65 * 1024 * 1024)}`;
assert.ok(privateValue.length > 64 * 1024 * 1024);
const map = hsonLiveMap.fromLibraries({
  page: { document: '<main <p "PUBLIC_PAGE_SENTINEL"/>/>', schema: Page },
  PRIVATE_NAME_SENTINEL: { data: { value: privateValue }, schema: Data },
  privateSignal: { data: { value: "PRIVATE_SIGNAL_INITIAL" }, schema: Data },
});
const aggregate = internal_livemap_aggregate_authority(map);
const exposure = [{ library: "page", exposure: "client-public" as const },
  { library: "PRIVATE_NAME_SENTINEL", exposure: "server-private" as const },
  { library: "privateSignal", exposure: "server-private" as const }];
assert.throws(() => aggregate.captureHosted(), /bound|limit|size|payload/i);
const { locus } = create_registry_locus_internal({ map, exposure,
  defaultProjection: { libraries: ["page"], htmlDocument: "page" },
  authorizeProjection: () => ({ libraries: ["page"] }),
}, { maxHistoryBytes: 1 });

const serverListeners = new Set<(raw: string) => void>();
const clientListeners = new Set<(raw: string) => void>();
const sent: string[] = [];
const clientSocket: LocusSocketLike = {
  send(raw) { for (const listener of [...serverListeners]) listener(raw); }, close() {},
  onMessage(listener) { clientListeners.add(listener); return () => { clientListeners.delete(listener); }; },
  onClose() { return () => {}; },
};
const serverSocket: LocusSocketLike = {
  send(raw) { sent.push(raw); for (const listener of [...clientListeners]) listener(raw); }, close() {},
  onMessage(listener) { serverListeners.add(listener); return () => { serverListeners.delete(listener); }; },
  onClose() { return () => {}; },
};
let detach = locus.connect(serverSocket);
const echo = create_echo_socket_client_internal({ socket: clientSocket, logicalMapId: locus.logicalMapId,
  localLibraries: { local: { data: { value: "LOCAL_SENTINEL" }, schema: Data } } });
const initial = await echo.connect();
assert.equal(initial.outcome, "snapshot");
const session = sent.map((raw) => JSON.parse(raw)).find((message) => message.type === "session-created");
assert.equal(typeof session?.sessionId, "string");
const cut = locus.cut(session.sessionId);
const rendered = render_hosted_document({ authority: locus, sessionId: session.sessionId });
assert.equal(cut.revision, cut.data.revision);
assert.equal(rendered.revision, cut.revision);
assert.equal(rendered.html, cut.html);
assert.match(cut.html, /PUBLIC_PAGE_SENTINEL/);
const artifact = JSON.stringify(cut.data);
for (const hidden of ["PRIVATE_NAME_SENTINEL", "PRIVATE_ROOT_SENTINEL", "hson:quid", "issuedQuids", "registryDigest"]) {
  assert.equal(artifact.includes(hidden), false, hidden);
}
assert.match(artifact, /PUBLIC_PAGE_SENTINEL/);
assert.equal(cut.data.libraries.length, 1);
const oldCut = JSON.stringify(cut);
const local = echo.map?.lib("local");
if (local === undefined || local.mode === "document") throw new Error("Local Library missing.");
const localHandle = local.at(["value"]);
echo.disconnect();
detach();
localHandle.set("LOCAL_AFTER_DISCONNECT");
await locus.mutate((draft) => { const page = draft.lib("page"); if ("attrs" in page) page.attrs.set({ kind: "path", path: validate_document_path([0]) }, "title", "PUBLIC_NEXT_SENTINEL"); });
await locus.mutate((draft) => { const privateLib = draft.lib("privateSignal"); if ("at" in privateLib) privateLib.at(["value"]).set(`PRIVATE_SMALL_COMMIT_SENTINEL${"q".repeat(2 * 1024 * 1024)}`); });
assert.equal(JSON.stringify(cut), oldCut);
const nextCut = locus.cut(session.sessionId);
assert.equal(nextCut.revision, locus.rev);
assert.equal(nextCut.data.revision, locus.rev);
assert.match(nextCut.html, /PUBLIC_NEXT_SENTINEL/);
detach = locus.connect(serverSocket);
const recovered = await echo.connect();
assert.equal(recovered.outcome, "snapshot");
assert.equal(echo.lastAppliedRev, locus.rev);
assert.equal(localHandle.snap(), "LOCAL_AFTER_DISCONNECT");
assert.equal(echo.map?.lib("local"), local);
const snapshots = sent.filter((raw) => JSON.parse(raw).type === "recovery-snapshot");
assert.equal(snapshots.length, 2);
assert.equal(snapshots[1]?.includes("PRIVATE_NAME_SENTINEL"), false);
assert.equal(snapshots[1]?.includes("PRIVATE_SMALL_COMMIT_SENTINEL"), false);

const policy = make_locus_hosted_projection_policy(aggregate.hostedRegistry(), aggregate.hostedPosition().authority,
  exposure, undefined, () => ({ libraries: [] }));
const zero = await normalize_locus_effective_projection(policy, { libraries: [] });
const empty = capture_selected_authority_projection_snapshot(map, zero);
assert.deepEqual(empty.libraries, []);
assert.equal(empty.revision, locus.rev);

echo.dispose();
detach();
locus.dispose();

const { locus: zeroLocus } = create_registry_locus_internal({ map, exposure,
  defaultProjection: { libraries: [] }, authorizeProjection: () => ({ libraries: [] }),
}, { maxHistoryBytes: 1 });
let detachZero = zeroLocus.connect(serverSocket);
const endpoint = create_echo_socket_client_internal({ socket: clientSocket, logicalMapId: zeroLocus.logicalMapId });
const zeroInitial = await endpoint.connect();
assert.equal(zeroInitial.outcome, "snapshot");
assert.equal(endpoint.map, undefined);
assert.equal(endpoint.lastAppliedRev, zeroLocus.rev);
endpoint.disconnect();
detachZero();
await zeroLocus.mutate((draft) => { const privateLib = draft.lib("privateSignal");
  if ("at" in privateLib) privateLib.at(["value"]).set(`PRIVATE_ENDPOINT_SENTINEL${"z".repeat(3 * 1024 * 1024)}`); });
detachZero = zeroLocus.connect(serverSocket);
const zeroRecovered = await endpoint.connect();
assert.equal(zeroRecovered.outcome, "snapshot");
assert.equal(endpoint.map, undefined);
assert.equal(endpoint.lastAppliedRev, zeroLocus.rev);
assert.equal(sent.filter((raw) => JSON.parse(raw).type === "recovery-snapshot").at(-1)?.includes("PRIVATE_ENDPOINT_SENTINEL"), false);
endpoint.dispose();
detachZero();
zeroLocus.dispose();

// A selected root may exceed the historical 4 MiB exact codec default, while
// the actual projected artifact still has the existing 64 MiB ceiling.
const medium = hsonLiveMap.fromLibraries({ selected: { data: { value: "m".repeat(5 * 1024 * 1024) }, schema: Data } });
const mediumAuthority = internal_livemap_aggregate_authority(medium);
const mediumPolicy = make_locus_hosted_projection_policy(mediumAuthority.hostedRegistry(),
  mediumAuthority.hostedPosition().authority, [{ library: "selected", exposure: "client-public" }], undefined,
  () => ({ libraries: ["selected"] }));
const mediumEffective = await normalize_locus_effective_projection(mediumPolicy, { libraries: ["selected"] });
const mediumSnapshot = capture_selected_authority_projection_snapshot(medium, mediumEffective);
assert.ok(JSON.stringify(mediumSnapshot).length > 4 * 1024 * 1024);
const installed = hsonLiveMap.fromClientSnapshot({ authority: mediumSnapshot,
  localLibraries: { local: { data: { value: "local" }, schema: Data } } });
assert.equal(installed.lib("selected").mode, "data-object");

const oversized = hsonLiveMap.fromLibraries({ selected: { data: { value: "o".repeat(65 * 1024 * 1024) }, schema: Data } });
const oversizedAuthority = internal_livemap_aggregate_authority(oversized);
const oversizedPolicy = make_locus_hosted_projection_policy(oversizedAuthority.hostedRegistry(),
  oversizedAuthority.hostedPosition().authority, [{ library: "selected", exposure: "client-public" }], undefined,
  () => ({ libraries: ["selected"] }));
const oversizedEffective = await normalize_locus_effective_projection(oversizedPolicy, { libraries: ["selected"] });
assert.throws(() => capture_selected_authority_projection_snapshot(oversized, oversizedEffective), /malformed/i);

const persistence = new MemoryCheckpointAdapter();
const persistentMap = hsonLiveMap.fromLibraries({
  page: { document: '<main <p "PERSISTENT_PUBLIC"/>/>', schema: Page },
  privateSignal: { data: { value: "small" }, schema: Data },
});
const persistent = await create_persistent_locus({ map: persistentMap, persistence,
  exposure: [{ library: "page", exposure: "client-public" }, { library: "privateSignal", exposure: "server-private" }],
  defaultProjection: { libraries: ["page"], htmlDocument: "page" },
  authorizeProjection: () => ({ libraries: ["page"] }),
});
await persistent.mutate((draft) => { const privateLib = draft.lib("privateSignal");
  if ("at" in privateLib) privateLib.at(["value"]).set("p".repeat(5 * 1024 * 1024)); });
assert.equal(persistence.appendCalls.length, 1);
await persistent.checkpoint();
persistent.dispose();
process.stdout.write("Z3A selected capture acceptance passed.\n");
