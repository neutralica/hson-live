import { create, resume, checkpoint } from "./locus.public.js";

/** The fixed library-registry Locus namespace. */
export const locus = Object.freeze({
  create,
  resume,
  checkpoint,
});
