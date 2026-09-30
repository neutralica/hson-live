import { create_echo, init_echo_internal } from "./echo.js";
import { create_echo_websocket_transport } from "./echo.websocket.js";

/** Public Echo namespace shared by `hson.echo` and `hson-live/echo`. */
export const hsonEcho = /* @__PURE__ */ Object.freeze({
  create: create_echo,
  init: init_echo_internal,
  transport: /* @__PURE__ */ Object.freeze({ websocket: create_echo_websocket_transport }),
});
