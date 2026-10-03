import { liveHost, type LiveHostApplication } from "hson-live/livehost";
import { hsonLocus } from "hson-live/locus";

declare const locus: ReturnType<typeof hsonLocus.create>;
const home = locus.lib("home");
const slide01 = locus.lib("slide01");
const slide02 = locus.lib("slide02");
if (home.mode === "document" && slide01.mode === "document" && slide02.mode === "document") {
  const host = liveHost.create({ name: "deck" });
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
    requests: liveHost.GET(["/", home.render], ["/slides/1", slide01.render]),
    dispose() {},
  };
  void rawApplication;
}

// @ts-expect-error An arbitrary string producer has no HTML semantics.
liveHost.GET("/plain", () => "plain");
// @ts-expect-error A raw request handler still requires a Response.
const rawString: import("hson-live/livehost").LiveHostRequestRoute = { method: "GET", path: "/raw", handle: () => "plain" };
void rawString;
