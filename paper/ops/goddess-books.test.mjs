import assert from 'node:assert/strict';
import test from 'node:test';
import { namesFromList, run } from './goddess-act.mjs';

test('mending book uses transferable enchantments and an auditable dry run', async () => {
  const result = await run(['mendingbook', 'BookAudit']);
  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.deepEqual(result.commands, [
    'mycli admin gift <request16> BookAudit gift:mending_book 1 <recipe-hash>',
  ]);
});

test('online target lookup uses account names behind rank and Agent nameplates', () => {
  assert.deepEqual(namesFromList('There are 3 of a max of 40 players online: Goddess (b2f9ceb0-8271-3470-b99f-e1c3ffe4edbd), ◆钻石 [Agent] CortiLan (ccba3629-1f58-33d2-bd0c-f7ba6e699816), ◆青铜 .BedrockGuest (11111111-1111-1111-1111-111111111111)'),
    ['Goddess', 'CortiLan', '.BedrockGuest']);
  assert.deepEqual(namesFromList('There are 0 of a max of 40 players online:'), []);
  assert.deepEqual(namesFromList('unexpected response'), []);
});
