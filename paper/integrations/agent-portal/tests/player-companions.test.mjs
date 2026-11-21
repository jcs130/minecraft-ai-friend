import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {PlayerCompanions} from '../src/player-companions.mjs';

test('authored companion profiles are independent, revisioned and attributed by UUID', () => {
  const db = new DatabaseSync(':memory:');
  const playerId = randomUUID(), maidId = randomUUID(), bystander = randomUUID();
  let now = 100_000;
  const profiles = new PlayerCompanions({
    db, ownedUuids:id => id === 'owner' ? [playerId] : [bystander],
    audit() {},
    transaction(fn) {
      db.exec('BEGIN IMMEDIATE');
      try { const result = fn(); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  }, () => now);
  const owner = {id:'owner'}, other = {id:'other'};
  const body = {ownerId:playerId,maidId,name:'小灯',profileRevision:0,loaded:true,active:true,level:4};
  const edit = {name:'灯伙伴',persona:'喜欢探索\n说话简短',expectedRevision:0};
  try {
    assert.deepEqual(profiles.list(owner),[]);
    assert.deepEqual(profiles.poll({guides:[body]}).profiles,[]);
    assert.throws(() => profiles.update(other,playerId,edit),{reason:'COMPANION_NOT_FOUND'});
    const saved = profiles.update(owner,playerId,edit);
    assert.equal(saved.actualName,'小灯');
    assert.equal(saved.persona,'喜欢探索 说话简短');
    assert.equal(saved.revision,1);
    assert.equal(saved.appliedRevision,0);
    assert.throws(() => profiles.update(owner,playerId,edit),{reason:'COMPANION_PROFILE_CHANGED'});
    assert.equal(profiles.poll({guides:[body]}).profiles[0].maidId, maidId);
    assert.throws(() => profiles.poll({guides:[{...body,maidId:randomUUID()}]}),{reason:'COMPANION_BODY_CHANGED'});
    profiles.poll({guides:[{...body,name:saved.name,profileRevision:1}]});
    assert.equal(profiles.list(owner)[0].actualName,saved.name);
    assert.equal(profiles.list(owner)[0].appliedRevision,1);
    assert.deepEqual(profiles.list(other),[]);
    now += 36_000;
    const [offline] = profiles.list(owner);
    assert.equal(offline.online,false);
    assert.equal(offline.active,false);
    assert.equal(offline.level,4);
    profiles.poll({guides:[{...body,name:'恢复后的伙伴',profileRevision:5}]});
    assert.equal(profiles.list(owner)[0].revision,5);
    assert.equal(profiles.list(owner)[0].name,'恢复后的伙伴');
    assert.equal(profiles.list(owner)[0].persona,'');
    const updated = profiles.update(owner,playerId,{...edit,expectedRevision:5});
    assert.equal(updated.revision,6);
  } finally { db.close(); }
});
