import assert from "node:assert/strict";
import { hsonLiveMap, install_libraries_snapshot } from "../src/api/livemap/index.ts";
import { opaque_document_stylesheet } from "../src/internal/css/opaque-stylesheet.ts";
const document='<html <head/> <body <main/>/>/>';
const map=hsonLiveMap.fromLibraries({page:{document}}), page=map.doc.must('page');
const commits: Parameters<typeof map.replay>[0][]=[];map.commits.observe(commit=>commits.push(commit));
for(const source of ['/* opening */ main { color:red; color:blue; & > i {display:grid} }', '@import "x"; @font-face{font-family:x;src:url(x)}', '.bad {', '', ' \n ', '/* only a comment */']) {
  const rev=map.rev;page.css.stylesheet(source);assert.equal(map.rev,rev+1);
  assert.equal(page.css.snapshot(),source);assert.deepEqual(map.capture().libraries[0]!.css,opaque_document_stylesheet(source));
  assert.equal((page.render().match(/data-hson-managed-document-css/g)??[]).length,1);
  page.css.stylesheet(source);assert.equal(map.rev,rev+1);
}
page.css.rule('structured','.structured').set.color('green');
const raw=page.css.snapshot();page.css.drop('stylesheet:1');assert.equal(page.css.snapshot(),raw);
page.css.drop('structured');assert.equal(page.css.snapshot(),'/* only a comment */');
page.css.stylesheet('.last { color: black; }');assert.deepEqual(page.css.list(),[]);
assert.equal(install_libraries_snapshot(map.capture()).map.doc.must('page').css.snapshot(),page.css.snapshot());
const replay=hsonLiveMap.fromLibraries({page:{document}});for(const commit of commits)replay.replay(commit);
assert.deepEqual(replay.capture(),map.capture());
page.css.clearAll();assert.equal(page.css.snapshot(),'');assert.deepEqual(map.capture().libraries[0]!.css!.order,[]);
console.log('Opaque stylesheet ingress passed.');
