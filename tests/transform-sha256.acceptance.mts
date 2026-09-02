// @hson-live-external-test
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { create_test_event_emitter } from "./test-events.mjs";
import { hsonTransform } from "../src/api/transform/index.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "transform.sha256",
  title: "Transform serialized SHA-256",
  category: "Transform",
  runtime: "node",
  tags: Object.freeze(["serialization", "sha256", "webcrypto", "public-api", "externally-discoverable"]),
});

const testEvents = create_test_event_emitter("transform.sha256");
let checks = 0;

async function check(name: string, run: () => void | Promise<void>): Promise<void> {

  testEvents.case_begin(name, name);
  try {
    await run();
    testEvents.case_end(name, "pass");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Check failed.";
    testEvents.diagnostic(name, "assertion", message.slice(0, 1_000));
    testEvents.case_end(name, "fail");
    testEvents.terminal("fail");
    throw error;
  }
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function sha256Oracle(serialized: string): string {
  return createHash("sha256").update(new TextEncoder().encode(serialized)).digest("hex");
}

function sha256BytesOracle(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const HSON_CAFE = `<note "café">`;
const JSON_CAFE = `{\n  "note": "café"\n}`;
const HTML_CAFE = `<_hson_obj>\n<note><_hson_obj>\n<_hson_str>&quot;caf\\u00e9&quot;</_hson_str>\n</_hson_obj></note>\n</_hson_obj>`;

await check("the independent oracle has the empty SHA-256 vector", () => {
  assert.equal(sha256Oracle(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});

await check("the independent oracle has the abc SHA-256 vector", () => {
  assert.equal(sha256Oracle("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

await check("Hson hashes its exact checked-in serializer output", async () => {
  const representation = hsonTransform.fromJson({ note: "café" }).toHson();
  assert.equal(representation.serialize(), HSON_CAFE);
  assert.equal(await representation.sha256(), "250c070cec839503e98e1a0c4e43dd4a073610ea635ea3b8b9aa0889f30c9c33");
});

await check("JSON hashes its exact checked-in serializer output", async () => {
  const representation = hsonTransform.fromJson({ note: "café" }).toJson();
  assert.equal(representation.serialize(), JSON_CAFE);
  assert.equal(await representation.sha256(), "f66d24f32cae5e6dcfc3fe374c67ff19be541bdba60c96917b89af9c22f82343");
});

await check("HTML hashes its exact checked-in serializer output", async () => {
  const representation = hsonTransform.fromJson({ note: "café" }).toHtml();
  assert.equal(representation.serialize(), HTML_CAFE);
  assert.equal(await representation.sha256(), "0cf5d6904c133769a8a72e6d2de4668b8b7e4a384301d73ef14ed660fe0a6ed0");
});

await check("every textual lane agrees with the independent UTF-8 oracle", async () => {
  const source = hsonTransform.fromJson({ note: "café" });
  for (const representation of [source.toHson(), source.toJson(), source.toHtml()]) {
    assert.equal(await representation.sha256(), sha256Oracle(representation.serialize()));
  }
});

await check("the same graph can have distinct Hson JSON and HTML hashes", async () => {
  const source = hsonTransform.fromJson({ note: "café" });
  const hashes = await Promise.all([source.toHson().sha256(), source.toJson().sha256(), source.toHtml().sha256()]);
  assert.equal(new Set(hashes).size, 3);
});

await check("one graph's representation hashes remain scoped to all four emitted byte lanes", async () => {
  const source = hsonTransform.fromJson({ note: "café", values: [-0, true] });
  const hashes = await Promise.all([
    source.toHson().sha256(),
    source.toJson().sha256(),
    source.toHtml().sha256(),
    source.toBinary().sha256(),
  ]);
  assert.equal(new Set(hashes).size, 4);
});

await check("Hson options change the hash only through changed emitted bytes", async () => {
  const source = hsonTransform.fromJson({ alpha: { beta: 1 }, gamma: [2, 3] });
  const readable = source.toHson();
  const compact = source.toHson().noBreak();
  assert.notEqual(readable.serialize(), compact.serialize());
  assert.notEqual(await readable.sha256(), await compact.sha256());
  assert.equal(await readable.sha256(), sha256Oracle(readable.serialize()));
  assert.equal(await compact.sha256(), sha256Oracle(compact.serialize()));
});

await check("non-ASCII serializer text retains its exact UTF-8 hash", async () => {
  const representation = hsonTransform.fromJson({ note: "café" }).toHson();
  assert.equal(await representation.sha256(), "250c070cec839503e98e1a0c4e43dd4a073610ea635ea3b8b9aa0889f30c9c33");
});

await check("lone-surrogate output follows TextEncoder byte behavior without normalization", async () => {
  const representation = hsonTransform.fromJson({ value: "\ud800" }).toHson();
  assert.equal(representation.serialize(), `<value "\\ud800">`);
  assert.equal(await representation.sha256(), "7157ffcc16ed2c443569bfcbbb3ff6e95fc732b21ce6d424535158eeb6712366");
  assert.equal(await representation.sha256(), sha256Oracle(representation.serialize()));
});

await check("zero and negative zero retain their distinct JSON representations", async () => {
  const zero = hsonTransform.fromJson(0).toJson();
  const negativeZero = hsonTransform.fromJson(-0).toJson();
  assert.equal(zero.serialize(), "0");
  assert.equal(negativeZero.serialize(), "-0");
  assert.equal(await zero.sha256(), "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9");
  assert.equal(await negativeZero.sha256(), "ed79f26d03f412bde3db206601a698e0bb451bea9e3cc25289636ac17ea74b0a");
});

await check("property ordering remains representation-hash sensitive", async () => {
  const ba = hsonTransform.fromJson({ b: 2, a: 1 }).toJson();
  const ab = hsonTransform.fromJson({ a: 1, b: 2 }).toJson();
  assert.equal(await ba.sha256(), "b8d841ab5d213095157bd4480e2c9441bef6ddbd08ed6df965420c2747288dbb");
  assert.equal(await ab.sha256(), "c81ded0f93b4c797225630516d7e3e02ada5e65cd20b7e91736767d4496793d3");
  assert.notEqual(await ba.sha256(), await ab.sha256());
});

await check("readable Hson whitespace is included in the hash", async () => {
  const readable = hsonTransform.fromJson({ alpha: { beta: 1 }, gamma: [2, 3] }).toHson();
  assert.equal(readable.serialize().includes("\n"), true);
  assert.equal(await readable.sha256(), "880005a544c91ae467d5c4e1578275325ad5aae413f950390062a4c9cac2e328");
});

await check("compact Hson whitespace selection has its checked-in hash", async () => {
  const compact = hsonTransform.fromJson({ alpha: { beta: 1 }, gamma: [2, 3] }).toHson().noBreak();
  assert.equal(compact.serialize(), `<alpha <beta 1> gamma «2,3»>`);
  assert.equal(await compact.sha256(), "847496c03032336b389030ca25f2003292102281f32fbeb4d83dacd032a6e204");
});

await check("hashes are lowercase 64-character hexadecimal strings", async () => {
  const digest = await hsonTransform.fromJson({ note: "café" }).toJson().sha256();
  assert.match(digest, /^[0-9a-f]{64}$/);
});

await check("sha256 returns a promise while serialization stays synchronous", async () => {
  const representation = hsonTransform.fromJson({ note: "café" }).toJson();
  const result = representation.sha256();
  assert.equal(result instanceof Promise, true);
  assert.equal(representation.serialize(), JSON_CAFE);
  await result;
});

await check("separate finalizer calls remain deterministic", async () => {
  const representation = hsonTransform.fromJson({ note: "café" }).toHtml();
  assert.equal(await representation.sha256(), await representation.sha256());
});

await check("Hson noQuid selection remains authoritative for hashing", async () => {
  const source = hsonTransform.fromHson(`<entry @000000001 "ready"/>`);
  const full = source.toHson();
  const filtered = source.toHson().noQuid();
  assert.notEqual(full.serialize(), filtered.serialize());
  assert.equal(await filtered.sha256(), sha256Oracle(filtered.serialize()));
});

await check("the Worker fixture has the shared checked-in Hson digest", async () => {
  const representation = hsonTransform.fromHson(`<worker @000000001 "ready"/>`).toHson();
  assert.equal(representation.serialize(), `<worker @000000001 "ready"/>`);
  assert.equal(await representation.sha256(), "47eebceca8428b19a36dc1ae429cddb1da2de7eda05ddb3bbfad81bd8a1659c3");
});

await check("JSON direct-integer property order follows its serializer output", async () => {
  const representation = hsonTransform.fromJson({ "10": "ten", "2": "two", "1": "one" }).toJson();
  assert.equal(await representation.sha256(), sha256Oracle(representation.serialize()));
});

await check("Binary typed-style SHA hashes its exact checked-in bytes", async () => {
  const binary = hsonTransform.fromNode({
    $_tag: "_hson_elem",
    $_content: [{
      $_tag: "main",
      $_content: [],
      $_attrs: { style: { width: { value: 2, unit: "px" } } },
    }],
  }).toBinary();
  const bytes = binary.serialize();
  assert.equal(sha256BytesOracle(bytes), "bf6ee5169dcc2ee5af4b09a195f074227e226b239f9057f4e3e577a17ae546e4");
  assert.equal(await binary.sha256(), sha256BytesOracle(bytes));
});

await check("a missing WebCrypto subtle capability rejects clearly", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: undefined });
  try {
    await assert.rejects(
      hsonTransform.fromJson({ ready: true }).toJson().sha256(),
      /SHA-256 hashing requires WebCrypto SubtleCrypto support/,
    );
  } finally {
    if (descriptor === undefined) delete (globalThis as { crypto?: Crypto }).crypto;
    else Object.defineProperty(globalThis, "crypto", descriptor);
  }
});

process.stdout.write(`1..${checks}\n`);
testEvents.terminal("pass");
