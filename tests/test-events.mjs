export const HSON_TEST_EVENT_PREFIX = "<HSON_TEST_EVENT>";

const CASE_STATUSES = new Set(["pass", "fail", "skip", "unsupported", "cancelled"]);

function emit(record) {
  process.stdout.write(`${HSON_TEST_EVENT_PREFIX}${JSON.stringify(record)}\n`);
}

function require_string(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Test event ${label} must be a non-empty string.`);
  }
}

function derive_terminal_status(statuses) {
  if (statuses.includes("fail")) return "fail";
  if (statuses.includes("cancelled")) return "cancelled";
  if (statuses.includes("pass")) return "pass";
  if (statuses.length > 0 && statuses.every((status) => status === "skip")) return "skip";
  if (statuses.includes("unsupported")) return "unsupported";
  throw new Error("Test event terminal status cannot be derived from completed cases.");
}

/** Creates the child-side event writer for one executable suite. */
export function create_test_event_emitter(suiteId) {
  require_string(suiteId, "suiteId");
  const seenCaseIds = new Set();
  const activeCaseIds = new Set();
  const completedStatuses = [];
  let terminalEmitted = false;

  function case_begin(caseId, title) {
    require_string(caseId, "caseId");
    require_string(title, "title");
    if (terminalEmitted) throw new Error("Test event case_begin cannot follow terminal.");
    if (seenCaseIds.has(caseId)) throw new Error(`Duplicate test case ID: ${caseId}`);
    seenCaseIds.add(caseId);
    activeCaseIds.add(caseId);
    emit({ t: "case_begin", caseId, title });
  }

  function diagnostic(caseId, kind, message) {
    require_string(caseId, "caseId");
    require_string(kind, "kind");
    require_string(message, "message");
    if (!activeCaseIds.has(caseId)) throw new Error(`Diagnostic has no active case: ${caseId}`);
    emit({ t: "diagnostic", caseId, kind, message });
  }

  function case_end(caseId, status) {
    require_string(caseId, "caseId");
    if (!CASE_STATUSES.has(status)) throw new Error(`Invalid test case status: ${status}`);
    if (!activeCaseIds.delete(caseId)) throw new Error(`Test case is not active: ${caseId}`);
    completedStatuses.push(status);
    emit({ t: "case_end", caseId, status });
  }

  function terminal(status) {
    if (!CASE_STATUSES.has(status)) throw new Error(`Invalid test terminal status: ${status}`);
    if (terminalEmitted) throw new Error("Test event terminal may only be emitted once.");
    if (activeCaseIds.size > 0) throw new Error("Test event terminal requires every case to end.");
    const derived = derive_terminal_status(completedStatuses);
    if (status !== derived) throw new Error(`Test event terminal ${status} contradicts completed cases (${derived}).`);
    terminalEmitted = true;
    emit({ t: "terminal", suiteId, status });
  }

  return Object.freeze({ case_begin, diagnostic, case_end, terminal });
}
