// @hson-live-external-test
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { hson } from "../src/hson.ts";
import { hsonTransform } from "../src/api/transform/index.ts";
import { set_transform_html_sanitizer } from "../src/api/transform/constructors/construct-output-2.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import type { HsonAttrs, HsonNode, Primitive } from "../src/core/types.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import { repository_typescript_worker } from "./helpers/repository-typescript-worker.mts";

let checks = 0;

async function check(name: string, run: () => void | Promise<void>): Promise<void> {
  await run();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

/** Parse only hand-authored hexadecimal fixtures; this is not a format encoder. */
function fixedHex(source: string): Uint8Array {
  const hex = source.replaceAll(/\s/g, "");
  assert.match(hex, /^(?:[0-9a-fA-F]{2})*$/);
  return Uint8Array.from(hex.match(/../g)?.map((pair) => Number.parseInt(pair, 16)) ?? []);
}

function node(tag: string, content: HsonNode["$_content"] = [], attrs?: HsonAttrs): HsonNode {
  const value: HsonNode = { $_tag: tag, $_content: content };
  if (attrs !== undefined) value.$_attrs = attrs;
  return value;
}

function elem(value: HsonNode): HsonNode {
  return node("_hson_elem", [value]);
}

function str(value: string): HsonNode {
  return node("_hson_str", [value]);
}

function val(value: Exclude<Primitive, string>): HsonNode {
  return node("_hson_val", [value]);
}

function expectBinaryRejection(bytes: Uint8Array, options?: Parameters<typeof hsonTransform.fromBinary>[1]): void {
  assert.throws(() => hsonTransform.fromBinary(bytes, options).toNode());
}

function sha256Oracle(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const GOLDEN_NULL = fixedHex(`48 53 4f 4e 12 00 00 20`);
const GOLDEN_ASCII = fixedHex(`48 53 4f 4e 11 00 00 00000001 0041`);
const GOLDEN_ARRAY = fixedHex(`
  48 53 4f 4e 14 00 00 00000002
    16 00 01 00000001
      00000005 0069 006e 0064 0065 0078 00000001 0030
      00000001 12 00 00 23 3ff0000000000000
    16 00 01 00000001
      00000005 0069 006e 0064 0065 0078 00000001 0031
      00000001 12 00 00 23 4000000000000000
`);
const GOLDEN_NESTED = fixedHex(`
  48 53 4f 4e 15 00 00 00000001
    10 00000004 006d 0061 0069 006e
      00 01 00000001
        00000004 0071 0075 0069 0064
        00000009 0030 0030 0030 0030 0030 0030 0030 0030 0031
      00000001
        15 00 00 00000001
          10 00000006 0073 0074 0072 006f 006e 0067 00 00 00000001
            15 00 00 00000001
              11 00 00 00000002 006f 006b
`);

const indexedArray = hson.fromHson(`«1,2»`).toNode();

await check("root and transform facades agree and Buffer remains a Uint8Array input", () => {
  const transformNode = hsonTransform.fromBinary(GOLDEN_NULL).toNode();
  const rootNode = hson.fromBinary(Buffer.from(GOLDEN_NULL)).toNode();
  assert.equal(canonical_hson_graph_equal(transformNode, rootNode), true);
});

await check("Binary snapshots admitted input and refuses to repair a noncanonical graph", () => {
  const source = str("A");
  const bytes = hsonTransform.fromNode(source).toBinary().serialize();
  source.$_content[0] = "B";
  assert.deepEqual(bytes, GOLDEN_ASCII);

  const repairedForEstablishedTerminals = hsonTransform.fromNode(node("main", [], {}));
  assert.equal(repairedForEstablishedTerminals.toNode().$_attrs, undefined);
  assert.throws(() => repairedForEstablishedTerminals.toBinary().serialize());
});

await check("sanitizeBEWARE Binary output follows the sanitized replacement graph", () => {
  const replacement = hsonTransform.fromHson(`<safe "replacement"/>`).toNode();
  set_transform_html_sanitizer(() => replacement);
  const sanitized = hson.fromNode(elem(node("main", [str("original")], { onclick: "bad()" }))).sanitizeBEWARE();
  const sanitizedNode = sanitized.toNode();
  assert.equal(canonical_hson_graph_equal(sanitizedNode, replacement), true);
  const decoded = hson.fromBinary(sanitized.toBinary().serialize()).toNode();
  assert.equal(canonical_hson_graph_equal(decoded, replacement), true);
});

await check("wrong and truncated representation markers reject", () => {
  expectBinaryRejection(fixedHex(`00 53 4f 4e 12 00 00 20`));
  expectBinaryRejection(fixedHex(`48 53 4f`));
});

await check("unknown node and primitive discriminators reject", () => {
  expectBinaryRejection(fixedHex(`48 53 4f 4e ff`));
  expectBinaryRejection(fixedHex(`48 53 4f 4e 12 00 00 ff`));
});

await check("invalid facet-presence bytes reject", () => {
  expectBinaryRejection(fixedHex(`48 53 4f 4e 11 02`));
  expectBinaryRejection(fixedHex(`48 53 4f 4e 11 00 02`));
});

await check("truncation at fixed-width reads and trailing bytes reject", () => {
  expectBinaryRejection(fixedHex(`48 53 4f 4e 11 00 00 000000`));
  expectBinaryRejection(fixedHex(`48 53 4f 4e 12 00 00 23 00000000000000`));
  expectBinaryRejection(fixedHex(`48 53 4f 4e 12 00 00 20 00`));
});

await check("string and container counts larger than remaining input reject before allocation", () => {
  expectBinaryRejection(fixedHex(`48 53 4f 4e 11 00 00 ffffffff`));
  expectBinaryRejection(fixedHex(`48 53 4f 4e 13 00 00 ffffffff`));
});

await check("NaN and both Infinity bit patterns reject", () => {
  expectBinaryRejection(fixedHex(`48 53 4f 4e 12 00 00 23 7ff8000000000000`));
  expectBinaryRejection(fixedHex(`48 53 4f 4e 12 00 00 23 7ff0000000000000`));
  expectBinaryRejection(fixedHex(`48 53 4f 4e 12 00 00 23 fff0000000000000`));
});

await check("unsorted and duplicate attribute keys reject", () => {
  expectBinaryRejection(fixedHex(`
    48 53 4f 4e 10 00000001 0078 01 00000002
      00000001 0062 24 00000000
      00000001 0061 24 00000000
    00 00000000
  `));
  expectBinaryRejection(fixedHex(`
    48 53 4f 4e 10 00000001 0078 01 00000002
      00000001 0061 24 00000000
      00000001 0061 24 00000000
    00 00000000
  `));
});

await check("unsorted and duplicate metadata keys reject", () => {
  expectBinaryRejection(fixedHex(`
    48 53 4f 4e 10 00000001 0078 00 01 00000002
      00000004 0071 0075 0069 0064 00000009 0030 0030 0030 0030 0030 0030 0030 0030 0031
      00000005 0069 006e 0064 0065 0078 00000001 0030
    00000000
  `));
  expectBinaryRejection(fixedHex(`
    48 53 4f 4e 10 00000001 0078 00 01 00000002
      00000004 0071 0075 0069 0064 00000009 0030 0030 0030 0030 0030 0030 0030 0030 0031
      00000004 0071 0075 0069 0064 00000009 0030 0030 0030 0030 0030 0030 0030 0030 0032
    00000000
  `));
});

await check("unsorted and duplicate structured-style keys reject", () => {
  expectBinaryRejection(fixedHex(`
    48 53 4f 4e 10 00000001 0078
    01 00000001 00000005 0073 0074 0079 006c 0065 26 00000002
      00000001 007a 24 00000000
      00000001 0061 24 00000000
    00 00000000
  `));
  expectBinaryRejection(fixedHex(`
    48 53 4f 4e 10 00000001 0078
    01 00000001 00000005 0073 0074 0079 006c 0065 26 00000002
      00000001 0061 24 00000000
      00000001 0061 24 00000000
    00 00000000
  `));
});

await check("empty attrs and 0x26 outside the style attribute reject", () => {
  expectBinaryRejection(fixedHex(`48 53 4f 4e 10 00000001 0078 01 00000000 00 00000000`));
  expectBinaryRejection(fixedHex(`
    48 53 4f 4e 10 00000001 0078
    01 00000001 00000005 0063 006c 0061 0073 0073 26 00000000
    00 00000000
  `));
});

await check("malformed typed-style leaves reject", () => {
  expectBinaryRejection(fixedHex(`
    48 53 4f 4e 10 00000001 0078
    01 00000001 00000005 0073 0074 0079 006c 0065 26 00000001
      00000001 0078 25 21 00
    00 00000000
  `));
  expectBinaryRejection(fixedHex(`
    48 53 4f 4e 10 00000001 0078
    01 00000001 00000005 0073 0074 0079 006c 0065 26 00000001
      00000001 0078 25 24 00000000 02
  `));
  expectBinaryRejection(fixedHex(`
    48 53 4f 4e 10 00000001 0078
    01 00000001 00000005 0073 0074 0079 006c 0065 26 00000001
      00000001 0078 25 24 00000000 03
    00 00000000
  `));
});

await check("invalid QUID length and alphabet reject", () => {
  expectBinaryRejection(fixedHex(`
    48 53 4f 4e 10 00000004 006d 0061 0069 006e 00 01 00000001
      00000004 0071 0075 0069 0064 00000008 0030 0030 0030 0030 0030 0030 0030 0031
    00000000
  `));
  expectBinaryRejection(fixedHex(`
    48 53 4f 4e 10 00000004 006d 0061 0069 006e 00 01 00000001
      00000004 0071 0075 0069 0064 00000009 0030 0030 0030 0030 0030 0030 0030 0030 0049
    00000000
  `));
});

await check("invalid metadata keys and placement reject", () => {
  expectBinaryRejection(fixedHex(`
    48 53 4f 4e 10 00000004 006d 0061 0069 006e 00 01 00000001
      00000001 0078 00000001 0079
    00000000
  `));
  expectBinaryRejection(fixedHex(`
    48 53 4f 4e 11 00 01 00000001
      00000004 0071 0075 0069 0064 00000009 0030 0030 0030 0030 0030 0030 0030 0030 0031
    00000001 0078
  `));
});

const ARRAY_INDEX_ZERO = `
  16 00 01 00000001
    00000005 0069 006e 0064 0065 0078 00000001 0030
    00000001 12 00 00 20
`;
const ARRAY_INDEX_ONE = `
  16 00 01 00000001
    00000005 0069 006e 0064 0065 0078 00000001 0031
    00000001 12 00 00 20
`;
const ARRAY_INDEX_TWO = `
  16 00 01 00000001
    00000005 0069 006e 0064 0065 0078 00000001 0032
    00000001 12 00 00 20
`;

await check("array duplicate and gap indexes reject", () => {
  expectBinaryRejection(fixedHex(`48 53 4f 4e 14 00 00 00000002 ${ARRAY_INDEX_ZERO} ${ARRAY_INDEX_ZERO}`));
  expectBinaryRejection(fixedHex(`48 53 4f 4e 14 00 00 00000002 ${ARRAY_INDEX_ZERO} ${ARRAY_INDEX_TWO}`));
});

await check("noncanonical and out-of-order array indexes reject", () => {
  expectBinaryRejection(fixedHex(`
    48 53 4f 4e 14 00 00 00000001
      16 00 01 00000001
        00000005 0069 006e 0064 0065 0078 00000002 0030 0030
        00000001 12 00 00 20
  `));
  expectBinaryRejection(fixedHex(`48 53 4f 4e 14 00 00 00000002 ${ARRAY_INDEX_ONE} ${ARRAY_INDEX_ZERO}`));
});

await check("duplicate object members reject through the Binary boundary", () => {
  const member = `10 00000001 0061 00 00 00000001 13 00 00 00000000`;
  expectBinaryRejection(fixedHex(`48 53 4f 4e 13 00 00 00000002 ${member} ${member}`));
});

await check("invalid structural crossings reject through the Binary boundary", () => {
  expectBinaryRejection(fixedHex(`48 53 4f 4e 14 00 00 00000001 12 00 00 20`));
  expectBinaryRejection(fixedHex(`48 53 4f 4e 15 00 00 00000001 12 00 00 20`));
});

await check("decode options require positive integers", () => {
  for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    expectBinaryRejection(GOLDEN_NULL, { maxBytes: value });
    expectBinaryRejection(GOLDEN_NULL, { maxGraphDepth: value });
    expectBinaryRejection(GOLDEN_NULL, { maxGraphNodes: value });
  }
});

await check("maxBytes rejects before marker parsing and has the approved default", () => {
  expectBinaryRejection(GOLDEN_NULL, { maxBytes: GOLDEN_NULL.length - 1 });
  expectBinaryRejection(new Uint8Array(1_048_577));
  assert.equal(canonical_hson_graph_equal(hsonTransform.fromBinary(GOLDEN_NULL, { maxBytes: GOLDEN_NULL.length }).toNode(), val(null)), true);
});

await check("maxGraphDepth rejects before excessive descent", () => {
  expectBinaryRejection(GOLDEN_NESTED, { maxGraphDepth: 1 });
  assert.equal(canonical_hson_graph_equal(hsonTransform.fromBinary(GOLDEN_NULL, { maxGraphDepth: 1 }).toNode(), val(null)), true);
});

await check("maxGraphNodes rejects before exceeding its node budget", () => {
  expectBinaryRejection(GOLDEN_ARRAY, { maxGraphNodes: 4 });
  assert.equal(canonical_hson_graph_equal(hsonTransform.fromBinary(GOLDEN_ARRAY, { maxGraphNodes: 5 }).toNode(), indexedArray), true);
});

await check("an actual Worker has byte, decode/encode, and SHA parity", async () => {
  const worker = repository_typescript_worker(new URL("./fixtures/binary-hson.worker.mts", import.meta.url));
  const result = await new Promise<{ bytes: number[]; closure: number[]; digest: string }>((resolve, reject) => {
    worker.once("message", resolve);
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) reject(new Error(`Binary Hson Worker exited with code ${code}`));
    });
  });
  assert.deepEqual(Uint8Array.from(result.bytes), GOLDEN_NESTED);
  assert.deepEqual(Uint8Array.from(result.closure), GOLDEN_NESTED);
  assert.equal(result.digest, sha256Oracle(GOLDEN_NESTED));
});

process.stdout.write(`1..${checks}\n`);
emit_hson_live_test_completion("transform.binary-hson-rejection", checks, checks, 0);
