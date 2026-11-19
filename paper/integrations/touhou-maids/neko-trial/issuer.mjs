import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

const api = '/api/v1/maid-connect';
const digest = text => createHash('sha256').update(text).digest('hex');
const proof = /^mdw_[A-Za-z0-9_-]{43}$/;
const invitation = /^mdinvite_[A-Za-z0-9_-]{43}$/;
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const ttl = 10 * 60_000;
function fault(status, reason) { return Object.assign(new Error(reason), { status }); }

export function trialIssuer(config, db, now = Date.now) {
  const origin = new URL(config.origin);
  const body = new URL(config.bodyEndpoint);
  if (origin.protocol !== 'https:' || origin.origin !== config.origin || body.protocol !== 'https:'
      || body.pathname !== '/api/v1/maid-body' || body.username || body.password || body.search || body.hash
      || !uuid.test(config.maidId) || !uuid.test(config.ownerId) || !Number.isSafeInteger(config.until)
      || !Array.isArray(config.invitations) || !config.invitations.length || config.invitations.length > 8
      || config.invitations.some(v => !/^[0-9a-f]{64}$/.test(v))) throw Error('Invalid trial settings');
  db.exec('PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, code TEXT NOT NULL, expires INTEGER NOT NULL, invite TEXT UNIQUE, approved INTEGER NOT NULL DEFAULT 0)');
  const addresses = new Map();
  function rate(key, limit) {
    const t = now();
    for (const [k, row] of addresses) if (row.until <= t) addresses.delete(k);
    const row = addresses.get(key);
    if ((row?.count || 0) >= limit || (!row && addresses.size >= 1024)) throw fault(429,'RATE_LIMITED');
    addresses.set(key, {count:(row?.count || 0)+1, until:row?.until || t+60_000});
  }
  function reply(res, code, result) {
    res.writeHead(code, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(JSON.stringify(result));
  }
  async function read(req) {
    if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw fault(415,'JSON_REQUIRED');
    const chunks=[]; let size=0;
    for await (const chunk of req.iterator({destroyOnReturn:false})){ size+=chunk.length; if(size>1200)throw fault(413,'TOO_LARGE'); chunks.push(chunk); }
    let value;
    try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw fault(400,'INVALID_JSON');}
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw fault(400,'INVALID_JSON');
    return value;
  }
  const server = createServer({requestTimeout:10000,headersTimeout:6000}, async (req,res) => {
    const path = req.url, t=now();
    try{
      if(req.method==='GET' && path===api+'/trial') {
        return reply(res,200,{active:t<config.until,name:config.name,expiresAt:config.until});
      }
      if(req.method!=='POST')throw fault(405,'POST_REQUIRED');
      if(t>=config.until)throw fault(410,'TRIAL_EXPIRED');
      const ip=String(req.headers['x-real-ip'] || req.socket.remoteAddress).slice(0,64);
      if(path===api+'/request' || path===api+'/check') {
        if(req.headers.origin || req.headers.cookie)throw fault(403,'DESKTOP_REQUIRED');
        if(path===api+'/request') {
          rate('start:'+ip,12);
          const payload=await read(req);
          if(Object.keys(payload).length!==1 || !/^[a-f0-9]{64}$/.test(payload.tokenHash || ''))throw fault(400,'INVALID_DEVICE');
          db.prepare('DELETE FROM devices WHERE approved=0 AND expires<=?').run(t);
          if(db.prepare('SELECT count(*) AS n FROM devices').get().n>=256)throw fault(429,'CAPACITY');
          const id=randomUUID(), code=randomBytes(3).toString('hex').toUpperCase(), expires=Math.min(t+ttl,config.until);
          const row=db.prepare('INSERT OR IGNORE INTO devices(id,token_hash,code,expires) VALUES(?,?,?,?)').run(id,payload.tokenHash,code,expires);
          if(!row.changes)throw fault(409,'REQUEST_EXISTS');
          return reply(res,201,{verificationUrl:origin.origin+'/maid-connect.html#request='+id,confirmationCode:code,expiresAt:expires,pollSeconds:3});
        }
        rate('check:'+ip,2400);
        const token=(req.headers.authorization || '').replace(/^Bearer /,'');
        if(!proof.test(token) || req.headers.authorization!=='Bearer '+token)throw fault(401,'UNAUTHORIZED');
        await read(req);
        const row=db.prepare('SELECT approved,expires FROM devices WHERE token_hash=? AND expires>?').get(digest(token),t);
        if(!row)throw fault(401,'UNAUTHORIZED');
        return row.approved ? reply(res,200,{state:'approved',ownerId:config.ownerId,maidId:config.maidId,bodyEndpoint:config.bodyEndpoint,expiresAt:row.expires}) : reply(res,202,{state:'pending'});
      }
      const match=new RegExp('^'+api+'/requests/([a-f0-9-]{36})/trial$').exec(path);
      if(!match||!uuid.test(match[1]))throw fault(404,'NOT_FOUND');
      if(req.headers.origin!==config.origin)throw fault(403,'INVALID_ORIGIN');
      rate('confirm:'+ip,15); rate('device:'+match[1],8);
      const data=await read(req);
      if(!invitation.test(data.invitation || '')||!/^[0-9A-F]{6}$/.test(data.confirmationCode || ''))throw fault(400,'INVALID_CONFIRMATION');
      const key=digest(data.invitation);
      const row=db.prepare('SELECT id,code,expires,approved,invite FROM devices WHERE id=? AND expires>?').get(match[1],t);
      if(!config.invitations.includes(key)||!row || !timingSafeEqual(Buffer.from(data.confirmationCode),Buffer.from(row.code)))throw fault(403,'CONFIRMATION_DENIED');
      if(row.approved && row.invite===key)return reply(res,200,{name:config.name,expiresAt:row.expires});
      if(row.approved || db.prepare('SELECT 1 FROM devices WHERE invite=?').get(key))throw fault(409,'INVITATION_USED');
      // All validations and this unique-key update run together in one synchronous turn.
      const result=db.prepare('UPDATE devices SET approved=1,invite=?,expires=? WHERE id=? AND approved=0').run(key,config.until,row.id);
      if(!result.changes)throw fault(409,'INVITATION_USED');
      return reply(res,200,{name:config.name,expiresAt:config.until});
    }catch(error){if(!res.headersSent&&!res.destroyed)reply(res,error.status||500,{error:{reason:error.status?error.message:'UNAVAILABLE'}});}
  });
  return server;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  const config=JSON.parse(readFileSync(process.argv[2],'utf8'));
  const db=new DatabaseSync(process.argv[3]);
  const server=trialIssuer(config,db);
  server.listen(Number(process.argv[4]),'127.0.0.1');
  const expiryTimer=setTimeout(()=>stop(),Math.max(0,config.until-Date.now()+3000));
  const stop=()=>{clearTimeout(expiryTimer);server.close(()=>{db.close();});};
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
}
