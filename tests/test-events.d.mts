export const HSON_TEST_EVENT_PREFIX: "<HSON_TEST_EVENT>";

export type HsonTestCaseStatus = "pass" | "fail" | "skip" | "unsupported" | "cancelled";

export type HsonTestEventEmitter = Readonly<{
  case_begin(caseId: string, title: string): void;
  diagnostic(caseId: string, kind: string, message: string): void;
  case_end(caseId: string, status: HsonTestCaseStatus): void;
  terminal(status: HsonTestCaseStatus): void;
}>;

export function create_test_event_emitter(suiteId: string): HsonTestEventEmitter;
