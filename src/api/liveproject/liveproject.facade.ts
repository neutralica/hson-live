import { project_keyed_collection } from "./liveproject.keyed.js";

/** Canonical one-way LiveMap-to-LiveTree projection facade. */
export const hsonReflect = Object.freeze({
  keyedCollection: project_keyed_collection,
});
