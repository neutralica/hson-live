import assert from "node:assert/strict";
import { Hson, hsonLocus, liveHost, type LiveHostApplication, type LiveHostApplicationContext,
  type LiveHostRequestRoute } from "../src/index.ts";
import { is_browser_html_producer } from "../src/internal/browser-html-producer.ts";
import { mark_browser_html_producer } from "../src/internal/browser-html-producer.ts";

const context: LiveHostApplicationContext = {
  applicationName: "deck", correlationId: "test", principal: { anonymous: true },
};
const response = (route: LiveHostRequestRoute, method = route.method): Response | Promise<Response> =>
  route.handle(new Request(`https://example.test${route.path}`, { method }), context);

const empty = liveHost.create({ name: "deck" });
const emptyApplication: LiveHostApplication = empty;
assert.equal(emptyApplication.name, "deck");
assert.deepEqual(empty.requests, []);
assert.equal(await empty.dispose(), undefined);
assert.equal("port" in empty, false);

let originalDisposed = 0;
const replaceable = {
  name: "replaceable",
  ready() { return this.name === "replaceable"; },
  dispose() { originalDisposed += 1; },
};
const captured = liveHost.create(replaceable);
replaceable.ready = () => false;
replaceable.dispose = () => { throw new Error("replacement must not be used"); };
assert.equal(captured.ready?.(), true);
await captured.dispose();
assert.equal(originalDisposed, 1);

const initial: LiveHostRequestRoute = { method: "PATCH", path: "/raw", handle: () => new Response("raw") };
const callerRoutes = [initial];
const raw = Object.freeze({
  name: "raw-deck", requests: callerRoutes,
  connections: [{ path: "/socket", accept() {} }],
  ready() { return this.name === "raw-deck"; },
  dispose() { assert.equal(this, raw); },
});
const host = liveHost.create(raw);
assert.notEqual(host, raw);
assert.notEqual(host.requests, callerRoutes);
assert.equal(host.requests[0], initial);
assert.notEqual(host.connections, raw.connections);
assert.deepEqual(host.connections, raw.connections);
assert.equal(host.ready?.(), true);
callerRoutes.push({ method: "GET", path: "/caller-only", handle: () => new Response() });
assert.equal(host.requests.length, 1);
await host.dispose();

const extraRaw: LiveHostRequestRoute = { method: "OPTIONS", path: "/options", handle: () => new Response() };
const secondRaw: LiveHostRequestRoute = { method: "TRACE", path: "/trace", handle: () => new Response() };
host.add(extraRaw, secondRaw);
assert.equal(host.requests[1], extraRaw);
assert.equal(host.requests[2], secondRaw);
const get = host.GET("/get", (request, appContext) =>
  new Response(`${request.method}:${appContext.applicationName}`));
const post = host.POST("/post", async (request) =>
  new Response(await request.text(), { status: 201, headers: { "x-custom": "yes" } }));
const put = host.PUT("/put", () => new Response("put"));
const deleted = host.DELETE("/delete", () => new Response("delete"));
assert.deepEqual(host.requests.map((route) => route.method), ["PATCH", "OPTIONS", "TRACE", "GET", "POST", "PUT", "DELETE"]);
assert.equal(host.requests[3], get);
assert.equal((await response(get)).status, 200);
assert.equal(await (await response(get)).text(), "GET:deck");
const posted = await post.handle(new Request("https://example.test/post", { method: "POST", body: "saved" }), context);
assert.equal(posted.status, 201);
assert.equal(posted.headers.get("x-custom"), "yes");
assert.equal(await posted.text(), "saved");
assert.equal(await (await response(put)).text(), "put");
assert.equal(await (await response(deleted)).text(), "delete");

