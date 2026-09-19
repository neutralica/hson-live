export type FormattingDocument = Readonly<{ isClosed: boolean }>;
export type FormattingEditor<TDocument extends FormattingDocument> = Readonly<{ document: TDocument }>;

/** Identity guard used after the awaited host formatter returns. */
export function formatting_target_is_current<TDocument extends FormattingDocument>(
  initiatingEditor: FormattingEditor<TDocument>,
  initiatingDocument: TDocument,
  activeEditor: FormattingEditor<TDocument> | undefined,
): boolean {
  return activeEditor === initiatingEditor
    && activeEditor.document === initiatingDocument
    && !initiatingDocument.isClosed;
}
