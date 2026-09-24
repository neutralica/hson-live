import assert from "node:assert/strict";
import { MemoryCheckpointAdapter } from "./helpers/memory-checkpoint-adapter.mts";
import { Hson, hsonLiveMap, hsonLocus, enable_interactions, type HsonSchema } from "../src/index.ts";
import { create_persistent_locus } from "../src/api/locus/index.ts";
import { decode_locus_message } from "../src/api/locus/locus.protocol.ts";
import { create_locus_hosted_aggregate_socket_internal } from "../src/api/locus/locus.aggregate.socket.ts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";
import { make_locus_hosted_projection_policy, normalize_locus_effective_projection, HOSTED_PROJECTION_EGRESS_COMPLETE } from "../src/api/locus/locus.projection.ts";
import type { LocusExposureEntry, LocusProjectionAuthorization } from "../src/types/locus.types.ts";

const PageSchema: HsonSchema = Hson.schema`<type "document" tag "main" content <repeat <tag "p" content "empty">>>`;
const PresentationSchema: HsonSchema = Hson.schema`<type "data" content <value "string">>`;
const PresentationSchemaChanged: HsonSchema = Hson.schema`<type "data" content <value "string" extra "string">>`;
const CredentialsSchema: HsonSchema = Hson.schema`<type "data" content <password "string">>`;
const CredentialsSchemaChanged: HsonSchema = Hson.schema`<type "data" content <password "string" token "string">>`;
const EXPOSURE: readonly LocusExposureEntry[] = Object.freeze([
  { library: "page", exposure: "client-public" },
  { library: "presentation", exposure: "client-public" },
  { library: "credentials", exposure: "server-private" },
]);
const FENCE = Object.freeze({ logicalMapId: "projection-map", incarnationId: "projection-incarnation" });

function map(options: { presentationValue?: string; changedPublicSchema?: boolean; changedPrivateSchema?: boolean } = {}) {
  return hsonLiveMap.fromLibraries({
    page: { document: "<main/>", schema: PageSchema },
    presentation: options.changedPublicSchema
      ? { data: { value: options.presentationValue ?? "slides", extra: "x" }, schema: PresentationSchemaChanged }
      : { data: { value: options.presentationValue ?? "slides" }, schema: PresentationSchema },
    credentials: options.changedPrivateSchema
      ? { data: { password: "SECRET_ROOT", token: "SECRET_TOKEN" }, schema: CredentialsSchemaChanged }
      : { data: { password: "SECRET_ROOT" }, schema: CredentialsSchema },
  });
}

function policy(authority: ReturnType<typeof map>, exposure = EXPOSURE) {
  return make_locus_hosted_projection_policy(internal_livemap_aggregate_authority(authority).hostedRegistry(), FENCE, exposure);
}

function grant(principal?: string): LocusProjectionAuthorization {
  if (principal === "alice") return { libraries: ["page", "presentation", "credentials"], systemFeatures: ["interactions"], writableDocuments: ["page"] };
  if (principal === "bob") return { libraries: ["page"], systemFeatures: [] };
  return {};
}

function attachment(server: ReturnType<typeof create_locus_hosted_aggregate_socket_internal>, principalId: string) {
  const finite: Array<{ type: string; readonly [field: string]: unknown }> = [];
  const attached = server.attach({
    finite: (message) => { finite.push(message); },
    synchronization: () => {}, publication: () => {}, event: () => {},
  }, { principalId });
  return { attached, finite };
}

assert.equal(HOSTED_PROJECTION_EGRESS_COMPLETE, true);

// Every application library requires exactly one explicit classification; system state does not.
{
  const authority = map();
  enable_interactions(authority);
  assert.throws(() => hsonLocus.create({ map: authority, exposure: JSON.parse("null") }), /exposure configuration is required/i);
  assert.throws(() => hsonLocus.create({ map: authority, exposure: EXPOSURE.slice(0, 2) }), /missing.*credentials/i);
  assert.throws(() => hsonLocus.create({ map: authority, exposure: [...EXPOSURE, { library: "unknown", exposure: "client-public" }] }), /unknown application library/i);
  assert.throws(() => hsonLocus.create({ map: authority, exposure: [...EXPOSURE, EXPOSURE[0]!] }), /duplicates/i);
  assert.throws(() => hsonLocus.create({ map: authority, exposure: [...EXPOSURE,
    { library: "page", exposure: "server-private" }] }), /duplicates/i);
  assert.throws(() => hsonLocus.create({ map: authority, exposure: JSON.parse('[{"library":"page","exposure":"client-local"}]') }), /invalid value/i);
  assert.throws(() => hsonLocus.create({ map: authority, exposure: [{ library: "page", exposure: "client-public" }] }), /missing/i);
  const hosted = hsonLocus.create({ map: authority, exposure: EXPOSURE });
  hosted.dispose();

  const one = hsonLiveMap.fromLibraries({ page: { document: "<main/>", schema: PageSchema } });
  assert.throws(() => hsonLocus.create({ map: one, exposure: [] }), /missing.*page/i);
  hsonLocus.create({ map: one, exposure: [{ library: "page", exposure: "server-private" }] }).dispose();
  const allPrivate = hsonLocus.create({ map: map(), exposure: EXPOSURE.map((entry) => ({ ...entry, exposure: "server-private" as const })) });
  allPrivate.dispose();
}

