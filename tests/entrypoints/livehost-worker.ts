import {
  decode_livehost_server_message,
  hsonLiveHost,
  liveHost,
  type LiveHostSocketLike,
} from "hson-live/livehost";

declare const socket: LiveHostSocketLike;

void socket;
void liveHost;
void hsonLiveHost;
void decode_livehost_server_message("{}");
