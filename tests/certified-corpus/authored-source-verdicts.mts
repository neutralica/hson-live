/**
 * Historical-only worksheet template machinery.
 *
 * This file records the corpus and backtick-delimited syntax used to create the
 * immutable completed worksheet. It is not an active grammar or current-spec
 * generator. Current derived artifacts are produced through the explicit
 * quoted-name amendment in authored-name-delimiter-amendment.mts.
 */
import { corpusFamilyDefinitions, materializedCorpusCases } from "./corpus-manifest.mts";
import type { MaterializedCorpusCase } from "./corpus-types.mts";

export const AUTHORED_VERDICT_DOCUMENT =
  "docs/contracts/authored-hson-review/01-authored-source-verdicts.md";

export const PROVENANCE_EVIDENCE =
  "docs/contracts/authored-hson-review/evidence/authored-hson-corpus-provenance-audit.txt";
export const SHAPE_EVIDENCE =
  "docs/contracts/authored-hson-review/evidence/authored-hson-shape-coverage-preview.txt";

export const EXPECTED_PROVENANCE_SHA256 =
  "41b2d0ba4f539eae8d12fb4ccafaafba2aa6cf69427ceba3b9ca4b2163111b09";
export const EXPECTED_SHAPE_SHA256 =
  "40f1ee261325ead71ed170765e443a1fd182d76efec4f11bce9eb94f214d4180";

type AuthoredCase = Exclude<MaterializedCorpusCase, { disposition: "reference" }> & { source: string };

type ReviewSection = Readonly<{
  number: number;
  title: string;
  introduction?: string;
}>;

type ReviewGroup = Readonly<{
  id: string;
  section: number;
  title: string;
  rule: string;
  entries: readonly AuthoredCase[];
}>;

export const REVIEW_SECTIONS: readonly ReviewSection[] = Object.freeze([
  { number: 1, title: "Primitive values" },
  { number: 2, title: "Basic HSON objects" },
  { number: 3, title: "Basic HSON arrays" },
  { number: 4, title: "Basic HSON elements" },
  { number: 5, title: "Legal compositions" },
  {
    number: 6,
    title: "Contextual object keys and element flags",
    introduction: [
      "```hson",
      "<t true f false n null>",
      "<x true false null/>",
      "<true 1 false 2 null 3>",
      "```",
      "",
      "The same primitive-looking spelling has a different role in an object value,",
      "an object property key, and an element flag position.",
    ].join("\n"),
  },
  { number: 7, title: "Accepted number spellings" },
  { number: 8, title: "Rejected number spellings" },
  { number: 9, title: "Accepted source trivia and comments" },
  { number: 10, title: "Rejected trivia and unsupported whitespace" },
  { number: 11, title: "Accepted quoted-string escapes" },
  { number: 12, title: "Malformed quoted-string escapes" },
  { number: 13, title: "Raw controls in quoted strings" },
  { number: 14, title: "Accepted backtick names" },
  { number: 15, title: "Malformed backtick names" },
  { number: 16, title: "Raw controls in backtick names" },
  { number: 17, title: "Invalid HSON object grammar" },
  { number: 18, title: "Invalid HSON array grammar" },
  { number: 19, title: "Invalid HSON element grammar" },
  {
    number: 20,
    title: "Root and structural-mode failures",
    introduction: [
      "```hson",
      "<a 1>     // current proposal: valid HSON object",
      "<a 1/>    // current proposal: invalid HSON element typed content",
      "",
      "<a/><b/>  // current proposal: valid element fragment",
      "<a/><b 2> // current proposal: invalid mixed modes",
      "```",
      "",
      "These contrasts make the consequences of `>` versus `/>` and homogeneous",
      "versus mixed root modes visible. The exact descriptors also appear below.",
    ].join("\n"),
  },
  { number: 21, title: "Legacy and historical cases" },
]);

const authoredCases: readonly AuthoredCase[] = Object.freeze(materializedCorpusCases.flatMap((entry) =>
  entry.ingress === "hson" && entry.disposition !== "reference" && entry.source !== undefined
    ? [entry as AuthoredCase]
    : []));

const byId = new Map(authoredCases.map((entry) => [entry.id, entry]));
const familyById = new Map(corpusFamilyDefinitions.map((family) => [family.id, family]));

