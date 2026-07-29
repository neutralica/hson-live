import {
  create_browser_livehost_socket,
  decode_livehost_server_message,
  hsonLiveHost,
  liveHost,
  type LiveHostSocketLike,
} from "hson-live/livehost";

declare const socket: LiveHostSocketLike;

void socket;
declare const websocketUrl: string;
declare const BrowserSocket: Parameters<typeof create_browser_livehost_socket>[1];
void create_browser_livehost_socket(websocketUrl, BrowserSocket);
void liveHost;
void hsonLiveHost;
void decode_livehost_server_message("{}");
