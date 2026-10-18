import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { request } from "node:https";
import { connect } from "node:http2";
import { hsonLiveMap } from "hson-live/livemap";
import { hsonLiveHost } from "hson-live/livehost";
import { start_node_application_host } from "hson-live/livehost/node";
import { definition } from "./locus-scoped-ssr-cases.mts";
import { deferred } from "../helpers/memory-checkpoint-adapter.mts";

/** Actual package exports and native HTTP/1.1 + HTTP/2, with no WebSocket route. */
export async function scoped_ssr_http() {
  const locus = hsonLiveMap.locus.create(definition);
  const session = await locus.session.create({ libraries: ["page", "flat"] });
  const cut = session.now({ html: "page" });
  const tls = { key: await readFile(new URL("./livehost-tls/key.pem", import.meta.url)),
    cert: await readFile(new URL("./livehost-tls/cert.pem", import.meta.url)) };
  const app = hsonLiveHost.create({ name: "h2-ssr" });
  app.GET("/", () => new Response(session.now({ html: "page" }).html, { headers: { "content-type": "text/html; charset=utf-8" } }));
  app.GET("/flat", locus.lib("flat").render);
  app.GET("/forbidden", () => new Response(session.now({ html: "secret" }).html));
  const captured = deferred(), release = deferred();
  app.GET("/stream", async () => {
    const current = session.now({ html: "page" }); captured.resolve(); await release.promise;
    let half = false;
    return new Response(new ReadableStream({ pull(controller) {
      const split = Math.floor(current.html.length / 2);
      controller.enqueue(new TextEncoder().encode(half ? current.html.slice(split) : current.html.slice(0, split)));
      if (half) controller.close(); half = true;
    } }), { headers: { "content-type": "text/html; charset=utf-8", "x-revision": String(current.libs.revision) } });
  });
  const host = await start_node_application_host({ port: 0, http2: tls, applications: [app],
    security: new Map([[app.name, {
      origin() { return { ok: true, value: undefined }; },
      authenticate() { return { ok: true, value: { anonymous: true } }; },
      authorize() { return { ok: true, value: undefined }; },
    }]]),
  });
  const h2 = connect(host.httpUrl, { ca: tls.cert, servername: "localhost" });
  const h1get = (path: string) => new Promise<{ status: number; type: string | undefined; body: string }>((resolve, reject) => {
    const req = request(host.httpUrl + path, { ca: tls.cert, servername: "localhost" }, response => {
      assert.equal(response.httpVersion, "1.1"); let body = ""; response.setEncoding("utf8");
      response.on("data", chunk => { body += chunk; }); response.once("error", reject);
      response.once("end", () => resolve({ status: response.statusCode!, type: response.headers["content-type"], body }));
    }); req.once("error", reject); req.end();
  });
  const h2get = (path: string) => new Promise<{ status: number; type: string; body: string; revision: string }>((resolve, reject) => {
    const stream = h2.request({ ":path": path }); let body = "", status = 0, type = "", revision = "";
    stream.on("response", headers => { status = Number(headers[":status"]); type = String(headers["content-type"]); revision = String(headers["x-revision"]); });
    stream.setEncoding("utf8"); stream.on("data", chunk => { body += chunk; }); stream.once("error", reject);
    stream.once("end", () => resolve({ status, type, body, revision })); stream.end();
  });
  try {
    await once(h2, "connect"); assert.equal(h2.alpnProtocol, "h2");
    for (const get of [h1get, h2get]) {
      const result = await get("/"); assert.equal(result.status, 200);
      assert.equal(result.type, "text/html; charset=utf-8"); assert.equal(result.body, cut.html);
      assert.doesNotMatch(result.body, /hson-part|<script|PRIVATE_/);
      assert.equal((await get("/flat")).body, session.now({ html: "flat" }).html);
      const forbidden = await get("/forbidden"); assert.equal(forbidden.status, 500); assert.doesNotMatch(forbidden.body, /PRIVATE_|<html/);
    }
    const pending = h2get("/stream"); await captured.promise;
    await locus.stage(w => { w.lib("page").at([]).asElement().attrs.set("title", "later-http"); w.lib("page").css.sel("body").setProp("color", "teal"); });
    release.resolve(); const streamed = await pending;
    assert.equal(streamed.body, cut.html); assert.equal(streamed.revision, String(cut.libs.revision));
    assert.match((await h1get("/")).body, /later-http/);
    console.log("H2 native HTTP/1.1, HTTP/2, streaming, HTML producer and error handling passed.");
  } finally { release.resolve(); h2.destroy(); await host.dispose(); locus.dispose(); }
}