function familyEntries(familyId: string, include: (id: string) => boolean = () => true): readonly AuthoredCase[] {
  const family = familyById.get(familyId);
  if (family === undefined) throw new Error(`Unknown family ${familyId}`);
  return family.cases
    .filter((entry) => include(entry.id))
    .map((entry) => byId.get(entry.id) as AuthoredCase);
}

const isUnicodeEscape = (id: string): boolean =>
  id.includes(".unicode-") || id.endsWith(".consecutive-unicode");

const CALIBRATED_STANDALONE_IDS = Object.freeze([
  "hson.reject.family.backtick-name.unicode-interrupted-backtick",
  "hson.reject.family.backtick-name.trailing-backslash",
]);

export const REVIEW_FAMILY_GROUPS: readonly ReviewGroup[] = Object.freeze([
  {
    id: "quoted-string-ordinary-dispatch",
    section: 11,
    title: "Accepted ordinary quoted-string escape dispatch",
    rule: "Each displayed JSON escape is accepted in a quoted HSON string.",
    entries: familyEntries("family.accept.quoted-string-json-escapes", (id) => !isUnicodeEscape(id)),
  },
  {
    id: "quoted-string-unicode-boundaries",
    section: 11,
    title: "Accepted quoted-string Unicode boundaries",
    rule: "Each complete four-hex-digit Unicode escape sequence is accepted in a quoted HSON string.",
    entries: familyEntries("family.accept.quoted-string-json-escapes", isUnicodeEscape),
  },
  {
    id: "quoted-string-malformed-escapes",
    section: 12,
    title: "Malformed quoted-string escapes",
    rule: "Each displayed malformed, incomplete, or unsupported quoted-string escape is invalid.",
    entries: familyEntries("family.reject.quoted-string-malformed-escapes"),
  },
  {
    id: "quoted-string-raw-c0",
    section: 13,
    title: "Raw C0 controls in quoted strings",
    rule: "A raw U+0000 through U+001F code unit is invalid inside a quoted string.",
    entries: familyEntries("family.reject.quoted-string-raw-c0"),
  },
  {
    id: "backtick-name-ordinary-dispatch",
    section: 14,
    title: "Accepted ordinary backtick-name escape dispatch",
    rule: "Each displayed ordinary escape is accepted in a backtick object-property name.",
    entries: familyEntries("family.accept.backtick-name-escapes", (id) => !isUnicodeEscape(id)),
  },
  {
    id: "backtick-name-unicode-boundaries",
    section: 14,
    title: "Accepted backtick-name Unicode boundaries",
    rule: "Each complete four-hex-digit Unicode escape sequence is accepted in a backtick object-property name.",
    entries: familyEntries("family.accept.backtick-name-escapes", isUnicodeEscape),
  },
  {
    id: "backtick-name-malformed-escapes",
    section: 15,
    title: "Malformed backtick-name escapes",
    rule: "Each displayed malformed, incomplete, or unsupported backtick-name escape is invalid.",
    entries: familyEntries(
      "family.reject.backtick-name-malformed-escapes",
      (id) => !CALIBRATED_STANDALONE_IDS.includes(id),
    ),
  },
  {
    id: "backtick-name-raw-c0",
    section: 16,
    title: "Raw C0 controls in backtick names",
    rule: "A raw U+0000 through U+001F code unit is invalid inside a backtick name.",
    entries: familyEntries("family.reject.backtick-name-raw-c0"),
  },
  {
    id: "unsupported-whitespace",
    section: 10,
    title: "Unsupported external whitespace",
    rule: "Code points outside SPACE, HT, LF, and CR are not authored-HSON trivia.",
    entries: familyEntries("family.reject.unsupported-whitespace"),
  },
]);

const inheritedFamilyIds = new Set(REVIEW_FAMILY_GROUPS.flatMap((group) => group.entries.map((entry) => entry.id)));

const acceptedNumberIds = new Set([
  "hson.accept.literal.primitive.zero",
  "hson.accept.literal.primitive.negative-zero",
  "hson.accept.literal.primitive.positive-integer",
  "hson.accept.literal.primitive.negative-fraction",
  "hson.accept.literal.primitive.exponent",
]);

