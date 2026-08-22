import { parentPort } from "node:worker_threads";

import { hsonTransform } from "../../src/api/transform/index.ts";

if (parentPort === null) throw new Error("Binary HSON Worker fixture requires a parent port.");

const node = hsonTransform.fromHson(`<main @000000001 <strong "ok"/>/>`).toNode();
const binary = hsonTransform.fromNode(node).toBinary();
const bytes = binary.serialize();
const decoded = hsonTransform.fromBinary(bytes).toNode();

parentPort.postMessage({
  bytes: Array.from(bytes),
  closure: Array.from(hsonTransform.fromNode(decoded).toBinary().serialize()),
  digest: await binary.sha256(),
});
