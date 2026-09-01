import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  HSON_SETTINGS_QUERY,
  APPEARANCE_COLOR_KEYS,
  appearance_color,
  marker_color_key,
  marker_strength,
} from "../src/settings.js";

const manifest = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8"));
const groups: readonly { title: string; properties: Record<string, {
  default?: unknown; minimum?: number; maximum?: number; multipleOf?: number;
  pattern?: string; scope?: string; markdownDescription?: string;
}> }[] = manifest.contributes.configuration;
const properties = Object.assign({}, ...groups.map(group => group.properties));
let checks = 0;
function check(name: string, body: () => void): void {
  body();
  process.stdout.write(`ok ${++checks} - ${name}\n`);
}

check("settings expose only supported appearance controls", () => assert.deepEqual(groups.map(group => group.title), ["Hson › Appearance"]));
check("appearance surface contains only the finalized eight controls", () => assert.deepEqual(
  Object.keys(groups[0]!.properties),
  [
    "hson.appearance.libraryMarkerStrength",
    "hson.appearance.authoringMarkerStrength",
    "hson.appearance.blue",
    "hson.appearance.yellow",
    "hson.appearance.pink",
    "hson.appearance.green",
    "hson.appearance.colorLibraryMarker",
    "hson.appearance.librarySeparatorColor",
  ],
));
check("library strength has the exact stable key", () => assert.ok(properties["hson.appearance.libraryMarkerStrength"]));
check("library strength defaults to full presence", () => assert.equal(properties["hson.appearance.libraryMarkerStrength"].default, 1));
check("authoring strength has the exact stable key", () => assert.ok(properties["hson.appearance.authoringMarkerStrength"]));
check("authoring strength defaults to seventy percent", () => assert.equal(properties["hson.appearance.authoringMarkerStrength"].default, 0.7));
check("strength range is zero through one", () => {
  for (const key of ["hson.appearance.libraryMarkerStrength", "hson.appearance.authoringMarkerStrength"]) {
    assert.equal(properties[key].minimum, 0); assert.equal(properties[key].maximum, 1);
  }
});
check("strength settings retain bounds without broken multiple-of restrictions", () => {
  assert.equal(properties["hson.appearance.libraryMarkerStrength"].multipleOf, undefined);
  assert.equal(properties["hson.appearance.authoringMarkerStrength"].multipleOf, undefined);
});
check("appearance settings are window scoped", () => assert.equal(properties["hson.appearance.libraryMarkerStrength"].scope, "window"));
check("four shared color fields have approved defaults and accept empty-or-hex overrides", () => {
  assert.deepEqual(APPEARANCE_COLOR_KEYS, ["blue", "yellow", "pink", "green"]);
  const defaults = { blue: "#00adf6", yellow: "#c9d100", pink: "#ff4a8c", green: "#39a500" } as const;
  for (const key of APPEARANCE_COLOR_KEYS) {
    const property = properties[`hson.appearance.${key}`];
    assert.equal(property.default, defaults[key]); assert.equal(property.scope, "window");
    const pattern = new RegExp(property.pattern ?? "");
    assert.ok(pattern.test("")); assert.ok(pattern.test("#00adf6")); assert.ok(!pattern.test("blue"));
  }
});
check("each explicit hue is shared by its lowercase and uppercase marker letters", () => {
  for (const [lower, upper, key] of [["h", "H", "blue"], ["s", "S", "yellow"], ["o", "O", "pink"], ["n", "N", "green"]]) {
    assert.equal(marker_color_key(lower), key); assert.equal(marker_color_key(upper), key);
  }
});
check("orange is hard-migrated to pink", () => assert.equal(properties["hson.appearance.orange"], undefined));
check("lowercase branding toggle defaults on and is window scoped", () => {
  assert.equal(properties["hson.appearance.colorLibraryMarker"].default, true);
  assert.equal(properties["hson.appearance.colorLibraryMarker"].scope, "window");
});
check("library separator has the approved violet default and accepted hex forms", () => {
  const property = properties["hson.appearance.librarySeparatorColor"];
  assert.equal(property.default, "#7247d4"); assert.equal(property.scope, "window");
  const pattern = new RegExp(property.pattern ?? "");
  for (const value of ["", "#abc", "#abcd", "#abcdef", "#abcdef12"]) assert.ok(pattern.test(value));
  assert.ok(!pattern.test("violet"));
});
check("runtime color parsing accepts hex and falls back for unset or invalid values", () => {
  assert.equal(appearance_color("#abc"), "#abc"); assert.equal(appearance_color("#69B8EECC"), "#69B8EECC");
  assert.equal(appearance_color(""), undefined); assert.equal(appearance_color("blue"), undefined);
});
check("retired trusted Schema settings are absent", () => assert.equal(Object.keys(properties).some(key => key.startsWith("hson.trustedSchemaDiagnostics.")), false));
check("no retired execution settings are advertised as restricted", () => assert.equal(manifest.capabilities.untrustedWorkspaces.restrictedConfigurations, undefined));
check("settings search targets this extension", () => assert.equal(HSON_SETTINGS_QUERY, "@ext:terminal-gothic.hson-language"));
check("marker strength clamps invalid low and high values", () => {
  assert.equal(marker_strength(-1, 0.5), 0); assert.equal(marker_strength(2, 0.5), 1);
});
check("marker strength falls back for non-finite input", () => assert.equal(marker_strength(Number.NaN, 0.6), 0.6));
check("the compact command set complements settings and status", () => assert.deepEqual(
  manifest.contributes.commands.map((command: { command: string }) => command.command),
  ["hson.openSettings", "hson.generateSchemaTypes", "hson.startSchemaWatch", "hson.stopSchemaWatch", "hson.checkSchemas", "hson.showSchemaOutput"],
));

process.stdout.write(`ok - ${checks} focused settings and consent checks passed\n`);
