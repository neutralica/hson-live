export const LIVEHOST_NODE_MINIMUM_VERSION = Object.freeze({
  major: 22,
  minor: 12,
  patch: 0,
});

export const LIVEHOST_NODE_SUPPORTED_RANGE = ">=22.12.0 <25";

export function is_supported_livehost_node_runtime(version = process.versions.node): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (match === null) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (major > LIVEHOST_NODE_MINIMUM_VERSION.major) return major < 25;
  if (major !== LIVEHOST_NODE_MINIMUM_VERSION.major) return false;
  if (minor !== LIVEHOST_NODE_MINIMUM_VERSION.minor) {
    return minor > LIVEHOST_NODE_MINIMUM_VERSION.minor;
  }
  return patch >= LIVEHOST_NODE_MINIMUM_VERSION.patch;
}

/** Executable-boundary guard; environment-neutral package imports do not call it. */
export function assert_supported_livehost_node_runtime(version = process.versions.node): void {
  if (is_supported_livehost_node_runtime(version)) return;
  throw new Error(
    `Unsupported Node.js ${version}; hson-live Node hosting requires ${LIVEHOST_NODE_SUPPORTED_RANGE}.`,
  );
}