// Request, exposure, and read authorization are independent. No authorizer denies all.
{
  const authority = map();
  enable_interactions(authority);
  const base = policy(authority);
  const denied = await normalize_locus_effective_projection(base, { libraries: ["page", "presentation"] });
  assert.deepEqual(denied.libraries, []);
  assert.equal(denied.includesLibrary("page"), false);
  const authorized = make_locus_hosted_projection_policy(base.registry, FENCE, EXPOSURE, undefined,
    ({ connection }) => grant(connection?.principalId));
  const alice = await normalize_locus_effective_projection(authorized,
    { libraries: ["presentation", "credentials"], htmlDocument: "page", systemFeatures: ["interactions"] }, { principalId: "alice" });
  assert.deepEqual(alice.libraries.map((entry) => entry.name), ["page", "presentation"]);
  assert.equal(alice.htmlDocument, "page");
  assert.equal(alice.includesLibrary("credentials"), false);
  assert.equal(alice.canAuthorDocument("page"), true);
  assert.equal(alice.canAuthorDocument("presentation"), false);
  assert.equal(alice.hasSystemFeature("interactions"), true);
  assert.equal(Object.isFrozen(alice) && Object.isFrozen(alice.libraries) && Object.isFrozen(alice.authority), true);
  const bob = await normalize_locus_effective_projection(authorized,
    { libraries: ["page", "presentation", "credentials"], systemFeatures: ["interactions"] }, { principalId: "bob" });
  assert.deepEqual(bob.libraries.map((entry) => entry.name), ["page"]);
  assert.equal(bob.canAuthorDocument("page"), false);
  assert.equal(bob.hasSystemFeature("interactions"), false);
  const anonymous = await normalize_locus_effective_projection(authorized, { libraries: ["page"] });
  assert.deepEqual(anonymous.libraries, []);
  const empty = await normalize_locus_effective_projection(authorized, { libraries: [] }, { principalId: "alice" });
  assert.deepEqual(empty.libraries, []);
  assert.equal(empty.htmlDocument, undefined);
  assert.deepEqual((await normalize_locus_effective_projection(authorized, undefined, { principalId: "alice" })).libraries, []);
  const configuredDefault = make_locus_hosted_projection_policy(base.registry, FENCE, EXPOSURE,
    { libraries: ["presentation"], htmlDocument: "page" }, ({ connection }) => grant(connection?.principalId));
  assert.deepEqual((await normalize_locus_effective_projection(configuredDefault, undefined, { principalId: "alice" }))
    .libraries.map((entry) => entry.name), ["page", "presentation"]);

  const unavailable = [
    { libraries: [], htmlDocument: "credentials" },
    { libraries: [], htmlDocument: "unknown" },
    { libraries: [], htmlDocument: "presentation" },
  ];
  for (const request of unavailable) {
    await assert.rejects(async () => normalize_locus_effective_projection(authorized, request, { principalId: "alice" }),
      (error: unknown) => error instanceof Error && error.message === "Requested client projection is unavailable.");
  }
  await assert.rejects(async () => normalize_locus_effective_projection(authorized,
    { libraries: [], htmlDocument: "page" }, { principalId: "anonymous" }), /Requested client projection is unavailable/);
  const allPrivatePolicy = make_locus_hosted_projection_policy(base.registry, FENCE,
    EXPOSURE.map((entry) => ({ ...entry, exposure: "server-private" as const })), undefined, () => ({ libraries: ["page"] }));
  assert.deepEqual((await normalize_locus_effective_projection(allPrivatePolicy, { libraries: ["page"] })).libraries, []);
}

