import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes} from 'node:crypto';
import {portalHostingAuthority} from '../src/portal-authority.mjs';
import {verifyGrant} from '../src/protocol.mjs';
const role='00000000-0000-0000-0000-000000000001',creator='00000000-0000-0000-0000-000000000002';
function fixture(t){
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  db.exec('CREATE TABLE ownerships(agent_uuid TEXT PRIMARY KEY,owner_id TEXT); CREATE TABLE numen_creator_relations(player_uuid TEXT PRIMARY KEY,name TEXT,creator_uuid TEXT,state TEXT,last_seen INTEGER);');
  const bind=db.prepare('INSERT INTO ownerships VALUES(?,?)');bind.run(role,'owner');bind.run(creator,'owner');
  db.prepare('INSERT INTO numen_creator_relations VALUES(?,?,?,?,?)').run(role,'HostedTest',creator,'bound',100000);
  const grantKey=randomBytes(32);return{db,grantKey,authority:portalHostingAuthority({store:{db},serverId:'test',grantKey,now:()=>100000})};
}
test('website resolves original UUID and native owner from existing tables',t=>{
  const f=fixture(t),grant=verifyGrant(f.authority.issue('owner',role),f.grantKey,100001);
  assert.equal(grant.role.roleUuid,role);assert.equal(grant.role.numenOwnerUuid,creator);assert.equal(grant.role.name,'HostedTest');
  assert.throws(()=>f.authority.issue('other-owner',role),{code:'ROLE_NOT_OWNED'});
});
test('unadmitted ordinary roles never create a same-name replacement',t=>{
  const f=fixture(t);f.db.exec('DELETE FROM numen_creator_relations');
  assert.throws(()=>f.authority.issue('owner',role),{code:'NUMEN_BODY_NOT_ADMITTED'});
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM ownerships').get().n,2);
});
test('stale evidence and owner changes block new grants',t=>{
  const f=fixture(t);f.db.exec('UPDATE numen_creator_relations SET last_seen=1');
  assert.throws(()=>f.authority.issue('owner',role),{code:'NUMEN_IDENTITY_STALE'});
  f.db.exec("UPDATE numen_creator_relations SET last_seen=100000; UPDATE ownerships SET owner_id='other' WHERE agent_uuid='"+creator+"'");
  assert.throws(()=>f.authority.issue('owner',role),{code:'NUMEN_OWNERSHIP_CONFLICT'});
});

test('ordinary owned roles use the original UUID and a stable website principal without creating accounts',async t=>{
  const f=fixture(t);f.db.exec('DELETE FROM numen_creator_relations');
  const authority=portalHostingAuthority({store:{db:f.db},serverId:'test',grantKey:f.grantKey,ordinaryRoles:async()=>[{playerUuid:role,name:'OriginalRole'}],now:()=>100000});
  const a=verifyGrant(await authority.issue('owner',role),f.grantKey,100001);
  const b=verifyGrant(await authority.issue('owner',role),f.grantKey,100001);
  assert.equal(a.role.roleUuid,role);assert.equal(a.role.name,'OriginalRole');assert.equal(a.role.numenOwnerUuid,b.role.numenOwnerUuid);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM ownerships').get().n,2);
});

test('ownership is rechecked after an asynchronous ordinary-role lookup',async t=>{
  const f=fixture(t);f.db.exec('DELETE FROM numen_creator_relations');
  const authority=portalHostingAuthority({store:{db:f.db},serverId:'test',grantKey:f.grantKey,now:()=>100000,ordinaryRoles:async()=>{
    f.db.prepare('UPDATE ownerships SET owner_id=? WHERE agent_uuid=?').run('other',role);
    return[{playerUuid:role,name:'OriginalRole'}];
  }});
  await assert.rejects(authority.issue('owner',role),{code:'ROLE_NOT_OWNED'});
});
