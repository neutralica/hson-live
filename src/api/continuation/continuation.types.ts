import type { Echo } from "../../types/locus.types.js";
import type {
  LiveMapDocumentLibrary,
  LiveMap,
} from "../../types/livemap.types.js";
import type { LiveTree } from "../livetree/livetree.js";
import type { DocumentMirror } from "../mirror/mirror.document.js";

export type DocumentContinuation<TMap extends LiveMapDocumentLibrary = LiveMapDocumentLibrary> = Readonly<{
  map: TMap;
  tree: LiveTree;
  mirror: DocumentMirror;
  dispose: () => void;
}>;

export type HostedDocumentContinuation<
  TMap extends LiveMapDocumentLibrary = LiveMapDocumentLibrary,
> = DocumentContinuation<TMap> & Readonly<{
  echo: Echo<LiveMap>;
}>;
