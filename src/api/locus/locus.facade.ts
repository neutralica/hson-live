import { create, resume, checkpoint } from "./locus.public.js";

/** The fixed library-registry Locus namespace. */
export const hsonLocus = Object.freeze({
  create,
  resume,
  checkpoint,
});
