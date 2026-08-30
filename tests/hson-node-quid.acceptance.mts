import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
// @hson-live-external-test
import assert from "node:assert/strict";
import type { HsonNode } from "../src/core/types.ts";
import { EVERY_VSN, HSON_META_INDEX, HSON_META_QUID } from "../src/core/constants.ts";

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
  build_livemap_document_identity_overlay,
  LiveMapDocumentIdentityError,
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
  return index.toString().padStart(9, "0");
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

check("known byte vectors encode to exact 9-character Crockford Base32 values", () => {
  assert.equal(encode_persisted_quid(new Uint8Array(6)), "000000000");
  assert.equal(encode_persisted_quid(new Uint8Array(6).fill(255)), "zzzzzzzzz");
  assert.equal(
    encode_persisted_quid(new Uint8Array([0, 1, 2, 3, 4, 5])),
    "000g40r40",
  );
  assert.equal(
    encode_persisted_quid(new Uint8Array([1, 35, 69, 103, 137, 171])),
    "04hmasw9n",
  );
  assert.throws(() => encode_persisted_quid(new Uint8Array(5)), /exactly 6 bytes/);
  assert.throws(() => encode_persisted_quid(new Uint8Array(7)), /exactly 6 bytes/);
});

check("validation accepts only the exact lowercase 9-character alphabet", () => {
  assert.equal(is_persisted_quid("d1r6x8qwc"), true);
  for (const malformed of [
    "",
    "d1r6x8qw",
    "0d1r6x8qwc",
    "000d1r6x8qwc",
    "4k7m2v9d1r6x8qwc",
    "D1R6X8QWC",
    "d1r6x8qwi",
    "d1r6x8qwl",
    "d1r6x8qwo",
    "d1r6x8qwu",
    "d1r6x8qw-",
    " d1r6x8qwc",
    "d1r6x8qwc ",
    "xd1r6x8qwc",
    "d1r6x8qwcx",
  ]) {
    assert.equal(is_persisted_quid(malformed), false, malformed);
  }
});

check("secure minting uses exactly six bytes, stays lowercase, and fails without Web Crypto", () => {
  let requestedLength = 0;
  withCrypto({
    getRandomValues<T extends ArrayBufferView | null>(array: T): T {
      assert.ok(array instanceof Uint8Array);
      requestedLength = array.byteLength;
      array.set([255, 0, 170, 85, 16, 32]);
      return array;
    },
  } as Crypto, () => {
    const minted = mint_hson_node_quid();
    assert.equal(requestedLength, 6);
    assert.equal(minted, "zw0amn8g4");
    assert.match(minted, /^[0-9abcdefghjkmnpqrstvwxyz]{9}$/);
    assert.equal(minted, minted.toLowerCase());
  });
  withCrypto(undefined, () => {
    assert.throws(() => mint_hson_node_quid(), /secure QUID generation is unavailable/);
  });
});

check("only semantic projected containers expand the established VSN eligibility boundary", () => {
  for (const tag of [...EVERY_VSN.filter((tag) => tag !== "_hson_obj" && tag !== "_hson_arr"), "_hson_future"]) {
    const value = node(tag, [], tag === "_hson_ii" ? { [HSON_META_INDEX]: "0" } : undefined);
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
  for (const value of [node("_hson_obj"), node("_hson_arr")]) {
    assert.equal(assign_hson_node_quid(value, q(1000)), q(1000));
    assert.equal(remove_hson_node_quid(value), q(1000));
  }
  const transparent = node("_hson_obj", [node("_hson_val", [true])]);
  assert.throws(() => assign_hson_node_quid(transparent, q(1001)), (cause) => (
    cause instanceof HsonNodeQuidValidationError && cause.code === "INELIGIBLE_QUID"
  ));
});

check("QUID-bearing ineligible VSN metadata is rejected while semantic containers preserve it", () => {
  for (const [index, tag] of [...EVERY_VSN.filter((tag) => tag !== "_hson_obj" && tag !== "_hson_arr"), "_hson_future"].entries()) {
    const persisted = q(1100 + index);
    const value = node(tag, [], { [HSON_META_QUID]: persisted });
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
      assert.equal(value.$_meta?.[HSON_META_QUID], persisted);
    }
  }
  for (const [index, tag] of ["_hson_obj", "_hson_arr"].entries()) {
    const persisted = q(1300 + index);
    assert.equal(read_hson_node_quid(node(tag, [], { [HSON_META_QUID]: persisted })), persisted);
  }
});