// Digest binds only the included authority contract, not roots, revisions, hidden topology, or local identity.
{
  const request = { libraries: ["presentation"] };
  const authorize = () => ({ libraries: ["presentation"] });
  const first = await normalize_locus_effective_projection(
    make_locus_hosted_projection_policy(policy(map()).registry, FENCE, EXPOSURE, undefined, authorize), request);
  const same = await normalize_locus_effective_projection(
    make_locus_hosted_projection_policy(policy(map({ presentationValue: "changed" })).registry, FENCE, EXPOSURE, undefined, authorize), request);
  const hiddenChanged = await normalize_locus_effective_projection(
    make_locus_hosted_projection_policy(policy(map({ changedPrivateSchema: true })).registry, FENCE, EXPOSURE, undefined, authorize), request);
  const includedChanged = await normalize_locus_effective_projection(
    make_locus_hosted_projection_policy(policy(map({ changedPublicSchema: true })).registry, FENCE, EXPOSURE, undefined, authorize), request);
  const differentSet = await normalize_locus_effective_projection(
    make_locus_hosted_projection_policy(policy(map()).registry, FENCE, EXPOSURE, undefined,
      () => ({ libraries: ["page", "presentation"] })), { libraries: ["page", "presentation"] });
  assert.equal(first.digest, same.digest);
  assert.equal(first.digest, hiddenChanged.digest);
  assert.notEqual(first.digest, includedChanged.digest);
  assert.notEqual(first.digest, differentSet.digest);
  const changedRevisionMap = hsonLiveMap.fromLibraries({
    page: { document: "<main/>", schema: PageSchema },
    presentation: { data: { value: "slides" }, schema: PresentationSchema },
    credentials: { data: { password: "SECRET_ROOT" }, schema: CredentialsSchema },
  });
  const changedRevisionPolicy = make_locus_hosted_projection_policy(
    internal_livemap_aggregate_authority(changedRevisionMap).hostedRegistry(), FENCE, EXPOSURE, undefined, authorize);
  const beforeRevision = await normalize_locus_effective_projection(changedRevisionPolicy, request);
  changedRevisionMap.lib("presentation").at(["value"]).set("after-revision");
  assert.equal(changedRevisionMap.rev, 1);
  assert.equal((await normalize_locus_effective_projection(changedRevisionPolicy, request)).digest, beforeRevision.digest);
  assert.equal(JSON.stringify(first).includes("credentials"), false);
  assert.equal(JSON.stringify(first).includes("SECRET_"), false);
  assert.equal(JSON.stringify(first).includes("password"), false);
  assert.equal(JSON.stringify(first).toLowerCase().includes("quid"), false);
}

// Session creation stores one frozen effective scope. Reattachment reuses it; revocation fences it.
{
  const authority = map();
  const server = create_locus_hosted_aggregate_socket_internal({ map: authority, exposure: EXPOSURE,
    authorizeProjection: ({ connection }) => grant(connection?.principalId) });
  const rejectedMessages: string[] = [];
  for (const [index, principalId, htmlDocument] of [
    ["private", "alice", "credentials"], ["unknown", "alice", "unknown"], ["unauthorized", "anonymous", "page"],
  ]) {
    const attempted = attachment(server, principalId);
    await attempted.attached.operations.submit({ type: "session-create", id: index,
      projection: { libraries: [], htmlDocument } });
    const rejected = attempted.finite.find((entry) => entry.type === "session-rejected");
    assert.ok(rejected && typeof rejected.message === "string");
    rejectedMessages.push(`${rejected.code}:${rejected.message}`);
    attempted.attached.close();
  }
  assert.equal(new Set(rejectedMessages).size, 1);
  assert.equal(server.sessions.debug().activeSessionCount, 0);
  const first = attachment(server, "alice");
  await first.attached.operations.submit({ type: "session-create", id: "a", projection: { libraries: ["page"] } });
  const created = first.finite.find((entry) => entry.type === "session-created");
  assert.ok(created && typeof created.sessionId === "string" && typeof created.credential === "string");
  const scope = server.sessions.projection(created.sessionId);
  assert.ok(scope);
  assert.deepEqual(scope.libraries.map((entry) => entry.name), ["page"]);
  await first.attached.operations.submit({ type: "session-create", id: "conflict", projection: { libraries: ["presentation"] } });
  assert.equal(first.finite.some((entry) => entry.type === "session-rejected" && entry.id === "conflict"), true);
  const conflictingAttach = decode_locus_message(JSON.stringify({ type: "session-attach", id: "widen", credential: created.credential,
    projection: { libraries: ["page", "presentation"] } }));
  assert.equal(conflictingAttach.ok, false);
  const second = attachment(server, "alice");
  await second.attached.operations.submit({ type: "session-attach", id: "reattach", credential: created.credential });
  assert.equal(second.finite.some((entry) => entry.type === "session-attached"), true);
  assert.strictEqual(server.sessions.projection(created.sessionId), scope);
  const otherPrincipal = attachment(server, "bob");
  await otherPrincipal.attached.operations.submit({ type: "session-attach", id: "wrong-principal", credential: created.credential });
  assert.equal(otherPrincipal.finite.some((entry) => entry.type === "session-rejected"), true);
  const third = attachment(server, "alice");
  await third.attached.operations.submit({ type: "session-create", id: "b", projection: { libraries: ["presentation"] } });
  const createdB = third.finite.find((entry) => entry.type === "session-created");
  assert.ok(createdB && typeof createdB.sessionId === "string");
  assert.deepEqual(server.sessions.projection(createdB.sessionId)?.libraries.map((entry) => entry.name), ["presentation"]);
  assert.equal(server.sessions.revoke(created.sessionId), true);
  assert.equal(server.sessions.projection(created.sessionId), undefined);
  assert.equal(second.finite.some((entry) => entry.type === "session-fenced"), true);
  const afterRevocation = attachment(server, "alice");
  await afterRevocation.attached.operations.submit({ type: "session-attach", id: "revoked", credential: created.credential });
  assert.equal(afterRevocation.finite.some((entry) => entry.type === "session-rejected"), true);
  first.attached.close(); second.attached.close(); third.attached.close(); otherPrincipal.attached.close(); afterRevocation.attached.close();
  server.dispose();
}

