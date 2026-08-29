import { canonical_hson_graph_equal } from "../../core/canonical-hson-equal.js";
import type { HsonNode } from "../../core/types.js";
import type {
  LiveMapCapture,
  LiveMapCaptureOptions,
  LiveMapRestoreOptions,
} from "../../types/livemap.types.js";
import type { OrderedProjectedValue } from "../../core/ordered-projected-value.js";
import { clone_hson_graph_without_quids, type LiveMapDocumentIdentityEpochController } from "./livemap.document.capture.js";
import { clone_live_root } from "./livemap.editor.js";
import { encode_projected_value_transport } from "./livemap.transport.js";

type Provenance = Readonly<{
  owner: object;
  epoch: number;
  category: LiveMapCaptureOptions["identity"];
  root: HsonNode;
  rev: number;
}>;

const provenance = new WeakMap<object, Provenance>();

export function capture_livemap_projected(
  controller: LiveMapDocumentIdentityEpochController,
  rev: number,
  root: HsonNode,
  projected: OrderedProjectedValue,
  options?: LiveMapCaptureOptions,
): LiveMapCapture {
  const category = options?.identity ?? "preserve-metadata";
  if (category !== "same-epoch" && category !== "preserve-metadata" && category !== "strip") {
    throw new Error(`Unsupported data identity capture category ${JSON.stringify(category)}.`);
  }
  const captureRoot = category === "strip"
    ? clone_hson_graph_without_quids(root)
    : clone_live_root(root);
  const capture: LiveMapCapture = {
    rev,
    ...encode_projected_value_transport(projected),
    root: captureRoot,
  };
  Object.defineProperty(capture, "root", { enumerable: false });
  Object.freeze(capture);
  if (options !== undefined) {
    provenance.set(capture, Object.freeze({
      owner: controller.owner,
      epoch: controller.current(),
      category,
      root: clone_live_root(captureRoot),
      rev,
    }));
  }
  return capture;
}

/** Return whether exact-object provenance permits retaining the owner epoch. */
export function projected_capture_continuity(
  controller: LiveMapDocumentIdentityEpochController,
  capture: object,
  options?: LiveMapRestoreOptions,
): "same-epoch" | "new-epoch" {
  const policy = options?.identity ?? "preserve-metadata";
  if (policy !== "same-epoch") return "new-epoch";
  const proof = provenance.get(capture);
  if (proof === undefined
    || proof.category !== "same-epoch"
    || proof.owner !== controller.owner
    || proof.epoch !== controller.current()) {
    throw new Error("Same-epoch projected restore requires the exact active capture capability.");
  }
  const candidate = capture as Partial<LiveMapCapture>;
  if (candidate.rev !== proof.rev
    || candidate.root === undefined
    || !canonical_hson_graph_equal(candidate.root, proof.root)) {
    throw new Error("Same-epoch projected capture changed after issuance.");
  }
  return "same-epoch";
}
