import { parentPort, workerData } from "node:worker_threads";
import { hsonTransform } from "../../src/api/transform/index.ts";

type WorkerInput = Readonly<{ source: string }>;

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function nativeSha(bytes: Uint8Array): Promise<string> {
  const snapshot = new Uint8Array(bytes.length);
  snapshot.set(bytes);
  return hex(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", snapshot)));
}

const source = hsonTransform.fromJson((workerData as WorkerInput).source);
const hson = source.toHson();
const json = source.toJson();
const html = source.toHtml();
const binary = source.toBinary();

const hsonText = hson.serialize();
const jsonText = json.serialize();
const htmlText = html.serialize();
const binaryBytes = binary.serialize();

parentPort?.postMessage({
  hson: { serialized: hsonText, production: await hson.sha256(), native: await nativeSha(new TextEncoder().encode(hsonText)) },
  json: { serialized: jsonText, production: await json.sha256(), native: await nativeSha(new TextEncoder().encode(jsonText)) },
  html: { serialized: htmlText, production: await html.sha256(), native: await nativeSha(new TextEncoder().encode(htmlText)) },
  binary: { serialized: binaryBytes, production: await binary.sha256(), native: await nativeSha(binaryBytes) },
});
