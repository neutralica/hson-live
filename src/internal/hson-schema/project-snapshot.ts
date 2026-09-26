import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

export class ObsoleteSchemaProject extends Error {}

/** Memoized compiler filesystem observations, including failed lookups and wildcard membership. */
export class SchemaProjectSnapshot {
  private readonly observations = new Map<string, { value: unknown; read: () => unknown }>();
  private readonly bytes = new Map<string, Buffer>();
  private observe<T>(key: string, read: () => T): T {
    const existing = this.observations.get(key);
    if (existing !== undefined) return existing.value as T;
    const value = read();
    this.observations.set(key, { value, read });
    return value;
  }
  readonly readFile = (path: string): string | undefined => {
    const key = `text:${resolve(path)}`;
    const existing = this.observations.get(key);
    if (existing !== undefined) return this.texts.get(resolve(path));
    const read = (): Buffer | undefined => {
      try { return readFileSync(path); }
      catch (error) { if (missing(error)) return undefined; throw error; }
    };
    const bytes = read();
    const digest = (value: Buffer | undefined): string | undefined => value === undefined ? undefined : createHash("sha256").update(value).digest("hex");
    this.observations.set(key, { value: digest(bytes), read: () => digest(read()) });
    const text = bytes === undefined ? undefined : decode_typescript_bytes(bytes);
    if (bytes !== undefined) { this.bytes.set(resolve(path), bytes); this.texts.set(resolve(path), text); }
    return text;
  };
  private readonly texts = new Map<string, string | undefined>();
  readBytes(path: string): Buffer {
    this.readFile(path);
    const bytes = this.bytes.get(resolve(path));
    if (bytes === undefined) throw new ObsoleteSchemaProject(`Input disappeared: ${path}`);
    return bytes;
  }
  readonly fileExists = (path: string): boolean => this.observe(`file:${resolve(path)}`, () => ts.sys.fileExists(path));
  readonly directoryExists = (path: string): boolean => this.observe(`directory:${resolve(path)}`, () => ts.sys.directoryExists(path));
  readonly getDirectories = (path: string): string[] => this.observe(`directories:${resolve(path)}`, () => ts.sys.getDirectories(path).sort());
  readonly realpath = (path: string): string => this.observe(`realpath:${resolve(path)}`, () => ts.sys.realpath?.(path) ?? path);
  readonly readDirectory: ts.ParseConfigHost["readDirectory"] = (path, extensions, excludes, includes, depth) => {
    const key = JSON.stringify(["glob", resolve(path), extensions, excludes, includes, depth]);
    return this.observe(key, () => ts.sys.readDirectory(path, extensions, [...excludes ?? [], "**/.hson/**"], includes, depth).sort());
  };
  readonly host: ts.ParseConfigHost = {
    useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
    readFile: this.readFile, fileExists: this.fileExists, readDirectory: this.readDirectory,
  };
  compilerHost(options: ts.CompilerOptions): ts.CompilerHost {
    const host = ts.createCompilerHost(options, true);
    Object.assign(host, { readFile: this.readFile, fileExists: this.fileExists, directoryExists: this.directoryExists,
      getDirectories: this.getDirectories, realpath: this.realpath, readDirectory: this.readDirectory });
    return host;
  }
  records(): readonly (readonly [string, unknown])[] {
    return [...this.observations].map(([key, { value }]) => [key, value] as const);
  }
  /** Replay the exact captured filesystem queries; verification never generates files. */
  static matches(records: readonly (readonly [string, unknown])[]): boolean {
    const snapshot = new SchemaProjectSnapshot();
    for (const [key, expected] of records) {
      let actual: unknown;
      if (key.startsWith("[")) {
        const [kind, path, extensions, excludes, includes, depth] = JSON.parse(key);
        if (kind !== "glob") throw new Error("Unknown Hson snapshot query.");
        actual = snapshot.readDirectory(path, extensions, excludes, includes, depth);
      } else {
        const colon = key.indexOf(":"), kind = key.slice(0, colon), path = key.slice(colon + 1);
        switch (kind) {
          case "text": snapshot.readFile(path); actual = snapshot.observations.get(key)?.value; break;
          case "file": actual = snapshot.fileExists(path); break;
          case "directory": actual = snapshot.directoryExists(path); break;
          case "directories": actual = snapshot.getDirectories(path); break;
          case "realpath": actual = snapshot.realpath(path); break;
          default: throw new Error("Unknown Hson snapshot query.");
        }
      }
      if (JSON.stringify(actual) !== JSON.stringify(expected)) return false;
    }
    return snapshot.isCurrent();
  }
  fingerprint(): string {
    return createHash("sha256").update(JSON.stringify([...this.observations].map(([key, { value }]) => [key, value])
      .sort(([a], [b]) => String(a).localeCompare(String(b))))).digest("hex");
  }
  isCurrent(): boolean {
    for (const observation of this.observations.values()) {
      try { if (JSON.stringify(observation.value) !== JSON.stringify(observation.read())) return false; }
      catch (error) { if (error instanceof ObsoleteSchemaProject || missing(error)) return false; throw error; }
    }
    return true;
  }
}
function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR");
}

/** Match stock TypeScript's UTF-8/UTF-16 BOM decoding from the same single byte read. */
function decode_typescript_bytes(bytes: Buffer): string {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const littleEndian = Buffer.from(bytes);
    littleEndian.subarray(0, littleEndian.length & ~1).swap16();
    return littleEndian.toString("utf16le", 2);
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.toString("utf16le", 2);
  return bytes.toString("utf8", bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0);
}
