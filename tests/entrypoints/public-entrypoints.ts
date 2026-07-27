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

void hson;
void transformSubpath;
void mapSubpath;
void treeSubpath;
void hostSubpath;
void LiveTree;
void make_livemap_core;

type PublicTypes = LiveTreeLifecycleResult | LiveMapCommit | LiveMapPathHandle;
declare const publicTypes: PublicTypes;
void publicTypes;
