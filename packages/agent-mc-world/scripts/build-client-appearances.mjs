import {spawnSync} from 'node:child_process';
import {copyFileSync,existsSync,mkdirSync,readdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {delimiter,dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),args=process.argv.slice(2),game=args[0]&&resolve(args[0]);
const index=args.indexOf('--java-home'),jdk=index>=0?args[index+1]:process.env.JAVA_HOME;
if(!game||!existsSync(join(game,'.fabric','remappedJars')))throw Error('A previously launched matching Fabric 1.21.1 client is required');
const jars=p=>existsSync(p)?readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?jars(join(p,e.name)):e.name.endsWith('.jar')?[join(p,e.name)]:[]):[];
const work=join(root,'scratch','client-appearances'),classes=join(work,'classes'),deps=join(work,'deps');
if(!classes.startsWith(resolve(root,'scratch','client-appearances')+sep))throw Error('Unsafe compiler output directory');
rmSync(classes,{recursive:true,force:true});
mkdirSync(classes,{recursive:true});mkdirSync(deps,{recursive:true});
function run(name,argv,cwd=root){const r=spawnSync(jdk?join(jdk,'bin',name+(process.platform==='win32'?'.exe':'')):name,argv,{cwd,windowsHide:true,encoding:'utf8'});if(r.error)throw r.error;if(r.status!==0)throw Error(name+': '+r.stdout+'\n'+r.stderr);if(r.stdout.trim())process.stdout.write(r.stdout);}
const api=jars(join(game,'mods')).find(p=>p.endsWith('fabric-api-0.115.4+1.21.1.jar'));
const ysm=jars(join(game,'mods')).find(p=>p.endsWith('yesstevemodel-fabric-1.21.1-2.4.1-release.jar'));
const mc=jars(join(game,'.fabric','remappedJars')).find(p=>p.includes('minecraft-1.21.1-')&&p.endsWith('client-intermediary.jar'));
if(!api||!ysm||!mc)throw Error('Verified Minecraft 1.21.1, Fabric API 0.115.4 and YSM 2.4.1 inputs are required');
run('jar',['--extract','--file',api],deps);
const cp=[mc,ysm,...jars(join(game,'libraries')),...jars(join(deps,'META-INF','jars'))].join(delimiter);
const owner=join(root,'client-appearance'),sources=['AppearancePolicy.java','AppearancePolicyCheck.java','ClientAppearances.java','YsmHudTargetMixin.java','YsmHudContractCheck.java'].map(p=>join(owner,p));
const manifest=JSON.parse(readFileSync(join(owner,'fabric.mod.json'),'utf8'));
const mixins=JSON.parse(readFileSync(join(owner,'agentmc-client-appearances.mixins.json'),'utf8'));
for(const entrypoint of Object.values(manifest.entrypoints).flat()){
  if(typeof entrypoint!=='string'||entrypoint.startsWith(mixins.package+'.'))throw Error('Entrypoint cannot be inside the reserved Mixin package');
}
const argFile=join(work,'javac.args');writeFileSync(argFile,['--release','21','-encoding','UTF-8','-proc:none','-classpath',cp,'-d',classes,...sources].map(v=>'"'+v.replaceAll('\\','/').replaceAll('"','\\"')+'"').join('\n'));
run('javac',['@'+argFile]);run('java',['-cp',classes+delimiter+cp,'AppearancePolicyCheck']);
run('java',['-cp',classes+delimiter+cp,'YsmHudContractCheck',ysm]);
for(const name of mixins.client)if(!existsSync(join(classes,...mixins.package.split('.'),name+'.class')))throw Error('Declared Mixin class missing from compiled output');
const output=join(work,`${manifest.id}-${manifest.version}.jar`);
run('jar',['--create','--file',output,'-C',classes,'org','-C',owner,'fabric.mod.json','-C',owner,'agentmc-client-appearances.mixins.json']);
if(args.includes('--install')){copyFileSync(output,join(game,'mods','agentmc-client-appearances.jar'));console.log('Installed into selected native client; reconnect only that client to activate');}else console.log(output);