const compositionIds = new Set([
  "hson.accept.literal.object.nested",
  "hson.accept.literal.object.array-value",
  "hson.accept.literal.array.nested",
  "hson.accept.literal.array.object-item",
  "hson.accept.literal.element.nested",
  "hson.accept.literal.element.mixed-content",
  "hson.accept.basis.root.element-fragment",
]);

const contextualIds = new Set([
  "hson.accept.literal.object.typed-keywords",
  "hson.accept.literal.element.keyword-flags",
  "hson.accept.basis.object.primitive-looking-keys",
]);

const legacyIds = new Set([
  "hson.reject.literal.object.legacy-adjacent",
  "hson.reject.literal.object.legacy-doubled",
  "hson.reject.literal.authored-metadata",
  "hson.reject.literal.reserved-name",
]);

function sectionNumber(entry: AuthoredCase): number {
  if (inheritedFamilyIds.has(entry.id)) {
    return REVIEW_FAMILY_GROUPS.find((group) => group.entries.some((candidate) => candidate.id === entry.id))!.section;
  }
  if (acceptedNumberIds.has(entry.id) || entry.id.startsWith("hson.accept.basis.number.")) return 7;
  if (entry.id.startsWith("hson.reject.basis.number.")) return 8;
  if (compositionIds.has(entry.id)) return 5;
  if (contextualIds.has(entry.id)) return 6;
  if (legacyIds.has(entry.id)) return 21;
  if (CALIBRATED_STANDALONE_IDS.includes(entry.id)) return 15;
  if (entry.id === "hson.accept.basis.backtick-name.element-name"
      || entry.id === "hson.accept.literal.object.colon-dot-names"
      || entry.id === "hson.accept.literal.object.empty-decoded-key") return 14;
  if (entry.id.startsWith("hson.reject.basis.backtick-name.")) return 15;
  if (entry.disposition === "accept" && entry.tags.includes("trivia")) return 9;
  if (entry.disposition === "reject" && (entry.tags.includes("trivia") || entry.tags.includes("comment"))) return 10;
  if (entry.disposition === "reject" && entry.tags.includes("structural-mode")) return 20;
  if (entry.disposition === "reject" && (entry.taxonomy.shape === "source" || entry.taxonomy.shape === "mixed-root")) return 20;
  if (entry.disposition === "accept") {
    if (entry.taxonomy.shape === "scalar") return 1;
    if (entry.taxonomy.shape.includes("object") || entry.taxonomy.shape === "object") return 2;
    if (entry.taxonomy.shape.includes("array") || entry.taxonomy.shape === "array") return 3;
    if (entry.taxonomy.shape.includes("element") || entry.taxonomy.shape === "element") return 4;
  } else {
    if (entry.taxonomy.shape === "object") return 17;
    if (entry.taxonomy.shape.includes("array") || entry.taxonomy.shape === "array") return 18;
    if (entry.taxonomy.shape.includes("element") || entry.taxonomy.shape === "element") return 19;
  }
  throw new Error(`No human-review section for ${entry.id}`);
}

const productionRetainedOutputIds = new Set([
  "hson.accept.literal.object.one-property",
  "hson.accept.literal.object.multiple-properties",
  "hson.accept.literal.object.nested",
  "hson.accept.literal.object.array-value",
  "hson.accept.literal.object.typed-keywords",
  "hson.accept.literal.object.colon-dot-names",
  "hson.accept.literal.object.empty-decoded-key",
  "hson.accept.literal.object.comments",
  "hson.accept.literal.array.primitives",
  "hson.accept.literal.array.trailing-comma-bracket",
  "hson.accept.literal.array.nested",
  "hson.accept.literal.array.object-item",
  "hson.accept.literal.array.negative-zero",
  "hson.accept.literal.element.nested",
  "hson.accept.literal.element.keyword-flags",
  "hson.accept.literal.element.adjacent-strings",
  "hson.accept.literal.element.three-empty-strings",
  "hson.accept.literal.element.quid",
  "hson.accept.literal.element.mixed-content",
]);

