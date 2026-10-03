import { hsonLiveMap as bareLiveMap } from "./livemap.facade.js";
import { locus } from "../locus/locus.facade.js";
import { echo } from "../echo/echo.facade.js";

/** The public LiveMap subsystem: local state and its authority/replica governors. */
export const hsonLiveMap = Object.freeze({
  create: bareLiveMap.create,
  fromLibraries: bareLiveMap.fromLibraries,
  locus,
  echo,
});
