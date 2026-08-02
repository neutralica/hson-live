import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  HISTORICAL_WORKSHEET_PATH,
  HISTORICAL_WORKSHEET_SHA256,
} from "./authored-name-delimiter-amendment.mts";

const worksheet = readFileSync(HISTORICAL_WORKSHEET_PATH);
const actualHash = createHash("sha256").update(worksheet).digest("hex");
if (actualHash !== HISTORICAL_WORKSHEET_SHA256) {
  throw new Error(`Historical worksheet SHA-256 mismatch: ${actualHash}`);
}
throw new Error(
  "The completed worksheet is immutable historical provenance and cannot be regenerated. "
  + "Regenerate current artifacts with generate-authored-source-verdict-ledger.mts --apply-amendment.",
);
