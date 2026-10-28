import { configure_scout } from "hson-live/scout";
import { continue_hosted_document } from "../../dist/index.js";
import { hsonLiveMap } from "hson-live/livemap";
import { continuation_root_is_active } from "../../dist/api/continuation/continuation.common.js";
import { prepare_hosted_document_internal } from "../../dist/api/continuation/continue-hosted-document.js";
import { set_document_adoption_fault_hook_for_tests } from "../../dist/api/continuation/continuation.adopt.js";
import { get_node_for_el } from "../../dist/api/livetree/utils/node-map-helpers.js";

const scenario = location.pathname.slice(1);
const smallPayload = "eyJvcGFxdWUiOiJBenlfLTA5In0";
const largePayload = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-".repeat(16384) + "Zg==";
const expectedPayload = scenario === "payload-large" || scenario === "parser-early" ? largePayload
  : scenario === "scout-first" || scenario === "provider-first" ? undefined : smallPayload;
const fail = (message) => { throw new Error(message); };
const check = (value, message) => { if (!value) fail(message); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const report = async (status, detail) => fetch(`/__result?scenario=${encodeURIComponent(scenario)}&status=${status}&detail=${encodeURIComponent(detail)}`);
const canonicalNodes = (node) => node.localName === "hson-scout" ? []
  : [node, ...Array.from(node.childNodes).flatMap(canonicalNodes)];

const errors = [];
window.addEventListener("error", (event) => {
  errors.push(event.message);
  if (scenario === "provider-failure" || scenario === "preparation-failure" || scenario === "start-failure") event.preventDefault();
});
window.addEventListener("unhandledrejection", (event) => { errors.push(String(event.reason)); });

async function until(test, message) {
  for (let count = 0; count < 120; count += 1) {
    if (await test()) return;
    await sleep(50);
  }
  fail(`${message}; browser errors: ${errors.join(" | ")}`);
}

async function main() {
  check(customElements.get("hson-scout") !== undefined, "Scout did not register");
  if (scenario === "parser-early" || scenario === "payload-module") {
    check(document.readyState === (scenario === "parser-early" ? "loading" : "interactive"),
      "Parser readiness fixture ran at the wrong boundary");
    let calls = 0;
    const failure = new Error("Expected capture-only provider failure");
    const result = configure_scout((payload) => {
      calls += 1;
      check(document.readyState !== "loading", "Provider ran before parsing finished");
      check(payload === expectedPayload, "Parser delivered incomplete or changed payload");
      throw failure;
    }).catch((cause) => cause);
    await until(() => calls === 1, "Parser provider did not run");
    check(await result === failure, "Parser capture failed");
    const scout = document.querySelector("hson-scout");
    check(calls === 1 && scout?.textContent === expectedPayload, "Capture changed provider failure lifecycle");
    check(getComputedStyle(scout).display === "none", "Failed Scout exposed its payload");
    check(document.body.childNodes.length === 2 && document.body.lastChild === scout,
      "After-body parsing added unwanted whitespace nodes");
    return;
  }
  const html = document.documentElement;
  const body = document.body;
  const mainElement = document.querySelector("main");
  const button = document.querySelector("button");
  const originalNodes = canonicalNodes(html);
  let calls = 0;
  let manualOptions;
  let suppliedOptions;
  let result;
  let releaseFirstProvider;
  const setupPromise = fetch(`/setup?scenario=${encodeURIComponent(scenario)}`).then((response) => response.json());
  const configuration = async (payload) => {
    calls += 1;
    if (scenario !== "manual-collision" && scenario !== "preparing-collision") {
      check(payload === (scenario === "removed-waiting" || calls > 1 ? undefined : expectedPayload),
        "Provider received changed or incomplete payload");
    }
    if ((scenario === "removed-pending" || scenario === "cross-document-move") && calls === 1) {
      await new Promise((resolve) => { releaseFirstProvider = resolve; });
      return { root: html };
    }
    if (scenario === "manual-collision" && manualOptions !== undefined) return manualOptions;
    if (scenario === "provider-failure") throw new Error("Expected provider failure");
    const setup = await setupPromise;
    const transport = scenario === "websocket"
      ? hsonLiveMap.echo.transport.websocket({ url: setup.websocketUrl })
      : hsonLiveMap.echo.transport.http({ endpoint: "/_hson" });
    const options = { now: setup.now, credential: setup.credential, transport, root: html,
      interactions: { local: {} },
      ...(scenario === "preparation-failure" ? { document: "absent" } : {}) };
    if (scenario === "manual-collision") manualOptions = options;
    suppliedOptions = options;
    return options;
  };
  const configure = () => {
    const pending = configure_scout(configuration);
    result = pending.then(
      (continuation) => ({ status: "success", continuation }),
      (error) => ({ status: "failure", error }),
    );
  };

  if (scenario === "no-scout") {
    configure();
    await sleep(100);
    check(calls === 0 && document.querySelector("hson-scout") === null, "Scout absent page ignited");
    return;
  }
  if (scenario === "provider-first") {
    configure();
    let duplicateRejected = false;
    try { configure_scout(async () => { throw new Error("Conflicting provider ran"); }); }
    catch { duplicateRejected = true; }
    check(duplicateRejected, "Second provider was accepted");
    document.body.insertAdjacentHTML("beforeend", "<hson-scout hidden></hson-scout>");
  } else if (scenario === "manual-collision") {
    const options = await configuration();
    const manual = await continue_hosted_document(options);
    const scout = document.createElement("hson-scout");
    scout.setAttribute("hidden", "");
    document.body.appendChild(scout);
    configure();
    await until(() => document.querySelector("hson-scout") === null, "Redundant Scout remained");
    check((await result).status === "failure", "Redundant Scout result did not reject");
    check(calls === 2 && manual.mirror.status === "active", "Manual continuation was displaced");
    manual.dispose();
    manual.echo.dispose();
    options.transport.dispose();
    return;
  } else if (scenario === "preparing-collision") {
    const options = await configuration();
    const prepared = prepare_hosted_document_internal(options);
    configure();
    await until(() => calls === 2, "Scout provider did not run against prepared root");
    await sleep(100);
    check(document.querySelector("hson-scout") !== null, "Preparing collision consumed Scout");
    check((await result).status === "failure", "Preparing collision result did not reject");
    prepared.dispose();
    document.querySelector("hson-scout").remove();
    const transport = hsonLiveMap.echo.transport.http({ endpoint: "/_hson" });
    const recovered = await continue_hosted_document({ ...options, transport });
    check(recovered.mirror.status === "active", "Prepared root was not released");
    recovered.dispose(); recovered.echo.dispose(); transport.dispose();
    options.transport.dispose(); suppliedOptions.transport.dispose();
    return;
  } else {
    check(document.querySelector("hson-scout") !== null, "Parsed Scout was missing");
    check(document.body.lastElementChild?.tagName === "HSON-SCOUT", "Parser did not place Scout last in body");
    check(document.body.childNodes.length === 2 && document.body.lastChild?.localName === "hson-scout",
      "After-body placement added unwanted whitespace nodes");
    if (scenario === "payload-split") {
      const text = document.querySelector("hson-scout").firstChild;
      text.splitText(7).splitText(5);
      check(document.querySelector("hson-scout").childNodes.length === 3, "Text-node split fixture failed");
    }
    if (scenario === "scout-first") {
      await sleep(60);
      check(document.querySelector("hson-scout") !== null, "Scout disappeared before provider");
      const scout = document.querySelector("hson-scout");
      check(getComputedStyle(scout).display === "none", "Hidden Scout became visible while waiting");
      scout.remove();
      document.body.appendChild(scout);
    }
    if (scenario === "removed-waiting") {
      document.querySelector("hson-scout").remove();
      await Promise.resolve();
      document.body.insertAdjacentHTML("beforeend", "<hson-scout hidden></hson-scout>");
    }
    if (scenario === "start-failure") mainElement.appendChild(document.createElement("span"));
    configure();
    if (scenario === "removed-pending") {
      await until(() => calls === 1, "First provider did not begin");
      document.querySelector("hson-scout").remove();
      await Promise.resolve();
      document.body.insertAdjacentHTML("beforeend", "<hson-scout hidden></hson-scout>");
      await until(() => calls === 2, "Replacement Scout did not invoke provider");
      releaseFirstProvider();
    }
    if (scenario === "cross-document-move") {
      await until(() => calls === 1, "First provider did not begin");
      const moved = document.querySelector("hson-scout");
      const frame = document.createElement("iframe");
      document.body.appendChild(frame);
      const otherDocument = frame.contentDocument;
      otherDocument.body.appendChild(otherDocument.adoptNode(moved));
      await Promise.resolve();
      check(calls === 1 && !continuation_root_is_active(html),
        "Moved Scout ignited in another document");
      releaseFirstProvider();
      await Promise.resolve();
      frame.remove();
      document.body.insertAdjacentHTML("beforeend", "<hson-scout hidden></hson-scout>");
      await until(() => calls === 2, "Fresh Scout did not reclaim original document");
    }
  }

  const scoutElements = [...document.querySelectorAll("hson-scout")];
  if (scenario === "payload" || scenario === "payload-large" || scenario === "payload-split") {
    let removalMicrotaskRan = false;
    const scout = scoutElements[0];
    const remove = scout.remove;
    scout.remove = function () {
      remove.call(this);
      queueMicrotask(() => { removalMicrotaskRan = true; });
    };
    set_document_adoption_fault_hook_for_tests(() => {
      check(!removalMicrotaskRan, "Scout yielded between removal and exact adoption");
      check(document.querySelector("hson-scout") === null && document.body.childNodes.length === 1
        && document.body.firstChild === mainElement, "Scout or payload remained during exact adoption");
      check(scoutElements.every((element) => !element.isConnected), "Scout remained connected during adoption");
    });
  }
  if (scenario === "provider-failure" || scenario === "preparation-failure" || scenario.startsWith("malformed")) {
    await until(() => calls === (scenario.startsWith("malformed") ? 0 : 1), "Unexpected provider invocation");
    await sleep(100);
    check(document.querySelector("hson-scout") !== null, "Scout disappeared before handoff");
    check((await result).status === "failure", "Pre-handoff failure did not reject result");
    check(errors.length === 0, "Scout failure was reported twice");
    if (!scenario.startsWith("malformed")) {
      check(document.querySelector("hson-scout").textContent === expectedPayload,
        "Pre-handoff failure discarded the payload");
      check(getComputedStyle(document.querySelector("hson-scout")).display === "none", "Failure exposed payload");
    }
    check(html === document.documentElement && button === document.querySelector("button"), "Failure changed application DOM");
    if (scenario === "preparation-failure") {
      document.querySelector("hson-scout").remove();
      const transport = hsonLiveMap.echo.transport.http({ endpoint: "/_hson" });
      const recovered = await continue_hosted_document({ ...suppliedOptions, document: undefined, transport });
      check(recovered.mirror.status === "active", "Failed preparation retained root ownership");
      recovered.dispose(); recovered.echo.dispose(); transport.dispose();
      suppliedOptions.transport.dispose();
    }
    return;
  }
  if (scenario === "start-failure") {
    await until(() => document.querySelector("hson-scout") === null, "Scout was not consumed before start");
    check((await result).status === "failure", "Start failure did not reject result");
    check(mainElement.querySelector("span") !== null, "Mismatch fixture vanished");
    await sleep(100);
    mainElement.querySelector("span").remove();
    const recoveryTransport = hsonLiveMap.echo.transport.http({ endpoint: "/_hson" });
    const recovered = await continue_hosted_document({ ...suppliedOptions, transport: recoveryTransport });
    check(recovered.mirror.status === "active", "Failed start retained root ownership");
    recovered.dispose(); recovered.echo.dispose(); recoveryTransport.dispose(); suppliedOptions.transport.dispose();
    return;
  }

  await until(() => document.querySelector("hson-scout") === null, "Scout did not remove itself");
  await until(() => continuation_root_is_active(html), "Hosted continuation never became active");
  const outcome = await result;
  set_document_adoption_fault_hook_for_tests(undefined);
  check(outcome.status === "success" && outcome.continuation.mirror.status === "active"
    && outcome.continuation.echo.sync.status === "caught_up",
  "Scout did not return the ordinary completed hosted continuation");
  check(scoutElements.every((element) => get_node_for_el(element) === undefined),
    "Scout entered LiveTree or Mirror correspondence");
  check(document.body.childNodes.length === 1 && document.body.lastChild === mainElement,
    "Body retained Scout, payload, or whitespace nodes");
  check(html === document.documentElement && body === document.body
    && mainElement === document.querySelector("main") && button === document.querySelector("button"),
  "SSR DOM identity changed");
  const adoptedNodes = canonicalNodes(html);
  check(originalNodes.length === adoptedNodes.length
    && originalNodes.every((node, index) => node === adoptedNodes[index]), "Canonical SSR nodes were replaced or reordered");
  const baseline = await fetch("/handled").then((response) => response.json());
  await until(async () => {
    button.click();
    const state = await fetch("/handled").then((response) => response.json());
    return state.count > baseline.count;
  }, "Canonical interaction never activated");
  check(calls === (scenario === "removed-pending" || scenario === "cross-document-move" ? 2 : 1),
    "Unexpected provider invocation count");
  if (scenario === "http") {
    let collided = false;
    try { await continue_hosted_document(suppliedOptions); } catch { collided = true; }
    check(collided, "Manual continuation duplicated active Scout root");
    outcome.continuation.dispose();
    outcome.continuation.echo.dispose();
    suppliedOptions.transport.dispose();
    document.body.insertAdjacentHTML("beforeend", "<hson-scout hidden></hson-scout>");
    await sleep(60);
    check(calls === 1 && document.querySelectorAll("hson-scout").length === 0,
      "Disposed Scout continuation restarted ignition");
  }
}

main().then(() => report("pass", "ok"), (error) => report("fail", error.stack ?? String(error)));
