import type { InteractionDescriptor } from "../src/index.js";

declare const listener: InteractionDescriptor["listener"];

const portable: InteractionDescriptor = {
  id: "portable",
  subject: { library: "page", path: [0, 0, 0] },
  listener,
  kind: "browser-local",
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
  kind: "browser-local",
  key: "run",
  args: null,
};
void oldAddress;

const missingLibrary: InteractionDescriptor = {
  id: "unqualified",
  // @ts-expect-error A subject must be qualified by its document Library.
  subject: { path: [0] },
  listener,
  kind: "browser-local",
  key: "run",
  args: null,
};
void missingLibrary;
