import assert from "node:assert/strict";
import { hsonLiveMap } from "../src/index.ts";
import { install_libraries_snapshot } from "../src/api/livemap/index.ts";
import { DocumentStylesheetError } from "../src/internal/css/parse-document-stylesheet.ts";
import { parse_document_stylesheet } from "../src/internal/css/parse-document-stylesheet.ts";

const document = "<html <head/> <body <main id=home-screen/>/>/>";
const create = () => hsonLiveMap.fromLibraries({ page: { document } });

{
  const map = create();
  const css = map.lib("page").css;
  const commits: unknown[] = [];
  map.commits.observe((commit) => commits.push(commit));
  const start = map.rev;
  assert.equal(css.stylesheet("/* opening */ body { margin: 0; } #home-screen { display: grid; }"), undefined);
  assert.equal(map.rev, start + 1);
  assert.equal(commits.length, 1);
  assert.ok(css.snapshot().indexOf("body{") < css.snapshot().indexOf("#home-screen{"));
  assert.equal((map.lib("page").render().match(/data-hson-managed-document-css/g) ?? []).length, 1);
  assert.match(map.lib("page").render(), /#home-screen\{display:grid;\}/);
  assert.doesNotMatch(css.snapshot(), /opening/);
  css.stylesheet("");
  assert.equal(css.snapshot(), "");
  assert.equal(map.rev, start + 2);
  assert.equal(commits.length, 2);
  for (const empty of ["", " \n ", "/* only a comment */"]) {
    css.stylesheet(empty);
    assert.equal(map.rev, start + 2);
    assert.equal(commits.length, 2);
  }
}

{
  const map = create();
  const css = map.lib("page").css;
  const first = `
    main { color: red; }
    :root { --tone: red; }
    @property --tone { syntax: "<color>"; inherits: false; initial-value: red; }
    @keyframes pulse { from { opacity: 0; } to { opacity: 1; } }
  `;
  const second = `
    @keyframes pulse { from { opacity: .2; } to { opacity: .8; } }
    main { color: green; }
    @property --tone { syntax: "<color>"; inherits: false; initial-value: blue; }
    :root { --tone: blue; }
    main { color: blue; }
  `;
  const commits: Parameters<typeof map.replay>[0][] = [];
  map.commits.observe((commit) => commits.push(commit));
  css.stylesheet(first);
  const before = map.rev;
  css.stylesheet(second);
  const state = map.capture().libraries[0]?.css;
  assert.deepEqual(state, parse_document_stylesheet(second, []));
  assert.deepEqual(state?.order.map((entry) => entry.kind), ["keyframes", "rule", "property", "rule", "rule"]);
  assert.deepEqual(state?.rules.map((rule) => rule.selector), ["main", ":root", "main"]);
  assert.deepEqual(state?.rules.map((rule) => rule.ruleKey), ["stylesheet:1", "stylesheet:2", "stylesheet:3"]);
  assert.equal(state?.properties[0]?.init, "blue");
  assert.equal(state?.keyframes[0]?.steps[0]?.declarations[0]?.[1], ".2");
  assert.doesNotMatch(css.snapshot(), /color:red|--tone:red|initial-value:red|opacity: 0/);
  assert.equal(map.rev, before + 1);
  const replacement = commits.at(-1)?.operations[0]?.operation;
  assert.ok(replacement && "domain" in replacement && replacement.domain === "css");
  assert.equal(replacement.kind, "replace");
  const replayed = create();
  for (const commit of commits) replayed.replay(commit);
  assert.deepEqual(replayed.capture().libraries[0]?.css, state);
  css.stylesheet(second);
  assert.equal(map.rev, before + 1);
  assert.equal(commits.length, 2);
}

{
  const map = create();
  const commits: Parameters<typeof map.replay>[0][] = [];
  map.commits.observe((commit) => commits.push(commit));
  map.lib("page").css.stylesheet("main { color: red; }");
  map.batch((draft) => { draft.lib("page").css({
    domain: "css", kind: "append", stylesheet: parse_document_stylesheet("main { color: blue; }", ["stylesheet:1"]),
  }); });
  const state = map.capture().libraries[0]?.css;
  assert.deepEqual(state?.rules.map((rule) => rule.ruleKey), ["stylesheet:1", "stylesheet:2"]);
  const appended = commits.at(-1)?.operations[0]?.operation;
  assert.ok(appended && "domain" in appended && appended.domain === "css");
  assert.equal(appended.kind, "append");
  const replayed = create();
  for (const commit of commits) replayed.replay(commit);
  assert.deepEqual(replayed.capture().libraries[0]?.css, state);
}

{
  const map = create();
  const css = map.lib("page").css;
  css.stylesheet(".foo { color: red; } .foo { color: blue; }");
  assert.deepEqual(css.list(), ["stylesheet:1", "stylesheet:2"]);
  assert.match(css.get("stylesheet:2") ?? "", /color:blue/);
  assert.throws(() => css.rule("stylesheet:2", ".collision"), /reserved/);
  css.rule("structured", ".structured").set.color("green");
  css.stylesheet(".last { color: black; }");
  const snapshot = css.snapshot();
  assert.match(snapshot, /\.last\{color:black;\}/);
  assert.doesNotMatch(snapshot, /\.foo|\.structured/);
  assert.deepEqual(css.list(), ["stylesheet:1"]);
  const captured = map.capture();
  const restored = install_libraries_snapshot(captured);
  const restoredPage = restored.map.lib("page");
  assert.equal(restoredPage.mode, "document");
  if (restoredPage.mode === "document") assert.equal(restoredPage.css.snapshot(), snapshot);
  assert.deepEqual(restored.map.capture().libraries[0]?.css, captured.libraries[0]?.css);
  const fresh = create();
  const replayCommits: Parameters<typeof fresh.replay>[0][] = [];
  const producer = create();
  producer.commits.observe((commit) => replayCommits.push(commit));
  producer.lib("page").css.stylesheet(".foo { color: red; } .foo { color: blue; }");
  producer.lib("page").css.rule("structured", ".structured").set.color("green");
  producer.lib("page").css.stylesheet(".last { color: black; }");
  const replacement = replayCommits.at(-1)?.operations[0]?.operation;
  assert.ok(replacement && "domain" in replacement && replacement.domain === "css");
  assert.equal(replacement.kind, "replace");
  for (const commit of replayCommits) fresh.replay(commit);
  assert.equal(fresh.lib("page").css.snapshot(), snapshot);
  assert.doesNotMatch(fresh.lib("page").render(), /\.foo|\.structured/);
  css.drop("stylesheet:1");
  assert.equal(css.snapshot(), "");
  css.clearAll();
  assert.equal(css.snapshot(), "");
  assert.deepEqual(css.list(), []);
}

{
  const map = create();
  const css = map.lib("page").css;
  const commits: unknown[] = [];
  map.commits.observe((commit) => commits.push(commit));
  css.stylesheet("main { color: blue; }");
  const before = css.snapshot();
  const rev = map.rev;
  for (const source of [
    ".ok { color: red; } @import url(https://example.test/a.css); .later { color: blue; }",
    ".ok { color: red; } .broken { color: blue; ",
    ".ok { color: red; } ??? { color: blue; } .later { color: green; }",
    ".ok { color: red; color: blue; }",
    '.ok { content: "</style>"; }',
  ]) {
    assert.throws(() => css.stylesheet(source), (error: unknown) =>
      error instanceof DocumentStylesheetError && typeof error.code === "string" && error.offset >= 0 && !!error.construct);
    assert.equal(map.rev, rev);
    assert.equal(css.snapshot(), before);
    assert.equal(commits.length, 1);
  }
}

{
  const map = create();
  const css = map.lib("page").css;
  const commits: Parameters<typeof map.replay>[0][] = [];
  map.commits.observe((commit) => commits.push(commit));
  css.stylesheet(`
    @media (max-width: 600px) { @supports (display: grid) { @layer components { .card { display: grid; } } } }
    @property --phase { syntax: "<number>"; inherits: false; initial-value: 0; }
    .card { --label: "a;b}"; width: calc(100% - var(--gap, 2px)); color: red !important; background-image: url("data:image/svg+xml,a;b"); }
    @keyframes fade { from { opacity: 0; } 50% { opacity: .5; } to { opacity: 1; } }
  `);
  const capture = map.capture();
  const state = capture.libraries[0]?.css;
  assert.deepEqual(state?.order.map((entry) => entry.kind), ["rule", "property", "rule", "keyframes"]);
  assert.deepEqual(state?.rules[0]?.scopes, ["@media (max-width:600px)", "@supports (display:grid)", "@layer components"]);
  assert.equal(state?.properties[0]?.name, "--phase");
  assert.equal(state?.keyframes[0]?.name, "fade");
  const snapshot = css.snapshot();
  assert.equal(commits.length, 1);
  const replayed = create();
  replayed.replay(commits[0]!);
  assert.deepEqual(replayed.capture().libraries[0]?.css, state);
  assert.equal(replayed.lib("page").css.snapshot(), snapshot);
  assert.match(snapshot, /color:red !important/);
  assert.match(snapshot, /content|--label:"a;b}"/);
  assert.match(snapshot, /data:image\/svg\+xml,a;b/);
  assert.match(snapshot, /@keyframes fade/);
  css.stylesheet('body/**/.commented { color: red /* insignificant */; --joined: 1/* separator */2; }');
  assert.match(css.snapshot(), /body\.commented\{color:red;--joined:1 2;\}/);
  assert.doesNotMatch(css.snapshot(), /insignificant|separator/);
  map.restore(capture);
  assert.equal(css.snapshot(), snapshot);
  const installedPage = install_libraries_snapshot(capture).map.lib("page");
  assert.equal(installedPage.mode, "document");
  if (installedPage.mode === "document") assert.equal(installedPage.css.snapshot(), snapshot);
  css.clearAll();
  assert.equal(css.snapshot(), "");
  assert.deepEqual(map.capture().libraries[0]?.css, { rules: [], properties: [], keyframes: [], order: [] });
}

{
  const map = create();
  const css = map.lib("page").css;
  css.stylesheet(".cascade { margin-left: 5px; margin: 0; content: var(--message); } @keyframes cascade { from { padding-left: 5px; padding: 0; } }");
  const snapshot = css.snapshot();
  assert.match(snapshot, /margin-left:5px;margin:0;/);
  assert.match(snapshot, /content:var\(--message\);/);
  assert.match(snapshot, /padding-left: 5px;\s+padding: 0;/);
  const installed = install_libraries_snapshot(map.capture()).map.lib("page");
  assert.equal(installed.mode, "document");
  if (installed.mode === "document") assert.equal(installed.css.snapshot(), snapshot);
}

console.log("LiveMap stylesheet text ingress acceptance passed.");
