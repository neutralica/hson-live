export const HSON_SETTINGS_QUERY = "@ext:terminal-gothic.hson-language";
export const TRUSTED_CONFIGURATION_SECTION = "hson.trustedSchemaDiagnostics";
export const TRUSTED_CONFIGURATION_KEYS = Object.freeze([
  "hson.trustedSchemaDiagnostics.enabled",
  "hson.trustedSchemaDiagnostics.module",
  "hson.trustedSchemaDiagnostics.hsonModule",
  "hson.trustedSchemaDiagnostics.runtimeEntry",
  "hson.trustedSchemaDiagnostics.execArgv",
]);
export type AppearanceColorKey = "blue" | "yellow" | "orange" | "green";
export const APPEARANCE_COLOR_KEYS: readonly AppearanceColorKey[] = Object.freeze(["blue", "yellow", "orange", "green"]);

const MARKER_COLOR_KEY: Readonly<Record<string, AppearanceColorKey>> = Object.freeze({
  h: "blue",
  s: "yellow",
  o: "orange",
  n: "green",
});
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export type TrustedExecutionConfiguration = Readonly<{
  module: string;
  hsonModule: string;
  runtimeEntry: string;
  execArgv: readonly string[];
}>;

export function trusted_execution_fingerprint(configuration: TrustedExecutionConfiguration): string {
  return JSON.stringify([
    configuration.module,
    configuration.hsonModule,
    configuration.runtimeEntry,
    [...configuration.execArgv],
  ]);
}

export function trusted_consent_key(workspaceFolderUri: string): string {
  return `hson.trustedSchemaDiagnostics.consent:${workspaceFolderUri}`;
}

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