// An asynchronous read decision must finish before the session exists, and a
// second request on the same attachment cannot replace that pending scope.
{
  let decide: ((grant: LocusProjectionAuthorization) => void) | undefined;
  const server = create_locus_hosted_aggregate_socket_internal({ map: map(), exposure: EXPOSURE,
    authorizeProjection: () => new Promise<LocusProjectionAuthorization>((resolve) => { decide = resolve; }) });
  const context = { principalId: "alice" };
  const finite: Array<{ type: string; readonly [field: string]: unknown }> = [];
  const client = { attached: server.attach({
    finite: (message) => { finite.push(message); },
    synchronization: () => {}, publication: () => {}, event: () => {},
  }, context), finite };
  const pending = client.attached.operations.submit({ type: "session-create", id: "pending",
    projection: { libraries: ["page"] } });
  assert.equal(server.sessions.debug().activeSessionCount, 0);
  context.principalId = "bob";
  await client.attached.operations.submit({ type: "session-create", id: "widen",
    projection: { libraries: ["page", "presentation"] } });
  assert.equal(client.finite.some((entry) => entry.type === "session-rejected" && entry.id === "widen"), true);
  assert.ok(decide);
  decide({ libraries: ["page", "presentation"] });
  await pending;
  const created = client.finite.find((entry) => entry.type === "session-created" && entry.id === "pending");
  assert.ok(created && typeof created.sessionId === "string" && typeof created.credential === "string");
  assert.deepEqual(server.sessions.projection(created.sessionId)?.libraries.map((entry) => entry.name), ["page"]);
  const reattached = attachment(server, "alice");
  await reattached.attached.operations.submit({ type: "session-attach", id: "same-principal", credential: created.credential });
  assert.equal(reattached.finite.some((entry) => entry.type === "session-attached"), true);
  reattached.attached.close();
  client.attached.close();
  server.dispose();
}

// The deployment supplies exposure again on restart; durable authority records contain no exposure classification.
{
  const adapter = new MemoryCheckpointAdapter();
  const first = await create_persistent_locus({ map: map(), exposure: EXPOSURE, logicalMapId: "projection-persist", persistence: adapter });
  await first.checkpoint();
  const checkpoint = adapter.state("projection-persist")?.checkpoint;
  assert.equal(JSON.stringify(checkpoint).includes("server-private"), false);
  assert.equal(JSON.stringify(checkpoint).includes("client-public"), false);
  first.dispose();
  await assert.rejects(() => create_persistent_locus({ map: map(), exposure: EXPOSURE.slice(0, 2), logicalMapId: "projection-persist", persistence: adapter }), /missing.*credentials/i);
  const restored = await create_persistent_locus({ map: map(), exposure: EXPOSURE, logicalMapId: "projection-persist", persistence: adapter });
  restored.dispose();
}

process.stdout.write("Step 6A exposure and session projection acceptance passed.\n");
