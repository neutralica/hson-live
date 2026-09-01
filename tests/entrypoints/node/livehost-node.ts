import {
  create_node_locus_socket,
  handle_node_locus_bootstrap_request,
} from "hson-live/locus/node";
import type { LiveHostApplication } from "hson-live/livehost";
import {
  start_node_application_host,
} from "hson-live/livehost/node";
// @ts-expect-error One-map socket adapters moved exclusively to the Locus Node entrypoint.
import { create_node_livehost_socket } from "hson-live/livehost/node";
// @ts-expect-error Locus socket adapters are not re-exported by the future-host Node entrypoint.
import { create_node_locus_socket as misplaced_locus_socket } from "hson-live/livehost/node";

declare const application: LiveHostApplication;
declare const websocket: Parameters<typeof create_node_locus_socket>[0];

void create_node_locus_socket(websocket);
void start_node_application_host({ applications: [application] });
void handle_node_locus_bootstrap_request;
void create_node_livehost_socket;
void misplaced_locus_socket;