const independentlyStructuredRejectedIds = new Set([
  "hson.reject.literal.source.empty",
  "hson.reject.literal.root.multiple-values",
  "hson.reject.literal.root.mixed-modes",
  "hson.reject.literal.object.duplicate",
  "hson.reject.literal.element.duplicate-attribute",
  "hson.reject.literal.object.legacy-doubled",
]);

function isImplementationDerived(entry: AuthoredCase): boolean {
  if (entry.id.startsWith("hson.reject.family.")) return true;
  if (entry.id.startsWith("hson.reject.literal.")) return !independentlyStructuredRejectedIds.has(entry.id);
  return productionRetainedOutputIds.has(entry.id);
}

function attention(entry: AuthoredCase): string[] {
  const notes: string[] = [];
  if (isImplementationDerived(entry)) notes.push("Implementation-derived classification or expectation provenance.");
  if (entry.tags.includes("implementation-derived-output")) {
    notes.push("Implementation-influenced expected output; this pass reviews source validity only, not attribute output order.");
  }
  if (CALIBRATED_STANDALONE_IDS.includes(entry.id)) {
    notes.push("Calibrated diagnostic; review only the rejection verdict here. Exact diagnostic ownership is deferred.");
  }
  if (entry.id.includes("high-surrogate")) notes.push("Contains an isolated high-surrogate escape.");
  if (entry.id.includes("low-surrogate")) notes.push("Contains an isolated low-surrogate escape.");
  if (entry.id.includes("u2028")) notes.push("Exercises U+2028 LINE SEPARATOR.");
  if (entry.id.includes("u2029")) notes.push("Exercises U+2029 PARAGRAPH SEPARATOR.");
  if (entry.tags.includes("empty-name")) notes.push("Empty decoded name; validity depends on the name's grammatical role.");
  if (entry.tags.includes("structural-mode")) notes.push("Structural-mode crossing or `>` versus `/>` boundary.");
  if (entry.tags.includes("primitive-keyword")) notes.push("Primitive-looking name or flag versus typed primitive value.");
  if (entry.tags.includes("negative-zero")) notes.push("Negative zero must remain distinct from positive zero.");
  if (entry.tags.includes("duplicate")) notes.push("Duplicate declaration behavior.");
  if (entry.tags.includes("metadata") || entry.tags.includes("reserved-name")) notes.push("Metadata or reserved-name behavior.");
  if (entry.tags.includes("legacy")) notes.push("Historical or legacy-syntax regression.");
  if (entry.tags.includes("trivia") && entry.tags.includes("comment") && entry.source.length > 20) {
    notes.push("Complex trivia composition.");
  }
  if (entry.id === "hson.accept.literal.object.one-property" || entry.id === "hson.reject.literal.element.numeric-content") {
    notes.push("Direct `>` versus `/>` contrast.");
  }
  return notes;
}

function plainClaim(entry: AuthoredCase): string {
  if (entry.id.startsWith("hson.accept.family.quoted-string.")) {
    return "This displayed escape spelling is accepted inside a quoted HSON string.";
  }
  if (entry.id.startsWith("hson.accept.family.backtick-name.")) {
    return "This displayed escape spelling is accepted inside a backtick object-property name.";
  }
  if (entry.id.startsWith("hson.reject.family.quoted-string.raw-")) {
    return "This raw C0 code unit is invalid inside a quoted HSON string.";
  }
  if (entry.id.startsWith("hson.reject.family.backtick-name.raw-")) {
    return "This raw C0 code unit is invalid inside a backtick name.";
  }
  if (entry.id.startsWith("hson.reject.family.quoted-string.")) {
    return "This displayed malformed or unsupported quoted-string escape is invalid.";
  }
  if (entry.id.startsWith("hson.reject.family.backtick-name.")) {
    return "This displayed malformed or unsupported backtick-name escape is invalid.";
  }
  if (entry.id.startsWith("hson.reject.family.unsupported-whitespace.")) {
    return "This code point is not valid authored-HSON trivia.";
  }
  return entry.claim
    .replace(" with related evidence", "")
    .replace(" rejects deterministically", " is invalid");
}

function markdownInlineCode(value: string): string {
  const longest = Math.max(0, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length));
  const fence = "`".repeat(longest + 1);
  const padding = value.startsWith("`") || value.endsWith("`") ? " " : "";
  return `${fence}${padding}${value.replaceAll("|", "\\|")}${padding}${fence}`;
}

