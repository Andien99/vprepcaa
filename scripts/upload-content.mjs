// Uploads the question images and solution bundles written by import-bank.mjs to the
// private R2 bucket (binding CONTENT).
//
//   node scripts/upload-content.mjs                              # local R2 for wrangler dev (fast, in-process)
//   node scripts/upload-content.mjs --persist-to <dir>           # local R2 in another wrangler state folder
//   node scripts/upload-content.mjs --remote                     # production bucket vprepcaa-content
//   node scripts/upload-content.mjs --remote --bucket vprepcaa-content-preview
//
// Remote uploads are resumable: keys already uploaded are listed in
// content/import/uploaded-<bucket>.json and skipped next time.
import { execFile } from 'node:child_process';
import { readdirSync, statSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const argv = process.argv.slice(2);
const arg = (/** @type {string} */ name) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
};
const remote = argv.includes('--remote');
const bucket = arg('--bucket') ?? 'vprepcaa-content';
const root = join('content', 'r2');
if (!existsSync(root)) {
  console.error('No content/r2 folder. Run scripts/import-bank.mjs first.');
  process.exit(1);
}

/** @returns {string[]} */
const walk = (/** @type {string} */ dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
const files = walk(root);
const keyOf = (/** @type {string} */ f) => relative(root, f).split(sep).join('/');
const typeOf = (/** @type {string} */ f) => (f.endsWith('.png') ? 'image/png' : 'application/json');

if (!remote) {
  // Local: write straight into wrangler's local R2 through the platform proxy.
  const { getPlatformProxy } = await import('wrangler');
  const persist = arg('--persist-to');
  const proxy = await getPlatformProxy(persist ? { persist: { path: join(persist, 'v3') } } : {});
  const r2 = /** @type {any} */ (proxy.env).CONTENT;
  let n = 0;
  for (const f of files) {
    await r2.put(keyOf(f), readFileSync(f), { httpMetadata: { contentType: typeOf(f) } });
    if (++n % 200 === 0) console.log(`  ${n} uploaded`);
  }
  await proxy.dispose();
  console.log(`Done: ${n} files in local R2.`);
  process.exit(0);
}

const doneFile = join('content', 'import', `uploaded-${bucket}.json`);
const done = new Set(existsSync(doneFile) ? JSON.parse(readFileSync(doneFile, 'utf8')) : []);
const todo = files.filter((f) => !done.has(keyOf(f)));
console.log(`${files.length} files, ${todo.length} to upload to ${bucket}`);

let n = 0;
let failed = 0;
const save = () => writeFileSync(doneFile, JSON.stringify([...done]));
async function worker() {
  for (;;) {
    const file = todo.shift();
    if (!file) return;
    const key = keyOf(file);
    try {
      await run('npx', ['wrangler', 'r2', 'object', 'put', `${bucket}/${key}`, '--file', file, '--content-type', typeOf(file), '--remote'], { shell: process.platform === 'win32' });
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