check("ordinary-node assignment, stable ensure, and deliberate removal are canonical", () => {
  for (const tag of ["main", "property", "svg", "custom-element"]) {
    const value = node(tag);
    const supplied = q(1300 + tag.length);
    assert.equal(assign_hson_node_quid(value, supplied), supplied);
    assert.equal(read_hson_node_quid(value), supplied);
    assert.equal(has_hson_node_quid(value), true);
    assert.equal(ensure_hson_node_quid(value), supplied);
    assert.equal(remove_hson_node_quid(value), supplied);
    assert.equal(read_hson_node_quid(value), undefined);
    assert.equal(value.$_meta, undefined);
  }

  const minted = node("fresh");
  const mintedQuid = ensure_hson_node_quid(minted);
  assert.match(mintedQuid, /^[0-9abcdefghjkmnpqrstvwxyz]{9}$/);
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

  const malformed = node("main", [], { [HSON_META_QUID]: "not-canonical" });
  assert.throws(
    () => remove_hson_node_quid(malformed),
    (cause) => cause instanceof HsonNodeQuidValidationError
      && cause.code === "MALFORMED_QUID",
  );
  assert.equal(malformed.$_meta?.[HSON_META_QUID], "not-canonical");
});

check("graph scan rejects sibling and ancestor-descendant duplicate claims deterministically", () => {
  const siblingQ = q(1400);
  const left = node("left", [], { [HSON_META_QUID]: siblingQ });
  const right = node("right", [], { [HSON_META_QUID]: siblingQ });
  const siblingError = duplicateError(() => scan_hson_node_quids(node("root", [left, right])));
  assert.equal(siblingError.conflictingNode, left);
  assert.equal(siblingError.node, right);

  const nestedQ = q(1401);
  const descendant = node("descendant", [], { [HSON_META_QUID]: nestedQ });
  const ancestor = node("ancestor", [descendant], { [HSON_META_QUID]: nestedQ });
  const nestedError = duplicateError(() => scan_hson_node_quids(ancestor));
  assert.equal(nestedError.conflictingNode, ancestor);
  assert.equal(nestedError.node, descendant);
});

check("canonical claim collection preserves duplicate values without registration", () => {
  const duplicateQ = q(1450);
  const left = node("left", [], { [HSON_META_QUID]: duplicateQ });
  const right = node("right", [], { [HSON_META_QUID]: duplicateQ });
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
      node("article", [], { [HSON_META_QUID]: documentQ }),
      node("aside", [], { [HSON_META_QUID]: documentQ }),
    ]),
  ]);
  duplicateError(() => scan_hson_node_quids(document));

  const objectQ = q(1501);
  const dataObject = node("_hson_root", [
    node("_hson_obj", [
      node("first", [], { [HSON_META_QUID]: objectQ }),
      node("second", [], { [HSON_META_QUID]: objectQ }),
    ]),
  ]);
  duplicateError(() => scan_hson_node_quids(dataObject));

  const arrayQ = q(1502);
  const dataArray = node("_hson_root", [
    node("_hson_arr", [
      node("_hson_ii", [node("first-item", [], { [HSON_META_QUID]: arrayQ })], { [HSON_META_INDEX]: "0" }),
      node("_hson_ii", [node("second-item", [], { [HSON_META_QUID]: arrayQ })], { [HSON_META_INDEX]: "1" }),
    ]),
  ]);
  duplicateError(() => scan_hson_node_quids(dataArray));
});

check("graph identity is object-based, graph-local, non-registering, and duplicate-distinct", () => {
  const sharedQ = q(1600);
  const shared = node("shared", [], { [HSON_META_QUID]: sharedQ });
  const repeatedReference = node("root", [shared, shared]);
  const repeatedIndex = scan_hson_node_quids(repeatedReference);
  assert.equal(repeatedIndex.size, 1);
  assert.equal(repeatedIndex.get(sharedQ), shared);

  const coldQ = q(1601);
  const cold = node("cold", [], { [HSON_META_QUID]: coldQ });
  assert.equal(scan_hson_node_quids(cold).get(coldQ), cold);
  assert.equal(get_node_by_quid(coldQ), undefined);

  const separateQ = q(1602);
  assert.equal(
    scan_hson_node_quids(node("one", [], { [HSON_META_QUID]: separateQ })).has(separateQ),
    true,
  );
  assert.equal(
    scan_hson_node_quids(node("two", [], { [HSON_META_QUID]: separateQ })).has(separateQ),
    true,
  );
  duplicateError(() => scan_hson_node_quids(node("combined", [
    node("one", [], { [HSON_META_QUID]: separateQ }),
    node("two", [], { [HSON_META_QUID]: separateQ }),
  ])));
});

