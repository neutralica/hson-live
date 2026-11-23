import { hson_lexical_cursor, observe_authored_event } from "../api/transform/parsers/tokenize-hson.js";
import { AUTHORED_EVENT_TAG } from "../core/authored-event-names.js";
import { _throw_transform_err, is_transform_error, type TransformError, type TransformErrorSource } from "../core/errors.js";
import type { HsonSourceRange } from "./hson-source-provenance/hson-source-provenance.js";

const DOMAINS = [AUTHORED_EVENT_TAG, "hson:schema"] as const;
export type HsonDeclarativeDomain = typeof DOMAINS[number];

type SourceHead = Readonly<{
  source: string;
  position: TransformErrorSource;
  /** Offset of the leading `<`, in UTF-16 code units. */
  openingOffset?: number;
  /** Half-open UTF-16 range of the authored name. */
  nameRange?: HsonSourceRange;
  name?: string;
}>;

type NamedHead = SourceHead & Readonly<{ openingOffset: number; nameRange: HsonSourceRange; name: string }>;
type RecognizedDeclaration = NamedHead & Readonly<{ kind: "recognized"; domain: HsonDeclarativeDomain }>;

export type HsonDeclarativeRecognition =
  | RecognizedDeclaration
  | (NamedHead & Readonly<{ kind: "incomplete" }>)
  | (NamedHead & Readonly<{ kind: "unsupported" }>)
  | (SourceHead & Readonly<{ kind: "ordinary" }>)
  | (SourceHead & Readonly<{ kind: "malformed"; message: string; error?: TransformError }>);

/** Read only the leading head. Framing and body validation belong to each domain. */
export function recognize_hson_declaration(source: string): HsonDeclarativeRecognition {
  const cursor = hson_lexical_cursor(source);
  const position = (): TransformErrorSource => {
    const { index, line, col } = cursor.position();
    return { index, line, column: col };
  };
  let head: SourceHead = { source, position: position() };
  try {
    cursor.skipTrivia();
    const openingOffset = cursor.offset();
    if (cursor.peek() !== "<") return { source, position: position(), kind: "ordinary" };

    head = { source, openingOffset, position: position() };
    cursor.consume("<");
    cursor.skipTrivia();
    head = { source, openingOffset, position: position() };
    const start = cursor.offset();
    const first = cursor.peek();
    if (first === ">" || first === "@") return { ...head, kind: "ordinary" };
    const name = first === "" ? "" : first === "'" ? cursor.quotedName() : cursor.bareName();
    const end = cursor.offset();
    const named = { ...head, openingOffset, name, nameRange: { start, end } };
    if (first === "'") return { ...named, kind: "ordinary" };

    const domain = DOMAINS.find(candidate => candidate === name);
    // At EOF, a proper prefix of a known name can still become a declaration.
    if (domain === undefined && cursor.peek() === "" && DOMAINS.some(candidate => candidate.startsWith(name))) {
      return { ...named, kind: "incomplete" };
    }
    if (!name.startsWith("hson:")) return { ...named, kind: "ordinary" };
    if (name === "hson:") {
      return { ...named, kind: "malformed", message: "Expected a domain name after hson:." };
    }
    if (!cursor.triviaAhead() && !["", "<", ">"].includes(cursor.peek()) && !source.startsWith("/>", end)) {
      // Preserve the scanner's diagnostic for invalid trivia immediately after the name.
      head = named;
      cursor.skipTrivia();
      return { ...named, kind: "malformed", position: position(), message: "Expected a boundary after the Declarative root name." };
    }
    return domain === undefined ? { ...named, kind: "unsupported" } : { ...named, kind: "recognized", domain };
  } catch (error) {
    if (!is_transform_error(error)) throw error;
    return { ...head, kind: "malformed", position: error.source ?? position(), message: error.message, error };
  }
}

/** Completion and highlighting share declaration recognition with strict admission. */
export function authored_event_completion_checkpoint(source: string, cursor?: number) {
  if (source.length > 128_000 || cursor !== undefined && (!Number.isInteger(cursor) || cursor < 0 || cursor > source.length)) return undefined;
  const head = recognize_hson_declaration(source);
  if (head.kind === "recognized" && head.domain === AUTHORED_EVENT_TAG
    || head.kind === "ordinary" && head.openingOffset === undefined && head.position.index === source.length) {
    return observe_authored_event(source, cursor);
  }
  if (head.kind === "incomplete" && AUTHORED_EVENT_TAG.startsWith(head.name)) {
    return observe_authored_event(source, cursor, head);
  }
  return undefined;
}

type DeclarationAdapter<Result> = (source: string, recognition: RecognizedDeclaration) => Result;
type DeclarationAdapters<Results> = {
  readonly [Domain in keyof Results]: DeclarationAdapter<Results[Domain]>;
};

/** Send the original source to the exact domain's caller-supplied adapter. */
export function dispatch_hson_declaration<
  Domain extends HsonDeclarativeDomain,
  Results extends Record<Domain, unknown>,
>(
  recognition: HsonDeclarativeRecognition,
  adapters: DeclarationAdapters<Results>,
  expectedDomain: Domain,
): Results[Domain];
export function dispatch_hson_declaration<Results extends Record<HsonDeclarativeDomain, unknown>>(
  recognition: HsonDeclarativeRecognition,
  adapters: DeclarationAdapters<Results>,
  expectedDomain?: undefined,
): Results[HsonDeclarativeDomain];
export function dispatch_hson_declaration(
  recognition: HsonDeclarativeRecognition,
  adapters: DeclarationAdapters<Partial<Record<HsonDeclarativeDomain, unknown>>>,
  expectedDomain?: HsonDeclarativeDomain,
): unknown {
  const { position } = recognition;
  const fail = (code: string, message: string): never => _throw_transform_err(
    message, "HsonDeclarative", undefined, undefined, { code, stage: "source-admission", source: position },
  );
  switch (recognition.kind) {
    case "ordinary":
      return fail("HSON_DECLARATIVE_ROOT_REQUIRED", `Expected a literal <${expectedDomain ?? "hson:…"} declaration.`);
    case "incomplete":
      return fail("HSON_DECLARATIVE_NAME_INCOMPLETE", `Finish the ${expectedDomain ?? "hson:…"} declaration name.`);
    case "malformed":
      if (recognition.error !== undefined) throw recognition.error;
      return fail("HSON_DECLARATIVE_HEAD_MALFORMED", recognition.message);
    case "unsupported":
      return fail("HSON_DECLARATIVE_DOMAIN_UNSUPPORTED",
        `Declarative domain ${JSON.stringify(recognition.name)} is unsupported. Recognized domains are ${DOMAINS.join(" and ")}.`);
    case "recognized": {
      const { domain, source } = recognition;
      if (expectedDomain !== undefined && domain !== expectedDomain) {
        return fail("HSON_DECLARATIVE_DOMAIN_MISMATCH", `Expected a <${expectedDomain} declaration, found <${domain}.`);
      }
      const adapter = adapters[domain];
      if (adapter === undefined) return fail("HSON_DECLARATIVE_ADAPTER_UNAVAILABLE", `No adapter is available for <${domain} here.`);
      return adapter(source, recognition);
    }
  }
}
