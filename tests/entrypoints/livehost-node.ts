import {
  create_node_livehost_socket,
  start_node_application_host,
  type NodeHostedApplication,
} from "hson-live/livehost/node";

declare const application: NodeHostedApplication;
declare const websocket: Parameters<typeof create_node_livehost_socket>[0];

void create_node_livehost_socket(websocket);
void start_node_application_host({ applications: [application] });
