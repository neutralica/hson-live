export type HsonLiveTestSubject =
  | "LiveHost"
  | "LiveMap"
  | "Reflect"
  | "LiveTree"
  | "Transform"
  | "Core";

export type HsonLiveTestRuntime =
  | "node"
  | "node-synthetic-dom"
  | "node-real-websocket"
  | "node-real-websocket-process";

/**
 * Every registered launcher must emit exactly one terminal completion record
 * whose executed count equals its manifested executableChecks value.
 */
export const HSON_LIVE_TEST_COMPLETION_REQUIREMENT =
  "exact-declared-check-count" as const;

export type HsonLiveTestLauncher = Readonly<{
  id: string;
  subject: HsonLiveTestSubject;
  displayName: string;
  packageScript: `test:${string}`;
  repositoryModule: `tests/${string}`;
  runtime: HsonLiveTestRuntime;
  executableChecks: number;
  collections: readonly string[];
}>;

export type HsonLiveNonLauncherTestScript = Readonly<{
  packageScript: `test:${string}`;
  reason: string;
}>;

function launcher(
  value: Omit<HsonLiveTestLauncher, "collections"> & {
    collections: readonly string[];
  },
): HsonLiveTestLauncher {
  return Object.freeze({
    ...value,
    collections: Object.freeze([...value.collections]),
  });
}

