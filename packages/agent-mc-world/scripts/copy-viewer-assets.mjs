import { readdir, mkdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';

/** npm may select an omitted alias as a tar hard-link target. Every shipped asset needs its own file. */
export async function copyViewerAssets(source, target) {
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.isDirectory()) await copyViewerAssets(join(source, entry.name), join(target, entry.name));
    else if (entry.isFile()) await copyFile(join(source, entry.name), join(target, entry.name));
    else throw new Error('Unexpected non-file viewer build input: ' + entry.name);
  }
}
