import type { WorkspaceConfiguration } from "vscode";
import { HSON_BRANDING, type AppearanceColorKey } from "./appearance-branding.generated.js";

export const HSON_SETTINGS_QUERY = "@ext:terminal-gothic.hson-language";
export type { AppearanceColorKey } from "./appearance-branding.generated.js";
function isAppearanceColorKey(value: string): value is AppearanceColorKey {
  return Object.hasOwn(HSON_BRANDING.colors, value);
}
export const APPEARANCE_COLOR_KEYS: readonly AppearanceColorKey[] = Object.freeze(
  Object.keys(HSON_BRANDING.colors).filter(isAppearanceColorKey),
);

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function marker_strength(value: number | undefined, fallback: number): number {
  const candidate = value !== undefined && Number.isFinite(value) ? value : fallback;
  return Math.max(0, Math.min(1, candidate));
}

export function marker_color<Color>(
  appearance: Pick<WorkspaceConfiguration, "inspect" | "get">,
  marker: Readonly<{ colorSetting: string }>,
  themeColor: Color,
): string | Color {
  const inspected = appearance.inspect<string>(marker.colorSetting);
  const explicitlyConfigured = inspected !== undefined && (inspected.globalValue !== undefined
    || inspected.workspaceValue !== undefined
    || inspected.workspaceFolderValue !== undefined
    || inspected.globalLanguageValue !== undefined
    || inspected.workspaceLanguageValue !== undefined
    || inspected.workspaceFolderLanguageValue !== undefined);
  const override = explicitlyConfigured ? appearance_color(appearance.get<string>(marker.colorSetting)) : undefined;
  return override ?? themeColor;
}

export function appearance_color(value: string | undefined): string | undefined {
  return value !== undefined && HEX_COLOR.test(value) ? value : undefined;
}
