import {
  create_browser_locus_socket,
  decode_locus_bootstrap,
  install_locus_bootstrap,
  install_locus_snapshot,
  decode_locus_server_message,
  encode_locus_client_message,
  hsonLocus,
  type LocusClientMessage,
  type LocusSocketLike,
} from "hson-live/locus";

declare const socket: LocusSocketLike;

void socket;
declare const websocketUrl: string;
declare const BrowserSocket: Parameters<typeof create_browser_locus_socket>[1];
void create_browser_locus_socket(websocketUrl, BrowserSocket);
void hsonLocus;
void decode_locus_server_message("{}");
declare const clientMessage: LocusClientMessage;
void encode_locus_client_message(clientMessage);
declare const bootstrapHson: string;
void install_locus_bootstrap(decode_locus_bootstrap(bootstrapHson));
declare const semanticSnapshot: Parameters<typeof install_locus_snapshot>[0];
void install_locus_snapshot(semanticSnapshot);
