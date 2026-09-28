import type ts from "typescript";
import { install_live_schema_view } from "./schema-editor-view.js";
import { filter_verified_schema_assignment_diagnostics, verified_schema_assignment_ranges } from "./schema-editor-proof.js";

/** Only this boundary translates positions. Neither service ever writes authored source. */
export function create_schema_language_service(typescript: typeof ts, service: ts.LanguageService, host: ts.LanguageServiceHost, projectPath: string, registerEvidence?: (file: string, text: string | undefined) => void): ts.LanguageService {
  const view = install_live_schema_view(typescript, host, projectPath, registerEvidence);
  // Syntax, formatting, refactor/code-fix edits and outline operate on authored snapshots.
  // They cannot accidentally propose writing generated imports/assertions into the editor.
  const proxy: ts.LanguageService = Object.create(service);
  // Preserve tsserver's private lifecycle methods (notably getCurrentProgram) on
  // the original service; only explicitly authored-coordinate APIs use the reader.
  for (const name of [
    "getSyntacticClassifications", "getEncodedSyntacticClassifications", "getSemanticClassifications",
    "getNameOrDottedNameSpan", "getBreakpointStatementAtPosition", "getSmartSelectionRange",
    "getNavigateToItems", "getNavigationBarItems", "getNavigationTree", "prepareCallHierarchy",
    "provideCallHierarchyIncomingCalls", "provideCallHierarchyOutgoingCalls", "provideInlayHints",
    "getOutliningSpans", "getTodoComments", "getBraceMatchingAtPosition", "getIndentationAtPosition",
    "getFormattingEditsForRange", "getFormattingEditsForDocument", "getFormattingEditsAfterKeystroke",
    "getDocCommentTemplateAtPosition", "isValidBraceCompletionAtPosition", "getJsxClosingTagAtPosition",
    "getLinkedEditingRangeAtPosition", "getSpanOfEnclosingComment", "toLineColumnOffset",
    "getCodeFixesAtPosition", "getCombinedCodeFix", "getApplicableRefactors", "getEditsForRefactor",
    "getMoveToRefactoringFileSuggestions", "organizeImports", "getEditsForFileRename", "getEmitOutput",
    "toggleLineComment", "toggleMultilineComment", "commentSelection", "uncommentSelection",
    "preparePasteEditsForFile", "getPasteEdits",
  ] as const) {
    const method = view.authoredService[name];
    if (method !== undefined) Object.defineProperty(proxy, name, { value: method.bind(view.authoredService) });
  }
  const position = (file: string, offset: number): number => { view.refresh(); return view.mapping(file)?.to_transformed(offset) ?? offset; };
  const span = (file: string, range: ts.TextSpan): ts.TextSpan | undefined => view.is_evidence(file) ? undefined : view.mapping(file)?.to_authored(range) ?? (view.mapping(file) === undefined ? range : undefined);
  const editSpan = (file: string, range: ts.TextSpan): ts.TextSpan | undefined => view.is_evidence(file) ? undefined : view.mapping(file)?.authored_edit(range) ?? (view.mapping(file) === undefined ? range : undefined);
  const document = <T extends ts.DocumentSpan>(value: T, editing = false): T | undefined => {
    const textSpan = editing ? editSpan(value.fileName, value.textSpan) : span(value.fileName, value.textSpan);
    if (textSpan === undefined) return undefined;
    return { ...value, textSpan,
      ...(value.contextSpan === undefined ? {} : { contextSpan: span(value.fileName, value.contextSpan) }),
      ...(value.originalTextSpan === undefined ? {} : { originalTextSpan: span(value.originalFileName ?? value.fileName, value.originalTextSpan) }),
      ...(value.originalContextSpan === undefined ? {} : { originalContextSpan: span(value.originalFileName ?? value.fileName, value.originalContextSpan) }),
    };
  };
  const documents = <T extends ts.DocumentSpan>(values: readonly T[] | undefined, editing = false): T[] | undefined => values?.flatMap(value => { const mapped = document(value, editing); return mapped === undefined ? [] : [mapped]; });
  const message = (file: string | undefined, value: string | ts.DiagnosticMessageChain): string | ts.DiagnosticMessageChain => typeof value === "string" ? view.display_text(file, value) : {
    ...value, messageText: view.display_text(file, value.messageText),
    ...(value.next === undefined ? {} : { next: value.next.map(item => message_chain(file, item)) }),
  };
  const message_chain = (file: string | undefined, value: ts.DiagnosticMessageChain): ts.DiagnosticMessageChain => ({
    ...value, messageText: view.display_text(file, value.messageText),
    ...(value.next === undefined ? {} : { next: value.next.map(item => message_chain(file, item)) }),
  });
  const information = <T extends ts.DiagnosticRelatedInformation>(value: T): T | undefined => {
    if (value.file === undefined) return value;
    if (view.is_evidence(value.file.fileName)) return undefined;
    const mapped = value.start === undefined ? undefined : span(value.file.fileName, { start: value.start, length: value.length ?? 0 });
    if (value.start !== undefined && mapped === undefined) return undefined;
    return { ...value, file: view.authored_file(value.file.fileName) ?? value.file, messageText: message(value.file.fileName, value.messageText),
      ...(mapped === undefined ? {} : { start: mapped.start, length: mapped.length }) };
  };
  const diagnostics = <T extends ts.Diagnostic>(values: readonly T[]): T[] => values.flatMap(value => {
    const mapped = information(value);
    return mapped === undefined ? [] : [{ ...mapped, ...(value.relatedInformation === undefined ? {} : {
      relatedInformation: value.relatedInformation.flatMap(item => { const related = information(item); return related === undefined ? [] : [related]; }),
    }) }];
  });

  proxy.getProgram = () => { view.refresh(); return service.getProgram(); };
  proxy.getSemanticDiagnostics = file => {
    view.refresh();
    const result = service.getSemanticDiagnostics(file);
    const program = service.getProgram();
    return [...diagnostics(program === undefined ? result : filter_verified_schema_assignment_diagnostics(result, verified_schema_assignment_ranges(typescript, program, file, view.evidence_file))), ...view.candidate_diagnostics(file)];
  };
  proxy.getSyntacticDiagnostics = file => { view.refresh(); return diagnostics(service.getSyntacticDiagnostics(file)); };
  proxy.getSuggestionDiagnostics = file => { view.refresh(); return diagnostics(service.getSuggestionDiagnostics(file)); };
  proxy.getCompilerOptionsDiagnostics = () => { view.refresh(); return diagnostics(service.getCompilerOptionsDiagnostics()); };
  proxy.getQuickInfoAtPosition = (file, offset, maximumLength) => {
    const result = service.getQuickInfoAtPosition(file, position(file, offset), maximumLength);
    const textSpan = result === undefined ? undefined : span(file, result.textSpan);
    return result === undefined || textSpan === undefined ? undefined : { ...result, textSpan,
      ...(result.displayParts === undefined ? {} : { displayParts: result.displayParts.map(part => ({ ...part, text: view.display_text(file, part.text) })) }),
    };
  };
  proxy.getDefinitionAtPosition = (file, offset) => documents(service.getDefinitionAtPosition(file, position(file, offset)));
  proxy.getTypeDefinitionAtPosition = (file, offset) => documents(service.getTypeDefinitionAtPosition(file, position(file, offset)));
  proxy.getImplementationAtPosition = (file, offset) => documents(service.getImplementationAtPosition(file, position(file, offset)));
  proxy.getDefinitionAndBoundSpan = (file, offset) => {
    const result = service.getDefinitionAndBoundSpan(file, position(file, offset));
    const textSpan = result === undefined ? undefined : span(file, result.textSpan);
    return result === undefined || textSpan === undefined ? undefined : { ...result, textSpan, definitions: documents(result.definitions) };
  };
  proxy.getReferencesAtPosition = (file, offset) => documents(service.getReferencesAtPosition(file, position(file, offset)));
  proxy.findReferences = (file, offset) => service.findReferences(file, position(file, offset))?.flatMap(value => {
    const definition = document(value.definition);
    return definition === undefined ? [] : [{ ...value, definition, references: documents(value.references) ?? [] }];
  });
  proxy.getFileReferences = file => { view.refresh(); return documents(service.getFileReferences(file)) ?? []; };
  proxy.getRenameInfo = (file, offset, options) => {
    const result = service.getRenameInfo(file, position(file, offset), options);
    if (!result.canRename) return result;
    const triggerSpan = editSpan(file, result.triggerSpan);
    return triggerSpan === undefined ? { canRename: false, localizedErrorMessage: "This generated Schema type has no authored rename location." } : { ...result, triggerSpan };
  };
  proxy.findRenameLocations = (file, offset, strings, comments, preferences) => {
    const mapped = position(file, offset);
    return documents(typeof preferences === "object" ? service.findRenameLocations(file, mapped, strings, comments, preferences)
      : service.findRenameLocations(file, mapped, strings, comments, preferences), true);
  };
  proxy.getDocumentHighlights = (file, offset, files) => service.getDocumentHighlights(file, position(file, offset), files)?.flatMap(value => view.is_evidence(value.fileName) ? [] : [{
    ...value, highlightSpans: value.highlightSpans.flatMap(item => {
      const textSpan = span(item.fileName ?? value.fileName, item.textSpan);
      return textSpan === undefined ? [] : [{ ...item, textSpan, ...(item.contextSpan === undefined ? {} : { contextSpan: span(item.fileName ?? value.fileName, item.contextSpan) }) }];
    }),
  }]);
  proxy.getSignatureHelpItems = (file, offset, options) => {
    const result = service.getSignatureHelpItems(file, position(file, offset), options);
    const applicableSpan = result === undefined ? undefined : span(file, result.applicableSpan);
    return result === undefined || applicableSpan === undefined ? undefined : { ...result, applicableSpan };
  };
  proxy.getCompletionsAtPosition = (file, offset, options, formatting) => {
    const result = service.getCompletionsAtPosition(file, position(file, offset), options, formatting);
    if (result === undefined) return undefined;
    return { ...result,
      ...(result.optionalReplacementSpan === undefined ? {} : { optionalReplacementSpan: editSpan(file, result.optionalReplacementSpan) }),
      entries: result.entries.flatMap(entry => {
        if (!result.isMemberCompletion && view.generated_name(file, entry.name) || entry.source?.includes("/.hson/editor-evidence/")) return [];
        const replacementSpan = entry.replacementSpan === undefined ? undefined : editSpan(file, entry.replacementSpan);
        return entry.replacementSpan !== undefined && replacementSpan === undefined ? [] : [{ ...entry, ...(replacementSpan === undefined ? {} : { replacementSpan }) }];
      }),
    };
  };
  const changes = (files: readonly ts.FileTextChanges[]): ts.FileTextChanges[] | undefined => {
    const output: ts.FileTextChanges[] = [];
    for (const file of files) {
      if (view.is_evidence(file.fileName)) return undefined;
      const textChanges: ts.TextChange[] = [];
      for (const change of file.textChanges) {
        const mapped = editSpan(file.fileName, change.span);
        if (mapped === undefined) return undefined;
        textChanges.push({ ...change, span: mapped });
      }
      output.push({ ...file, textChanges });
    }
    return output;
  };
  proxy.getCompletionEntryDetails = (file, offset, name, format, source, preferences, data) => {
    const result = service.getCompletionEntryDetails(file, position(file, offset), name, format, source, preferences, data);
    if (result === undefined) return undefined;
    return { ...result, ...(result.codeActions === undefined ? {} : { codeActions: result.codeActions.flatMap(action => {
      const mapped = changes(action.changes);
      return mapped === undefined ? [] : [{ ...action, changes: mapped }];
    }) }) };
  };
  proxy.getCompletionEntrySymbol = (file, offset, name, source) => service.getCompletionEntrySymbol(file, position(file, offset), name, source);
  proxy.getEncodedSemanticClassifications = (file, range, format) => {
    const start = position(file, range.start), end = position(file, range.start + range.length);
    const result = service.getEncodedSemanticClassifications(file, { start, length: end - start }, format);
    const spans: number[] = [];
    for (let index = 0; index < result.spans.length; index += 3) {
      const mapped = span(file, { start: result.spans[index]!, length: result.spans[index + 1]! });
      if (mapped !== undefined) spans.push(mapped.start, mapped.length, result.spans[index + 2]!);
    }
    return { ...result, spans };
  };
  proxy.dispose = () => { view.dispose(); service.dispose(); };
  return proxy;
}
