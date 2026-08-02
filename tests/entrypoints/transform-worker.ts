import { hsonTransform } from "hson-live/transform";
import {
  verify_universal_circuit,
  type UniversalCircuitVerificationResult,
} from "hson-live/diagnostics/universal-circuit";
import { hsonCalc, hsonNumber, type HsonNumber } from "hson-live/number";
import { hsonLiveHost } from "hson-live/livehost";
import { assertCanonicalClosure } from "hson-live/diagnostics/transform-test-oracle";

void hsonLiveHost;
void assertCanonicalClosure;
void hsonTransform.fromHson(`<worker <ready true>>`).toNode();
void hsonTransform.fromJson({ ready: true }).toHson().serialize();
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