check("LiveTree and LiveMap accept the same valid QUID and reject the same malformed values", () => {
  const valid = q(1700);
  const treeNode = node("main", [], { [HSON_META_QUID]: valid });
  assert.equal(ensure_quid(treeNode), valid);

  const mapNode = node("main", [], { [HSON_META_QUID]: valid });
  const mapGraph = node("_hson_root", [node("_hson_elem", [mapNode])]);
  assert.deepEqual(build_livemap_document_identity_overlay(mapGraph, "document").pathForQuid(valid), []);

  for (const malformed of ["", "short", "00000001", "0000000001", "000000000001", "0000000000000001", "00000000I", "00000000-"]) {
    const malformedTreeNode = node("tree-bad", [], { [HSON_META_QUID]: malformed });
    assert.throws(
      () => ensure_quid(malformedTreeNode),
      (cause) => cause instanceof HsonNodeQuidValidationError
        && cause.code === "MALFORMED_QUID",
    );

    const malformedMapNode = node("map-bad", [], { [HSON_META_QUID]: malformed });
    assert.throws(
      () => build_livemap_document_identity_overlay(
        node("_hson_root", [node("_hson_elem", [malformedMapNode])]),
        "document",
      ),
      (cause) => cause instanceof LiveMapDocumentIdentityError
        && cause.code === "MALFORMED_QUID",
    );
  }
});

check("LiveTree and LiveMap both reject QUID-bearing VSNs and graph-local duplicates", () => {
  const vsnQ = q(1800);
  const invalidVsn = node("_hson_future", [], { [HSON_META_QUID]: vsnQ });
  assert.throws(
    () => get_quid(invalidVsn),
    (cause) => cause instanceof HsonNodeQuidValidationError
      && cause.code === "INELIGIBLE_QUID",
  );
  assert.throws(
    () => build_livemap_document_identity_overlay(
      node("_hson_root", [node("_hson_elem", [node("main", [invalidVsn])])]),
      "document",
    ),
    (cause) => cause instanceof LiveMapDocumentIdentityError
      && cause.code === "MALFORMED_QUID",
  );

  const duplicateQ = q(1801);
  const treeSource = node("tree-root", [
    node("a", [], { [HSON_META_QUID]: duplicateQ }),
    node("b", [], { [HSON_META_QUID]: duplicateQ }),
  ]);
  assert.throws(
    () => new LiveTree(treeSource),
    /Duplicate QUID/,
  );

  const mapSource = node("_hson_root", [node("_hson_elem", [
    node("a", [], { [HSON_META_QUID]: duplicateQ }),
    node("b", [], { [HSON_META_QUID]: duplicateQ }),
  ])]);
  assert.throws(
    () => build_livemap_document_identity_overlay(mapSource, "document"),
    (cause) => cause instanceof LiveMapDocumentIdentityError
      && cause.code === "DUPLICATE_QUID",
  );
});

check("LiveMap remains non-minting while LiveTree retains canonical minting", () => {
  const mapNode = node("unquidded");
  const mapGraph = node("_hson_root", [node("_hson_elem", [mapNode])]);
  assert.equal(build_livemap_document_identity_overlay(mapGraph, "document").size, 0);
  assert.equal(mapNode.$_meta?.[HSON_META_QUID], undefined);

  const treeNode = node("minted");
  const minted = ensure_quid(treeNode);
  assert.match(minted, /^[0-9abcdefghjkmnpqrstvwxyz]{9}$/);
  assert.equal(treeNode.$_meta?.[HSON_META_QUID], minted);
  assert.equal(get_node_by_quid(minted), treeNode);
});

process.stdout.write(`1..${checks}\n`);
emit_hson_live_test_completion("core.hson-node-quid", checks, checks, 0);
