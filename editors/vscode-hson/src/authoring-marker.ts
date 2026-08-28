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

export const HSON_LIBRARY_SEPARATOR_COLOR_ID = "hson.libraryMarker.separator";

export type HsonIdentityMarkerPart = Readonly<{
  kind: "marker";
  publicName: typeof hsonIdentityMarkers[number]["publicName"];
  letter: typeof hsonIdentityMarkers[number]["letter"];
  colorId: typeof hsonIdentityMarkers[number]["colorId"];
  strength: typeof hsonIdentityMarkers[number]["strength"];
  range: HostSourceRange;
}>;

export type HsonLibrarySeparatorPart = Readonly<{
  kind: "separator";
  colorId: typeof HSON_LIBRARY_SEPARATOR_COLOR_ID;
  strength: "strong";
  range: HostSourceRange;
}>;

export type HsonIdentityPresentation = Readonly<{
  markers: readonly HsonIdentityMarkerPart[];
  separators: readonly HsonLibrarySeparatorPart[];
}>;

/** Binding-aware presentation for official literal HSON-live facade references. */
export function hson_identity_presentation(
  fileName: string,
  text: string,
  colorLibraryMarker = true,
): HsonIdentityPresentation {
  const markers: HsonIdentityMarkerPart[] = [];
  const separators: HsonLibrarySeparatorPart[] = [];
  for (const reference of discover_hson_binding_references(fileName, text)) {
    if (reference.publicName === "hson" && !colorLibraryMarker) continue;
    const definitions = hsonIdentityMarkers.filter(marker => marker.publicName === reference.publicName);
    for (let index = 0; index < definitions.length; index += 1) {
      const marker = definitions[index];
      if (marker === undefined) continue;
      markers.push(Object.freeze({
        kind: "marker",
        ...marker,
        range: Object.freeze({ start: reference.range.start + index, end: reference.range.start + index + 1 }),
      }));
    }
    if (reference.publicName === "hson" && reference.memberSeparatorRange !== undefined) {
      separators.push(Object.freeze({
        kind: "separator",
        colorId: HSON_LIBRARY_SEPARATOR_COLOR_ID,
        strength: "strong",
        range: reference.memberSeparatorRange,
      }));
    }
  }
  return Object.freeze({
    markers: Object.freeze(markers.sort((left, right) => left.range.start - right.range.start)),
    separators: Object.freeze(separators.sort((left, right) => left.range.start - right.range.start)),
  });
}

/** Presentation evidence for literal usage references to official HSON-live bindings. */
export function hson_identity_marker_parts(
  fileName: string,
  text: string,
): readonly HsonIdentityMarkerPart[] {
  return hson_identity_presentation(fileName, text).markers;
}

export function hson_library_separator_parts(
  fileName: string,
  text: string,
): readonly HsonLibrarySeparatorPart[] {
  return hson_identity_presentation(fileName, text).separators;
}
