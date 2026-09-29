import { create_echo, replicate_echo_internal } from "./echo.js";

/** Public Echo namespace shared by `hson.echo` and `hson-live/echo`. */
export const hsonEcho = Object.freeze({
  create: create_echo,
  replicate: replicate_echo_internal,
});
