import assert from "node:assert/strict";
import { Hson, hsonLiveMap, type HsonSchema } from "../src/index.ts";
import { validate_document_path } from "../src/api/livemap/livemap.document.path.ts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";
import { make_locus_hosted_projection_policy, normalize_locus_effective_projection } from "../src/api/locus/locus.projection.ts";
import { project_authority_snapshot } from "../src/api/locus/locus.authority-projection-snapshot.ts";
import { decode_locus_live_projected_envelope_internal, LOCUS_LIVE_PROJECTED_WIRE_FORMAT, project_locus_live_revision_internal } from "../src/api/locus/locus.live-projection.ts";
import { create_echo_aggregate_replica_capability_internal } from "../src/api/echo/echo.aggregate-replica.lifecycle.ts";

const PageSchema: HsonSchema = Hson.schema`<type "document" tag "main" content <repeat <tag "item" content "string">>>`;
const DataSchema: HsonSchema = Hson.schema`<type "data" content <value "string">>`;
const authority = hsonLiveMap.fromLibraries({
  page: { document: "<main <item \"old\"/>/>", schema: PageSchema },
  privateData: { data: { value: "PRIVATE_SENTINEL" }, schema: DataSchema },
});
const engine = internal_livemap_aggregate_authority(authority);
const before = engine.captureHosted();
const policy = make_locus_hosted_projection_policy(before.registry, before.authority, [
  { library: "page", exposure: "client-public" }, { library: "privateData", exposure: "server-private" },
], undefined, () => ({ libraries: ["page"] }));
const effective = await normalize_locus_effective_projection(policy, { libraries: ["page"] });
const projected = project_authority_snapshot(before, effective);
const client = hsonLiveMap.fromClientSnapshot({ authority: projected, localLibraries: {} });
const replica = create_echo_aggregate_replica_capability_internal(client);
const pageId = engine.libraries()[0]!;
const target = { kind: "path" as const, path: validate_document_path([0, 0]) };
const lineage = [{ source: validate_document_path([]), destination: validate_document_path([]) }];
const graph = { domain: "graph" as const, op: "replace-content" as const, target, index: 0,
  replacement: { $_tag: "item", $_content: [{ $_tag: "_hson_elem", $_content: [
    { $_tag: "_hson_str", $_content: ["VISIBLE_LINEAGE_SENTINEL"] },
  ] }] }, lineage };
const hosted = engine.commit([{ target: engine.target(pageId, target.path), kind: "graph", operation: graph }]).hosted;
assert.ok(hosted);
const after = engine.captureHosted();
const event = project_locus_live_revision_internal(hosted, before, after, effective);
assert.equal(event.kind, "commit");
if (event.kind !== "commit") throw new Error("Expected visible replacement.");
assert.equal(event.commit.operations.length, 1);
const encoded = JSON.stringify({ format: LOCUS_LIVE_PROJECTED_WIRE_FORMAT,
  logicalMapId: effective.authority.logicalMapId, incarnationId: effective.authority.incarnationId,
  registryDigest: event.commit.registryDigest, commit: event.commit });
assert.ok(encoded.includes("VISIBLE_LINEAGE_SENTINEL"));
assert.ok(encoded.includes("lineage"));
assert.equal(encoded.includes("PRIVATE_SENTINEL"), false);
assert.equal(encoded.toLowerCase().includes("quid"), false);
const decoded = decode_locus_live_projected_envelope_internal(JSON.parse(encoded), {
  ...effective.authority, registryDigest: replica.clientProjection()!.registry.digest,
});
replica.replayHosted(decoded, before.revision);
assert.equal(client.rev, 1);
const page = client.lib("page");
if (page.mode !== "document") throw new Error("Expected document.");
const main = page.root().$_content[0];
assert.equal(typeof main, "object");
replica.dispose();
process.stdout.write("Step 6C replacement lineage acceptance passed.\n");
