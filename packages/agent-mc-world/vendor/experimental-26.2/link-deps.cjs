#!/usr/bin/env node
/** Create node_modules symlinks from the official AMW install into the vendor 26.2 tree. */
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const vendorRoot = __dirname;
const amwRoot = path.join(__dirname, '../..');
const amwRequire = createRequire(path.join(amwRoot, 'package.json'));

function linkDeps(pkgDir, officialName, skip) {
  const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  const officialRequire = officialName
    ? createRequire(amwRequire.resolve(officialName + '/package.json'))
    : amwRequire;
  const nm = path.join(pkgDir, 'node_modules');
  fs.mkdirSync(nm, { recursive: true });
  const deps = { ...(pkg.dependencies || {}), ...(pkg.peerDependencies || {}) };
  for (const dep of Object.keys(deps)) {
    if (skip.has(dep)) continue;
    const dest = path.join(nm, dep);
    if (fs.existsSync(dest) || fs.lstatSync(dest, { throwIfNoEntry: false })?.isSymbolicLink()) continue;
    let target;
    try { target = path.dirname(officialRequire.resolve(dep + '/package.json')); }
    catch {
      try { target = path.dirname(amwRequire.resolve(dep + '/package.json')); }
      catch {
        console.warn('missing dependency', path.basename(pkgDir), dep);
        continue;
      }
    }
    if (!fs.existsSync(target)) {
      console.warn('missing target', dep, target);
      continue;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.symlinkSync(target, dest, 'dir');
    console.log('link', path.relative(amwRoot, dest), '->', path.relative(amwRoot, target));
  }
}

const mineflayerPkg = amwRequire.resolve('mineflayer/package.json');
const mineflayerRequire = createRequire(mineflayerPkg);
linkDeps(path.join(vendorRoot, 'minecraft-protocol'), 'mineflayer', new Set(['minecraft-data']));
linkDeps(path.join(vendorRoot, 'mineflayer'), 'mineflayer', new Set(['minecraft-data', 'minecraft-protocol']));

