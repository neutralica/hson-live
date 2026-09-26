import type { CompilerOptions } from "typescript";
export const checking: CompilerOptions = { strict: true };
export const untouched = "leave me alone" as const;
// Authored strings containing legacy markers are ordinary application data.
export const startMarker = "// @hson-schema generated type exports";
export const endMarker = "// @hson-schema end generated type exports";
