export const HSON_LIVE_TEST_COMPLETION_PREFIX = "<HSON_LIVE_TEST_COMPLETION>";
export const HSON_LIVE_TEST_COMPLETION_VERSION = 1;

export function emit_hson_live_test_completion(launcherId, executed, passed, failed) {
  if (typeof launcherId !== "string" || launcherId.length === 0) {
    throw new Error("Launcher completion requires a non-empty launcher ID.");
  }
  for (const [name, value] of Object.entries({ executed, passed, failed })) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`Launcher completion ${name} must be a non-negative safe integer.`);
    }
  }
  if (executed !== passed + failed) {
    throw new Error("Launcher completion executed count must equal passed plus failed.");
  }
  const record = {
    version: HSON_LIVE_TEST_COMPLETION_VERSION,
    launcherId,
    executed,
    passed,
    failed,
  };
  process.stdout.write(`${HSON_LIVE_TEST_COMPLETION_PREFIX}${JSON.stringify(record)}\n`);
}
