import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
// @hson-live-external-test
import assert from "node:assert/strict";
import type { HsonNode } from "../src/core/types.ts";
import { EVERY_VSN, _DATA_INDEX, _DATA_QUID } from "../src/core/constants.ts";

const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
let moduleScopeRandomCalls = 0;
Object.defineProperty(globalThis, "crypto", {
  configurable: true,
  writable: true,
  value: {
    getRandomValues<T extends ArrayBufferView | null>(array: T): T {
      moduleScopeRandomCalls += 1;
      return array;
    },
  } as Crypto,
});

const quidCore = await import("../src/core/hson-node-quid.ts");
assert.equal(moduleScopeRandomCalls, 0, "importing the shared module must not consume randomness");

function restoreCrypto(): void {
  if (originalCryptoDescriptor === undefined) {
    Reflect.deleteProperty(globalThis, "crypto");
  } else {
    Object.defineProperty(globalThis, "crypto", originalCryptoDescriptor);
  }
}
restoreCrypto();

const {
  HsonNodeQuidValidationError,
  assign_hson_node_quid,
  collect_hson_node_quid_claims,
  encode_persisted_quid,
  ensure_hson_node_quid,
  has_hson_node_quid,
  is_persisted_quid,
  mint_hson_node_quid,
  read_hson_node_quid,
  remove_hson_node_quid,
  scan_hson_node_quids,
  validate_hson_node_quid,
} = quidCore;
const {
  ensure_quid,
  get_node_by_quid,
  get_quid,
} = await import("../src/api/livetree/quid/data-quid.ts");
const { LiveTree } = await import("../src/api/livetree/livetree.ts");
const {
  LiveMapDocumentIdentityError,
  index_livemap_document_elements,
} = await import("../src/api/livemap/livemap.document.identity.ts");

let checks = 0;
function check(name: string, fn: () => void): void {
  fn();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function node(
  tag: string,
  content: HsonNode["$_content"] = [],
  meta?: HsonNode["$_meta"],
): HsonNode {
  return meta === undefined
    ? { $_tag: tag, $_content: content }
    : { $_tag: tag, $_content: content, $_meta: meta };
}

function q(index: number): string {
  return `000000000000${index.toString().padStart(4, "0")}`;
}

function withCrypto(value: Crypto | undefined, fn: () => void): void {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    writable: true,
    value,
  });
  try {
    fn();
  } finally {
    restoreCrypto();
  }
}

function duplicateError(fn: () => unknown): InstanceType<typeof HsonNodeQuidValidationError> {
  let observed: unknown;
  try {
    fn();
  } catch (cause) {
    observed = cause;
  }
  assert.ok(observed instanceof HsonNodeQuidValidationError);
  assert.equal(observed.code, "DUPLICATE_QUID");
  assert.equal(typeof observed.path, "string");
  assert.equal(typeof observed.conflictingPath, "string");
  assert.notEqual(observed.path, observed.conflictingPath);
  return observed;
}

check("known byte vectors encode to exact 16-character Crockford Base32 values", () => {
  assert.equal(encode_persisted_quid(new Uint8Array(10)), "0000000000000000");
  assert.equal(encode_persisted_quid(new Uint8Array(10).fill(255)), "zzzzzzzzzzzzzzzz");
  assert.equal(
    encode_persisted_quid(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])),
    "000g40r40m30e209",
  );
  assert.equal(
    encode_persisted_quid(new Uint8Array([1, 35, 69, 103, 137, 171, 205, 239, 16, 50])),
    "04hmasw9nf6yy41j",
  );
  assert.throws(() => encode_persisted_quid(new Uint8Array(9)), /exactly 10 bytes/);
  assert.throws(() => encode_persisted_quid(new Uint8Array(11)), /exactly 10 bytes/);
});