const specialNames = new Map<number, string>([
  [0x0000, "NUL"], [0x0008, "BACKSPACE"], [0x0009, "HT"], [0x000a, "LF"],
  [0x000b, "VERTICAL TAB"], [0x000c, "FORM FEED"], [0x000d, "CR"],
  [0x00a0, "NO-BREAK SPACE"], [0x1680, "OGHAM SPACE MARK"],
  [0x2028, "LINE SEPARATOR"], [0x2029, "PARAGRAPH SEPARATOR"],
  [0x202f, "NARROW NO-BREAK SPACE"], [0x205f, "MEDIUM MATHEMATICAL SPACE"],
  [0x3000, "IDEOGRAPHIC SPACE"], [0xfeff, "BYTE ORDER MARK"],
]);

function isSpecialCodeUnit(unit: number): boolean {
  return unit < 0x20 || (unit >= 0xd800 && unit <= 0xdfff) || specialNames.has(unit)
    || (unit >= 0x2000 && unit <= 0x200a);
}

function escapedSource(source: string): string {
  let result = "\"";
  for (let index = 0; index < source.length; index += 1) {
    const unit = source.charCodeAt(index);
    if (unit === 0x22) result += "\\\"";
    else if (unit === 0x5c) result += "\\\\";
    else if (isSpecialCodeUnit(unit)) result += `\\u${unit.toString(16).padStart(4, "0").toUpperCase()}`;
    else result += source[index];
  }
  return result + "\"";
}

function specialCodeUnitDescription(source: string): string {
  const parts: string[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const unit = source.charCodeAt(index);
    if (!isSpecialCodeUnit(unit)) continue;
    const hex = unit.toString(16).padStart(4, "0").toUpperCase();
    let name = specialNames.get(unit);
    if (name === undefined && unit >= 0xd800 && unit <= 0xdbff) {
      const paired = index + 1 < source.length && source.charCodeAt(index + 1) >= 0xdc00
        && source.charCodeAt(index + 1) <= 0xdfff;
      name = paired ? "paired high-surrogate code unit" : "isolated high-surrogate code unit";
    } else if (name === undefined && unit >= 0xdc00 && unit <= 0xdfff) {
      const paired = index > 0 && source.charCodeAt(index - 1) >= 0xd800
        && source.charCodeAt(index - 1) <= 0xdbff;
      name = paired ? "paired low-surrogate code unit" : "isolated low-surrogate code unit";
    }
    else if (name === undefined && unit < 0x20) name = "raw C0 control";
    else if (name === undefined) name = "Unicode whitespace";
    parts.push(`index ${index}: ${name} U+${hex}`);
  }
  return `${parts.join("; ")}; all other code units are printable as shown`;
}

function proposal(entry: AuthoredCase): "Valid" | "Invalid" {
  return entry.disposition === "accept" ? "Valid" : "Invalid";
}

function visibleAttention(entry: AuthoredCase): readonly string[] {
  return attention(entry).filter((note) =>
    note !== "Implementation-derived classification or expectation provenance.");
}

function sourceBlock(entry: AuthoredCase): string {
  if (!isSpecialSource(entry.source)) return `**Source:** ${markdownInlineCode(entry.source)}`;
  return [
    "**Source:**",
    "",
    "```text",
    escapedSource(entry.source),
    "```",
    "",
    `**Special code units:** ${specialCodeUnitDescription(entry.source)}`,
  ].join("\n");
}

function isSpecialSource(source: string): boolean {
  for (let index = 0; index < source.length; index += 1) {
    const unit = source.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff && index + 1 < source.length) {
      const next = source.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        index += 1;
        continue;
      }
    }
    if (isSpecialCodeUnit(unit)) return true;
  }
  return false;
}

