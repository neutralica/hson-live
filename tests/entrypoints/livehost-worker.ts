import {
  decode_livehost_server_message,
  liveHost,
  type LiveHostSocketLike,
} from "hson-live/livehost";

declare const socket: LiveHostSocketLike;

void socket;
void liveHost;
void decode_livehost_server_message("{}");
