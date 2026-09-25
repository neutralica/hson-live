import { parentPort } from "node:worker_threads";
import { hsonLiveMap } from "../../src/index.ts";

const map = hsonLiveMap.fromLibraries({ page: { document: "<html <head/> <body/>/>" } });
const page = map.lib("page");
page.css.sel("body").set.margin("0");
page.css.atProperty.register(["--phase", "<number>", "0"]);
page.css.keyframes.set({ name: "fade", steps: { from: { opacity: "0" }, to: { opacity: "1" } } });
parentPort?.postMessage({ capture: map.capture(), css: page.css.snapshot(), html: map.render("page") });
