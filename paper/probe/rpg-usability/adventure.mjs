import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
const stage='E:/MC/staging/vortex-takeover-20261027',label=process.argv[2];assert.equal(await fs.readFile(stage+'/.qa-only','utf8'),'VORTEX_TAKEOVER_QA_ONLY');assert(/^[a-z0-9]+$/.test(label));
const report={productionChanged:false,results:[]};
for(const path of ['../../integrations/vortex-rpg/probe/dungeon-loadout-client.mjs','../../integrations/vortex-rpg/probe/native-dungeon-client.mjs']){
 const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[fileURLToPath(new URL(path,import.meta.url)),label],{stdio:'inherit'});child.on('error',reject);child.on('exit',resolve);});report.results.push({path,exit:code});if(code!==0){await fs.writeFile(stage+'/rpg-adventure-'+label+'.json',JSON.stringify(report,null,2));process.exit(code??1);}
}
report.passed=true;await fs.writeFile(stage+'/rpg-adventure-'+label+'.json',JSON.stringify(report,null,2));
