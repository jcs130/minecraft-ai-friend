// Checks the Linux native modules and renderer files without joining a world.
const {createRequire} = require('node:module');
const fs = require('node:fs');
const requireApp = createRequire('/app/package.json');
for (const name of ['mineflayer', 'minecraft-protocol', 'socket.io', 'pngjs', 'tsx', 'gl']) requireApp.resolve(name);
const Database = requireApp('better-sqlite3');
const db = new Database(':memory:');
if (db.prepare('select 42 as value').get().value !== 42) throw new Error('SQLite probe failed');
db.close();
const {createCanvas} = requireApp('canvas');
if (createCanvas(2, 2).toBuffer('image/png').length < 20) throw new Error('Canvas probe failed');
requireApp('gl'); // Load the Linux binding without creating a display.
for (const file of ['modern-viewer.js', 'minecraft-renderer.js', 'threeWorker.js', 'mesherWasm.js', 'wasm_mesher_bg.wasm', 'runtime-budget.js']) {
  if (fs.statSync('/app/modern-viewer/' + file).size === 0) throw new Error('Empty renderer asset: ' + file);
}
const viewer = requireApp.resolve('prismarine-viewer/package.json');
for (const file of ['public/worker.js', 'public/textures/1.21.1.png', 'public/blocksStates/1.21.1.json']) {
  if (fs.statSync(require('node:path').join(require('node:path').dirname(viewer), file)).size === 0) throw new Error('Missing vanilla renderer data');
}
console.log(JSON.stringify({ok: true, node: process.version, platform: process.platform, sqlite: true, canvas: true, glBinding: true, rendererFiles: true}));
