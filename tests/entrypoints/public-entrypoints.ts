import { hson } from "hson-live";
import { hsonTransform as transformSubpath } from "hson-live/transform";
import {
  hsonLiveTree as treeSubpath,
  LiveTree,
  type LiveTreeLifecycleResult,
} from "hson-live/livetree";
import {
  hsonLiveMap as mapSubpath,
  make_livemap_core,
  type LiveMapCommit,
  type LiveMapPathHandle,
} from "hson-live/livemap";
import { hsonLiveHost as hostSubpath } from "hson-live/livehost";
// @ts-expect-error LiveMap path-handle pseudo-QUID helpers were removed.
import { get_livemap_quid } from "hson-live";
// @ts-expect-error LiveMap path-handle pseudo-QUID helpers were removed.
import { ensure_livemap_quid } from "hson-live/livemap";

void hson;
void transformSubpath;
void mapSubpath;
void treeSubpath;
void hostSubpath;
void LiveTree;
void make_livemap_core;
void get_livemap_quid;
void ensure_livemap_quid;

type PublicTypes = LiveTreeLifecycleResult | LiveMapCommit | LiveMapPathHandle;
declare const publicTypes: PublicTypes;
void publicTypes;

declare const pathHandle: LiveMapPathHandle;
// @ts-expect-error LiveMap path handles have no public QUID identity.
void pathHandle.quid;
