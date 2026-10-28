import * as vscode from "vscode";
import type { IGrammar } from "vscode-textmate";
import { createHash, randomUUID } from "node:crypto";
import { hson_highlights } from "./highlighting.js";
import { nativeTokenTypes, nativeTokenModifiers, read_native_tokens, NATIVE_SEMANTIC_COMMAND,
  SEMANTIC_DOCUMENT_LIMIT } from "./native-semantic-tokens.js";

import { hsonTokenDefinitions, hsonTokenModifierDefinitions } from "./appearance.js";

export { nativeTokenTypes, nativeTokenModifiers } from "./native-semantic-tokens.js";
export const hsonSemanticLegend = new vscode.SemanticTokensLegend([...nativeTokenTypes, ...Object.keys(hsonTokenDefinitions)], [...nativeTokenModifiers, ...Object.keys(hsonTokenModifierDefinitions)]);

/** Public range-token and legend commands cannot identify a common provider.
 * The existing TS plugin instead returns an atomic, content-bound 2020 snapshot.
 * Unavailable/invalid snapshots yield to VS Code's native range highlighting. */
export async function document_semantic_tokens(
  document: vscode.TextDocument, cancellation: vscode.CancellationToken, grammar: Promise<IGrammar>,
): Promise<vscode.SemanticTokens | undefined> {
  const version = document.version, text = document.getText();
  const stale = () => cancellation.isCancellationRequested || document.isClosed || document.version !== version;
  // At most twenty native requests; every atomic snapshot has the same bound.
  if (stale() || text.length > SEMANTIC_DOCUMENT_LIMIT) return undefined;
  try {
    const loaded = await grammar;
    if (stale()) return undefined;
    const hson = hson_highlights(loaded, document.fileName, text);
    if (hson.length === 0) return undefined;
    await vscode.extensions.getExtension("vscode.typescript-language-features")?.activate();
    if (stale()) return undefined;
    const textHash = createHash("sha256").update(text).digest("hex"), requestId = randomUUID();
    const native = await read_native_tokens(document, text.length, textHash, requestId, request =>
      vscode.commands.executeCommand<unknown>("typescript.tsserverRequest", NATIVE_SEMANTIC_COMMAND,
        { ...request, file: document.uri }, { lowPriority: true }, cancellation), stale);
    if (native === undefined) return undefined;
    const builder = new vscode.SemanticTokensBuilder(hsonSemanticLegend);
    let hsonIndex = 0;
    for (const token of native) {
      while (hsonIndex < hson.length && hson[hsonIndex]!.range.end <= token.start) hsonIndex++;
      if (hsonIndex < hson.length && hson[hsonIndex]!.range.start < token.end) continue;
      builder.push(new vscode.Range(token.line, token.character, token.line, token.character + token.length), token.type, token.modifiers);
    }
    for (const token of hson) builder.push(new vscode.Range(document.positionAt(token.range.start), document.positionAt(token.range.end)), token.type, [...token.modifiers]);
    return stale() ? undefined : builder.build();
  } catch {
    // Missing plugin/command, cancelled server work, or malformed responses must
    // not replace native highlighting with a partial document.
    return undefined;
  }
}
