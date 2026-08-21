import {
  create_browser_locus_socket,
  decode_locus_bootstrap,
  install_locus_bootstrap,
  decode_locus_server_message,
  hsonLocus,
  type LocusSocketLike,
} from "hson-live/locus";

declare const socket: LocusSocketLike;

void socket;
declare const websocketUrl: string;
declare const BrowserSocket: Parameters<typeof create_browser_locus_socket>[1];
void create_browser_locus_socket(websocketUrl, BrowserSocket);
void hsonLocus;
void decode_locus_server_message("{}");
declare const bootstrapHson: string;
void install_locus_bootstrap(decode_locus_bootstrap(bootstrapHson));
