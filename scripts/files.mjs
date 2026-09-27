import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const source = resolve(root, 'site');
export const output = resolve(root, 'dist');
export const files = JSON.parse(await readFile(resolve(root, 'site-files.json'), 'utf8'));
assert.equal(new Set(files).size, files.length, 'Duplicate site file');
for (const file of files) {
  assert(typeof file === 'string' && file.length > 0 && !file.includes('\\') &&
    file.split('/').every(part => part && part !== '.' && part !== '..') &&
    !file.startsWith('/'), `Invalid site file: ${file}`);
}