check("validation accepts only the exact lowercase 16-character alphabet", () => {
  assert.equal(is_persisted_quid("4k7m2v9d1r6x8qwc"), true);
  for (const malformed of [
    "",
    "4k7m2v9d1r6x8qw",
    "4k7m2v9d1r6x8qwcc",
    "4K7M2V9D1R6X8QWC",
    "4k7m2v9d1r6x8qwi",
    "4k7m2v9d1r6x8qwl",
    "4k7m2v9d1r6x8qwo",
    "4k7m2v9d1r6x8qwu",
    "4k7m2v9d1r6x8qw-",
  ]) {
    assert.equal(is_persisted_quid(malformed), false, malformed);
  }
});

check("secure minting uses exactly ten bytes, stays lowercase, and fails without Web Crypto", () => {
  let requestedLength = 0;
  withCrypto({
    getRandomValues<T extends ArrayBufferView | null>(array: T): T {
      assert.ok(array instanceof Uint8Array);
      requestedLength = array.byteLength;
      array.set([255, 0, 170, 85, 16, 32, 48, 64, 80, 96]);
      return array;
    },
  } as Crypto, () => {
    const minted = mint_hson_node_quid();
    assert.equal(requestedLength, 10);
    assert.equal(minted, "zw0amn8g40r40m30");
    assert.match(minted, /^[0-9abcdefghjkmnpqrstvwxyz]{16}$/);
    assert.equal(minted, minted.toLowerCase());
  });
  withCrypto(undefined, () => {
    assert.throws(() => mint_hson_node_quid(), /secure QUID generation is unavailable/);
  });
});

check("all current and future-prefix VSNs are cleanly readable but reject mutation", () => {
  for (const tag of [...EVERY_VSN, "_hson_future"]) {
    const value = node(tag, [], tag === "_hson_ii" ? { [_DATA_INDEX]: "0" } : undefined);
    const before = structuredClone(value);
    assert.equal(read_hson_node_quid(value), undefined);
    assert.equal(has_hson_node_quid(value), false);
    validate_hson_node_quid(value);
    for (const operation of [
      () => assign_hson_node_quid(value, q(1000)),
      () => ensure_hson_node_quid(value),
      () => remove_hson_node_quid(value),
    ]) {
      assert.throws(
        operation,
        (cause) => cause instanceof HsonNodeQuidValidationError
          && cause.code === "INELIGIBLE_QUID",
      );
      assert.deepEqual(value, before);
    }
  }
});

check("QUID-bearing VSN metadata is rejected and never repaired or relocated", () => {
  for (const [index, tag] of [...EVERY_VSN, "_hson_future"].entries()) {
    const persisted = q(1100 + index);
    const value = node(tag, [], { [_DATA_QUID]: persisted });
    for (const operation of [
      () => read_hson_node_quid(value),
      () => validate_hson_node_quid(value),
      () => assign_hson_node_quid(value, q(1200 + index)),
      () => ensure_hson_node_quid(value),
      () => remove_hson_node_quid(value),
    ]) {
      assert.throws(
        operation,
        (cause) => cause instanceof HsonNodeQuidValidationError
          && cause.code === "INELIGIBLE_QUID",
      );
      assert.equal(value.$_meta?.[_DATA_QUID], persisted);
    }
  }
});

check("ordinary-node assignment, stable ensure, and deliberate removal are canonical", () => {
  for (const tag of ["main", "property", "svg", "custom-element"]) {
    const value = node(tag, [], { "data-_custom": "kept" });
    const supplied = q(1300 + tag.length);
    assert.equal(assign_hson_node_quid(value, supplied), supplied);
    assert.equal(read_hson_node_quid(value), supplied);
    assert.equal(has_hson_node_quid(value), true);
    assert.equal(ensure_hson_node_quid(value), supplied);
    assert.equal(remove_hson_node_quid(value), supplied);
    assert.equal(read_hson_node_quid(value), undefined);
    assert.deepEqual(value.$_meta, { "data-_custom": "kept" });
  }

  const minted = node("fresh");
  const mintedQuid = ensure_hson_node_quid(minted);
  assert.match(mintedQuid, /^[0-9abcdefghjkmnpqrstvwxyz]{16}$/);
  assert.equal(ensure_hson_node_quid(minted), mintedQuid);
  assert.equal(get_node_by_quid(mintedQuid), undefined);
});

