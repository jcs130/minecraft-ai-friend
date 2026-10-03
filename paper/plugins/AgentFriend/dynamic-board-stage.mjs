import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const stage = 'E:/MC/staging/life-buildings-20261003';
const rcon = command => execFileSync('node', [`${stage}/rcon-stage.mjs`, command], {
  encoding: 'utf8', timeout: 15000,
});
const list = () => {
  const result = rcon('mycli admin board list');
  const cards = [...result.matchAll(/^([1-5]) (db_\S+) (.+) x(\d+)$/gm)]
    .map(match => ({ slot: Number(match[1]), id: match[2], title: match[3], target: Number(match[4]) }));
  return { result, cards };
};
const signatures = cards => cards.map(card => card.id.slice(card.id.indexOf('_', 3) + 1));
const disjoint = (a, b) => assert.equal(signatures(a).filter(id => signatures(b).includes(id)).length, 0);

const first = list();
assert.match(first.result, /revision=\d+/);
assert.ok(first.cards.length >= 3 && first.cards.length <= 5);
rcon('mycli admin board regenerate');
const second = list();
assert.ok(second.cards.length >= 3 && second.cards.length <= 5);
disjoint(first.cards, second.cards);
rcon('mycli admin board regenerate');
const third = list();
assert.ok(third.cards.length >= 3 && third.cards.length <= 5);
disjoint(second.cards, third.cards);

// Stage-only chest fixture. Each public double chest has two block entities.
rcon('forceload add -473 -491');
rcon('data merge block -473 67 -491 {Items:[]}');
rcon('data merge block -472 67 -491 {Items:[]}');
rcon('mycli admin board clear');
rcon('mycli admin board regenerate');
const lowStock = list();
assert.ok(lowStock.cards.some(card => card.id.endsWith('supply_torches') && card.target === 16),
  `low-stock torches absent: ${lowStock.result}`);
assert.ok(lowStock.cards.some(card => card.id.endsWith('supply_bread') && card.target === 12),
  `low-stock bread absent: ${lowStock.result}`);

const configPath = `${stage}/plugins/AgentFriend/dynamic-board.yml`;
const original = readFileSync(configPath, 'utf8');
try {
  writeFileSync(configPath, original.replace('cards-per-day: 4', 'cards-per-day: 5'));
  assert.match(rcon('mycli admin board reload'), /已热加载/);
  assert.equal(list().cards.length, lowStock.cards.length, 'reload does not silently replace today');
  assert.match(rcon('mycli admin board replace 1 wheat_day'), /已更新/);
  assert.ok(list().cards[0].id.endsWith('wheat_day'));
  rcon('mycli admin board add honey_day');
  assert.ok(list().cards.some(card => card.id.endsWith('honey_day')));
  rcon('mycli admin board remove 5');
  assert.equal(list().cards.length, 4);
  const beforeInvalid = list().result;
  writeFileSync(configPath, original.replace('cards-per-day: 4', 'cards-per-day: 9'));
  assert.match(rcon('mycli admin board reload'), /校验失败/);
  assert.equal(list().result, beforeInvalid, 'invalid reload keeps the published board');
} finally {
  writeFileSync(configPath, original);
  assert.match(rcon('mycli admin board reload'), /已热加载/);
}

console.log(JSON.stringify({ pass: true, generated: [first.cards, second.cards, third.cards],
  lowStock: lowStock.cards, final: list().cards }));