function reviewBlock(entry: AuthoredCase, kind: "verdict" | "override", familyId?: string): string {
  const allAttention = attention(entry);
  const visible = visibleAttention(entry);
  const meta = [
    `source=${isSpecialSource(entry.source) ? "display" : "inline"}`,
    `review=${kind === "verdict" ? "standalone" : `family:${familyId}`}`,
    `attention=${allAttention.length === 0 ? "none" : allAttention.join(" ")}`,
  ].join("; ");
  const lines = [
    `<!-- review-meta: ${meta} -->`,
    `<!-- authored-case:${entry.id} -->`,
    "",
    kind === "verdict" ? "**Verdict — V / I / ?:** ` `" : "**Override — V / I / ?:** ` `",
    "",
    plainClaim(entry),
    "",
    sourceBlock(entry),
  ];
  if (visible.length > 0) lines.push("", `**Review attention:** ${visible.join(" ")}`);
  lines.push("", `**Current proposal:** ${proposal(entry)}`, "", "**Notes:**");
  return lines.join("\n");
}

function primaryBlocks(entries: readonly AuthoredCase[]): string {
  return entries.map((entry) => reviewBlock(entry, "verdict")).join("\n\n---\n\n");
}

function familyBlocks(group: ReviewGroup): string {
  const lines = [
    `### Family: ${group.title}`,
    "",
    `**Shared rule:** ${group.rule}`,
    "",
    "**Family verdict — V / I / ?:** ` `",
    "",
    "A family verdict applies to every blank override below. An individual override wins.",
    "Blank family and override fields mean not reviewed.",
    "",
    `<!-- family:start ${group.id} -->`,
    "",
    group.entries.map((entry) => reviewBlock(entry, "override", group.id)).join("\n\n---\n\n"),
    "",
    `<!-- family:end ${group.id} -->`,
  ];
  return lines.join("\n");
}

function emptyNameContrast(): string {
  return [
    "### Matched contrast: empty decoded-name roles",
    "",
    "```hson",
    "<`` 1>",
    "<``/>",
    "<e ``=\"x\"/>",
    "<e ``/>",
    "```",
    "",
    "An empty decoded object-property key is presently proposed valid; empty element,",
    "attribute, and flag names are presently proposed invalid.",
  ].join("\n");
}

function objectElementContrast(confirmed = false): string {
  return [
    "### Matched contrast: object versus element closer",
    confirmed ? "///---> CONFIRMED" : "",
    "```hson",
    "<a 1>   // current proposal: valid HSON object",
    "<a 1/>  // current proposal: invalid HSON element typed content",
    "```",
  ].join("\n");
}

export const orderedAuthoredReviewCases: readonly AuthoredCase[] = Object.freeze(REVIEW_SECTIONS.flatMap((section) => {
  const inherited = new Set(REVIEW_FAMILY_GROUPS.filter((group) => group.section === section.number)
    .flatMap((group) => group.entries.map((entry) => entry.id)));
  const standalone = authoredCases
    .filter((entry) => sectionNumber(entry) === section.number && !inherited.has(entry.id))
    .sort((left, right) => left.id.localeCompare(right.id));
  const groups = REVIEW_FAMILY_GROUPS.filter((group) => group.section === section.number);
  return [...standalone, ...groups.flatMap((group) => group.entries)];
}));

