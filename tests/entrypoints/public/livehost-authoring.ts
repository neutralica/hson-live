import { hsonLiveHost, type LiveHost, type LiveHostApplication, type LiveHostRequestRoute, type LiveHostRuntime } from "hson-live/livehost";
import type { NodeApplicationHost } from "hson-live/livehost/node";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type HostReturnIsLiveHost = Equal<ReturnType<typeof hsonLiveHost.create>, LiveHost>;
const exactHostReturn: HostReturnIsLiveHost = true;
void exactHostReturn;

declare const bound: NodeApplicationHost;
const runtime: LiveHostRuntime = bound;
void runtime;
// @ts-expect-error A bound runtime handle is not an authored application.
const component: LiveHost = bound;
void component;
// @ts-expect-error Route methods belong to a created host.
hsonLiveHost.GET;
// @ts-expect-error Route methods belong to a created host.
hsonLiveHost.POST;
// @ts-expect-error Route methods belong to a created host.
hsonLiveHost.PUT;
// @ts-expect-error Route methods belong to a created host.
hsonLiveHost.DELETE;

import * as hsonLiveMap from "hson-live/livemap";

declare const locus: ReturnType<typeof hsonLiveMap.locus.create>;
const home = locus.lib("home");
const slide01 = locus.lib("slide01");
const slide02 = locus.lib("slide02");
if (home.mode === "document" && slide01.mode === "document" && slide02.mode === "document") {
  const host: LiveHost = hsonLiveHost.create({ name: "deck" });
  host.GET("/single", home.render);
  // @ts-expect-error Returning HTML does not mark a newly wrapped callable.
  host.GET("/wrapped", () => home.render());
  host.GET(["/", home.render], ["/slides/1", slide01.render], ["/slides/2", slide02.render]);
  host.GET(["/grouped-response", (request, context) => new Response(request.method + context.applicationName)]);
  host.POST("/save", (request, context) => new Response(request.method + context.applicationName));
  host.add({ method: "OPTIONS", path: "/custom", handle: () => new Response() });
  const application: LiveHostApplication = host;
  void application;

  const rawApplication: LiveHostApplication = {
    name: "deck-raw",
    requests: [{ method: "GET", path: "/", handle: () => new Response(home.render()) }],
    dispose() {},
  };
  void rawApplication;
  const rawRoute: LiveHostRequestRoute = { method: "POST", path: "/raw", handle: () => new Response() };
  void rawRoute;
}

// @ts-expect-error An arbitrary string producer has no HTML semantics.
hsonLiveHost.GET("/plain", () => "plain");
// @ts-expect-error A raw request handler still requires a Response.
const rawString: import("hson-live/livehost").LiveHostRequestRoute = { method: "GET", path: "/raw", handle: () => "plain" };
void rawString;
