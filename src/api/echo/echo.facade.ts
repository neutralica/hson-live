import { create_echo } from "./echo.js";
import { create_echo_websocket_transport } from "./echo.websocket.js";
import { create_echo_http_transport } from "./echo.http.js";

/** Echo constructor namespace composed into the public LiveMap facade. */
export const echo = /* @__PURE__ */ Object.freeze({
  create: create_echo,
  transport: /* @__PURE__ */ Object.freeze({ websocket: create_echo_websocket_transport, http: create_echo_http_transport }),
});
