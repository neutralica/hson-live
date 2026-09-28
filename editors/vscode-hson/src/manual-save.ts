/** VS Code supplies the reason before saving, but not in onDidSaveTextDocument. */
export class ManualSaveTracker {
  readonly #pending = new Map<string, boolean>();

  willSave(uri: string, manual: boolean): void { this.#pending.set(uri, manual); }
  formattingAllowed(uri: string): boolean { return this.#pending.get(uri) !== false; }
  didSave(uri: string): boolean {
    const manual = this.#pending.get(uri) === true;
    this.#pending.delete(uri);
    return manual;
  }
  forget(uri: string): void { this.#pending.delete(uri); }
}
