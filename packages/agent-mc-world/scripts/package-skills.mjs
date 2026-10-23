import {readFileSync,readdirSync,lstatSync,mkdirSync,copyFileSync,writeFileSync,existsSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url)),pkg=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
if(!process.argv[2])throw new Error('Usage: node scripts/package-skills.mjs <output-directory>');
const output=resolve(process.argv[2]);mkdirSync(output,{recursive:true});
const archive=join(output,`agent-mc-skills-${pkg.version}.tgz`);
if(existsSync(archive))throw new Error('Refusing to overwrite an existing reviewed bundle');
const temp=mkdtempSync(join(tmpdir(),'agent-mc-skills-')),files=[];
const copy=(path,destination)=>{
  const stat=lstatSync(path);if(stat.isSymbolicLink())throw new Error('Symlinks are not skill release inputs');
  if(stat.isDirectory()){for(const name of readdirSync(path).sort())copy(join(path,name),join(destination,name));return;}
  if(!stat.isFile()||stat.size>256000)throw new Error('Unexpected skill release input');
  const rel=relative(temp,destination).replaceAll('\\','/');
  if(!/^(?:minecraft-agent|minecraft-learning)\/(?:SKILL\.md|agents\/openai\.yaml|references\/[a-z-]+\.md|scripts\/[a-z-]+\.mjs)$/.test(rel)&&rel!=='LICENSE')throw new Error(`Non-allowlisted release file: ${rel}`);
  mkdirSync(dirname(destination),{recursive:true});copyFileSync(path,destination);
  files.push({file:rel,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')});
};
try{
  for(const skill of ['minecraft-agent','minecraft-learning'])copy(join(root,'skills',skill),join(temp,skill));
  copy(join(root,'LICENSE'),join(temp,'LICENSE'));
  writeFileSync(join(temp,'skill-bundle-manifest.json'),JSON.stringify({schema:'agent-mc-skill-bundle/v1',version:pkg.version,license:pkg.license,
    repository:pkg.repository,gameTarget:'Java 1.21.1',runtimeInstalled:false,marketplacePublished:false,files},null,2)+'\n');
  execFileSync('tar',['-czf',archive,'-C',temp,'minecraft-agent','minecraft-learning','LICENSE','skill-bundle-manifest.json']);
  const sha256=createHash('sha256').update(readFileSync(archive)).digest('hex');
  writeFileSync(archive+'.sha256',`${sha256}  ${archive.split(/[\\/]/).at(-1)}\n`);
  console.log(JSON.stringify({archive,sha256,files:files.length,published:false}));
}finally{
  const base=resolve(tmpdir());
  if(dirname(resolve(temp))!==base||!resolve(temp).split(/[\\/]/).at(-1).startsWith('agent-mc-skills-'))throw new Error('Unexpected temporary path');
  rmSync(temp,{recursive:true,force:true});
}
