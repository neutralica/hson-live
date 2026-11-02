import type { Echo } from "../../types/locus.types.js";
import type {
  LiveMapDocumentLibrary,
  LiveMapDocumentBindingSource,
  LiveMap,
} from "../../types/livemap.types.js";
import type { LiveTree } from "../livetree/livetree.js";
import type { DocumentMirror } from "../mirror/mirror.document.js";
import type { EchoProjectedDocumentLibrary } from "../../types/governor.types.js";

export type DocumentContinuation<TMap extends LiveMapDocumentBindingSource = LiveMapDocumentLibrary> = Readonly<{
  map: TMap;
  tree: LiveTree;
  mirror: DocumentMirror;
  dispose: () => void;
}>;

export type HostedDocumentContinuation = Omit<DocumentContinuation, "map"> & Readonly<{
  map: EchoProjectedDocumentLibrary;
  echo: Echo<LiveMap>;
}>;
