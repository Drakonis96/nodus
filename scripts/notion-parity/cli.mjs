#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const inline = process.argv.find((value) => value.startsWith('--loop='));
const loopValue = inline?.slice('--loop='.length) ?? '0';
const forwarded = process.argv.slice(2).filter((value) => !value.startsWith('--loop='));
const loops = loopValue === 'all' ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19] : [Number(loopValue)];

for (const loop of loops) {
  const script = loop === 0 ? 'run.mjs' : loop === 1 ? 'verify-loop-01.mjs' : loop === 2 ? 'verify-loop-02.mjs' : loop === 3 ? 'verify-loop-03.mjs' : loop === 4 ? 'verify-loop-04.mjs' : loop === 5 ? 'verify-loop-05.mjs' : loop === 6 ? 'verify-loop-06.mjs' : loop === 7 ? 'verify-loop-07.mjs' : loop === 8 ? 'verify-loop-08.mjs' : loop === 9 ? 'verify-loop-09.mjs' : loop === 10 ? 'verify-loop-10.mjs' : loop === 11 ? 'verify-loop-11.mjs' : loop === 12 ? 'verify-loop-12.mjs' : loop === 13 ? 'verify-loop-13.mjs' : loop === 14 ? 'verify-loop-14.mjs' : loop === 15 ? 'verify-loop-15.mjs' : loop === 16 ? 'verify-loop-16.mjs' : loop === 17 ? 'verify-loop-17.mjs' : loop === 18 ? 'verify-loop-18.mjs' : loop === 19 ? 'verify-loop-19.mjs' : null;
  if (!script) throw new Error(`Bucle QA no disponible: ${loop}.`);
  execFileSync(process.execPath, [path.join(directory, script), ...forwarded], { stdio: 'inherit' });
}
