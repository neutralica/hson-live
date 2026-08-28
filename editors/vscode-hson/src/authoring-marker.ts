import { discover_hson_tagged_templates } from "../../../src/internal/embedded-hson/discover-hson-tagged-templates.js";
import type { HostSourceRange } from "../../../src/internal/embedded-hson/embedded-hson-source.js";

export const hsonAuthoringMarker = [
  { letter: "H", colorId: "hson.authoringMarker.h" },
  { letter: "S", colorId: "hson.authoringMarker.s" },
  { letter: "O", colorId: "hson.authoringMarker.o" },
  { letter: "N", colorId: "hson.authoringMarker.n" },
] as const;

export type HsonAuthoringMarkerPart = Readonly<{
  letter: typeof hsonAuthoringMarker[number]["letter"];
  colorId: typeof hsonAuthoringMarker[number]["colorId"];
  range: HostSourceRange;
}>;

/** Presentation evidence for literal, binding-authorized HSON template tags. */
export function hson_authoring_marker_parts(
  fileName: string,
  text: string,
): readonly HsonAuthoringMarkerPart[] {
  const discovery = discover_hson_tagged_templates(fileName, text);
  const sources = [...discovery.sources, ...discovery.interpolated];
  const result: HsonAuthoringMarkerPart[] = [];
  for (const source of sources) {
    if (text.slice(source.tagRange.start, source.tagRange.end) !== "HSON") continue;
    for (let index = 0; index < hsonAuthoringMarker.length; index += 1) {
      const marker = hsonAuthoringMarker[index];
      if (marker === undefined) continue;
      result.push(Object.freeze({
        ...marker,
        range: Object.freeze({
          start: source.tagRange.start + index,
          end: source.tagRange.start + index + 1,
        }),
      }));
    }
  }
  return Object.freeze(result);
}
