import { writeCorpusReviewArtifact } from "./corpus-review.mts";

await writeCorpusReviewArtifact();
process.stdout.write("wrote deterministic certified authored-Hson corpus review artifact\n");
