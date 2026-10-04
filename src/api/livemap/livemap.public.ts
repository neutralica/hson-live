import { create, fromLibraries } from "./livemap.facade.js";
import { locus } from "../locus/locus.facade.js";
import { echo } from "../echo/echo.facade.js";

/** The public LiveMap subsystem: local state and its authority/replica governors. */
export const hsonLiveMap = /* @__PURE__ */ Object.freeze({
  create,
  fromLibraries,
  locus,
  echo,
});
