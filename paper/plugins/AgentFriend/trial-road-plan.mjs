// Generate the reviewable centerline blueprint and evaluate it against a stage terrain survey.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const base = fileURLToPath(new URL('.', import.meta.url));
const surveyPath = process.argv[2] ?? 'E:/MC/staging/arena-dungeon-20260928/plugins/AgentFriend/trial-road-survey.tsv';
const survey = new Map(readFileSync(surveyPath, 'utf8').trim().split(/\r?\n/).slice(1).map((line) => {
  const [x, z, groundY, ground, topY, top, vegetation] = line.split('\t');
  return [`${x},${z}`, { x: Number(x), z: Number(z), groundY: Number(groundY), ground,
    topY: Number(topY), top, vegetation: Number(vegetation) }];
}));
const points = [];
const add = (x, z, y) => {
  const previous = points.at(-1);
  if (previous && Math.abs(previous.x - x) + Math.abs(previous.z - z) !== 1)
    throw new Error(`nonadjacent route at ${x},${z}`);
  if (previous && Math.abs(previous.y - y) > 1) throw new Error(`steep route at ${x},${z}`);
  points.push({ x, z, y });
};
for (let z = -411; z <= -386; z++) add(-570, z, 63 + Math.floor((z + 411) / 25));
for (let x = -571; x >= -575; x--) add(x, -386, 64);
for (let z = -385; z <= -357; z++) add(-575, z, 64 + Math.floor((z + 386) / 29));
for (let x = -576; x >= -590; x--) add(x, -357, 65 + Math.floor((-x - 575) * 5 / 15));
for (let z = -356; z <= -329; z++) add(-590, z, 70 + Math.floor((z + 357) * 20 / 28));

const deck = new Map();
for (const point of points) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
  const x = point.x + dx, z = point.z + dz;
  if (z >= -328) continue; // Do not overwrite the original arena bridge.
  const key = `${x},${z}`;
  deck.set(key, Math.max(deck.get(key) ?? -Infinity, point.y));
}
const natural = new Set(['GRASS_BLOCK', 'DIRT', 'DIRT_PATH', 'COARSE_DIRT', 'PODZOL',
  'TUFF', 'STONE', 'GRAVEL', 'WATER', 'SAND', 'CLAY', 'DIORITE', 'ANDESITE',
  'GRANITE', 'MOSS_BLOCK', 'DEEPSLATE_COAL_ORE']);
const problems = [];
let water = 0, exposed = 0, maxGap = 0;
for (const [key, y] of deck) {
  const cell = survey.get(key);
  if (!cell) { problems.push(`${key} outside survey`); continue; }
  if (!natural.has(cell.ground)) problems.push(`${key} existing ${cell.ground}@${cell.groundY}, deck ${y}`);
  if (cell.groundY > y) problems.push(`${key} ground ${cell.groundY} above deck ${y}`);
  if (cell.ground === 'WATER') water++;
  if (cell.groundY < y - 2) exposed++;
  maxGap = Math.max(maxGap, y - cell.groundY);
}
const text = ['x\tz\tfloorY', ...points.map(({ x, z, y }) => `${x}\t${z}\t${y}`), ''].join('\n');
writeFileSync(new URL('resources/trial-road.tsv', import.meta.url), text, 'utf8');
console.log(JSON.stringify({ points: points.length, deckBlocks: deck.size, water, exposed,
  maxGap, start: points[0], end: points.at(-1), problems: problems.slice(0, 80), problemCount: problems.length }, null, 2));
