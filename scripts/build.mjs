import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { files, source, output } from './files.mjs';
import './check.mjs';

await rm(output, { recursive: true, force: true });
for (const file of files) {
  const target = resolve(output, file);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(resolve(source, file), target);
}
console.log(`Built ${files.length} files in dist/.`);
