import { create_echo } from "./echo.js";
import { create_echo_websocket_transport } from "./echo.websocket.js";
import { create_echo_http_transport } from "./echo.http.js";

/** Public Echo namespace shared by `hson.echo` and `hson-live/echo`. */
export const hsonEcho = /* @__PURE__ */ Object.freeze({
  create: create_echo,
  transport: /* @__PURE__ */ Object.freeze({ websocket: create_echo_websocket_transport, http: create_echo_http_transport }),
});
