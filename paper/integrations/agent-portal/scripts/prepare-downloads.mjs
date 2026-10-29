import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {parseArgs} from 'node:util';
import {reviewedSkills} from '../src/agent-skill.mjs';
import {downloadBaseUrl} from '../src/download-mirror.mjs';

// Explicit operator/CI preparation, never an install hook or server request.
// Releases live in OSS; cloning source need not store every ZIP in Git.
export async function prepareSkillDownloads({directory,baseUrl,releases=reviewedSkills,fetchImpl=fetch}) {
  const base=downloadBaseUrl(baseUrl);if(!base)throw Error('public_download_base_required');
  await fs.mkdir(directory,{recursive:true});const result=[];
  for(const release of releases){
    if(!/^qiandengji-agent-[0-9]+\.[0-9]+\.[0-9]+\.zip$/.test(release.filename)
      ||!Number.isSafeInteger(release.bytes)||release.bytes<1||release.bytes>8*1024*1024||!/^[a-f0-9]{64}$/.test(release.sha256))throw Error('invalid_reviewed_release');
    const target=path.join(directory,release.filename),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
    try{
      const stat=await fs.lstat(target);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==release.bytes||hash(await fs.readFile(target))!==release.sha256)throw Error('existing_download_mismatch');
      result.push({filename:release.filename,downloaded:false});continue;
    }catch(error){if(error.code!=='ENOENT')throw error;}
    const response=await fetchImpl(base+release.sha256+'/'+release.filename,{credentials:'omit',signal:AbortSignal.timeout(60000)});
    if(!response.ok||!response.body)throw Error('reviewed_download_unavailable');
    let length=0;const chunks=[];
    for await(const chunk of response.body){length+=chunk.length;if(length>release.bytes)throw Error('download_size_mismatch');chunks.push(chunk);}
    const bytes=Buffer.concat(chunks);if(length!==release.bytes||hash(bytes)!==release.sha256)throw Error('download_checksum_mismatch');
    const temporary=target+'.'+randomUUID()+'.partial';
    await fs.writeFile(temporary,bytes,{flag:'wx',mode:0o644});
    try{await fs.link(temporary,target);}finally{await fs.unlink(temporary);}
    result.push({filename:release.filename,downloaded:true});
  }
  return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const{values}=parseArgs({options:{'base-url':{type:'string'},directory:{type:'string'}}});
  const files=await prepareSkillDownloads({directory:values.directory??fileURLToPath(new URL('../public/downloads',import.meta.url)),baseUrl:values['base-url']??''});
  console.log(JSON.stringify({verified:true,files}));
}