check("malformed assignment and removal reject before metadata mutation", () => {
  const clean = node("main");
  assert.throws(
    () => assign_hson_node_quid(clean, "not-canonical"),
    (cause) => cause instanceof HsonNodeQuidValidationError
      && cause.code === "MALFORMED_QUID",
  );
  assert.equal(clean.$_meta, undefined);

  const malformed = node("main", [], { [_DATA_QUID]: "not-canonical" });
  assert.throws(
    () => remove_hson_node_quid(malformed),
    (cause) => cause instanceof HsonNodeQuidValidationError
      && cause.code === "MALFORMED_QUID",
  );
  assert.equal(malformed.$_meta?.[_DATA_QUID], "not-canonical");
});

check("graph scan rejects sibling and ancestor-descendant duplicate claims deterministically", () => {
  const siblingQ = q(1400);
  const left = node("left", [], { [_DATA_QUID]: siblingQ });
  const right = node("right", [], { [_DATA_QUID]: siblingQ });
  const siblingError = duplicateError(() => scan_hson_node_quids(node("root", [left, right])));
  assert.equal(siblingError.conflictingNode, left);
  assert.equal(siblingError.node, right);

  const nestedQ = q(1401);
  const descendant = node("descendant", [], { [_DATA_QUID]: nestedQ });
  const ancestor = node("ancestor", [descendant], { [_DATA_QUID]: nestedQ });
  const nestedError = duplicateError(() => scan_hson_node_quids(ancestor));
  assert.equal(nestedError.conflictingNode, ancestor);
  assert.equal(nestedError.node, descendant);
});

check("canonical claim collection preserves duplicate values without registration", () => {
  const duplicateQ = q(1450);
  const left = node("left", [], { [_DATA_QUID]: duplicateQ });
  const right = node("right", [], { [_DATA_QUID]: duplicateQ });
  const claims = collect_hson_node_quid_claims(node("root", [left, right]));
  assert.equal(claims.length, 2);
  assert.deepEqual(claims.map((claim) => claim.quid), [duplicateQ, duplicateQ]);
  assert.deepEqual(claims.map((claim) => claim.node), [left, right]);
  assert.equal(get_node_by_quid(duplicateQ), undefined);
});

check("graph scan rejects duplicates in document, data-object, and array-contained graphs", () => {
  const documentQ = q(1500);
  const document = node("_hson_root", [
    node("_hson_elem", [
      node("article", [], { [_DATA_QUID]: documentQ }),
      node("aside", [], { [_DATA_QUID]: documentQ }),
    ]),
  ]);
  duplicateError(() => scan_hson_node_quids(document));

  const objectQ = q(1501);
  const dataObject = node("_hson_root", [
    node("_hson_obj", [
      node("first", [], { [_DATA_QUID]: objectQ }),
      node("second", [], { [_DATA_QUID]: objectQ }),
    ]),
  ]);
  duplicateError(() => scan_hson_node_quids(dataObject));

  const arrayQ = q(1502);
  const dataArray = node("_hson_root", [
    node("_hson_arr", [
      node("_hson_ii", [node("first-item", [], { [_DATA_QUID]: arrayQ })], { [_DATA_INDEX]: "0" }),
      node("_hson_ii", [node("second-item", [], { [_DATA_QUID]: arrayQ })], { [_DATA_INDEX]: "1" }),
    ]),
  ]);
  duplicateError(() => scan_hson_node_quids(dataArray));
});

check("graph identity is object-based, graph-local, non-registering, and duplicate-distinct", () => {
  const sharedQ = q(1600);
  const shared = node("shared", [], { [_DATA_QUID]: sharedQ });
  const repeatedReference = node("root", [shared, shared]);
  const repeatedIndex = scan_hson_node_quids(repeatedReference);
  assert.equal(repeatedIndex.size, 1);
  assert.equal(repeatedIndex.get(sharedQ), shared);

  const coldQ = q(1601);
  const cold = node("cold", [], { [_DATA_QUID]: coldQ });
  assert.equal(scan_hson_node_quids(cold).get(coldQ), cold);
  assert.equal(get_node_by_quid(coldQ), undefined);

  const separateQ = q(1602);
  assert.equal(
    scan_hson_node_quids(node("one", [], { [_DATA_QUID]: separateQ })).has(separateQ),
    true,
  );
  assert.equal(
    scan_hson_node_quids(node("two", [], { [_DATA_QUID]: separateQ })).has(separateQ),
    true,
  );
  duplicateError(() => scan_hson_node_quids(node("combined", [
    node("one", [], { [_DATA_QUID]: separateQ }),
    node("two", [], { [_DATA_QUID]: separateQ }),
  ])));
});

