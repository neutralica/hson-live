import { hsonTransform } from "hson-live/transform";
import type { BinaryDecodeOptions, TransformBinarySerialize } from "hson-live/transform";
import {
  verify_universal_circuit,
  type UniversalCircuitVerificationResult,
} from "hson-live/diagnostics/universal-circuit";
import { hsonCalc, hsonNumber, type HsonNumber } from "hson-live/number";
import { hsonLocus } from "hson-live/locus";
import { assertCanonicalClosure } from "hson-live/diagnostics/transform-test-oracle";

void hsonLocus;
void assertCanonicalClosure;
void hsonTransform.fromHson(`<worker <ready true>>`).toNode();
void hsonTransform.fromJson({ ready: true }).toHson().serialize();
void hsonTransform.fromJson({ ready: true }).toHson().sha256();
const workerBinary: TransformBinarySerialize = hsonTransform.fromJson({ ready: true }).toBinary();
const workerBinaryBytes: Uint8Array = workerBinary.serialize();
const workerBinaryOptions: BinaryDecodeOptions = { maxBytes: 1_048_576 };
void workerBinary.sha256();
void hsonTransform.fromBinary(workerBinaryBytes, workerBinaryOptions).toNode();
const universalCircuit: UniversalCircuitVerificationResult = verify_universal_circuit({
  entry: "json",
  source: '{"ready":true}',
});
void universalCircuit;
void hsonTransform.fromNode({
  $_tag: "_object",
  $_content: [],
}).toJson().value();
void hsonTransform.fromTrustedHtml(`<worker ready></worker>`).toNode();
void hsonTransform.fromUntrustedHtml(`<worker ready onclick="bad()"></worker>`).toNode();
const workerNumber: HsonNumber = hsonNumber(-0);
const workerCalculation: HsonNumber = hsonCalc(() => workerNumber);
void workerCalculation;
