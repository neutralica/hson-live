import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  HISTORICAL_WORKSHEET_PATH,
  HISTORICAL_WORKSHEET_SHA256,
} from "./authored-name-delimiter-amendment.mts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const document = readFileSync(HISTORICAL_WORKSHEET_PATH, "utf8");
const actualHash = createHash("sha256").update(document).digest("hex");
assert(actualHash === HISTORICAL_WORKSHEET_SHA256,
  `Historical worksheet SHA-256 mismatch: ${actualHash}`);

const markers = Array.from(document.matchAll(/^<!-- authored-case:([^>\n]+) -->$/gm));
const ids = markers.map((match) => match[1]);
assert(new Set(ids).size === ids.length, "Historical worksheet contains a duplicate case marker.");

const familyStarts = Array.from(document.matchAll(/^<!-- family:start ([^>\n]+) -->$/gm));
const familyEnds = Array.from(document.matchAll(/^<!-- family:end ([^>\n]+) -->$/gm));
assert(familyStarts.map((match) => match[1]).join("\n") === familyEnds.map((match) => match[1]).join("\n"),
  "Historical worksheet family marker ordering changed.");

const verdictFields = Array.from(document.matchAll(
  /^\*\*(Verdict|Override) — V \/ I \/ \?:\*\*\s*`([^`]*)`\s*$/gm,
));
assert(verdictFields.length === markers.length, "Each historical authored case must have one verdict field.");
assert(verdictFields.every((match) => ["", "V", "I", "?"].includes(match[2].trim())),
  "Historical worksheet contains an unsupported verdict spelling.");

console.log(JSON.stringify({
  artifact: HISTORICAL_WORKSHEET_PATH,
  authoredBlocks: markers.length,
  familyGroups: familyStarts.length,
  immutableSha256: actualHash,
}));
