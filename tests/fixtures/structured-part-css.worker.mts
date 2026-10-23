import { parentPort } from 'node:worker_threads';
import { structured_css_cases } from './structured-part-css-cases.mts';
let count=0;await structured_css_cases(async(_name,run)=>{await run();count++;});parentPort!.postMessage(count);
