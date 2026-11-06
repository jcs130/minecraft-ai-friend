import {identity,keyOf,opaqueId,digest,fail} from './protocol.mjs';
import {publicDialogueText} from '../../agent-portal/src/public-dialogue.mjs';

export class HostedConversations {
  constructor({store,hosting,body,voice,now=Date.now}) {
    Object.assign(this,{store,hosting,body,voice,now});this.inflight=new Set();
    store.db.exec(`CREATE TABLE IF NOT EXISTS hosted_messages(role TEXT NOT NULL,actor TEXT NOT NULL,id TEXT NOT NULL,
      signature TEXT NOT NULL,text TEXT NOT NULL,state TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(role,actor,id));
      UPDATE hosted_messages SET state='unknown' WHERE state='sending';`);
    store.db.exec('CREATE TABLE IF NOT EXISTS hosted_replies(role TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(role,id));');
  }
  actor(value) {
    if(!value||typeof value.id!=='string'||!/^[A-Za-z0-9_.:-]{1,120}$/.test(value.id)
      ||typeof value.name!=='string'||!value.name.trim()||value.name.length>48||/[\x00-\x1f\x7f]/.test(value.name))
      throw fail('CHAT_LOGIN_REQUIRED','请登录网站后与 Agent 交流。',401);
    return {id:value.id,name:value.name};
  }
  ready(role) {
    identity(role);const state=this.hosting.status(role);
    if(state.state!=='ready'||!['numen','harness'].includes(state.mode))throw fail('AGENT_NOT_LISTENING','Agent 正在暂停或由网页手动控制；请等它恢复托管后再发送。');
  }
  list(role,actor) {
    this.hosting.owned(role);actor=this.actor(actor);
    return this.store.db.prepare('SELECT id,text,state,created AS createdAt FROM hosted_messages WHERE role=? AND actor=? ORDER BY created DESC LIMIT 30')
      .all(keyOf(role),actor.id).reverse();
  }
  async replies(role) {
    this.hosting.owned(role);const key=keyOf(role);
    if(this.body.replies){
      try{for(const row of(await this.body.replies(role))??[]){const text=publicDialogueText(typeof row.body==='string'?row.body.replace(/\s*[\r\n]+\s*/g,' '):row.body,1200);
        if(text&&typeof row.id==='string'&&row.id.startsWith('speech-')&&Number.isSafeInteger(row.createdAt))this.store.db.prepare('INSERT OR IGNORE INTO hosted_replies VALUES(?,?,?,?)').run(key,row.id,text,row.createdAt);}}
      catch{} // Cached spoken replies remain readable when the body is offline.
    }
    this.store.db.prepare('DELETE FROM hosted_replies WHERE role=? AND (created<? OR id NOT IN (SELECT id FROM hosted_replies WHERE role=? ORDER BY created DESC LIMIT 1000))').run(key,this.now()-7*86400000,key);
    return this.store.db.prepare('SELECT id,body,created AS createdAt FROM hosted_replies WHERE role=? ORDER BY created DESC LIMIT 30').all(key).map(row=>({...row,source:'numen.hosted-speech'}));
  }
  async speakStored(role,actor,id) {
    this.hosting.owned(role);actor=this.actor(actor);opaqueId(id);await this.replies(role);
    const row=this.store.db.prepare('SELECT body FROM hosted_replies WHERE role=? AND id=?').get(keyOf(role),id);
    if(!row)throw fail('REPLY_NOT_FOUND','这条托管回复不存在，请刷新对话。',404);
    if(!this.voice)throw fail('VOICE_UNAVAILABLE','回复朗读尚未接通。',503);
    return this.voice.speak({role,actor:actor.id,id,text:row.body});
  }
  async send(role,actor,{id,text}) {
    this.ready(role);actor=this.actor(actor);opaqueId(id);
    const clean=publicDialogueText(text,1200);
    if(!clean||clean.startsWith('/'))throw fail('CHAT_TEXT_INVALID','请输入 1–1200 字的对话；不要在聊天里发送登录口令、API Key 或服务器命令。',400);
    const key=keyOf(role),signature=digest({text:clean,speaker:actor.name}),db=this.store.db;
    const old=db.prepare('SELECT id,state,signature FROM hosted_messages WHERE role=? AND actor=? AND id=?').get(key,actor.id,id);
    if(old){if(old.signature!==signature)throw fail('MESSAGE_ID_CONFLICT','此消息编号已有不同正文，请刷新消息状态。');return{id,state:old.state};}
    const since=this.now()-60000;
    if(db.prepare('SELECT count(*) AS n FROM hosted_messages WHERE actor=? AND created>?').get(actor.id,since).n>=12
      ||db.prepare('SELECT count(*) AS n FROM hosted_messages WHERE role=? AND created>?').get(key,since).n>=40)
      throw fail('CHAT_RATE_LIMIT','消息较多，请稍等；Agent 会在当前行动的安全间隙读取。',429);
    // Cap daily growth while retaining the receipts needed for deduplication.
    if(db.prepare('SELECT count(*) AS n FROM hosted_messages WHERE created>?').get(this.now()-86400000).n>=10000)
      throw fail('CHAT_DAILY_CAP','今日网页对话较多，请稍后再试。',429);
    const senderId=digest({server:role.serverId,actor:actor.id}),requestId='web-'+digest({role:key,actor:actor.id,id});
    db.prepare('INSERT INTO hosted_messages VALUES(?,?,?,?,?,?,?)').run(key,actor.id,id,signature,clean,'sending',this.now());
    let state='unknown';
    try {
      const result=await this.body.message(role,{id:requestId,senderId,speaker:actor.name,text:clean});
      if(result?.id===requestId&&result?.delivered===true&&result?.state==='completed')state='delivered';
    }catch{} // Never echo a native/model error that may include private context.
    db.prepare('UPDATE hosted_messages SET state=? WHERE role=? AND actor=? AND id=?').run(state,key,actor.id,id);
    return{id,state,message:state==='delivered'?'已送达 Agent 收件箱，等待它回复。':'送达结果暂不确定；请查原消息，不要重复发送。'};
  }
  async reconcile(role,actor,id) {
    this.hosting.owned(role);actor=this.actor(actor);opaqueId(id);
    const key=keyOf(role),row=this.store.db.prepare('SELECT state FROM hosted_messages WHERE role=? AND actor=? AND id=?').get(key,actor.id,id);
    if(!row)throw fail('MESSAGE_NOT_FOUND','未找到本人发送的消息。',404);
    if(row.state==='unknown') {
      const requestId='web-'+digest({role:key,actor:actor.id,id});let result;
      try{result=await this.body.messageResult(role,requestId);}catch{}
      if(result?.id===requestId&&result.delivered===true&&result.state==='completed'){
        this.store.db.prepare("UPDATE hosted_messages SET state='delivered' WHERE role=? AND actor=? AND id=?").run(key,actor.id,id);
        return{id,state:'delivered'};
      }
    }
    return{id,state:row.state};
  }
  async transcribe(role,actor,{id,audio}) {
    this.ready(role);actor=this.actor(actor);opaqueId(id);
    if(!this.voice)throw fail('VOICE_UNAVAILABLE','语音识别尚未接通，请先打字交流。',503);
    const lane=actor.id;if(this.inflight.has(lane))throw fail('VOICE_BUSY','上一条语音正在处理，请稍候。',429);
    this.inflight.add(lane);
    try{return await this.voice.transcribe({actor:digest({role:keyOf(role),actor:actor.id}),id,audio});}
    finally{this.inflight.delete(lane);}
  }
}
