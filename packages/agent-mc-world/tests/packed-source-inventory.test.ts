import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {expect, it} from 'vitest';

it('verifies actual shipped source inputs and rejects missing or changed source bytes in packed mode',()=>{
  const root=mkdtempSync(join(tmpdir(),'mc-packed-source-'));
  const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
  const source='export const publicPort = true;\n';
  const runtime='export class MinecraftAgentClient {}\nexport const PROTOCOL="agent-mc/v1";\n';
  const types='export declare class MinecraftAgentClient {}\n';
  try{
    for(const directory of ['src','scripts','dist/runtime/src','dist/types'])mkdirSync(join(root,directory),{recursive:true});
    writeFileSync(join(root,'scripts/verify-build.mjs'),readFileSync(fileURLToPath(new URL('../scripts/verify-build.mjs',import.meta.url))));
    writeFileSync(join(root,'package.json'),JSON.stringify({type:'module',exports:{'.':{default:'./dist/runtime/src/index.js',types:'./dist/types/index.d.ts'}}}));
    writeFileSync(join(root,'release-sources.json'),JSON.stringify({viewer:{}}));
    writeFileSync(join(root,'src/public-port.ts'),source);
    writeFileSync(join(root,'dist/runtime/src/index.js'),runtime);
    writeFileSync(join(root,'dist/types/index.d.ts'),types);
    writeFileSync(join(root,'dist/build.json'),JSON.stringify({viewer:{included:false},
      files:[{file:'dist/runtime/src/index.js',sha256:hash(runtime)}],
      sourceFiles:[{file:'src/public-port.ts',sha256:hash(source)}]}));
    writeFileSync(join(root,'dist/types/manifest.json'),JSON.stringify({files:[{file:'index.d.ts',sha256:hash(types)}]}));
    const verify=()=>execFileSync(process.execPath,[join(root,'scripts/verify-build.mjs'),'--packed'],{encoding:'utf8',stdio:'pipe'});
    expect(verify()).toContain('Complete packed runtime');
    rmSync(join(root,'src/public-port.ts'));
    expect(verify).toThrow();
    writeFileSync(join(root,'src/public-port.ts'),'export const publicPort = false;\n');
    expect(verify).toThrow();
  }finally{rmSync(root,{recursive:true,force:true});}
});