export const hson_live_test_launchers: readonly HsonLiveTestLauncher[] =
  Object.freeze([
    launcher({
      id: "core.hson-number",
      subject: "Core",
      displayName: "HSON numeric admission",
      packageScript: "test:hson-number",
      repositoryModule: "tests/hson-number.acceptance.mts",
      runtime: "node",
      executableChecks: 19,
      collections: ["hson", "number", "admission", "public-api", "externally-discoverable"],
    }),
    launcher({
      id: "transform.hson-tokenizer",
      subject: "Transform",
      displayName: "HSON tokenizer",
      packageScript: "test:hson-tokenizer",
      repositoryModule: "tests/hson-tokenizer.acceptance.mts",
      runtime: "node",
      executableChecks: 134,
      collections: ["hson", "tokenization", "parsing"],
    }),
    launcher({
      id: "transform.hson-structural-mode",
      subject: "Transform",
      displayName: "HSON canonical structural mode",
      packageScript: "test:hson-structural-mode",
      repositoryModule: "tests/hson-structural-mode.acceptance.mts",
      runtime: "node",
      executableChecks: 44,
      collections: ["hson", "parsing", "canonical-graph", "structural-mode"],
    }),
    launcher({
      id: "transform.hson-root-boundary",
      subject: "Transform",
      displayName: "HSON root detachment and source shaping",
      packageScript: "test:hson-root-boundary",
      repositoryModule: "tests/hson-root-boundary.acceptance.mts",
      runtime: "node",
      executableChecks: 77,
      collections: ["hson", "parsing", "root-boundary", "source-shaping"],
    }),
    launcher({
      id: "transform.hson-serializer",
      subject: "Transform",
      displayName: "HSON serializer",
      packageScript: "test:hson-serializer",
      repositoryModule: "tests/hson-serializer.acceptance.mts",
      runtime: "node",
      executableChecks: 108,
      collections: ["hson", "serialization", "round-trip"],
    }),
    launcher({
      id: "transform.json-ingress",
      subject: "Transform",
      displayName: "Detached JSON ingress and root metadata",
      packageScript: "test:json-ingress",
      repositoryModule: "tests/json-ingress.acceptance.mts",
      runtime: "node",
      executableChecks: 31,
      collections: ["json", "ingress", "canonical-graph", "externally-discoverable"],
    }),
    launcher({
      id: "core.hson-node-quid",
      subject: "Transform",
      displayName: "Canonical HsonNode QUID primitives",
      packageScript: "test:hson-node-quid",
      repositoryModule: "tests/hson-node-quid.acceptance.mts",
      runtime: "node",
      executableChecks: 14,
      collections: ["quid", "canonical-graph", "externally-discoverable"],
    }),
    launcher({
      id: "transform.hson-node-quid-ingress",
      subject: "Transform",
      displayName: "Canonical HsonNode QUID ingress",
      packageScript: "test:hson-node-quid-ingress",
      repositoryModule: "tests/hson-node-quid-ingress.acceptance.mts",
      runtime: "node-synthetic-dom",
      executableChecks: 33,
      collections: ["quid", "ingress", "externally-discoverable"],
    }),
    launcher({
      id: "transform.hson-node-quid-egress",
      subject: "Transform",
      displayName: "Canonical HsonNode QUID egress",
      packageScript: "test:hson-node-quid-egress",
      repositoryModule: "tests/hson-node-quid-egress.acceptance.mts",
      runtime: "node-synthetic-dom",
      executableChecks: 13,
      collections: ["quid", "egress", "serialization", "externally-discoverable"],
    }),
    launcher({
      id: "core.canonical-hson-equality",
      subject: "Core",
      displayName: "Canonical HSON equality",
      packageScript: "test:canonical-hson-equality",
      repositoryModule: "tests/canonical-hson-equality.acceptance.mts",
      runtime: "node",
      executableChecks: 16,
      collections: ["canonical-graph", "equality"],
    }),
    launcher({
      id: "transform.canonical-oracle",
      subject: "Transform",
      displayName: "Canonical Transform oracle and deterministic witnesses",
      packageScript: "test:transform-oracle",
      repositoryModule: "tests/transform-oracle.acceptance.mts",
      runtime: "node",
      executableChecks: 26,
      collections: ["canonical-graph", "oracle", "deterministic-witness"],
    }),
    launcher({
      id: "livemap.view-state-snapshot-codec",
      subject: "LiveMap",
      displayName: "View-state snapshot codec",
      packageScript: "test:view-state-snapshot-codec",
      repositoryModule: "tests/view-state-snapshot-codec.acceptance.mts",
      runtime: "node",
      executableChecks: 24,
      collections: ["document", "snapshot", "codec"],
    }),
    launcher({
      id: "core.public-boundaries",
      subject: "Core",
      displayName: "Public package boundaries",
      packageScript: "test:public-boundaries",
      repositoryModule: "tests/public-boundaries.acceptance.mts",
      runtime: "node",
      executableChecks: 6,
      collections: ["public-api", "LiveMap", "LiveTree", "Transform"],
    }),
    launcher({
      id: "livetree.attrs",
      subject: "LiveTree",
      displayName: "LiveTree canonical attributes",
      packageScript: "test:livetree-attrs",
      repositoryModule: "tests/livetree-attrs.acceptance.mts",
      runtime: "node-synthetic-dom",
      executableChecks: 12,
      collections: ["attributes", "style", "dom-projection"],
    }),
    launcher({
      id: "livetree.quid-eligibility",
      subject: "LiveTree",
      displayName: "LiveTree QUID eligibility",
      packageScript: "test:livetree-quid-eligibility",
      repositoryModule: "tests/livetree-quid-eligibility.acceptance.mts",
      runtime: "node",
      executableChecks: 6,
      collections: ["quid", "eligibility", "identity", "externally-discoverable"],
    }),
    launcher({
      id: "livetree.runtime-scope",
      subject: "LiveTree",
      displayName: "LiveTree runtime scope isolation",
      packageScript: "test:livetree-runtime-scope",
      repositoryModule: "tests/livetree-runtime-scope.acceptance.mts",
      runtime: "node-synthetic-dom",
      executableChecks: 24,
      collections: ["quid", "runtime", "lifecycle", "css", "Reflect", "externally-discoverable"],
    }),
    launcher({
      id: "reflect.document-attrs",
      subject: "Reflect",
      displayName: "Document Reflect attributes",
      packageScript: "test:reflect-document-attrs",
      repositoryModule: "tests/reflect-document-attrs.acceptance.mts",
      runtime: "node-synthetic-dom",
      executableChecks: 10,
      collections: ["document", "binding", "attributes"],
    }),
    launcher({
      id: "reflect.document-structure",
      subject: "Reflect",
      displayName: "Document Reflect structure",
      packageScript: "test:reflect-document-structure",
      repositoryModule: "tests/reflect-document-structure.acceptance.mts",
      runtime: "node-synthetic-dom",
      executableChecks: 11,
      collections: ["document", "binding", "structure"],
    }),
    launcher({
      id: "reflect.document-delegation",
      subject: "Reflect",
      displayName: "Document Reflect mutation delegation",
      packageScript: "test:reflect-document-delegation",
      repositoryModule: "tests/reflect-document-delegation.acceptance.mts",
      runtime: "node-synthetic-dom",
      executableChecks: 8,
      collections: ["document", "binding", "delegation"],
    }),
    launcher({
      id: "reflect.document-root",
      subject: "Reflect",
      displayName: "Document Reflect root update",
      packageScript: "test:reflect-document-root",
      repositoryModule: "tests/reflect-document-root.acceptance.mts",
      runtime: "node-synthetic-dom",
      executableChecks: 8,
      collections: ["document", "binding", "root"],
    }),
    launcher({
      id: "reflect.document-snapshot",
      subject: "Reflect",
      displayName: "Document Reflect snapshot update",
      packageScript: "test:reflect-document-snapshot",
      repositoryModule: "tests/reflect-document-snapshot.acceptance.mts",
      runtime: "node-synthetic-dom",
      executableChecks: 9,
      collections: ["document", "binding", "snapshot"],
    }),
    launcher({
      id: "livemap.document",
      subject: "LiveMap",
      displayName: "Document LiveMap",
      packageScript: "test:livemap-document",
      repositoryModule: "tests/livemap-document.acceptance.mts",
      runtime: "node",
      executableChecks: 14,
      collections: ["document", "construction", "identity"],
    }),
    launcher({
      id: "livemap.document-install",
      subject: "LiveMap",
      displayName: "Document LiveMap installation",
      packageScript: "test:livemap-document-install",
      repositoryModule: "tests/livemap-document-install.acceptance.mts",
      runtime: "node",
      executableChecks: 11,
      collections: ["document", "installation", "identity"],
    }),
    launcher({
      id: "livemap.document-mutation",
      subject: "LiveMap",
      displayName: "Document LiveMap mutation",
      packageScript: "test:livemap-document-mutation",
      repositoryModule: "tests/livemap-document-mutation.acceptance.mts",
      runtime: "node",
      executableChecks: 21,
      collections: ["document", "mutation", "attributes", "content"],
    }),
    launcher({
      id: "livemap.document-attrs-read",
      subject: "LiveMap",
      displayName: "Document LiveMap attribute reads",
      packageScript: "test:livemap-document-attrs-read",
      repositoryModule: "tests/livemap-document-attrs-read.acceptance.mts",
      runtime: "node",
      executableChecks: 8,
      collections: ["document", "attributes", "reads"],
    }),
    launcher({
      id: "livemap.document-replay",
      subject: "LiveMap",
      displayName: "Document LiveMap observation and replay",
      packageScript: "test:livemap-document-replay",
      repositoryModule: "tests/livemap-document-replay.acceptance.mts",
      runtime: "node",
      executableChecks: 16,
      collections: ["document", "observation", "replay"],
    }),
    launcher({
      id: "livemap.path-handle",
      subject: "LiveMap",
      displayName: "LiveMap path handles",
      packageScript: "test:livemap-path-handle",
      repositoryModule: "tests/livemap-path-handle.acceptance.mts",
      runtime: "node",
      executableChecks: 10,
      collections: ["path-handle", "proxy", "bridge", "externally-discoverable"],
    }),
    launcher({
      id: "livemap.staged-authority",
      subject: "LiveMap",
      displayName: "Staged LiveMap authority",
      packageScript: "test:livemap-staged-authority",
      repositoryModule: "tests/livemap-staged-authority.acceptance.mts",
      runtime: "node",
      executableChecks: 13,
      collections: ["authority", "lifecycle", "commit"],
    }),
    launcher({
      id: "livehost.authority",
      subject: "LiveHost",
      displayName: "Exclusive LiveHost authority",
      packageScript: "test:livehost-authority",
      repositoryModule: "tests/runtime-probes/livehost-authority.acceptance.mjs",
      runtime: "node",
      executableChecks: 19,
      collections: ["authority", "lifecycle", "commit"],
    }),
    launcher({
      id: "livehost.persistence",
      subject: "LiveHost",
      displayName: "Persistent LiveHost",
      packageScript: "test:livehost-persistence",
      repositoryModule: "tests/runtime-probes/livehost-persistence.acceptance.mjs",
      runtime: "node",
      executableChecks: 16,
      collections: ["persistence", "authority", "recovery"],
    }),
    launcher({
      id: "livehost.recovery",
      subject: "LiveHost",
      displayName: "LiveHost recovery",
      packageScript: "test:livehost-recovery",
      repositoryModule: "tests/runtime-probes/livehost-recovery.acceptance.mjs",
      runtime: "node",
      executableChecks: 11,
      collections: ["recovery", "history", "snapshot"],
    }),
    launcher({
      id: "livehost.client-recovery",
      subject: "LiveHost",
      displayName: "LiveHost client recovery",
      packageScript: "test:livehost-client-recovery",
      repositoryModule: "tests/runtime-probes/livehost-client-recovery.acceptance.mjs",
      runtime: "node-real-websocket",
      executableChecks: 28,
      collections: ["client", "recovery", "protocol", "websocket"],
    }),
    launcher({
      id: "livehost.document-recovery",
      subject: "LiveHost",
      displayName: "LiveHost document recovery",
      packageScript: "test:livehost-document-recovery",
      repositoryModule: "tests/runtime-probes/livehost-document-recovery.acceptance.mjs",
      runtime: "node",
      executableChecks: 28,
      collections: ["document", "recovery", "snapshot"],
    }),
    launcher({
      id: "livehost.document-actions",
      subject: "LiveHost",
      displayName: "Hosted document actions",
      packageScript: "test:livehost-document-actions",
      repositoryModule: "tests/runtime-probes/livehost-document-actions.acceptance.mjs",
      runtime: "node",
      executableChecks: 28,
      collections: ["document", "actions", "recovery"],
    }),
    launcher({
      id: "livehost.protocol-document",
      subject: "LiveHost",
      displayName: "LiveHost document protocol",
      packageScript: "test:livehost-protocol-document",
      repositoryModule: "tests/runtime-probes/livehost-protocol-document.acceptance.mjs",
      runtime: "node",
      executableChecks: 8,
      collections: ["document", "protocol", "validation"],
    }),
    launcher({
      id: "livehost.session",
      subject: "LiveHost",
      displayName: "LiveHost session",
      packageScript: "test:livehost-session",
      repositoryModule: "tests/runtime-probes/livehost-session.acceptance.mjs",
      runtime: "node-real-websocket",
      executableChecks: 15,
      collections: ["session", "recovery", "websocket"],
    }),
    launcher({
      id: "livehost.action-dedupe",
      subject: "LiveHost",
      displayName: "LiveHost action deduplication",
      packageScript: "test:livehost-action-dedupe",
      repositoryModule: "tests/runtime-probes/livehost-action-dedupe.acceptance.mjs",
      runtime: "node-real-websocket-process",
      executableChecks: 21,
      collections: ["actions", "deduplication", "identity", "websocket"],
    }),
    launcher({
      id: "livehost.trace",
      subject: "LiveHost",
      displayName: "LiveHost tracing",
      packageScript: "test:livehost-trace",
      repositoryModule: "tests/runtime-probes/livehost-trace.acceptance.mjs",
      runtime: "node",
      executableChecks: 12,
      collections: ["trace", "actions", "redaction"],
    }),
    launcher({
      id: "livehost.authorization",
      subject: "LiveHost",
      displayName: "LiveHost action authorization",
      packageScript: "test:livehost-authorization",
      repositoryModule: "tests/runtime-probes/livehost-authorization.acceptance.mjs",
      runtime: "node",
      executableChecks: 11,
      collections: ["actions", "authorization", "policy"],
    }),
    launcher({
      id: "livehost.node-hosting",
      subject: "LiveHost",
      displayName: "LiveHost Node hosting",
      packageScript: "test:livehost-node-hosting",
      repositoryModule: "tests/livehost-node-hosting.acceptance.mts",
      runtime: "node-real-websocket",
      executableChecks: 44,
      collections: ["transport", "websocket", "node-host", "externally-discoverable"],
    }),
    launcher({
      id: "livehost.bootstrap",
      subject: "LiveHost",
      displayName: "LiveHost HTTP HSON bootstrap",
      packageScript: "test:livehost-bootstrap",
      repositoryModule: "tests/livehost-bootstrap.acceptance.mts",
      runtime: "node-real-websocket",
      executableChecks: 31,
      collections: ["bootstrap", "hson", "recovery", "http", "websocket", "externally-discoverable"],
    }),
    launcher({
      id: "livehost.authority-lifecycle",
      subject: "LiveHost",
      displayName: "LiveHost authority lifecycle",
      packageScript: "test:livehost-authority-lifecycle",
      repositoryModule: "tests/livehost-authority-lifecycle.acceptance.mts",
      runtime: "node",
      executableChecks: 18,
      collections: ["authority", "lifecycle", "eviction", "capacity", "restart", "externally-discoverable"],
    }),
  ]);

/**
 * Package test scripts intentionally outside the external launcher contract.
 * Every other test:* script must have exactly one hson_live_test_launchers entry.
 */
export const hson_live_non_launcher_test_scripts:
readonly HsonLiveNonLauncherTestScript[] = Object.freeze([
  Object.freeze({
    packageScript: "test:diagnostics-inventory",
    reason: "Validates the launcher manifest itself and would recurse if launched externally.",
  }),
  Object.freeze({
    packageScript: "test:hson-array-index",
    reason: "Command-only Transform integration journey; not an externally selectable launcher.",
  }),
  Object.freeze({
    packageScript: "test:hson-attribute-transport",
    reason: "Command-only Transform integration journey; not an externally selectable launcher.",
  }),
  Object.freeze({
    packageScript: "test:livehost-graph-content-codec",
    reason: "Command-only LiveHost integration journey; not an externally selectable launcher.",
  }),
  Object.freeze({
    packageScript: "test:root-compatibility",
    reason: "Production artifact compatibility certification; not an external semantic launcher.",
  }),
  Object.freeze({
    packageScript: "test:transform-worker",
    reason: "Worker entrypoint integration journey; not an externally selectable launcher.",
  }),
]);
