import {
  discover_hson_binding_references,
} from "../../../src/internal/embedded-hson/discover-hson-tagged-templates.js";
import type { HostSourceRange } from "../../../src/internal/embedded-hson/embedded-hson-source.js";

export const hsonIdentityMarkers = [
  { publicName: "hson", letter: "h", colorId: "hson.libraryMarker.h", strength: "strong" },
  { publicName: "hson", letter: "s", colorId: "hson.libraryMarker.s", strength: "strong" },
  { publicName: "hson", letter: "o", colorId: "hson.libraryMarker.o", strength: "strong" },
  { publicName: "hson", letter: "n", colorId: "hson.libraryMarker.n", strength: "strong" },
  { publicName: "HSON", letter: "H", colorId: "hson.authoringMarker.h", strength: "soft" },
  { publicName: "HSON", letter: "S", colorId: "hson.authoringMarker.s", strength: "soft" },
  { publicName: "HSON", letter: "O", colorId: "hson.authoringMarker.o", strength: "soft" },
  { publicName: "HSON", letter: "N", colorId: "hson.authoringMarker.n", strength: "soft" },
] as const;

export type HsonIdentityMarkerPart = Readonly<{
  publicName: typeof hsonIdentityMarkers[number]["publicName"];
  letter: typeof hsonIdentityMarkers[number]["letter"];
  colorId: typeof hsonIdentityMarkers[number]["colorId"];
  strength: typeof hsonIdentityMarkers[number]["strength"];
  range: HostSourceRange;
}>;

/** Presentation evidence for literal usage references to official HSON-live bindings. */
export function hson_identity_marker_parts(
  fileName: string,
  text: string,
): readonly HsonIdentityMarkerPart[] {
  const result: HsonIdentityMarkerPart[] = [];
  for (const reference of discover_hson_binding_references(fileName, text)) {
    const definitions = hsonIdentityMarkers.filter(marker => marker.publicName === reference.publicName);
    for (let index = 0; index < definitions.length; index += 1) {
      const marker = definitions[index];
      if (marker === undefined) continue;
      result.push(Object.freeze({
        ...marker,
        range: Object.freeze({ start: reference.range.start + index, end: reference.range.start + index + 1 }),
      }));
    }
  }
  return Object.freeze(result.sort((left, right) => left.range.start - right.range.start));
}
