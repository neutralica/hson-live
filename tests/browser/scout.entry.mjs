import { configure_scout } from "hson-live/scout";
import { continue_hosted_document, hsonEcho } from "../../dist/index.js";
import { continuation_root_is_active } from "../../dist/api/continuation/continuation.common.js";
import { prepare_hosted_document_internal } from "../../dist/api/continuation/continue-hosted-document.js";
import { get_node_for_el } from "../../dist/api/livetree/utils/node-map-helpers.js";

const scenario = location.pathname.slice(1);
const fail = (message) => { throw new Error(message); };
const check = (value, message) => { if (!value) fail(message); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const report = async (status, detail) => fetch(`/__result?scenario=${encodeURIComponent(scenario)}&status=${status}&detail=${encodeURIComponent(detail)}`);

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
  const html = document.documentElement;
  const body = document.body;
  const mainElement = document.querySelector("main");
  const button = document.querySelector("button");
  let calls = 0;
  let manualOptions;
  let suppliedOptions;
  const setupPromise = fetch(`/setup?scenario=${encodeURIComponent(scenario)}`).then((response) => response.json());
  const configuration = async () => {
    calls += 1;
    if (scenario === "manual-collision" && manualOptions !== undefined) return manualOptions;
    if (scenario === "provider-failure") throw new Error("Expected provider failure");
    const setup = await setupPromise;
    const transport = scenario === "websocket"
      ? hsonEcho.transport.websocket({ url: setup.websocketUrl })
      : hsonEcho.transport.http({ endpoint: "/_hson" });
    const options = { now: setup.now, credential: setup.credential, transport, root: html,
      interactions: { local: {} },
      ...(scenario === "preparation-failure" ? { document: "absent" } : {}) };
    if (scenario === "manual-collision") manualOptions = options;
    suppliedOptions = options;
    return options;
  };

  if (scenario === "no-scout") {
    configure_scout(configuration);
    await sleep(100);
    check(calls === 0 && document.querySelector("hson-scout") === null, "Scout absent page ignited");
    return;
  }
  if (scenario === "provider-first") {
    configure_scout(configuration);
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
    configure_scout(configuration);
    await until(() => document.querySelector("hson-scout") === null, "Redundant Scout remained");
    check(calls === 2 && manual.mirror.status === "active", "Manual continuation was displaced");
    manual.dispose();
    manual.echo.dispose();
    options.transport.dispose();
    return;
  } else if (scenario === "preparing-collision") {
    const options = await configuration();
    const prepared = prepare_hosted_document_internal(options);
    configure_scout(configuration);
    await until(() => calls === 2, "Scout provider did not run against prepared root");
    await sleep(100);
    check(document.querySelector("hson-scout") !== null, "Preparing collision consumed Scout");
    prepared.dispose();
    document.querySelector("hson-scout").remove();
    const transport = hsonEcho.transport.http({ endpoint: "/_hson" });
    const recovered = await continue_hosted_document({ ...options, transport });
    check(recovered.mirror.status === "active", "Prepared root was not released");
    recovered.dispose(); recovered.echo.dispose(); transport.dispose(); options.transport.dispose();
    return;
  } else {
    check(document.querySelector("hson-scout") !== null, "Parsed Scout was missing");
    check(document.body.lastElementChild?.tagName === "HSON-SCOUT", "Parser did not place Scout last in body");
    if (scenario === "scout-first") {
      await sleep(60);
      check(document.querySelector("hson-scout") !== null, "Scout disappeared before provider");
      const scout = document.querySelector("hson-scout");
      check(getComputedStyle(scout).display === "none", "Hidden Scout became visible while waiting");
      scout.remove();
      document.body.appendChild(scout);
    }
    if (scenario === "start-failure") mainElement.appendChild(document.createElement("span"));
    configure_scout(configuration);
  }

  const scoutElements = [...document.querySelectorAll("hson-scout")];
  if (scenario === "provider-failure" || scenario === "preparation-failure" || scenario.startsWith("malformed")) {
    await until(() => calls === (scenario.startsWith("malformed") ? 0 : 1), "Unexpected provider invocation");
    await sleep(100);
    check(document.querySelector("hson-scout") !== null, "Scout disappeared before handoff");
    check(html === document.documentElement && button === document.querySelector("button"), "Failure changed application DOM");
    if (scenario === "preparation-failure") {
      document.querySelector("hson-scout").remove();
      const transport = hsonEcho.transport.http({ endpoint: "/_hson" });
      const recovered = await continue_hosted_document({ ...suppliedOptions, document: undefined, transport });
      check(recovered.mirror.status === "active", "Failed preparation retained root ownership");
      recovered.dispose(); recovered.echo.dispose(); transport.dispose();
    }
    return;
  }
  if (scenario === "start-failure") {
    await until(() => document.querySelector("hson-scout") === null, "Scout was not consumed before start");
    check(mainElement.querySelector("span") !== null, "Mismatch fixture vanished");
    await sleep(100);
    mainElement.querySelector("span").remove();
    const recoveryTransport = hsonEcho.transport.http({ endpoint: "/_hson" });
    const recovered = await continue_hosted_document({ ...suppliedOptions, transport: recoveryTransport });
    check(recovered.mirror.status === "active", "Failed start retained root ownership");
    recovered.dispose(); recovered.echo.dispose(); recoveryTransport.dispose();
    return;
  }

  await until(() => document.querySelector("hson-scout") === null, "Scout did not remove itself");
  await until(() => continuation_root_is_active(html), "Hosted continuation never became active");
  check(scoutElements.every((element) => get_node_for_el(element) === undefined),
    "Scout entered LiveTree or Mirror correspondence");
  check(document.body.lastElementChild === mainElement, "Body retained infrastructure child");
  check(html === document.documentElement && body === document.body
    && mainElement === document.querySelector("main") && button === document.querySelector("button"),
  "SSR DOM identity changed");
  const baseline = await fetch("/handled").then((response) => response.json());
  await until(async () => {
    button.click();
    const state = await fetch("/handled").then((response) => response.json());
    return state.count > baseline.count;
  }, "Canonical interaction never activated");
  check(calls === 1, "Provider was called more than once");
  if (scenario === "http") {
    let collided = false;
    try { await continue_hosted_document(suppliedOptions); } catch { collided = true; }
    check(collided, "Manual continuation duplicated active Scout root");
  }
}

main().then(() => report("pass", "ok"), (error) => report("fail", error.stack ?? String(error)));