for (const [method, path] of [["GET", "/one"], ["POST", "/two"], ["PUT", "/three"], ["DELETE", "/four"]] as const) {
  const route = liveHost[method](path, () => new Response(method));
  assert.deepEqual([route.method, route.path], [method, path]);
  assert.equal(await (await response(route)).text(), method);
}
const grouped = liveHost.GET(["/", () => new Response("home")], ["/slides/1", () => new Response("slide")]);
assert.equal(Array.isArray(grouped), true);
assert.deepEqual(grouped.map((route) => [route.method, route.path]), [["GET", "/"], ["GET", "/slides/1"]]);
const declarative: LiveHostApplication = { name: "declarative", requests: grouped, dispose() {} };
assert.equal(declarative.requests, grouped);
const hostGroup = host.GET(["/a", () => new Response("a")], ["/b", () => new Response("b")]);
assert.deepEqual(host.requests.slice(-2), hostGroup);
for (const method of ["POST", "PUT", "DELETE"] as const) {
  const routes = liveHost[method]([`/${method}/1`, () => new Response()], [`/${method}/2`, () => new Response()]);
  assert.deepEqual(routes.map((route) => route.method), [method, method]);
}

const locus = hsonLocus.create({ shared: [
  { name: "home", definition: { document: '<html <head/> <body <main "Home"/>/>/>', schema: Hson.schema`<type "document">` } },
  { name: "slide01", definition: { document: '<html <head/> <body <main "Slide"/>/>/>', schema: Hson.schema`<type "document">` } },
] });
try {
  const home = locus.lib("home");
  const slide01 = locus.lib("slide01");
  const slide02 = locus.lib("slide01");
  if (home.mode !== "document" || slide01.mode !== "document" || slide02.mode !== "document") {
    throw new Error("Deck fixture requires document libraries.");
  }
  const deck = liveHost.create({ name: "deck" });
  deck.GET(["/", home.render], ["/slides/1", slide01.render], ["/slides/2", slide02.render]);
  let renderCount = 0;
  const counted = mark_browser_html_producer(() => { renderCount += 1; return home.render(); });
  const countedRoute = liveHost.GET("/counted", counted);
  assert.equal(renderCount, 0);
  await response(countedRoute);
  await response(countedRoute);
  assert.equal(renderCount, 2);
  const application: LiveHostApplication = deck;
  assert.equal(application.requests?.length, 3);
  const first = await response(deck.requests[0]!);
  assert.match(await first.text(), /Home/);
  assert.equal(first.headers.get("content-type"), "text/html; charset=utf-8");
  await home.at([]).attrs.set("data-version", "new");
  await home.css.stylesheet("main { color: blue; }");
  const second = await response(deck.requests[0]!);
  const updated = await second.text();
  assert.match(updated, /data-version="new"/);
  assert.match(updated, /color:blue/);
  assert.equal(is_browser_html_producer(home.render), true);
  assert.equal(is_browser_html_producer(() => "plain string"), false);
  const inert = liveHost.GET("/direct", home.render);
  assert.equal((await response(inert)).headers.get("content-type"), "text/html; charset=utf-8");
  const rawDeck: LiveHostApplication = {
    name: "raw-deck", requests: liveHost.GET(["/", home.render], ["/slides/1", slide01.render]), dispose() {},
  };
  assert.equal(rawDeck.requests?.length, 2);
} finally { locus.dispose(); }

const stream = liveHost.GET("/stream", () => new Response(new ReadableStream<Uint8Array>({
  start(controller) { controller.enqueue(new TextEncoder().encode("chunk")); controller.close(); },
}), { status: 206, headers: { "x-stream": "yes" } }));
const streamed = await response(stream);
assert.equal(streamed.status, 206);
assert.equal(streamed.headers.get("x-stream"), "yes");
assert.equal(await streamed.text(), "chunk");
const sameResponse = new Response("same", { status: 202 });
const preserved = liveHost.GET("/same", () => sameResponse);
assert.equal(await response(preserved), sameResponse);
const thrown = liveHost.GET("/throw", () => { throw new Error("failure"); });
assert.throws(() => thrown.handle(new Request("https://example.test/throw"), context), /failure/);
const rejected = liveHost.GET("/reject", async () => { throw new Error("rejected"); });
await assert.rejects(Promise.resolve().then(() => rejected.handle(new Request("https://example.test/reject"), context)), /rejected/);
