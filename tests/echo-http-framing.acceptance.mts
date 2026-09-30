import assert from "node:assert/strict";
import { EchoHttpRecordError, read_echo_http_records_internal } from "../src/api/echo/echo.http-framing.internal.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "echo.http-framing", title: "Bounded HTTP Echo NDJSON framing", category: "Echo", runtime: "node",
  tags: Object.freeze(["echo", "http", "framing", "security"]),
});
const events = create_test_event_emitter("echo.http-framing");
let count = 0;
async function check(name: string, run: () => Promise<void>): Promise<void> {
  events.case_begin(name, name);
  try { await run(); events.case_end(name, "pass"); }
  catch (cause) { events.case_end(name, "fail"); events.terminal("fail"); throw cause; }
  process.stdout.write(`ok ${++count} - ${name}\n`);
}

function reader(chunks: readonly Uint8Array[]): ReadableStreamDefaultReader<Uint8Array> {
  return new ReadableStream<Uint8Array>({ start(controller) {
    for (const chunk of chunks) controller.enqueue(chunk);
    controller.close();
  } }).getReader();
}
const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

await check("split UTF-8 and escaped string content preserve one record per line", async () => {
  const text = '{"text":"é\\nnext"}\n';
  const encoded = bytes(text);
  const split = encoded.indexOf(0xc3);
  const records: string[] = [];
  await read_echo_http_records_internal(reader([encoded.subarray(0, split + 1), encoded.subarray(split + 1)]),
    128, (record) => { records.push(record); });
  assert.deepEqual(records, ['{"text":"é\\nnext"}']);
  assert.equal(JSON.parse(records[0]!).text, "é\nnext");
});

await check("rapid small records preserve order", async () => {
  const records: number[] = [];
  await read_echo_http_records_internal(reader([bytes(Array.from({ length: 1000 }, (_, i) => `${i}\n`).join(""))]),
    16, (record) => { records.push(Number(record)); });
  assert.deepEqual(records, Array.from({ length: 1000 }, (_, i) => i));
});

for (const [name, chunks, limit] of [
  ["oversized record with no newline", [bytes("x".repeat(33))], 32],
  ["record exceeds byte limit before newline", [bytes("x".repeat(33) + "\n")], 32],
  ["invalid UTF-8", [new Uint8Array([0xc3, 0x28, 0x0a])], 32],
  ["stream ends mid-record", [bytes("{\"a\":1")], 32],
] as const) {
  await check(name, async () => {
    await assert.rejects(read_echo_http_records_internal(reader(chunks), limit, () => {}), EchoHttpRecordError);
  });
}

await check("malformed JSON and wrong semantic shape fail the current record", async () => {
  for (const raw of ["{invalid}\n", '{"type":"not-a-semantic-output"}\n']) {
    await assert.rejects(read_echo_http_records_internal(reader([bytes(raw)]), 128, (record) => {
      const value: unknown = JSON.parse(record);
      if (typeof value !== "object" || value === null || !("type" in value) || value.type !== "commit") {
        throw new Error("Wrong semantic shape.");
      }
    }), EchoHttpRecordError);
  }
});

events.terminal("pass");
