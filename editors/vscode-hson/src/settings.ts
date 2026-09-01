export const HSON_SETTINGS_QUERY = "@ext:terminal-gothic.hson-language";
export type AppearanceColorKey = "blue" | "yellow" | "pink" | "green";
export const APPEARANCE_COLOR_KEYS: readonly AppearanceColorKey[] = Object.freeze(["blue", "yellow", "pink", "green"]);

const MARKER_COLOR_KEY: Readonly<Record<string, AppearanceColorKey>> = Object.freeze({
  h: "blue",
  s: "yellow",
  o: "pink",
  n: "green",
});
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function marker_strength(value: number | undefined, fallback: number): number {
  const candidate = value !== undefined && Number.isFinite(value) ? value : fallback;
  return Math.max(0, Math.min(1, candidate));
}

export function marker_color_key(letter: string): AppearanceColorKey | undefined {
  return MARKER_COLOR_KEY[letter.toLowerCase()];
}

export function appearance_color(value: string | undefined): string | undefined {
  return value !== undefined && HEX_COLOR.test(value) ? value : undefined;
}