check("LiveTree and LiveMap accept the same valid QUID and reject the same malformed values", () => {
  const valid = q(1700);
  const treeNode = node("main", [], { [_DATA_QUID]: valid });
  assert.equal(ensure_quid(treeNode), valid);

  const mapNode = node("main", [], { [_DATA_QUID]: valid });
  const mapGraph = node("_hson_root", [node("_hson_elem", [mapNode])]);
  assert.equal(index_livemap_document_elements(mapGraph).get(valid), mapNode);

  for (const malformed of ["", "short", "000000000000000I", "000000000000000-"]) {
    const malformedTreeNode = node("tree-bad", [], { [_DATA_QUID]: malformed });
    assert.throws(
      () => ensure_quid(malformedTreeNode),
      (cause) => cause instanceof HsonNodeQuidValidationError
        && cause.code === "MALFORMED_QUID",
    );

    const malformedMapNode = node("map-bad", [], { [_DATA_QUID]: malformed });
    assert.throws(
      () => index_livemap_document_elements(
        node("_hson_root", [node("_hson_elem", [malformedMapNode])]),
      ),
      (cause) => cause instanceof LiveMapDocumentIdentityError
        && cause.code === "MALFORMED_QUID",
    );
  }
});

check("LiveTree and LiveMap both reject QUID-bearing VSNs and graph-local duplicates", () => {
  const vsnQ = q(1800);
  const invalidVsn = node("_hson_future", [], { [_DATA_QUID]: vsnQ });
  assert.throws(
    () => get_quid(invalidVsn),
    (cause) => cause instanceof HsonNodeQuidValidationError
      && cause.code === "INELIGIBLE_QUID",
  );
  assert.throws(
    () => index_livemap_document_elements(invalidVsn),
    (cause) => cause instanceof LiveMapDocumentIdentityError
      && cause.code === "MALFORMED_QUID",
  );

  const duplicateQ = q(1801);
  const treeSource = node("tree-root", [
    node("a", [], { [_DATA_QUID]: duplicateQ }),
    node("b", [], { [_DATA_QUID]: duplicateQ }),
  ]);
  assert.throws(
    () => new LiveTree(treeSource),
    /Duplicate QUID/,
  );

  const mapSource = node("_hson_root", [node("_hson_elem", [
    node("a", [], { [_DATA_QUID]: duplicateQ }),
    node("b", [], { [_DATA_QUID]: duplicateQ }),
  ])]);
  assert.throws(
    () => index_livemap_document_elements(mapSource),
    (cause) => cause instanceof LiveMapDocumentIdentityError
      && cause.code === "DUPLICATE_QUID",
  );
});

check("LiveMap remains non-minting while LiveTree retains canonical minting", () => {
  const mapNode = node("unquidded");
  const mapGraph = node("_hson_root", [node("_hson_elem", [mapNode])]);
  assert.equal(index_livemap_document_elements(mapGraph).size, 0);
  assert.equal(mapNode.$_meta?.[_DATA_QUID], undefined);

  const treeNode = node("minted");
  const minted = ensure_quid(treeNode);
  assert.match(minted, /^[0-9abcdefghjkmnpqrstvwxyz]{16}$/);
  assert.equal(treeNode.$_meta?.[_DATA_QUID], minted);
  assert.equal(get_node_by_quid(minted), treeNode);
});

process.stdout.write(`1..${checks}\n`);
emit_hson_live_test_completion("core.hson-node-quid", checks, checks, 0);
