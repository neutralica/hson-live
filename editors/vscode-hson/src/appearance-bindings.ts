import { hsonGrammarScopes as scope } from "./appearance-internals.js";

/** Generation-only links to existing grammar and semantic contracts. No palette values. */
export const syntaxBindings = {
  "element.name": { scopes: [scope.structuralName, scope.authoredName], selector: "hsonType" },
  "attribute.name": { scopes: [scope.attributeName], selector: "hsonProperty" },
  "attribute.qualifier": { scopes: [scope.attributeQualifier], selector: "*.hsonQualifier" },
  "flag.name": { scopes: [scope.flag], selector: "hsonFlag" },
  "part.declaration": { scopes: [scope.partDeclaration], selector: "hsonDeclaration" },
  "part.directive": { scopes: [scope.directive], selector: "hsonDirective" },
  "part.receivingArgument": { scopes: [scope.receiving], selector: "hsonReceiving" },
  "part.receivingKind": { context: scope.receiving, scopes: [scope.attributeLocalName], selector: "hsonReceiving.hsonLocalName" },
  "part.sendingArgument": { scopes: [scope.sending], selector: "hsonSending" },
  "iteration.name": { scopes: [scope.iteration], selector: "hsonIteration" },
  "reference.incoming.marker": { scopes: [scope.interpolationPercent], selector: "hsonIncomingReferenceSigil" },
  "reference.local.marker": { scopes: [scope.interpolationCaret], selector: "hsonLocalReferenceSigil" },
  "reference.content": { scopes: [scope.referencePath], selector: "hsonReference" },
  "reference.member": { scopes: [scope.referenceMember], selector: "hsonReference.hsonMember" },
  "reference.separator": { scopes: [scope.referenceSeparator], selector: "hsonReference.hsonReferenceSeparator" },
  "reference.selectorOpen": { scopes: [scope.selectorBegin], selector: "hsonReference.hsonSelectorOpen" },
  "reference.selectorClose": { scopes: [scope.selectorEnd], selector: "hsonReference.hsonSelectorClose" },
  "value.string": { scopes: [scope.quotedString, scope.unquotedAttributeValue], selector: "hsonString" },
  "value.number": { scopes: [scope.number], selector: "hsonNumber" },
  "value.primitive": { scopes: [scope.boolean, scope.null], selector: "hsonKeyword" },
  "identity.quid": { scopes: [scope.quid], selector: "hsonQuid" },
  "identity.quad": { scopes: [scope.quad], selector: "hsonQuad" },
  "identity.punctuation.marker": { scopes: [scope.identitySigil], selector: "hsonIdentityMarker" },
  "identity.punctuation.colon": { scopes: [scope.identitySeparator], selector: "hsonColon" },
  "punctuation.colon": { scopes: [scope.colon], selector: "hsonColon" },
  "punctuation.assignment": { scopes: [scope.assignment], selector: "hsonOperator.hsonAssignment" },
  "punctuation.interpolation": { scopes: [scope.interpolationDollar], selector: "hsonOperator.hsonInterpolationSigil" },
  "punctuation.tagOpen": { scopes: [scope.tagBegin], selector: "hsonDelimiter.hsonTagOpen" },
  "punctuation.tagClose": { scopes: [scope.tagEnd], selector: "hsonDelimiter.hsonTagClose" },
  "punctuation.selfClosingSlash": { scopes: [scope.selfClosingSlash], selector: "hsonDelimiter.hsonSelfClosing" },
  "punctuation.arrayOpen": { scopes: [scope.arrayBegin], selector: "hsonDelimiter.hsonArrayOpen" },
  "punctuation.arrayClose": { scopes: [scope.arrayEnd], selector: "hsonDelimiter.hsonArrayClose" },
  "punctuation.sequenceSeparator": { scopes: [scope.sequenceSeparator], selector: "hsonDelimiter.hsonSequenceSeparator" },
  "punctuation.referenceOpen": { scopes: [scope.interpolationBegin], selector: "hsonInterpolationDelimiter.hsonInterpolationOpen" },
  "punctuation.referenceClose": { scopes: [scope.interpolationEnd], selector: "hsonInterpolationDelimiter.hsonInterpolationClose" },
  "punctuation.quoteOpen": { scopes: [scope.quoteBegin], selector: "hsonQuote" },
  "punctuation.quoteClose": { scopes: [scope.quoteEnd], selector: "hsonQuote" },
  "comment.line": { scopes: [scope.comment, scope.commentDelimiter], selector: "hsonComment" },
  "escape.character": { scopes: [scope.escape], selector: "hsonEscape" },
  "invalid.character": { scopes: [scope.invalid], selector: "hsonInvalid" }
} as const;
export const tokenAppearancePaths = {
  "hsonType": "element.name",
  "hsonProperty": "attribute.name",
  "hsonFlag": "flag.name",
  "hsonDirective": "part.directive",
  "hsonReceiving": "part.receivingArgument",
  "hsonSending": "part.sendingArgument",
  "hsonIteration": "iteration.name",
  "hsonLocalReferenceSigil": "reference.local.marker",
  "hsonIncomingReferenceSigil": "reference.incoming.marker",
  "hsonString": "value.string",
  "hsonNumber": "value.number",
  "hsonKeyword": "value.primitive",
  "hsonDeclaration": "part.declaration",
  "hsonQuid": "identity.quid",
  "hsonQuad": "identity.quad",
  "hsonIdentityMarker": "identity.punctuation.marker",
  "hsonComment": "comment.line",
  "hsonDelimiter": "punctuation.tagOpen",
  "hsonOperator": "punctuation.assignment",
  "hsonColon": "punctuation.colon",
  "hsonEscape": "escape.character",
  "hsonInvalid": "invalid.character",
  "hsonReference": "reference.content",
  "hsonInterpolationDelimiter": "punctuation.referenceOpen",
  "hsonQuote": "punctuation.quoteOpen"
} as const;
export const legacyRolePaths = {
  "element": "element.name",
  "attribute": "attribute.name",
  "qualifier": "attribute.qualifier",
  "flag": "flag.name",
  "directive": "part.directive",
  "receiving": "part.receivingArgument",
  "sending": "part.sendingArgument",
  "iteration": "iteration.name",
  "quad": "identity.quad",
  "incomingReference": "reference.incoming.marker",
  "localReference": "reference.local.marker",
  "referencePath": "reference.content",
  "text": "value.string",
  "number": "value.number",
  "primitive": "value.primitive",
  "comment": "comment.line",
  "structure": "punctuation.tagOpen",
  "assignment": "punctuation.assignment",
  "colon": "punctuation.colon",
  "quote": "punctuation.quoteOpen",
  "escape": "escape.character",
  "invalid": "invalid.character"
} as const;
export const generalRules = [
  { path: "syntax.general.comment", scopes: ["comment"] },
  { path: "syntax.general.string", scopes: ["string"] },
  { path: "syntax.general.number", scopes: ["constant.numeric"] },
  { path: "syntax.general.keyword", scopes: ["keyword", "storage", "constant.language"] },
  { path: "syntax.general.type", scopes: ["entity.name.type", "support.type"] },
  { path: "syntax.general.function", scopes: ["entity.name.function", "support.function"] },
  { path: "syntax.general.variable", scopes: ["variable", "entity.other.attribute-name"] },
  { path: "syntax.general.punctuation", scopes: ["punctuation"] },
  { path: "syntax.general.escape", scopes: ["constant.character.escape"] },
  { path: "syntax.general.invalid", scopes: ["invalid"] }
] as const;
export const generalSemanticPaths = {
  "type": "syntax.general.type",
  "class": "syntax.general.type",
  "interface": "syntax.general.type",
  "enum": "syntax.general.type",
  "typeParameter": "syntax.general.type",
  "namespace": "syntax.general.type",
  "variable": "syntax.general.variable",
  "parameter": "syntax.general.variable",
  "property": "syntax.general.variable",
  "function": "syntax.general.function",
  "method": "syntax.general.function",
  "enumMember": "syntax.general.number"
} as const;
export const uiColorOrder = ["editor.background", "editor.foreground", "foreground", "focusBorder", "editor.selectionBackground", "editor.lineHighlightBackground", "editorCursor.foreground", "editorLineNumber.foreground", "editorLineNumber.activeForeground", "sideBar.background", "sideBar.foreground", "sideBar.border", "activityBar.background", "activityBar.foreground", "statusBar.background", "statusBar.foreground", "titleBar.activeBackground", "titleBar.activeForeground", "editorGroupHeader.tabsBackground", "tab.activeBackground", "tab.activeForeground", "tab.inactiveBackground", "panel.background", "panel.border", "input.background", "input.foreground", "input.border", "list.activeSelectionBackground", "list.activeSelectionForeground", "editorBracketHighlight.foreground1", "editorBracketHighlight.foreground2", "editorBracketHighlight.foreground3", "editorBracketHighlight.foreground4", "editorBracketHighlight.foreground5", "editorBracketHighlight.foreground6"] as const;

/** Match documentation targets against existing grammar scopes. This does not
 * parse Hson or alter the runtime adapter. Specific leaf scopes win, just as
 * they do in theme rules; the receiving prefix retains its existing override. */
export function syntaxExamplePath(scopes: readonly string[]): string | undefined {
  if (scopes.includes(scope.receiving) && scopes.at(-1) === scope.attributeQualifier) return "part.receivingArgument";
  let selected: string | undefined;
  let deepest = -1;
  for (const [path, binding] of Object.entries(syntaxBindings)) {
    if ("context" in binding && !scopes.includes(binding.context)) continue;
    for (const target of binding.scopes) {
      const index = scopes.lastIndexOf(target);
      if (index > deepest) { selected = path; deepest = index; }
    }
  }
  return selected;
}
