import { cut5_reentrant_mutation_cases } from "./fixtures/cut5-graft-reentrancy-cases.mts";
// @hson-live-external-test
import assert from 'node:assert/strict';
import { install_fake_document } from './helpers/fake-document.mts';
import { cut5_repair_cases, cut5_nonfatal_reporting_cases } from './fixtures/cut5-repair-cases.mts';
import { create_test_event_emitter } from './test-events.mjs';
import { repository_typescript_worker } from './helpers/repository-typescript-worker.mts';
export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livetree.cut5-repairs",
  title: "Cut 5 publication and rollback repairs",
  category: "LiveTree",
  runtime: "node-synthetic-dom",
  tags: Object.freeze(["fault-injection", "ownership", "mirror", "worker", "externally-discoverable"]),
});
const events = create_test_event_emitter('livetree.cut5-repairs');
install_fake_document();
let cases = 0;
const failures: string[] = [];
cut5_repair_cases((name, run) => { events.case_begin(name, name); try {
    run();
    cases++;
    events.case_end(name, 'pass');
    console.log('ok - ' + name);
}
catch (cause) {
    events.case_end(name, 'fail');
    failures.push(name);
    console.error('FAIL - ' + name, cause);
} });
cases += cut5_reentrant_mutation_cases((name, run) => {
  events.case_begin(name, name);
  try { run(); events.case_end(name, 'pass'); }
  catch (cause) { failures.push(name); events.case_end(name, 'fail'); console.error(name, cause); }
});
if (failures.length) events.terminal('fail');
assert.deepEqual(failures, []);
events.case_begin('nonfatal-reporting', 'Ordinary host survives unavailable or failing reporters');
cases += await cut5_nonfatal_reporting_cases();
events.case_end('nonfatal-reporting', 'pass');
const worker = repository_typescript_worker(new URL('./fixtures/cut5-repairs.worker.mts', import.meta.url));
const result = await new Promise((resolve, reject) => {
    let message: unknown;
    worker.once('message', value => { message = value; });
    worker.once('error', reject);
    worker.once('exit', code => code === 0 ? resolve(message) : reject(new Error('Worker exit ' + code)));
});
assert.deepEqual(result, { cases });
events.terminal('pass');
console.log(`Cut 5 repairs passed (${cases} Node and ${cases} actual Worker cases).`);
