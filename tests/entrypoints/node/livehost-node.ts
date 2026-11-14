import {
  bind_node_locus_websocket,
} from "hson-live/locus/node";
import type { LiveHostApplication } from "hson-live/livehost";
import { hsonLiveMap } from "hson-live/livemap";
import { Hson } from "hson-live/hson";
import {
  start_node_application_host,
} from "hson-live/livehost/node";
// @ts-expect-error One-map socket adapters moved exclusively to the Locus Node entrypoint.
import { create_node_livehost_socket } from "hson-live/livehost/node";
// @ts-expect-error Locus socket adapters are not re-exported by the future-host Node entrypoint.
import { bind_node_locus_websocket as misplaced_locus_socket } from "hson-live/livehost/node";

declare const application: LiveHostApplication;
declare const websocket: Parameters<typeof bind_node_locus_websocket>[1];

declare const locus: object;
void bind_node_locus_websocket(locus, websocket);
void start_node_application_host({ applications: [application] });
void create_node_livehost_socket;
void misplaced_locus_socket;

const pointerLocus = hsonLiveMap.locus.create({
  controls: { parts: { handle: { kind: "document", document: Hson.document`<button hson:part event:move/>`,
    events: { move: "<hson:event on:pointer:move host:MOVE dx:num=^{pointer.movementX} <> >" } } } },
  page: { document: Hson.document`<hson-part at=controls/handle/>` },
});
pointerLocus.actions.define("MOVE", (ctx, args) => {
  // @ts-expect-error A hosted Action receives Data without access to the browser event.
  void ctx.event;
  return args;
});

// TLS material is an explicit Node-only startup choice; the application stays unchanged.
void start_node_application_host({ applications: [application], http2: { key: "PEM key", cert: "PEM certificate" } });
void start_node_application_host({ applications: [application], http2: { key: Buffer.from("key"), cert: Buffer.from("cert") } });
// @ts-expect-error Secure HTTP/2 requires both key and certificate material.
void start_node_application_host({ applications: [application], http2: { key: "PEM key" } });
