import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  HSON_SETTINGS_QUERY,
  APPEARANCE_COLOR_KEYS,
  TRUSTED_CONFIGURATION_KEYS,
  appearance_color,
  marker_color_key,
  marker_strength,
  trusted_consent_key,
  trusted_execution_fingerprint,
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

check("settings use three coherent native groups", () => assert.deepEqual(groups.map(group => group.title), [
  "HSON › Appearance", "HSON › Schema Diagnostics", "HSON › Runtime / Provider",
]));
check("library strength has the exact stable key", () => assert.ok(properties["hson.appearance.libraryMarkerStrength"]));
check("library strength defaults to full presence", () => assert.equal(properties["hson.appearance.libraryMarkerStrength"].default, 1));
check("authoring strength has the exact stable key", () => assert.ok(properties["hson.appearance.authoringMarkerStrength"]));
check("authoring strength defaults to sixty percent", () => assert.equal(properties["hson.appearance.authoringMarkerStrength"].default, 0.6));
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
check("four optional shared color fields are native empty-or-hex strings", () => {
  assert.deepEqual(APPEARANCE_COLOR_KEYS, ["blue", "yellow", "orange", "green"]);
  for (const key of APPEARANCE_COLOR_KEYS) {
    const property = properties[`hson.appearance.${key}`];
    assert.equal(property.default, ""); assert.equal(property.scope, "window");
    const pattern = new RegExp(property.pattern ?? "");
    assert.ok(pattern.test("")); assert.ok(pattern.test("#69B8EE")); assert.ok(!pattern.test("blue"));
  }
});
check("each explicit hue is shared by its lowercase and uppercase marker letters", () => {
  for (const [lower, upper, key] of [["h", "H", "blue"], ["s", "S", "yellow"], ["o", "O", "orange"], ["n", "N", "green"]]) {
    assert.equal(marker_color_key(lower), key); assert.equal(marker_color_key(upper), key);
  }
});
check("runtime color parsing accepts hex and falls back for unset or invalid values", () => {
  assert.equal(appearance_color("#abc"), "#abc"); assert.equal(appearance_color("#69B8EECC"), "#69B8EECC");
  assert.equal(appearance_color(""), undefined); assert.equal(appearance_color("blue"), undefined);
});
check("trusted execution remains off by default", () => assert.equal(properties["hson.trustedSchemaDiagnostics.enabled"].default, false));
check("trusted execution is resource scoped", () => assert.equal(properties["hson.trustedSchemaDiagnostics.enabled"].scope, "resource"));
check("trusted execution warning names code categories and user permissions", () => {
  const text = properties["hson.trustedSchemaDiagnostics.enabled"].markdownDescription;
  assert.match(text, /constraints/); assert.match(text, /module initialization/); assert.match(text, /user permissions/); assert.match(text, /not a security sandbox/i);
});
check("all established runtime keys remain represented once", () => assert.deepEqual(TRUSTED_CONFIGURATION_KEYS.filter(key => properties[key] !== undefined), TRUSTED_CONFIGURATION_KEYS));
check("all execution-sensitive settings are restricted", () => assert.deepEqual(
  manifest.capabilities.untrustedWorkspaces.restrictedConfigurations, TRUSTED_CONFIGURATION_KEYS,
));
check("appearance settings are not restricted", () => assert.ok(
  manifest.capabilities.untrustedWorkspaces.restrictedConfigurations.every((key: string) => !key.startsWith("hson.appearance.")),
));
check("settings search targets this extension", () => assert.equal(HSON_SETTINGS_QUERY, "@ext:terminal-gothic.hson-language"));
check("consent is namespaced per workspace folder", () => assert.notEqual(trusted_consent_key("file:///a"), trusted_consent_key("file:///b")));
check("consent binds every execution-sensitive parameter", () => {
  const base = { module: "schema.js", hsonModule: "hson.js", runtimeEntry: "entry.js", execArgv: ["--loader=x"] };
  const fingerprint = trusted_execution_fingerprint(base);
  assert.notEqual(fingerprint, trusted_execution_fingerprint({ ...base, module: "other.js" }));
  assert.notEqual(fingerprint, trusted_execution_fingerprint({ ...base, hsonModule: "other-hson.js" }));
  assert.notEqual(fingerprint, trusted_execution_fingerprint({ ...base, runtimeEntry: "other-entry.js" }));
  assert.notEqual(fingerprint, trusted_execution_fingerprint({ ...base, execArgv: ["--loader=y"] }));
});
check("marker strength clamps invalid low and high values", () => {
  assert.equal(marker_strength(-1, 0.5), 0); assert.equal(marker_strength(2, 0.5), 1);
});
check("marker strength falls back for non-finite input", () => assert.equal(marker_strength(Number.NaN, 0.6), 0.6));
check("the compact command set complements settings and status", () => assert.deepEqual(
  manifest.contributes.commands.map((command: { command: string }) => command.command),
  ["hson.openSettings", "hson.enableTrustedSchemaDiagnostics", "hson.disableTrustedSchemaDiagnostics", "hson.restartTrustedSchemaRuntime"],
));

process.stdout.write(`ok - ${checks} focused settings and consent checks passed\n`);
