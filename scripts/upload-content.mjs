// Uploads the question images and solution bundles written by import-bank.mjs to the
// private R2 bucket. Resumable: keys already uploaded are listed in
// content/import/uploaded-<target>.json and skipped next time.
//
//   node scripts/upload-content.mjs            # local R2 (wrangler dev)
//   node scripts/upload-content.mjs --remote   # production bucket vprepcaa-content
//   node scripts/upload-content.mjs --remote --bucket vprepcaa-content-preview
import { execFile } from 'node:child_process';
import { readdirSync, statSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const argv = process.argv.slice(2);
const remote = argv.includes('--remote');
const bi = argv.indexOf('--bucket');
const bucket = bi >= 0 && argv[bi + 1] ? argv[bi + 1] : 'vprepcaa-content';
const root = join('content', 'r2');
if (!existsSync(root)) {
  console.error('No content/r2 folder. Run scripts/import-bank.mjs first.');
  process.exit(1);
}

/** @returns {string[]} */
const walk = (/** @type {string} */ dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
const files = walk(root);
const doneFile = join('content', 'import', `uploaded-${remote ? bucket : 'local'}.json`);
const done = new Set(existsSync(doneFile) ? JSON.parse(readFileSync(doneFile, 'utf8')) : []);
const todo = files.filter((f) => !done.has(relative(root, f).split(sep).join('/')));
console.log(`${files.length} files, ${todo.length} to upload to ${remote ? bucket : 'local R2'}`);

let n = 0;
let failed = 0;
const save = () => writeFileSync(doneFile, JSON.stringify([...done]));
async function worker() {
  for (;;) {
    const file = todo.shift();
    if (!file) return;
    const key = relative(root, file).split(sep).join('/');
    const type = file.endsWith('.png') ? 'image/png' : 'application/json';
    try {
      await run('npx', ['wrangler', 'r2', 'object', 'put', `${bucket}/${key}`, '--file', file, '--content-type', type, remote ? '--remote' : '--local'], { shell: process.platform === 'win32' });
      done.add(key);
      if (++n % 25 === 0) {
        save();
        console.log(`  ${n} uploaded`);
      }
    } catch (e) {
      failed++;
      console.error(`  failed ${key}: ${String(/** @type {any} */ (e)?.stderr ?? e).split('\n')[0]}`);
    }
  }
}
await Promise.all(Array.from({ length: 4 }, worker));
save();
console.log(`Done: ${n} uploaded, ${failed} failed${failed ? ' (run again to retry)' : ''}.`);
