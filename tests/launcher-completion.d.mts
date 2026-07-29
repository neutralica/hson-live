export const HSON_LIVE_TEST_COMPLETION_PREFIX: "<HSON_LIVE_TEST_COMPLETION>";
export const HSON_LIVE_TEST_COMPLETION_VERSION: 1;

export function emit_hson_live_test_completion(
  launcherId: string,
  executed: number,
  passed: number,
  failed: number,
): void;
