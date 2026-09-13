import assert from "node:assert/strict";
import { create_test_event_emitter } from "./test-events.mjs";
import * as root from "hson-live";
import * as diagnostics from "hson-live/diagnostics";
import * as echo from "hson-live/echo";
import * as hson from "hson-live/hson";
import * as livehost from "hson-live/livehost";
import * as livemap from "hson-live/livemap";
import * as livetree from "hson-live/livetree";
import * as locus from "hson-live/locus";
import * as reflect from "hson-live/reflect";
import * as ssr from "hson-live/ssr";
import * as transform from "hson-live/transform";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "core.root-compatibility",
  title: "Curated root identity",
  category: "Core",
  runtime: "node",
  tags: Object.freeze(["root", "exports", "identity", "public-api"]),
});

const testEvents = create_test_event_emitter("core.root-compatibility");
const caseId = "retained root exports preserve owner identity";
testEvents.case_begin(caseId, caseId);

try {
  const overlaps = [
    [hson, ["Hson", "HsonData", "TransformError"]],
    [transform, ["HsonData", "hsonTransform", "TransformError"]],
    [livetree, ["hsonLiveTree", "LiveTree", "TreeSelector", "LiveTreeDisposedError"]],
    [livemap, ["hsonLiveMap", "link_livemap", "LiveMapDocumentInstallError"]],
    [reflect, ["hsonReflect", "reflect_document", "DocumentReflectError"]],
    [echo, ["hsonEcho", "create_echo", "EchoSessionError"]],
    [locus, ["hsonLocus", "create_locus", "LocusAuthorityError"]],
    [ssr, ["render_document", "render_hosted_document", "DocumentSsrError"]],
    [livehost, ["create_livehost_locus_registry"]],
  ] as const;
  for (const [owner, names] of overlaps) {
    for (const name of names) assert.equal(Reflect.get(root, name), Reflect.get(owner, name), name);
  }

  for (const removed of [
    "CssManager",
    "make_livemap_core",
    "reflect_collection",
    "decode_locus_message",
    "encode_locus_client_message",
    "make_locus_recovery_planner",
    "hsonInspect",
    "create_live_inspector",
    "LIVETREE_DISPOSED_ERROR_CODE",
    "ROOT_TAG",
  ]) assert.equal(removed in root, false, `${removed} must not be exported by root`);

  assert.equal(root.hson.liveMap, root.hsonLiveMap);
  assert.equal(root.hson.liveTree, root.hsonLiveTree);
  assert.equal(root.hson.transform, root.hsonTransform);
  assert.equal("inspect" in root.hson, false);
  assert.equal(typeof diagnostics.hsonInspect.create, "function");
  assert.equal(typeof diagnostics.create_live_inspector, "function");
  testEvents.case_end(caseId, "pass");
} catch (error) {
  const message = error instanceof Error ? error.message : "Check failed.";
  testEvents.diagnostic(caseId, "assertion", message.slice(0, 1_000));
  testEvents.case_end(caseId, "fail");
  testEvents.terminal("fail");
  throw error;
}

process.stdout.write("# curated root runtime identity passed\n");
testEvents.terminal("pass");
