import type ts from "typescript";
import { apply_source_edits, type SchemaSourceEdit } from "./source-transformation.js";

type Copy = Readonly<{ authored: number; transformed: number; length: number }>;

/** UTF-16 copied intervals derived only from transformation edits. Generated gaps have no source. */
export class SchemaSourceMapping {
  readonly text: string;
  private readonly copies: readonly Copy[];

  constructor(readonly authored: string, readonly edits: readonly SchemaSourceEdit[]) {
    this.text = apply_source_edits(authored, edits);
    const copies: Copy[] = [];
    let source = 0, target = 0;
    for (const edit of [...edits].sort((a, b) => a.start - b.start || a.end - b.end)) {
      const length = edit.start - source;
      if (length > 0) copies.push({ authored: source, transformed: target, length });
      target += length + edit.text.length;
      source = edit.end;
    }
    copies.push({ authored: source, transformed: target, length: authored.length - source });
    this.copies = copies;
  }

  to_transformed(position: number): number {
    if (position === this.authored.length) {
      const last = [...this.copies].reverse().find(copy => copy.length > 0);
      if (last !== undefined && last.authored + last.length === position) return last.transformed + last.length;
    }
    for (const copy of this.copies) {
      if (position < copy.authored) return copy.transformed;
      if (position < copy.authored + copy.length) return copy.transformed + position - copy.authored;
    }
    return this.text.length;
  }

  /** Generated-only spans disappear; boundary-spanning diagnostics cover their copied authored text. */
  to_authored(span: ts.TextSpan): ts.TextSpan | undefined {
    const end = span.start + span.length;
    const overlapping = this.copies.filter(copy => span.length === 0
      ? span.start >= copy.transformed && span.start <= copy.transformed + copy.length
      : copy.length > 0 && span.start < copy.transformed + copy.length && end > copy.transformed);
    const first = overlapping[0], last = overlapping[overlapping.length - 1];
    if (first === undefined || last === undefined) return undefined;
    const start = first.authored + Math.max(0, span.start - first.transformed);
    const finish = last.authored + Math.min(last.length, end - last.transformed);
    return { start, length: Math.max(0, finish - start) };
  }

  /** Edits must lie wholly in one copied interval; never write generated coordinates or syntax. */
  authored_edit(span: ts.TextSpan): ts.TextSpan | undefined {
    const copy = this.copies.find(part => span.start >= part.transformed && span.start + span.length <= part.transformed + part.length);
    return copy === undefined ? undefined : { start: copy.authored + span.start - copy.transformed, length: span.length };
  }
}
