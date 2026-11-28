/** Offline, opt-in import. The operator must establish the named profile's historical endpoint and account. */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, mkdirSync, cpSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const hash = parts => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
export function importProfileLearning(dataDir, origin, apply = false) {
  const {profile, realm, auth, username, botName, agent = botName, worlds = []} = origin;
  if (![profile,realm,auth,username,botName,agent].every(x => typeof x==='string' && x.trim() && x.length<=500)
    || !Array.isArray(worlds) || worlds.some(x => typeof x!=='string' || !x || x.length>256)) throw Error('Supply the verified profile, realm, auth, username, botName and native world names.');
  const rows=[];
  function importOne(kind, oldParts, newParts) {
    const methods=kind==='methods', folder=path.resolve(dataDir,methods?'minecraft-methods':'minecraft-memory');
    const key=hash(oldParts), newKey=hash(newParts);
    const source=path.join(folder,key+(methods?'':'.json')), target=path.join(folder,newKey+(methods?'':'.json'));
    if (!existsSync(source)) return;
    let contents;
    if (!methods) {
      const book=JSON.parse(readFileSync(source,'utf8'));
      if (book.version!==1 || book.scopeKey!==key || !Array.isArray(book.entries)) throw Error('Unexpected source book: '+source);
      const entries=book.entries.filter(e => e.versions.at(-1)?.tags?.includes('scene-guide'));
      if (!entries.length) return;
      contents=JSON.stringify({...book,scopeKey:newKey,entries});
    } else if (!existsSync(path.join(source,'index.json')) || existsSync(path.join(source,'write.lock'))) throw Error('Method index missing or busy: '+source);
    if (existsSync(target)) {rows.push({kind,source,target,status:'destination-exists'});return;}
    if (apply) {
      mkdirSync(folder,{recursive:true});
      const temporary=path.join(folder,newKey+'-'+randomUUID()+'.tmp');
      try {
        if(methods) cpSync(source,temporary,{recursive:true,errorOnExist:true,force:false});
        else writeFileSync(temporary,contents,{flag:'wx',mode:0o600});
        if(existsSync(target)) throw Error('Destination appeared during import');
        renameSync(temporary,target);
      } finally {
        if(path.dirname(temporary)===folder && existsSync(temporary))rmSync(temporary,{recursive:methods,force:true});
      }
    }
    rows.push({kind,source,target,status:apply?'imported':'would-import'});
  }
  const scoped=r=>JSON.stringify([r,profile]);
  importOne('methods',[realm,auth,username,botName],[scoped(realm),auth,username,botName]);
  for(const map of [realm,...new Set(worlds.map(w=>JSON.stringify([realm,['vanilla-world',w]])))]) {
    importOne('scenes',[map,auth+':'+username,agent],[scoped(map),auth+':'+username,agent]);
  }
  return rows;
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const [folder,file,flag]=process.argv.slice(2);
  if(!folder || !file || (flag && flag!=='--apply')) throw Error('Usage: node scripts/import-profile-learning.mjs DATA_DIR verified-origin.json [--apply]');
  console.log(JSON.stringify(importProfileLearning(folder,JSON.parse(readFileSync(file,'utf8')),flag==='--apply'),null,2));
}
