import { HSON_APPEARANCE, hsonIdentityMarkers, type AppearanceColorKey } from "./appearance.js";

export const HSON_SETTINGS_QUERY = "@ext:terminal-gothic.hson-language";
export type { AppearanceColorKey } from "./appearance.js";
function isAppearanceColorKey(value: string): value is AppearanceColorKey {
  return Object.hasOwn(HSON_APPEARANCE.owned.colors, value);
}
export const APPEARANCE_COLOR_KEYS: readonly AppearanceColorKey[] = Object.freeze(
  Object.keys(HSON_APPEARANCE.owned.colors).filter(isAppearanceColorKey),
);

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function marker_strength(value: number | undefined, fallback: number): number {
  const candidate = value !== undefined && Number.isFinite(value) ? value : fallback;
  return Math.max(0, Math.min(1, candidate));
}

export function marker_color_key(letter: string): AppearanceColorKey | undefined {
  return hsonIdentityMarkers.find(marker => marker.letter.toLowerCase() === letter.toLowerCase())?.colorSetting;
}

export function appearance_color(value: string | undefined): string | undefined {
  return value !== undefined && HEX_COLOR.test(value) ? value : undefined;
}
