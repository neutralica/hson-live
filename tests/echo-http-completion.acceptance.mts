import { echo_map_internal } from "../src/internal/governor-maps.js";
import { authority_groups_from_catalog_fixture, authority_groups_from_map_fixture } from "./helpers/locus-definition-fixture.mts";
import assert from "node:assert/strict";
import { Hson, bind_locus_http, hsonEcho, hsonLiveMap, hsonLocus } from "../src/index.ts";
import { start_node_application_host } from "../src/api/livehost/node/livehost.node-application-host.ts";
import { echo_document_authority_for } from "../src/api/echo/echo.document-authority-registry.ts";
import type { LiveHostApplication } from "../src/types/livehost.types.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "echo.http-completion", title: "HTTP document completion through stream loss", category: "Echo",
  runtime: "node-real-http1", tags: Object.freeze(["echo", "http", "document", "completion", "recovery"]),
});
const events = create_test_event_emitter("echo.http-completion");
events.case_begin("completion", "Admitted document completion waits across lost HTTP stream");

const schema = Hson.schema`<type "document" tag "main" content "empty">`;
const map = hsonLiveMap.fromLibraries({ page: { document: "<main/>", schema } });
const locus = hsonLocus.create({ ...authority_groups_from_map_fixture(map, [{ name: "page", ownership: "shared" }]), defaultProjection: { libraries: ["page"] }, authorizeProjection: () => ({ libraries: ["page"], writableDocuments: ["page"] }) });
const binding = bind_locus_http(locus, { endpoint: "/_hson" });
const application: LiveHostApplication = { name: "echo-completion",
  requests: ["/_hson", "/_hson/sync"].map((path) => ({ method: "POST", path,
    handle: (request, context) => binding.handle(request, { principalId: context.principal.id }) })),
  dispose() { binding.dispose(); },
};
const host = await start_node_application_host({ port: 0, applications: [application] });
let holdCommit = false;
let heldCommits = 0;
let syncOpens = 0;
let interrupt: (() => void) | undefined;
const fetchWithLoss: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  if (!String(input).endsWith("/sync") || typeof init?.body !== "string"
    || JSON.parse(init.body).type !== "recover" || response.body === null || response.status !== 200) return response;
  syncOpens += 1;
  if (syncOpens !== 1) return response;
  const source = response.body.getReader();
  let target: ReadableStreamDefaultController<Uint8Array> | undefined;
  let ended = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { target = controller; },
    async pull(controller) {
      if (ended) return;
      try {
        const next = await source.read();
        if (ended) return;
        if (next.done) { controller.close(); return; }
        if (holdCommit && new TextDecoder().decode(next.value).includes('"type":"commit"')) {
          heldCommits += 1;
          return;
        }
        controller.enqueue(next.value);
      } catch (cause) { if (!ended) controller.error(cause); }
    },
    cancel() { ended = true; void source.cancel(); },
  });
  interrupt = () => { ended = true; target?.error(new Error("Lost HTTP response stream.")); void source.cancel(); };
  return new Response(stream, { status: response.status, headers: response.headers });
};
const transport = hsonEcho.transport.http({ endpoint: `${host.httpUrl}/_hson`, fetch: fetchWithLoss });
try {
  const retained = await locus.session.create({ libraries: ["page"] },
    { connection: { principalId: "development-anonymous" } });
  const echo = await hsonEcho.create({ now: retained.now(), credential: retained.credential!, transport });
  assert.equal(echo.sync.status, "caught_up");
  const authority = echo_document_authority_for(echo_map_internal(echo).lib("page"));
  assert.ok(authority);
  const page = echo.lib("page");
  if (page.mode !== "document" || page.source !== "authority-projected") throw new Error("Expected projected document.");
  holdCommit = true;
  const epoch = echo.session.epoch;
  const pending = page.at([]).attrs.set("title", "restored");
  let settlements = 0;
  void pending.then(() => { settlements += 1; }, () => { settlements += 1; });
  for (let turn = 0; turn < 100 && (heldCommits === 0 || authority.pendingRevisionWaits() === 0); turn++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(heldCommits, 1);
  assert.equal(authority.pendingRevisionWaits(), 1);
  assert.equal(settlements, 0);
  holdCommit = false;
  interrupt?.();
  for (let turn = 0; turn < 100 && (syncOpens < 2 || echo.sync.status !== "caught_up"); turn++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  await pending;
  assert.equal(syncOpens >= 2, true);
  assert.equal(echo.session.epoch, epoch);
  assert.equal(echo.sync.status, "caught_up");
  assert.equal(settlements, 1);
  assert.equal(page.at([]).attrs.get("title"), "restored");
  echo.dispose();
} finally {
  transport.dispose();
  await host.dispose();
  locus.dispose();
}
events.case_end("completion", "pass");
events.terminal("pass");
