import type ts from "typescript";
import { createHash } from "node:crypto";
import { isRecord, nativeTokenTypes, nativeTokenModifiers, NATIVE_SEMANTIC_COMMAND, NATIVE_SEMANTIC_PROTOCOL,
  NATIVE_REQUEST_LIMIT, SEMANTIC_DOCUMENT_LIMIT } from "../native-semantic-tokens.js";

// Registration lifecycle only: no documents, tokens, or compiler state are cached.
const sessions = new WeakSet<ts.server.Session<unknown>>();

export function register_native_semantic_tokens(typescript: typeof ts, info: ts.server.PluginCreateInfo): void {
  const session = info.session;
  if (session === undefined || sessions.has(session)) return;
  session.addProtocolHandler(NATIVE_SEMANTIC_COMMAND, request => {
    const args: unknown = request.arguments;
    const absent = { response: {}, responseRequired: true };
    if (typescript.SemanticClassificationFormat.TwentyTwenty !== "2020") return absent;
    if (!isRecord(args) || typeof args.file !== "string" || typeof args.start !== "number" || typeof args.length !== "number"
      || !Number.isSafeInteger(args.start) || args.start < 0 || !Number.isSafeInteger(args.length) || args.length <= 0
      || args.length > NATIVE_REQUEST_LIMIT || typeof args.textHash !== "string" || typeof args.requestId !== "string") return absent;
    const file = typescript.server.toNormalizedPath(args.file);
    const projects = info.project.projectService;
    const project = projects.getDefaultProjectForFile(file, true);
    const script = projects.getScriptInfoForNormalizedPath(file);
    if (project === undefined || script === undefined) return absent;
    const version = script.getLatestVersion(), snapshot = script.getSnapshot();
    if (snapshot.getLength() > SEMANTIC_DOCUMENT_LIMIT || args.start + args.length > snapshot.getLength()) return absent;
    const text = snapshot.getText(0, snapshot.getLength());
    const textHash = createHash("sha256").update(text).digest("hex");
    if (textHash !== args.textHash) return absent;
    // Reuse the project's installed service, including its existing authored
    // coordinate mapping. No new Program, parser, classifier, or provider.
    const spans = project.getLanguageService().getEncodedSemanticClassifications(file,
      { start: args.start, length: args.length }, typescript.SemanticClassificationFormat.TwentyTwenty).spans;
    if (script.getLatestVersion() !== version || spans.length % 3 !== 0) return absent;
    const data: number[] = [];
    let previousLine = 0, previousCharacter = 0, previousEnd = -1;
    for (let index = 0; index < spans.length; index += 3) {
      const start = spans[index]!, length = spans[index + 1]!, classification = spans[index + 2]!;
      if (![start, length, classification].every(Number.isSafeInteger) || start < 0 || length <= 0
        || start < previousEnd || start + length > text.length || classification < 256 || classification > 0xffffffff) return absent;
      previousEnd = start + length;
      const begin = script.positionToLineOffset(start), end = script.positionToLineOffset(start + length);
      let emitted = false;
      for (let line = begin.line; line <= end.line; line++) {
        const lineSpan = script.lineToTextSpan(line);
        const lineLength = text.slice(lineSpan.start, lineSpan.start + lineSpan.length).replace(/[\r\n]+$/, "").length;
        const character = line === begin.line ? begin.offset - 1 : 0;
        const stop = line === end.line ? end.offset - 1 : lineLength;
        if (stop <= character) continue; // Only physical newline/empty-line portions.
        const delta = line - 1 - previousLine;
        data.push(delta, delta === 0 ? character - previousCharacter : character, stop - character,
          Math.floor(classification / 256) - 1, classification % 256);
        previousLine = line - 1; previousCharacter = character;
        emitted = true;
      }
      if (!emitted) return absent;
    }
    return { responseRequired: true, response: { protocol: NATIVE_SEMANTIC_PROTOCOL, requestId: args.requestId,
      start: args.start, length: args.length, textHash, project: project.getProjectName(), projectVersion: project.getProjectVersion(),
      legend: { tokenTypes: nativeTokenTypes, tokenModifiers: nativeTokenModifiers }, data } };
  });
  sessions.add(session);
}
