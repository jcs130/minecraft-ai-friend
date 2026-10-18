import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';

/** Build a lazy shim with an explicit or installed MSVC x64 SDK. */
export function buildMesaPresentation(owner,work,{vcvars64}={}) {
  if(process.platform!=='win32')throw Error('The Windows presentation bridge must be built on Windows');
  if(!vcvars64){
    const vswhere=join(process.env['ProgramFiles(x86)']||'C:/Program Files (x86)','Microsoft Visual Studio','Installer','vswhere.exe');
    if(!existsSync(vswhere))throw Error('Install MSVC x64 build tools or provide --vcvars64');
    const found=spawnSync(vswhere,['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath'],{windowsHide:true,encoding:'utf8'});
    if(found.status!==0||!found.stdout.trim())throw Error('MSVC x64 build tools are unavailable');
    vcvars64=join(found.stdout.trim(),'VC','Auxiliary','Build','vcvars64.bat');
  }
  vcvars64=resolve(vcvars64);
  if(!existsSync(vcvars64)||/["%\r\n!]/.test(vcvars64))throw Error('Invalid MSVC environment script');
  const setup=spawnSync('cmd.exe',['/d','/c','call',vcvars64,'>nul','&&','set','INCLUDE','&&','set','LIB','&&','set','PATH'],{windowsHide:true,encoding:'utf8'});
  if(setup.status!==0)throw Error('MSVC environment initialization failed');
  const env={...process.env};
  for(const line of setup.stdout.split(/\r?\n/)){
    const split=line.indexOf('=');if(split<1)continue;const name=line.slice(0,split),value=line.slice(split+1);
    if(!/^(include|lib|libpath|path)$/i.test(name))continue;
    for(const existing of Object.keys(env))if(existing.toLowerCase()===name.toLowerCase())delete env[existing];
    env[name]=value;
  }
  const search=Object.entries(env).find(([k])=>k.toLowerCase()==='path')?.[1]||'';
  const compiler=search.split(';').map(p=>join(p,'cl.exe')).find(existsSync);
  if(!compiler)throw Error('MSVC compiler is unavailable after initialization');
  work=resolve(work);mkdirSync(work,{recursive:true});const output=join(work,'agGDI.dll');
  const object=join(work,'MesaPresentation.obj');
  const compile=spawnSync(compiler,['/nologo','/O2','/W4','/c','/Zl',join(owner,'MesaPresentation.c'),'/Fo'+object],{cwd:work,env,windowsHide:true,encoding:'utf8'});
  if(compile.error||compile.status!==0)throw Error('Presentation bridge compilation failed: '+String(compile.stderr||compile.stdout).slice(0,4000));
  const linker=join(compiler.slice(0,compiler.length-'cl.exe'.length),'link.exe');
  const result=spawnSync(linker,['/nologo','/DLL','/NOENTRY','/NODEFAULTLIB','/MACHINE:X64','/DYNAMICBASE','/NXCOMPAT','/HIGHENTROPYVA','/DEF:'+join(owner,'MesaPresentation.def'),'/OUT:'+output,'/IMPLIB:'+join(work,'agGDI.lib'),object,'kernel32.lib','gdi32.lib'],{cwd:work,env,windowsHide:true,encoding:'utf8'});
  if(result.error||result.status!==0||!existsSync(output))throw Error('Presentation bridge link failed: '+String(result.stderr||result.stdout).slice(0,4000));
  return output;
}
