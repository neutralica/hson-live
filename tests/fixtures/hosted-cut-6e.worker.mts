import { parentPort } from "node:worker_threads";
import { hosted_cut_fixture } from "../helpers/hosted-cut-fixture.mts";

parentPort?.postMessage(await hosted_cut_fixture());
