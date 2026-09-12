import type { Echo } from "../../types/locus.types.js";
import type {
  DocumentLiveMap,
  LiveMapAuthority,
  LiveMapDocumentLibrary,
  LiveMapLibraries,
} from "../../types/livemap.types.js";
import type { LiveTree } from "../livetree/livetree.js";
import type { DocumentReflect } from "../reflect/reflect.document.js";

type ContinuableDocumentMap = DocumentLiveMap | LiveMapDocumentLibrary;

export type DocumentContinuation<TMap extends ContinuableDocumentMap = ContinuableDocumentMap> = Readonly<{
  map: TMap;
  tree: LiveTree;
  reflect: DocumentReflect;
  dispose: () => void;
}>;

export type HostedDocumentContinuation<
  TMap extends ContinuableDocumentMap = ContinuableDocumentMap,
> = DocumentContinuation<TMap> & Readonly<{
  echo: Echo<LiveMapAuthority | LiveMapLibraries>;
}>;