export function renderAuthoredSourceVerdictTemplate(): string {
  const out: string[] = [
    "# Authored-HSON source verdicts",
    "",
    "This is the first-pass worksheet for the **materialized authored-HSON conformance corpus candidate**.",
    "The primary question for every row is: **Does this exact source belong to the authored HSON language?**",
    "",
    "## Reviewer key",
    "",
    "```text",
    "V = valid authored HSON",
    "I = invalid authored HSON",
    "? = uncertain or requires discussion",
    "blank = not reviewed",
    "```",
    "",
    "The **Current proposal** column is the candidate's present classification. It is not a recommendation",
    "and the reviewer need not follow it. A blank human-verdict cell does not imply agreement. Complete",
    "the optional note only when the verdict alone is insufficient. Exact diagnostic codes, stages,",
    "coordinates, paths, related evidence, expected graphs, and canonical output are not being certified",
    "during this pass.",
    "",
    "## Review progress",
    "",
    "```text",
    "Reviewed rows:",
    "Valid verdicts:",
    "Invalid verdicts:",
    "Uncertain verdicts:",
    "Unreviewed:",
    "Family verdicts used:",
    "Individual overrides:",
    "```",
    "",
    "This area is intentionally blank. Do not infer progress from the Current proposal column.",
    "",
    "## Evidence and scope",
    "",
    `- [Immutable provenance audit](evidence/authored-hson-corpus-provenance-audit.txt) — SHA-256 \`${EXPECTED_PROVENANCE_SHA256}\``,
    `- [Immutable shape preview](evidence/authored-hson-shape-coverage-preview.txt) — SHA-256 \`${EXPECTED_SHAPE_SHA256}\``,
    "- Included here: 269 authored-HSON sources (100 proposed valid; 169 proposed invalid).",
    "- Deferred: 11 graph-only accepted transports, 9 graph-only rejected transports, 14 structural JSON transports,",
    "  49 structural HTML transports, 4 diagnostic-circuit regressions, and 10 specialized-test references.",
    "",
    "## Matched source contrasts",
    "",
    objectElementContrast(true),
    "",
    "### Typed object values versus element flags",
    "///---> CONFIRMED",
    "```hson",
    "<t true f false n null>   /// JS object {t: true, f: false, n null}",
    "<x true false null/>      /// empty x element w boolean attributes <x true=\"true\" false=\"false\" null=\"null\"></x>",
    "```",
    "",
    "### Primitive-looking object keys",
    "",
    "```hson",
    "<true 1 false 2 null 3>",
    "```",
    "",
    "### Homogeneous versus mixed root modes",
    "",
    "```hson",
    "<a/><b/>   // current proposal: valid element fragment",
    "<a/><b 2>  // current proposal: invalid mixed modes",
    "```",
    "",
    emptyNameContrast(),
  ];

  for (const section of REVIEW_SECTIONS) {
    out.push("", `## ${section.number}. ${section.title}`, "");
    if (section.introduction !== undefined) out.push(section.introduction, "");
    if (section.number === 2) out.push(objectElementContrast(), "");
    if (section.number === 14) out.push(emptyNameContrast(), "");

    const groups = REVIEW_FAMILY_GROUPS.filter((group) => group.section === section.number);
    const familyIds = new Set(groups.flatMap((group) => group.entries.map((entry) => entry.id)));
    const standalone = authoredCases
      .filter((entry) => sectionNumber(entry) === section.number && !familyIds.has(entry.id))
      .sort((left, right) => left.id.localeCompare(right.id));
    if (standalone.length > 0) out.push(primaryBlocks(standalone), "");
    for (const group of groups) out.push(familyBlocks(group), "");
  }

  out.push(
    "## Deferred review packets",
    "",
    "These are intentionally outside this first authored-source verdict pass:",
    "",
    "- graph-only accepted and rejected transport;",
    "- structural JSON transport;",
    "- structural HTML transport;",
    "- diagnostic-circuit regressions;",
    "- specialized-test cross-references.",
    "",
    "## Regenerating a comparison template safely",
    "",
    "This document is now human-owned. The generator refuses to overwrite it. To compare the current",
    "descriptor-derived candidate with this editable worksheet, generate into a temporary file:",
    "",
    "```sh",
    "TS_NODE_TRANSPILE_ONLY=true node --loader ts-node/esm \\",
    "  tests/certified-corpus/generate-authored-source-verdicts.mts \\",
    "  --output /tmp/01-authored-source-verdicts.candidate.md",
    "diff -u docs/contracts/authored-hson-review/01-authored-source-verdicts.md \\",
    "  /tmp/01-authored-source-verdicts.candidate.md",
    "```",
    "",
    "The comparison can reveal descriptor drift without destroying human verdicts. Use `--initialize`",
    "only for a missing canonical worksheet; initialization refuses to replace an existing file.",
    "",
    "## Reviewer questions or global notes",
    "",
    "-",
    "",
    "## Cases marked `?`",
    "",
    "To be generated after review.",
    "",
    "## Candidate disagreements",
    "",
    "To be generated after review.",
    "",
  );
  return out.join("\n");
}

export function authoredReviewCaseIds(): readonly string[] {
  return authoredCases.map((entry) => entry.id).sort((left, right) => left.localeCompare(right));
}

export function calibratedStandaloneIds(): readonly string[] {
  return CALIBRATED_STANDALONE_IDS;
}
