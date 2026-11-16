import type { InteractionDescriptor } from "../src/index.js";

declare const listener: InteractionDescriptor["listener"];

const portable: InteractionDescriptor = {
  id: "portable",
  subject: { library: "page", path: [0, 0, 0] },
  listener,
  kind: "browser",
  key: "run",
  args: null,
};
void portable;

const oldAddress: InteractionDescriptor = {
  id: "old",
  subject: { library: "page", path: [0, 0, 0] },
  // @ts-expect-error The old portable QUID subject has no public type contract.
  subjectQuid: "000000001",
  listener,
  kind: "browser",
  key: "run",
  args: null,
};
void oldAddress;

const missingLibrary: InteractionDescriptor = {
  id: "unqualified",
  // @ts-expect-error A subject must be qualified by its document Library.
  subject: { path: [0] },
  listener,
  kind: "browser",
  key: "run",
  args: null,
};
void missingLibrary;

const documentSubject: InteractionDescriptor = { id: "document", subject: { library: "page", kind: "document" },
  listener: { ...listener, target: "document" }, kind: "browser", key: "run" };
void documentSubject;
// @ts-expect-error A Document subject cannot carry an element path.
const hybridSubject: InteractionDescriptor["subject"] = { library: "page", kind: "document", path: [] };
// @ts-expect-error A missing path does not imply Document ownership.
const missingSubject: InteractionDescriptor["subject"] = { library: "page" };
