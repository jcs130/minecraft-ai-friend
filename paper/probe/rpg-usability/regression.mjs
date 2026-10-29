/** Sequential scenarios share one marked QA start; no concurrent control of any body. */
import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
const stage='E:/MC/staging/vortex-takeover-20261027',label=process.argv[2];assert.equal(await fs.readFile(stage+'/.qa-only','utf8'),'VORTEX_TAKEOVER_QA_ONLY');assert(/^[a-z0-9]{1,7}$/.test(label));
const report={productionChanged:false,results:[]};
for(const [path,name]of [['./client.mjs',label],['../../integrations/vortex-rpg/probe/six-classes-client.mjs',label]]){
 const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[fileURLToPath(new URL(path,import.meta.url)),name],{stdio:'inherit'});child.on('error',reject);child.on('exit',resolve);});report.results.push({path,exit:code});if(code!==0){await fs.writeFile(stage+'/rpg-regression-'+label+'.json',JSON.stringify(report,null,2));process.exit(code??1);}
}
report.passed=true;await fs.writeFile(stage+'/rpg-regression-'+label+'.json',JSON.stringify(report,null,2));
