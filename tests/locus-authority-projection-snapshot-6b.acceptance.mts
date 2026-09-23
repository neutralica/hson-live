import assert from "node:assert/strict";
import { Hson, add_interaction, enable_interactions, hsonEcho, hsonLiveMap, type HsonSchema } from "../src/index.ts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";
import { make_locus_hosted_projection_policy, normalize_locus_effective_projection } from "../src/api/locus/locus.projection.ts";
import { admit_authority_projection_snapshot, capture_locus_session_authority_projection_snapshot, decode_authority_projection_snapshot, encode_authority_projection_snapshot, project_authority_snapshot } from "../src/api/locus/locus.authority-projection-snapshot.ts";
import { create_echo_aggregate_replica_capability_internal } from "../src/api/echo/echo.aggregate-replica.lifecycle.ts";
import { make_locus_session_manager } from "../src/api/locus/locus.session.ts";
import { parse_hson_exact_runtime } from "../src/internal/exact-runtime-hson-codec.ts";
import { encode_hosted_root } from "../src/api/livemap/livemap.hosted.ts";

const DataSchema: HsonSchema = Hson.schema`<type "data" content <value "string">>`;
const PageSchema: HsonSchema = Hson.schema`<type "document" tag "main" content "empty">`;
const LocalDocSchema: HsonSchema = Hson.schema`<type "document" tag "aside" content "empty">`;
const PrivateSchema: HsonSchema = Hson.schema`<type "data" content <PRIVATE_SCHEMA_SENTINEL "string">>`;
const UnselectedSchema: HsonSchema = Hson.schema`<type "data" content <UNSELECTED_SCHEMA_SENTINEL "string">>`;
const HiddenDocSchema: HsonSchema = Hson.schema`<type "document" tag "hidden" content "empty">`;
const listener = Object.freeze({ event: "click", target: "element" as const, capture: false, once: false,
  passive: false, missingTarget: "ignore" as const, preventDefault: false, stopPropagation: false, stopImmediatePropagation: false });

const map = hsonLiveMap.fromLibraries({
  allowedData: { data: { value: "ALLOWED_ROOT_SENTINEL" }, schema: DataSchema },
  allowedPage: { document: "<main/>", schema: PageSchema },
  PRIVATE_NAME_SENTINEL: { data: { PRIVATE_SCHEMA_SENTINEL: "PRIVATE_ROOT_SENTINEL" }, schema: PrivateSchema },
  hiddenDoc: { document: "<hidden/>", schema: HiddenDocSchema },
  UNSELECTED_NAME_SENTINEL: { data: { UNSELECTED_SCHEMA_SENTINEL: "UNSELECTED_ROOT_SENTINEL" }, schema: UnselectedSchema },
});
enable_interactions(map);
add_interaction(map, { id: "allowed", subject: { library: "allowedPage", path: [99] }, listener,
  kind: "browser-local", key: "ALLOWED_INTERACTION_SENTINEL", args: Hson.data.from(null) });
add_interaction(map, { id: "hidden", subject: { library: "hiddenDoc", path: [99] }, listener,
  kind: "browser-local", key: "PRIVATE_INTERACTION_SENTINEL", args: Hson.data.from(null) });

const aggregate = internal_livemap_aggregate_authority(map);
const complete = aggregate.captureHosted();
const exposure = [
  { library: "allowedData", exposure: "client-public" as const },
  { library: "allowedPage", exposure: "client-public" as const },
  { library: "PRIVATE_NAME_SENTINEL", exposure: "server-private" as const },
  { library: "hiddenDoc", exposure: "server-private" as const },
  { library: "UNSELECTED_NAME_SENTINEL", exposure: "client-public" as const },
];
const policy = make_locus_hosted_projection_policy(complete.registry, complete.authority, exposure, undefined,
  () => ({ libraries: ["allowedData", "allowedPage", "PRIVATE_NAME_SENTINEL", "hiddenDoc", "UNSELECTED_NAME_SENTINEL"],
    systemFeatures: ["interactions"], writableDocuments: ["allowedPage"] }));
const effective = await normalize_locus_effective_projection(policy,
  { libraries: ["allowedData", "allowedPage", "PRIVATE_NAME_SENTINEL", "hiddenDoc"],
    htmlDocument: "allowedPage", systemFeatures: ["interactions"] });
