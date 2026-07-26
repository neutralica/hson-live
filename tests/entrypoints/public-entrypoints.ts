import { hson } from "hson-live";
import { LiveTree, type LiveTreeLifecycleResult } from "hson-live/livetree";
import {
  make_livemap_core,
  type LiveMapCommit,
  type LiveMapPathHandle,
} from "hson-live/livemap";

void hson;
void LiveTree;
void make_livemap_core;

type PublicTypes = LiveTreeLifecycleResult | LiveMapCommit | LiveMapPathHandle;
declare const publicTypes: PublicTypes;
void publicTypes;
