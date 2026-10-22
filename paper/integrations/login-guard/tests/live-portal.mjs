import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {parseArgs} from 'node:util';
const {values}=parseArgs({options:{root:{type:'string'},portal:{type:'string'}}});
const root=path.resolve(values.root);assert.ok(root.includes('network-accounts-20261023/lab/paper-auth')||root.includes('network-accounts-20261023\\lab\\paper-auth'));
const {seal,unseal,offlineUuid}=await import(values.portal),key=Buffer.from((await fs.readFile(path.join(root,'bridge.key'),'utf8')).trim(),'hex');
let checks=0;const check=(v,m)=>{assert.ok(v,m);checks++;};
async function until(fn){const end=Date.now()+15000;while(Date.now()<end){const r=await fn();if(r)return r;await new Promise(r=>setTimeout(r,100));}throw Error('NATIVE_PAPER_RECEIPT_TIMEOUT');}
const name='ag_PaperVerify4',password='isolated-native-paper-password',uuid=offlineUuid(name);
async function request(operation,extra={}){const id=randomUUID(),body={schemaVersion:1,requestId:id,operation,username:name,playerUuid:uuid,password,currentPassword:password,sharedCredential:true,createdAt:Date.now(),expiresAt:Date.now()+120000,...extra};await fs.writeFile(path.join(root,'bridge/requests',id+'.json'),seal(key,'request:'+id,body),{flag:'wx'});return until(async()=>{try{const r=unseal(key,'result:'+id,await fs.readFile(path.join(root,'bridge/results',id+'.json'),'utf8'));return ['succeeded','failed','unknown'].includes(r.state)?r:null;}catch(e){if(e.code!=='ENOENT')throw e;return null;}});}
await until(async()=>{try{const h=unseal(key,'heartbeat',await fs.readFile(path.join(root,'bridge/heartbeat.json'),'utf8'));return h.ready&&h.verify;}catch{return false;}});check(true,'fresh native verify feature advertised');
check((await request('create')).state==='succeeded','native LibreLogin create');
const db=new DatabaseSync(path.join(root,'proxy/plugins/librelogin/user-data.db'),{readOnly:true});
const snapshot=()=>createHash('sha256').update(JSON.stringify(db.prepare('SELECT * FROM librepremium_data WHERE last_nickname=?').get(name))).digest('hex');
const before=snapshot();check((await request('verify',{password:undefined})).state==='succeeded','native verify accepts original hash without new password');check(snapshot()===before,'readonly verification preserves entire native account row');
check((await request('verify',{username:name.toLowerCase(),password:undefined})).reason==='IDENTITY_MISMATCH','case variant cannot replace canonical identity');
for(let i=0;i<3;i++)check((await request('verify',{currentPassword:'wrong-isolated-password',password:undefined})).reason==='PASSWORD_INCORRECT','wrong native password rejected');
check((await request('verify',{password:undefined})).reason==='PASSWORD_BLOCKED','third wrong password triggers bounded website verification lockout');check(snapshot()===before,'failed verification and lockout do not modify native account or sessions');
check((await fs.readdir(path.join(root,'bridge/managed'))).includes(uuid+'.json'),'shared-role management marker persists');db.close();console.log('PASS '+checks+' actual LibreLogin readonly verification and identity checks');
