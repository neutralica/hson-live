export const HISTORICAL_WORKSHEET_PATH =
  "docs/contracts/authored-hson-review/01-authored-source-verdicts.md";
export const HISTORICAL_WORKSHEET_SHA256 =
  "df17f7de1e9452754b9ab1ddc4d80fdfc82c473f1323ce91a72f9a46ec79db7c";
export const QUOTED_NAME_AMENDMENT_PATH =
  "docs/contracts/authored-hson-review/05-quoted-name-delimiter-amendment.md";

export type AmendmentVerdict = "valid" | "invalid";

export const AMENDMENT_ONLY_ACTIVE_CASES: Readonly<Record<string, AmendmentVerdict>> = Object.freeze({
  "hson.accept.family.quoted-name.literal-backtick": "valid",
  "hson.reject.literal.legacy-backtick-name": "invalid",
  "hson.reject.literal.quoted-name.raw-apostrophe": "invalid",
  "hson.reject.literal.single-quoted-value": "invalid",
});

export function activeCaseIdForHistorical(historicalCaseId: string): string {
  return historicalCaseId
    .replace("backtick-name", "quoted-name")
    .replace(".escaped-backtick", ".escaped-apostrophe")
    .replace(".unicode-interrupted-backtick", ".unicode-interrupted-apostrophe");
}

export function activeFamilyIdForHistorical(historicalFamilyId: string): string {
  return historicalFamilyId.replace("backtick-name", "quoted-name");
}

export function activeReviewGroupIdForHistorical(historicalGroupId: string): string {
  return historicalGroupId.replace("backtick-name", "quoted-name");
}

export function amendmentVerdictForActiveCase(activeCaseId: string): AmendmentVerdict | undefined {
  if (activeCaseId.startsWith("hson.accept.family.quoted-name.")) return "valid";
  if (activeCaseId.startsWith("hson.reject.family.quoted-name.")) return "invalid";
  return AMENDMENT_ONLY_ACTIVE_CASES[activeCaseId];
}

export function delimiterChangedForCase(historicalCaseId: string, activeCaseId: string): boolean {
  return historicalCaseId !== activeCaseId
    || historicalCaseId.includes("backtick-name")
    || activeCaseId.includes("quoted-name")
    || activeCaseId === "hson.accept.literal.object.empty-decoded-key"
    || activeCaseId === "hson.accept.literal.object.colon-dot-names"
    || activeCaseId.startsWith("hson.reject.literal.empty-");
}
