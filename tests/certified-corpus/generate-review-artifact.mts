import { writeCorpusReviewArtifact } from "./corpus-review.mts";

await writeCorpusReviewArtifact();
process.stdout.write("wrote deterministic certified authored-HSON corpus review artifact\n");
