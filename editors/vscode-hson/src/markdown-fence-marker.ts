import {
  hsonIdentityMarkers,
  type HsonIdentityMarkerPart,
} from "./authoring-marker.js";

type OpenFence = Readonly<{
  character: "`" | "~";
  width: number;
}>;

const FENCE_OPENING = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSING = /^( {0,3})(`+|~+)[ \t]*$/;
const CANONICAL_HSON_INFO = /^hson(?:[ \t]+[^`~]*)?$/;
const libraryMarkers = hsonIdentityMarkers.filter(marker => marker.publicName === "hson");

function opening_fence(line: string): Readonly<{
  fence: OpenFence;
  markerStart?: number;
}> | undefined {
  const match = FENCE_OPENING.exec(line);
  if (match === null) return undefined;
  const indentation = match[1] ?? "";
  const run = match[2] ?? "";
  const info = match[3] ?? "";
  const character = run[0];
  if (character !== "`" && character !== "~") return undefined;
  if (character === "`" && info.includes("`")) return undefined;
  return Object.freeze({
    fence: Object.freeze({ character, width: run.length }),
    markerStart: CANONICAL_HSON_INFO.test(info)
      ? indentation.length + run.length
      : undefined,
  });
}

function closes_fence(line: string, open: OpenFence): boolean {
  const match = FENCE_CLOSING.exec(line);
  const run = match?.[2];
  return run !== undefined
    && run[0] === open.character
    && run.length >= open.width;
}

/** Presentation-only markers for canonical lowercase Hson Markdown fences. */
export function markdown_hson_fence_marker_parts(
  text: string,
  colorLibraryMarker = true,
): readonly HsonIdentityMarkerPart[] {
  if (!colorLibraryMarker) return Object.freeze([]);
  const markers: HsonIdentityMarkerPart[] = [];
  let open: OpenFence | undefined;
  let lineStart = 0;

  while (lineStart <= text.length) {
    const newline = text.indexOf("\n", lineStart);
    const rawEnd = newline === -1 ? text.length : newline;
    const lineEnd = rawEnd > lineStart && text.charCodeAt(rawEnd - 1) === 13
      ? rawEnd - 1
      : rawEnd;
    const line = text.slice(lineStart, lineEnd);

    if (open !== undefined) {
      if (closes_fence(line, open)) open = undefined;
    } else {
      const opening = opening_fence(line);
      if (opening !== undefined) {
        open = opening.fence;
        if (opening.markerStart !== undefined) {
          const markerStart = lineStart + opening.markerStart;
          for (let index = 0; index < libraryMarkers.length; index += 1) {
            const marker = libraryMarkers[index];
            if (marker === undefined) continue;
            markers.push(Object.freeze({
              kind: "marker",
              ...marker,
              range: Object.freeze({
                start: markerStart + index,
                end: markerStart + index + 1,
              }),
            }));
          }
        }
      }
    }

    if (newline === -1) break;
    lineStart = newline + 1;
  }

  return Object.freeze(markers);
}