assert.deepEqual(effective.libraries.map((entry) => entry.name), ["allowedData", "allowedPage"]);
const sessions = make_locus_session_manager();
const created = sessions.create("projection-session", true, { fence() {} }, () => {}, () => 0, undefined, effective);
assert.equal(created.ok, true);
const projected = capture_locus_session_authority_projection_snapshot(map, sessions, "projection-session");
assert.deepEqual(projected, project_authority_snapshot(complete, effective));
const encoded = encode_authority_projection_snapshot(projected);
const decoded = decode_authority_projection_snapshot(encoded);
assert.deepEqual(decoded, projected);
assert.equal(decoded.revision, map.rev);
assert.equal(decoded.projectionDigest, effective.digest);
assert.equal(decoded.htmlDocument, "allowedPage");
assert.deepEqual(decoded.writableDocuments, ["allowedPage"]);
assert.deepEqual(decoded.libraries.map((entry) => entry.name), ["allowedData", "allowedPage"]);
assert.equal(decoded.libraries[0]?.schema, DataSchema.toHson());
assert.equal(decoded.libraries[1]?.schema, PageSchema.toHson());
assert.ok(encoded.includes("ALLOWED_ROOT_SENTINEL"));
assert.ok(encoded.includes("ALLOWED_INTERACTION_SENTINEL"));
assert.equal(encoded.includes("localData"), false);
assert.equal(encoded.includes("localDoc"), false);
for (const sentinel of ["PRIVATE_NAME_SENTINEL", "PRIVATE_ROOT_SENTINEL", "PRIVATE_SCHEMA_SENTINEL",
  "PRIVATE_INTERACTION_SENTINEL", "UNSELECTED_NAME_SENTINEL", "UNSELECTED_ROOT_SENTINEL", "UNSELECTED_SCHEMA_SENTINEL", "hiddenDoc"]) {
  assert.equal(encoded.includes(sentinel), false, `Excluded sentinel leaked: ${sentinel}`);
}
for (const forbidden of ["registryDigest", "issuedQuids", "epoch", "exposure", "totalLibraries", "originalIndex", "policy"]) {
  assert.equal(Object.hasOwn(decoded, forbidden), false);
  assert.equal(encoded.includes(`"${forbidden}"`), false);
}
assert.equal(encoded.toLowerCase().includes("quid"), false);

const client = hsonLiveMap.fromClientSnapshot({ authority: decoded, localLibraries: {
  localData: { data: { value: "local" }, schema: DataSchema },
  localDoc: { document: "<aside/>", schema: LocalDocSchema },
} });
assert.equal(client.rev, 0);
assert.equal(client.lib("allowedData").mode, "data-object");
assert.equal(client.lib("allowedPage").mode, "document");
assert.equal(client.lib("localData").mode, "data-object");
assert.equal(client.lib("localDoc").mode, "document");
const clientCaptureText = JSON.stringify(client.capture());
assert.ok(clientCaptureText.includes("ALLOWED_INTERACTION_SENTINEL"));
assert.equal(clientCaptureText.includes("PRIVATE_INTERACTION_SENTINEL"), false);
const replica = create_echo_aggregate_replica_capability_internal(client);
assert.equal(replica.clientProjection()?.revision, decoded.revision);
replica.dispose();
const echo = hsonEcho.create({ map: client, recovery: { logicalMapId: decoded.authority.logicalMapId },
  socket: { send() {}, close() {}, onMessage() { return () => {}; }, onClose() { return () => {}; } } });
assert.equal(echo.recovery.lastAppliedRev, decoded.revision);
assert.equal(client.rev, 0);
echo.dispose();
assert.throws(() => hsonLiveMap.fromClientSnapshot({ authority: decoded,
  localLibraries: { allowedData: { data: { value: "collision" }, schema: DataSchema } } }), /collides/i);

const disabled = await normalize_locus_effective_projection(policy, { libraries: ["allowedData"] });
const noSystem = project_authority_snapshot(complete, disabled);
assert.equal(noSystem.system, null);
assert.deepEqual(noSystem.systemFeatures, []);
assert.deepEqual(noSystem.libraries.map((entry) => entry.name), ["allowedData"]);
const unauthorizedPolicy = make_locus_hosted_projection_policy(complete.registry, complete.authority, exposure, undefined,
  () => ({ libraries: ["allowedData"] }));
const unauthorized = project_authority_snapshot(complete, await normalize_locus_effective_projection(unauthorizedPolicy,
  { libraries: ["allowedPage", "allowedData"] }));
