import { referenceImage } from './agent-profiles.mjs';
const fail=(status,reason,message)=>Object.assign(Error(message),{status,reason});
export class PlayerAvatars {
 constructor(store){this.store=store;store.db.exec('CREATE TABLE IF NOT EXISTS player_avatars(player_uuid TEXT PRIMARY KEY,player_name TEXT NOT NULL COLLATE NOCASE UNIQUE,mime TEXT NOT NULL,image BLOB NOT NULL,sha256 TEXT NOT NULL,updated_at INTEGER NOT NULL)');}
 get(agent){const r=this.store.db.prepare('SELECT sha256,updated_at FROM player_avatars WHERE player_uuid=?').get(agent.playerUuid);return {configured:!!r,url:'/api/v1/avatars/'+encodeURIComponent(agent.name),sha256:r?.sha256||null,visibility:'public'};}
 image(name){const r=this.store.db.prepare('SELECT mime,image,sha256 FROM player_avatars WHERE player_name=? COLLATE NOCASE').get(name);return r?{mime:r.mime,bytes:Buffer.from(r.image),sha256:r.sha256}:null;}
 set(agent,owner,bytes){if(agent.isReserved||agent.historical)throw fail(403,'AVATAR_ROLE_REQUIRED','请选择本人当前角色');const m=referenceImage(bytes);this.store.db.prepare('INSERT INTO player_avatars VALUES(?,?,?,?,?,?) ON CONFLICT(player_uuid) DO UPDATE SET player_name=excluded.player_name,mime=excluded.mime,image=excluded.image,sha256=excluded.sha256,updated_at=excluded.updated_at').run(agent.playerUuid,agent.name,m.mime,bytes,m.sha256,Date.now());this.store.audit(owner.id,'avatar.publish',agent.id);return this.get(agent);}
 fromReference(agent,owner,profiles,body){if(body?.publicConsent!==true)throw fail(400,'AVATAR_PUBLIC_CONSENT','请确认将这张图片用于公开头像');if(!/^[a-f0-9-]{36}$/.test(body.referenceId||''))throw fail(400,'AVATAR_REFERENCE_REQUIRED','请选择本人角色的设定图');return this.set(agent,owner,profiles.image(agent,body.referenceId).bytes);}
 remove(agent,owner){this.store.db.prepare('DELETE FROM player_avatars WHERE player_uuid=?').run(agent.playerUuid);this.store.audit(owner.id,'avatar.remove',agent.id);return this.get(agent);}
}
