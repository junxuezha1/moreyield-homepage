import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { files, source } from './files.mjs';

async function list(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) result.push(...await list(resolve(directory, entry.name), `${prefix}${entry.name}/`));
    else {
      assert(entry.isFile(), `Only regular files allowed: ${prefix}${entry.name}`);
      result.push(prefix + entry.name);
    }
  }
  return result;
}
assert.deepEqual((await list(source)).sort(), [...files].sort(), 'Update site-files.json to match site/');
const known = new Set(files);
const failures = [];
let references = 0;
function checkReference(from, value) {
  if (!value || /^(?:#|data:|mailto:|tel:|https?:|\/\/)/i.test(value)) return;
  const url = new URL(value.replaceAll('&amp;', '&'), `https://site.invalid/${from}`);
  const path = decodeURIComponent(url.pathname.slice(1));
  if (!path || path.endsWith('/')) {
    if (known.has(path + 'index.html')) { references++; return; }
  }
  if (!known.has(path) && !known.has(path + '.html')) failures.push(`${from} -> ${value}`);
  references++;
}
for (const path of files) {
  const bytes = await readFile(resolve(source, path));
  assert(bytes.length < 25 * 1024 * 1024, `Cloudflare Pages file limit exceeded: ${path}`);
  if (!['.html', '.css', '.js', '.json'].includes(extname(path))) continue;
  const text = bytes.toString();
  assert(!/\/(?:Users|private\/var|var\/folders)\//.test(text), `Local filesystem path in ${path}`);
  if (path.endsWith('.html')) {
    for (const match of text.matchAll(/\b(?:src|href|poster)\s*=\s*["']([^"']+)["']/g)) checkReference(path, match[1]);
  }
  if (path.endsWith('.css')) {
    for (const match of text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]+))\s*\)/g)) checkReference(path, match[1] ?? match[2] ?? match[3]);
  }
  if (path.endsWith('.js') && !path.startsWith('world/vendor/')) {
    for (const match of text.matchAll(/(?:from\s*|import\s*)["'](\.[^"']+)["']/g)) checkReference(path, match[1]);
  }
}
assert.deepEqual(failures, [], 'Missing local website references');
console.log(`Checked ${files.length} site files and ${references} local references.`);