assert.deepEqual(unauthorized.libraries.map((entry) => entry.name), ["allowedData"]);
const readonlyPolicy = make_locus_hosted_projection_policy(complete.registry, complete.authority, exposure, undefined,
  () => ({ libraries: ["allowedPage"] }));
const readonlyPage = project_authority_snapshot(complete, await normalize_locus_effective_projection(readonlyPolicy, { libraries: ["allowedPage"] }));
assert.deepEqual(readonlyPage.libraries.map((entry) => entry.name), ["allowedPage"]);
assert.deepEqual(readonlyPage.writableDocuments, []);
const zero = await normalize_locus_effective_projection(policy, { libraries: [], systemFeatures: ["interactions"] });
const zeroSnapshot = project_authority_snapshot(complete, zero);
assert.deepEqual(zeroSnapshot.libraries, []);
assert.ok(zeroSnapshot.system);
assert.equal(encode_authority_projection_snapshot(zeroSnapshot).includes("ALLOWED_INTERACTION_SENTINEL"), false);
const localOnly = hsonLiveMap.fromClientSnapshot({ authority: zeroSnapshot,
  localLibraries: { localData: { data: { value: "only" }, schema: DataSchema } } });
assert.equal(localOnly.rev, 0);
assert.equal(localOnly.lib("localData").mode, "data-object");
const localDocumentOnly = hsonLiveMap.fromClientSnapshot({ authority: zeroSnapshot,
  localLibraries: { localDoc: { document: "<aside/>", schema: LocalDocSchema } } });
assert.equal(localDocumentOnly.lib("localDoc").mode, "document");
assert.throws(() => hsonLiveMap.fromClientSnapshot({ authority: zeroSnapshot, localLibraries: {} }), /no LiveMap/i);
const zeroDisabled = project_authority_snapshot(complete, await normalize_locus_effective_projection(policy, { libraries: [] }));
assert.equal(zeroDisabled.system, null);
const localOnlyWithoutSystem = hsonLiveMap.fromClientSnapshot({ authority: zeroDisabled,
  localLibraries: { localData: { data: { value: "only" }, schema: DataSchema } } });
assert.equal(localOnlyWithoutSystem.rev, 0);
assert.equal(localOnlyWithoutSystem.lib("localData").mode, "data-object");
assert.throws(() => hsonLiveMap.fromClientSnapshot({ authority: zeroDisabled, localLibraries: {} }), /no LiveMap/i);

const malformed = { ...decoded, libraries: [...decoded.libraries, decoded.libraries[0]] };
assert.throws(() => admit_authority_projection_snapshot(malformed), /malformed/i);
assert.throws(() => admit_authority_projection_snapshot({ ...decoded, projectionDigest: "0".repeat(64) }), /malformed/i);
assert.throws(() => admit_authority_projection_snapshot({ ...decoded, identity: { issuedQuids: ["000000001"] } }), /malformed/i);
assert.throws(() => admit_authority_projection_snapshot({ ...decoded,
  libraries: decoded.libraries.map((entry) => entry.name === "allowedData" ? { ...entry, root: decoded.libraries[1]!.root } : entry),
}), /malformed/i);
assert.throws(() => hsonLiveMap.fromClientSnapshot({ authority: { ...decoded, projectionDigest: "0".repeat(64) },
  localLibraries: { localData: { data: { value: "safe" }, schema: DataSchema } } }), /malformed/i);
assert.throws(() => decode_authority_projection_snapshot(encoded.replace('"format":"hson-exact-value"', '"format":"invalid"')), /malformed/i);
const quidRoot = encode_hosted_root(parse_hson_exact_runtime("<main @000000001/>", { allowTopLevelDocumentText: true }));
assert.throws(() => admit_authority_projection_snapshot({ ...decoded,
  libraries: decoded.libraries.map((entry) => entry.name === "allowedPage" ? { ...entry, root: quidRoot } : entry),
}), /malformed/i);

// The capture is one revision even when authority advances after the cut.
map.lib("allowedData").at(["value"]).set("after-capture");
const older = project_authority_snapshot(complete, effective);
assert.equal(older.revision, complete.revision);
assert.equal(encode_authority_projection_snapshot(older).includes("after-capture"), false);
assert.equal(project_authority_snapshot(aggregate.captureHosted(), effective).revision, map.rev);
sessions.dispose();

process.stdout.write("Step 6B authority projection snapshot acceptance passed.\n");
